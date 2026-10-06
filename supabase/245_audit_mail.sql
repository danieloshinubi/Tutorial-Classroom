-- The audit log records mail sent and received (2026-10-06). Chat is not
-- logged (the school's choice).
--
-- What is kept is the trace, never the content: for an email, who sent it,
-- from which address, to whom (To / Cc / Bcc), the subject, whether it had
-- files and its size; for one that came in from outside, who it was from,
-- which mailbox took it, and whether it went to Junk. Message bodies are
-- never copied into the log.
--
-- Two new actions, SENT and RECEIVED, beside INSERT / UPDATE / DELETE.
-- Imported old mail, automatic notes (read receipts, Schoolivio's own
-- reports) and the recipients' own copies of internal mail are not logged
-- separately: the one SENT entry lists everyone it went to.

alter table classroom.audit_log drop constraint if exists audit_log_action_check;
alter table classroom.audit_log add constraint audit_log_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'SENT', 'RECEIVED'));

create index if not exists audit_log_school_table_idx on classroom.audit_log (school_id, table_name);

-- One audit row, with where the request came from (as the other audit triggers).
create or replace function classroom.audit_write(school uuid, tbl text, rec text, act text, actor uuid, data jsonb)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  actor_name text;
  actor_role text;
begin
  if school is null then return; end if;
  if actor is not null then
    select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username) into actor_name from classroom.profiles p where p.id = actor;
    select string_agg(distinct m.role::text, ', ') into actor_role from classroom.school_members m where m.school_id = school and m.user_id = actor and m.is_active;
  end if;
  insert into classroom.audit_log (school_id, table_name, record_id, action, actor_id, actor_label, actor_role,
      old_data, new_data, changed_fields, ip_address, country, user_agent)
  values (school, tbl, rec, act, actor, coalesce(actor_name, 'Schoolivio (automatic)'), actor_role, null, data, null,
      case when actor is null then null else coalesce(headers ->> 'cf-connecting-ip', split_part(headers ->> 'x-forwarded-for', ',', 1), headers ->> 'x-real-ip') end,
      case when actor is null then null else nullif(headers ->> 'cf-ipcountry', '') end,
      case when actor is null then null else nullif(headers ->> 'user-agent', '') end);
end;
$fn$;
revoke all on function classroom.audit_write(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;

-- Addresses only, from a To / Cc / Bcc list.
create or replace function classroom.audit_addresses(list jsonb)
returns jsonb language sql immutable as $fn$
  select coalesce(jsonb_agg(lower(x ->> 'address')), '[]'::jsonb) from jsonb_array_elements(coalesce(list, '[]'::jsonb)) x where coalesce(x ->> 'address', '') <> '';
$fn$;

-- Mail -------------------------------------------------------------------------------------------
create or replace function classroom.audit_mail()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  actor uuid;
begin
  select * into box from classroom.mail_mailboxes where id = new.mailbox_id;
  if not found then return null; end if;

  -- Sent: a draft leaving Drafts through Send (to Sent, or the Outbox while
  -- outside mail waits). Automatic replies and rule forwards count too, as
  -- Schoolivio's own.
  if tg_op = 'UPDATE' and old.folder = 'drafts' and new.folder in ('sent', 'outbox') then
    actor := case when new.is_auto then null
                  else coalesce((select auth.uid()), nullif(current_setting('classroom.actor', true), '')::uuid) end;
    perform classroom.audit_write(box.school_id, 'mail_messages', new.id::text, 'SENT', actor, jsonb_build_object(
      'subject', new.subject,
      'from', new.from_address,
      'from_name', new.from_name,
      'mailbox', box.address,
      'to', classroom.audit_addresses(new.to_list),
      'cc', classroom.audit_addresses(new.cc_list),
      'bcc', classroom.audit_addresses(new.bcc_list),
      'attachments', new.has_attachments,
      'size_bytes', new.size_bytes,
      'scheduled', new.scheduled_at is not null,
      'automatic', new.is_auto));

  -- Received from outside: each mailbox that took it.
  elsif tg_op = 'INSERT' and new.inbound_id is not null and new.inbound_id not like 'imp:%' then
    perform classroom.audit_write(box.school_id, 'mail_messages', new.id::text, 'RECEIVED', null, jsonb_build_object(
      'subject', new.subject,
      'from', new.from_address,
      'from_name', new.from_name,
      'mailbox', box.address,
      'to', classroom.audit_addresses(new.to_list),
      'cc', classroom.audit_addresses(new.cc_list),
      'attachments', new.has_attachments,
      'size_bytes', new.size_bytes,
      'folder', new.folder,
      'warning', new.warning));
  end if;
  return null;
end;
$fn$;

drop trigger if exists audit_mail_sent on classroom.mail_messages;
create trigger audit_mail_sent after update of folder on classroom.mail_messages
  for each row when (old.folder = 'drafts' and new.folder in ('sent', 'outbox'))
  execute function classroom.audit_mail();
drop trigger if exists audit_mail_received on classroom.mail_messages;
create trigger audit_mail_received after insert on classroom.mail_messages
  for each row when (new.inbound_id is not null)
  execute function classroom.audit_mail();

-- A scheduled message goes out as whoever scheduled it.
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_send_due()'::regprocedure);
  d := replace(d, $a$      perform classroom.mail_send_as(r.id, r.actor);$a$,
               $b$      perform set_config('classroom.actor', r.actor::text, true);
      perform classroom.mail_send_as(r.id, r.actor);$b$);
  if position($p$set_config('classroom.actor', r.actor::text$p$ in d) = 0 then raise exception 'mail_send_due patch did not apply'; end if;
  execute d;
end;
$do$;

-- The "Kind of record" choices: every kind this school has, however many
-- rows (the page used to read a sample of 5,000 rows, which busy mail would fill).
create or replace function classroom.audit_log_tables(target_school uuid)
returns setof text language sql stable security definer set search_path = classroom, public as $fn$
  -- Same rule as reading the log itself.
  select distinct a.table_name from classroom.audit_log a
   where a.school_id = target_school
     and (classroom.has_role_in(target_school, array['owner', 'admin']::classroom.member_role[])
          or classroom.module_access(target_school, 'auditlog') is not null)
   order by 1;
$fn$;
revoke all on function classroom.audit_log_tables(uuid) from public, anon;
grant execute on function classroom.audit_log_tables(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Chat messages were logged briefly on 2026-10-06; that is undone here.
drop trigger if exists audit_chat_sent on classroom.chat_messages;
drop function if exists classroom.audit_chat();
