-- Schoolivio Mail: fixes from the QA pass over 236-243 (2026-10-06).
--
--  1. What a person may write into a message row themselves. Drafts are
--     written straight from the app (RLS), so the columns only the server
--     should set (envelope, Message-ID, sender, size, flags set on arrival)
--     are forced on insert and frozen on update. Before this someone could
--     put a draft into another message's envelope and so add a file to
--     mail they did not write, or plant "received" mail with a forged sender.
--  2. Read-only members of a shared mailbox can no longer change or schedule
--     its drafts (a scheduled draft used to go out as the mailbox, unchecked).
--     A scheduled draft now goes out as whoever scheduled it.
--  3. Recall: only the sender's own sent copy, by someone who can send from
--     that mailbox, and only that message's copies (a rule's forward shares
--     the envelope but is a different message).
--  4. Opened alerts, read receipts and the receipts list only count copies of
--     the same message (not a rule's forward of it).
--  5. Access needs current staff membership (a leaver loses their mailbox
--     straight away) and the Mail module not switched off for them.
--     mail_access no longer answers about other people.
--  6. Storage: a file can be removed only from a draft's folder, by someone
--     who can write in that mailbox.
--  7. The admins' "reached the sending limit" alert is kept: it was rolled
--     back with the refused send.
--  8. Retention: schools that never saved mail settings get the 30-day
--     defaults; old import uploads are really returned for removal.
--  9. Moving everyone to the domain avoids group addresses; aliases kept
--     from an earlier domain can be saved again.
-- 10. Automatic replies never go to automatic mail; a safe sender is still
--     checked for forgery; imported mail no longer counts as received.
-- 11. mail_settings_save keeps the last error unless told otherwise;
--     disconnecting turns receiving off; Console sort; actors in the audit
--     log for disconnect, receiving and Microsoft 365.
-- 12. Import progress keeps the parts and the "finished" mark that arrive
--     while a turn runs.
-- 13. One "opened" token per outside email (several recipients in one email).

-- 1. Message rows written by people -------------------------------------------------------------
create or replace function classroom.mail_messages_insert_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  if current_user in ('authenticated', 'anon') then
    new.envelope_id := gen_random_uuid();
    new.message_id := '<' || gen_random_uuid() || '@schoolivio.com>';
    new.folder := 'drafts';
    new.previous_folder := null;
    new.from_address := '';
    new.from_name := '';
    new.size_bytes := 0;
    new.has_attachments := false;
    new.is_read := true;
    new.sent_at := null;
    new.external_pending := 0;
    new.inbound_id := null;
    new.reply_to := '[]'::jsonb;
    new.scheduled_at := null;
    new.recalled_at := null;
    new.is_auto := false;
    new.spam_score := null;
    new.spam_reasons := '{}';
    new.warning := null;
    -- A reply joins a conversation this mailbox already has, or starts its own.
    if not exists (select 1 from classroom.mail_messages m where m.thread_id = new.thread_id and m.mailbox_id = new.mailbox_id) then
      new.thread_id := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists mail_messages_insert_guard on classroom.mail_messages;
create trigger mail_messages_insert_guard before insert on classroom.mail_messages
  for each row execute function classroom.mail_messages_insert_guard();

create or replace function classroom.mail_messages_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  if current_user in ('authenticated', 'anon') then
    if new.envelope_id is distinct from old.envelope_id or new.message_id is distinct from old.message_id
       or new.mailbox_id is distinct from old.mailbox_id or new.thread_id is distinct from old.thread_id
       or new.from_address is distinct from old.from_address or new.from_name is distinct from old.from_name
       or new.size_bytes is distinct from old.size_bytes or new.has_attachments is distinct from old.has_attachments
       or new.sent_at is distinct from old.sent_at or new.inbound_id is distinct from old.inbound_id
       or new.is_auto is distinct from old.is_auto or new.recalled_at is distinct from old.recalled_at
       or new.spam_score is distinct from old.spam_score or new.spam_reasons is distinct from old.spam_reasons
       or new.warning is distinct from old.warning or new.external_pending is distinct from old.external_pending
       or new.reply_to is distinct from old.reply_to then
      raise exception 'That cannot be changed.';
    end if;
    if old.folder <> 'drafts' and (
         new.subject is distinct from old.subject or new.body_html is distinct from old.body_html
         or new.to_list is distinct from old.to_list or new.cc_list is distinct from old.cc_list
         or new.bcc_list is distinct from old.bcc_list or new.importance is distinct from old.importance
         or new.in_reply_to is distinct from old.in_reply_to or new.track_opens is distinct from old.track_opens
         or new.read_receipt is distinct from old.read_receipt or new.scheduled_at is distinct from old.scheduled_at) then
      raise exception 'A sent or received message cannot be edited.';
    end if;
    if new.folder = 'drafts' and old.folder <> 'drafts' then
      raise exception 'Only an unsent message can be a draft.';
    end if;
    -- A draft leaves Drafts only by being sent, or deleted.
    if old.folder = 'drafts' and new.folder not in ('drafts', 'deleted') then
      raise exception 'Use Send to send a message.';
    end if;
    if new.folder in ('sent', 'outbox') and old.folder <> new.folder then
      raise exception 'Use Send to send a message.';
    end if;
    -- Read-only members file and read; they do not write.
    if old.folder = 'drafts' and coalesce(classroom.mail_access(old.mailbox_id, (select auth.uid())), 'read') = 'read' then
      raise exception 'You can only read this mailbox.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

-- Files attached to drafts: by someone who can write in that mailbox.
drop policy if exists "owners attach to drafts" on classroom.mail_attachments;
create policy "owners attach to drafts" on classroom.mail_attachments for insert to authenticated
  with check (coalesce(classroom.mail_access(mailbox_id, (select auth.uid())), 'read') in ('own', 'full', 'on_behalf')
              and size_bytes >= 0
              and exists (select 1 from classroom.mail_messages m
                           where m.envelope_id = mail_attachments.envelope_id and m.mailbox_id = mail_attachments.mailbox_id and m.folder = 'drafts'));
drop policy if exists "owners remove draft attachments" on classroom.mail_attachments;
create policy "owners remove draft attachments" on classroom.mail_attachments for delete to authenticated
  using (coalesce(classroom.mail_access(mailbox_id, (select auth.uid())), 'read') in ('own', 'full', 'on_behalf')
         and exists (select 1 from classroom.mail_messages m
                      where m.envelope_id = mail_attachments.envelope_id and m.mailbox_id = mail_attachments.mailbox_id and m.folder = 'drafts')
         and not exists (select 1 from classroom.mail_messages m where m.envelope_id = mail_attachments.envelope_id and m.folder <> 'drafts'));

-- 6. Storage: uploads into a draft's folder; removals only while nothing sent uses it.
drop policy if exists "mail owners upload" on storage.objects;
create policy "mail owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'mail'
              and coalesce(classroom.mail_access(classroom.try_uuid((storage.foldername(name))[1]), (select auth.uid())), 'read') in ('own', 'full', 'on_behalf')
              and exists (select 1 from classroom.mail_messages m
                           where m.envelope_id = classroom.try_uuid((storage.foldername(name))[2])
                             and m.mailbox_id = classroom.try_uuid((storage.foldername(name))[1]) and m.folder = 'drafts'));
drop policy if exists "mail owners remove" on storage.objects;
create policy "mail owners remove" on storage.objects for delete to authenticated
  using (bucket_id = 'mail'
         and coalesce(classroom.mail_access(classroom.try_uuid((storage.foldername(name))[1]), (select auth.uid())), 'read') in ('own', 'full', 'on_behalf')
         and not exists (select 1 from classroom.mail_messages m
                          where m.envelope_id = classroom.try_uuid((storage.foldername(name))[2]) and m.folder <> 'drafts'));

-- 5. Access ------------------------------------------------------------------------------------
-- Current staff of the mailbox's school only, and Mail not switched off for
-- them. Asked about someone else, it only answers the server.
create or replace function classroom.mail_access(target_mailbox uuid, who uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select case
    when (select auth.uid()) is not null and who is distinct from (select auth.uid()) then null
    when not exists (select 1 from classroom.mail_mailboxes b join classroom.school_members sm on sm.school_id = b.school_id
                      where b.id = target_mailbox and sm.user_id = who and sm.is_active) then null
    when (select auth.uid()) is not null
         and coalesce(classroom.module_override((select b.school_id from classroom.mail_mailboxes b where b.id = target_mailbox), 'mail'), '') = 'none' then null
    when exists (select 1 from classroom.mail_mailboxes where id = target_mailbox and user_id = who) then 'own'
    else (select access from classroom.mail_mailbox_members where mailbox_id = target_mailbox and user_id = who) end;
$fn$;

create or replace function classroom.owns_mailbox(target_mailbox uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.mail_access(target_mailbox, (select auth.uid())) is not null;
$fn$;

-- Who is safe or blocked: the server's question only.
revoke execute on function classroom.mail_sender_standing(uuid, text) from authenticated;

-- 2. Scheduling -------------------------------------------------------------------------------
alter table classroom.mail_messages add column if not exists scheduled_by uuid references auth.users (id) on delete set null;

create or replace function classroom.mail_schedule(target_draft uuid, at_in timestamptz)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare d classroom.mail_messages;
begin
  select * into d from classroom.mail_messages where id = target_draft;
  if not found or d.folder <> 'drafts' or coalesce(classroom.mail_access(d.mailbox_id, (select auth.uid())), 'read') = 'read' then
    raise exception 'That draft is not yours.';
  end if;
  if at_in is not null and at_in < now() + interval '1 minute' then raise exception 'Pick a time at least a minute from now.'; end if;
  if at_in is not null and at_in > now() + interval '1 year' then raise exception 'Pick a time within the next year.'; end if;
  update classroom.mail_messages set scheduled_at = at_in, scheduled_by = case when at_in is null then null else (select auth.uid()) end
   where id = d.id;
end;
$fn$;

-- 7. The sending-limit alert, in its own right (a refused send rolls back
-- everything it did, including an alert made inside it).
create or replace function classroom.mail_limit_alert(target_mailbox uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  a uuid;
begin
  select * into box from classroom.mail_mailboxes where id = target_mailbox;
  if not found then return; end if;
  if (select auth.uid()) is not null and coalesce(classroom.mail_access(box.id, (select auth.uid())), 'read') = 'read' then return; end if;
  for a in select * from classroom.school_approvers(box.school_id) loop
    insert into classroom.notifications (user_id, school_id, kind, title, body, link, ref_id)
    values (a, box.school_id, 'mail_limit', box.address || ' reached the sending limit',
            'It tried to send to more outside recipients than the school allows. If that was not expected, the account may be compromised: suspend it under Mail settings.',
            '/School?tab=mail', md5(box.id::text || date_trunc('hour', now())::text)::uuid)
    on conflict do nothing;
  end loop;
end;
$fn$;
revoke all on function classroom.mail_limit_alert(uuid) from public, anon;
grant execute on function classroom.mail_limit_alert(uuid) to authenticated;

create or replace function classroom.mail_send_due()
returns int language plpgsql security definer set search_path = classroom, public as $fn$
declare
  r record;
  n int := 0;
begin
  for r in select m.id, m.subject, m.mailbox_id, coalesce(m.scheduled_by, b.user_id) as actor
             from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
            where m.folder = 'drafts' and m.scheduled_at is not null and m.scheduled_at <= now() order by m.scheduled_at limit 200 loop
    begin
      if r.actor is null then raise exception 'Nobody who can send from this mailbox scheduled it'; end if;
      perform classroom.mail_send_as(r.id, r.actor);
      n := n + 1;
    exception when others then
      update classroom.mail_messages set scheduled_at = null, scheduled_by = null where id = r.id;
      if sqlerrm like '%reached the school''s limit%' then perform classroom.mail_limit_alert(r.mailbox_id); end if;
      perform classroom.mail_notice(r.mailbox_id, 'Not sent: ' || r.subject,
        '<p>Your scheduled message <strong>' || replace(replace(r.subject, '<', '&lt;'), '>', '&gt;')
          || '</strong> could not be sent: ' || replace(replace(sqlerrm, '<', '&lt;'), '>', '&gt;') || '. It is in your Drafts.</p>');
    end;
  end loop;
  return n;
end;
$fn$;
revoke all on function classroom.mail_send_due() from public, anon, authenticated;

-- 3. Recall -----------------------------------------------------------------------------------
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_recall(uuid)'::regprocedure);
  d := replace(d, $a$  if m.folder not in ('sent', 'outbox') and m.sent_at is null then raise exception 'Only a sent message can be recalled.'; end if;$a$,
               $b$  if m.folder not in ('sent', 'outbox') or m.inbound_id is not null or m.is_auto then raise exception 'Only a message you sent can be recalled.'; end if;
  if coalesce(classroom.mail_access(m.mailbox_id, (select auth.uid())), 'read') = 'read' then raise exception 'You can only read this mailbox.'; end if;$b$);
  d := replace(d, $a$where x.envelope_id = m.envelope_id and x.mailbox_id <> m.mailbox_id and x.folder <> 'drafts' loop$a$,
               $b$where x.envelope_id = m.envelope_id and x.message_id = m.message_id and x.mailbox_id <> m.mailbox_id and x.folder <> 'drafts' loop$b$);
  if position('x.message_id = m.message_id' in d) = 0 or position('m.inbound_id is not null' in d) = 0 then
    raise exception 'mail_recall patch did not apply';
  end if;
  execute d;
end;
$do$;

-- 4. Opened alerts and receipts: the same message only -------------------------------------------
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_opened_inside()'::regprocedure);
  d := replace(d, $a$where envelope_id = new.envelope_id and folder in ('sent', 'outbox') and mailbox_id <> new.mailbox_id limit 1;$a$,
               $b$where envelope_id = new.envelope_id and message_id = new.message_id and folder in ('sent', 'outbox') and mailbox_id <> new.mailbox_id limit 1;$b$);
  if position('message_id = new.message_id' in d) = 0 then raise exception 'mail_opened_inside patch did not apply'; end if;
  execute d;

  d := pg_get_functiondef('classroom.mail_message_status(uuid)'::regprocedure);
  d := replace(d, $a$where c.envelope_id = m.envelope_id and c.mailbox_id <> m.mailbox_id and c.folder <> 'drafts'$a$,
               $b$where c.envelope_id = m.envelope_id and c.message_id = m.message_id and c.mailbox_id <> m.mailbox_id and c.folder <> 'drafts'$b$);
  if position('c.message_id = m.message_id' in d) = 0 then raise exception 'mail_message_status patch did not apply'; end if;
  execute d;
end;
$do$;

-- 8. Retention --------------------------------------------------------------------------------
create or replace function classroom.mail_retention_run()
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  removed int;
  files text[];
  uploads text[];
begin
  with gone as (
    delete from classroom.mail_messages m
     using classroom.mail_mailboxes b
      left join classroom.mail_settings s on s.school_id = b.school_id
     where b.id = m.mailbox_id
       and ((m.folder = 'deleted' and coalesce(s.deleted_days, 30) > 0 and m.updated_at < now() - make_interval(days => coalesce(s.deleted_days, 30)))
         or (m.folder = 'junk' and coalesce(s.junk_days, 30) > 0 and m.updated_at < now() - make_interval(days => coalesce(s.junk_days, 30))))
    returning m.id)
  select count(*) into removed from gone;

  with orphan as (
    delete from classroom.mail_attachments a
     where a.created_at < now() - interval '1 day'
       and not exists (select 1 from classroom.mail_messages m where m.envelope_id = a.envelope_id)
    returning a.file_path)
  select coalesce(array_agg(file_path), '{}') into files from orphan;

  -- The paths as they were (RETURNING gives the emptied value).
  with old as (
    select i.id, i.file_paths from classroom.mail_imports i
     where i.status in ('done', 'failed', 'cancelled') and cardinality(i.file_paths) > 0 and i.updated_at < now() - interval '7 days'
     for update),
  cleared as (
    update classroom.mail_imports i set file_paths = '{}' from old where i.id = old.id returning i.id)
  select coalesce(array_agg(p), '{}') into uploads from old, unnest(old.file_paths) p;

  return jsonb_build_object('messages_removed', removed, 'files', to_jsonb(files), 'uploads', to_jsonb(uploads));
end;
$fn$;
revoke all on function classroom.mail_retention_run() from public, anon, authenticated;

-- 9. Addresses --------------------------------------------------------------------------------
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_admin_move_to_domain(uuid)'::regprocedure);
  d := replace(d, $a$while exists (select 1 from classroom.mail_mailboxes where (address = candidate or candidate = any (previous_addresses)) and id <> box.id) loop$a$,
               $b$while classroom.mail_address_taken(candidate, box.id) loop$b$);
  if position('mail_address_taken(candidate' in d) = 0 then raise exception 'move_to_domain patch did not apply'; end if;
  execute d;

  d := pg_get_functiondef('classroom.mail_admin_set_aliases(uuid,text[])'::regprocedure);
  d := replace(d, $a$    a := classroom.mail_check_address(box.school_id, a);$a$,
               $b$    -- One the mailbox already has (perhaps on an earlier domain) stays as it is.
    if lower(btrim(a)) = any (box.previous_addresses) then a := lower(btrim(a));
    else a := classroom.mail_check_address(box.school_id, a); end if;$b$);
  if position('already has (perhaps' in d) = 0 then raise exception 'set_aliases patch did not apply'; end if;
  execute d;
end;
$do$;

-- 10. Arrival ---------------------------------------------------------------------------------
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_receive(uuid,text,uuid,uuid[],jsonb,jsonb)'::regprocedure);
  d := replace(d, $a$      if not (v ->> 'junk')::boolean then
        perform classroom.mail_autoreply($a$,
               $b$      if not (v ->> 'junk')::boolean and not coalesce((msg ->> 'auto')::boolean, false) then
        perform classroom.mail_autoreply($b$);
  if position($p$(msg ->> 'auto')::boolean$p$ in d) = 0 then raise exception 'mail_receive patch did not apply'; end if;
  execute d;

  -- A safe sender skips the content checks, not the forgery check.
  d := pg_get_functiondef('classroom.mail_junk_verdict(uuid,jsonb)'::regprocedure);
  d := replace(d, $a$  if standing = 'safe' then return jsonb_build_object('junk', false, 'score', 0, 'reasons', '[]'::jsonb, 'warning', null); end if;$a$,
               $b$  if standing = 'safe' and lower(coalesce(msg ->> 'dmarc', '')) <> 'fail' then return jsonb_build_object('junk', false, 'score', 0, 'reasons', '[]'::jsonb, 'warning', null); end if;$b$);
  if position($p$standing = 'safe' and lower$p$ in d) = 0 then raise exception 'mail_junk_verdict patch did not apply'; end if;
  execute d;

  -- Imported mail is not "received this week".
  d := pg_get_functiondef('classroom.mail_settings_get(uuid)'::regprocedure);
  d := replace(d, $a$where b.school_id = target_school and m.inbound_id is not null and m.created_at > now() - interval '7 days')$a$,
               $b$where b.school_id = target_school and m.inbound_id is not null and m.inbound_id not like 'imp:%' and m.created_at > now() - interval '7 days')$b$);
  if position($p$not like 'imp:%'$p$ in d) = 0 then raise exception 'mail_settings_get patch did not apply'; end if;
  execute d;

  d := pg_get_functiondef('classroom.platform_mail_overview()'::regprocedure);
  d := replace(d, $a$where b.school_id = s.id and m.inbound_id is not null and m.created_at > now() - interval '7 days') as received_week$a$,
               $b$where b.school_id = s.id and m.inbound_id is not null and m.inbound_id not like 'imp:%' and m.created_at > now() - interval '7 days') as received_week$b$);
  d := replace(d, $a$order by x.needs_dns desc, x.name)$a$, $b$order by coalesce(x.needs_dns, false) desc, x.name)$b$);
  if position($p$not like 'imp:%'$p$ in d) = 0 or position('coalesce(x.needs_dns, false)' in d) = 0 then raise exception 'platform_mail_overview patch did not apply'; end if;
  execute d;

  -- 11. A refresh or verify keeps the warning it did not mean to clear.
  d := pg_get_functiondef('classroom.mail_settings_save(uuid,text,text,text,text,jsonb,text,text,text,text,uuid)'::regprocedure);
  d := replace(d, $a$         last_error = last_error_in,$a$,
               $b$         last_error = case when api_key_in is not null or webhook_secret_in is not null or last_error_in is not null then last_error_in else last_error end,$b$);
  if position('else last_error end' in d) = 0 then raise exception 'mail_settings_save patch did not apply'; end if;
  execute d;
end;
$do$;

-- 11. Disconnect turns receiving off; actors for the audit log.
drop function if exists classroom.mail_settings_clear(uuid);
create or replace function classroom.mail_settings_clear(target_school uuid, actor uuid default null)
returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare s classroom.mail_settings;
begin
  perform set_config('classroom.actor', coalesce(actor::text, ''), true);
  select * into s from classroom.mail_settings where school_id = target_school for update;
  if not found then return; end if;
  if s.key_vault_id is not null then delete from vault.secrets where id = s.key_vault_id; end if;
  if s.webhook_vault_id is not null then delete from vault.secrets where id = s.webhook_vault_id; end if;
  update classroom.mail_settings
     set key_vault_id = null, key_hint = null, webhook_id = null, webhook_vault_id = null,
         resend_domain_id = null, domain_status = 'none', dns_records = '[]'::jsonb,
         sending_enabled = false, receiving_enabled = false, receiving_status = 'off',
         last_error = null, updated_at = now()
   where school_id = target_school;
end;
$fn$;
revoke all on function classroom.mail_settings_clear(uuid, uuid) from public, anon, authenticated;
grant execute on function classroom.mail_settings_clear(uuid, uuid) to service_role;

drop function if exists classroom.mail_settings_receiving(uuid, boolean, text);
create or replace function classroom.mail_settings_receiving(target_school uuid, enabled_in boolean, status_in text, actor uuid default null)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform set_config('classroom.actor', coalesce(actor::text, ''), true);
  update classroom.mail_settings
     set receiving_enabled = enabled_in, receiving_status = case when enabled_in then coalesce(status_in, 'not_started') else 'off' end,
         updated_at = now()
   where school_id = target_school;
end;
$fn$;
revoke all on function classroom.mail_settings_receiving(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function classroom.mail_settings_receiving(uuid, boolean, text, uuid) to service_role;

drop function if exists classroom.mail_set_microsoft_tenant(uuid, text);
create or replace function classroom.mail_set_microsoft_tenant(target_school uuid, tenant_in text, actor uuid default null)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform set_config('classroom.actor', coalesce(actor::text, ''), true);
  insert into classroom.mail_settings (school_id) values (target_school) on conflict (school_id) do nothing;
  update classroom.mail_settings set microsoft_tenant = tenant_in, microsoft_consent_at = case when tenant_in is null then null else now() end,
         updated_at = now() where school_id = target_school;
end;
$fn$;
revoke all on function classroom.mail_set_microsoft_tenant(uuid, text, uuid) from public, anon, authenticated;
grant execute on function classroom.mail_set_microsoft_tenant(uuid, text, uuid) to service_role;

-- 12. Import progress keeps what the browser added during the turn ------------------------------
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_import_progress(uuid,jsonb,text,jsonb,text)'::regprocedure);
  d := replace(d, $a$     set cursor = coalesce(cursor_in, mi.cursor),$a$,
               $b$     set cursor = case when cursor_in is null then mi.cursor
                       else cursor_in || jsonb_strip_nulls(jsonb_build_object('sizes', mi.cursor -> 'sizes', 'open', mi.cursor -> 'open',
                                                                              'appended_at', mi.cursor -> 'appended_at')) end,$b$);
  if position($p$'open', mi.cursor -> 'open'$p$ in d) = 0 then raise exception 'mail_import_progress patch did not apply'; end if;
  execute d;
end;
$do$;

-- 13. One "opened" token for all the recipients of one outside email.
create or replace function classroom.mail_outbound_share_token(recipient_ids uuid[])
returns uuid language plpgsql security definer set search_path = classroom, public as $fn$
declare t uuid;
begin
  select open_token into t from classroom.mail_outbound where id = any (recipient_ids) and open_token is not null order by created_at, id limit 1;
  if t is null then return null; end if;
  update classroom.mail_outbound set open_token = t where id = any (recipient_ids) and open_token is distinct from t;
  return t;
end;
$fn$;
revoke all on function classroom.mail_outbound_share_token(uuid[]) from public, anon, authenticated;
grant execute on function classroom.mail_outbound_share_token(uuid[]) to service_role;

notify pgrst, 'reload schema';

-- Connect checks the domain is free before changing anything in Resend.
create or replace function classroom.mail_domain_taken(domain_in text, target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_settings where domain = lower(btrim(domain_in)) and school_id <> target_school);
$fn$;
revoke all on function classroom.mail_domain_taken(text, uuid) from public, anon, authenticated;
grant execute on function classroom.mail_domain_taken(text, uuid) to service_role;
notify pgrst, 'reload schema';

-- Outside mail put back in the queue without counting a try: a run that ran
-- out of time, or the school's Resend daily limit (back after midnight UTC).
create or replace function classroom.mail_outbound_release(recipient_ids uuid[], retry_at timestamptz default null, detail_in text default null)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare msg uuid;
begin
  update classroom.mail_outbound
     set status = 'pending', attempts = greatest(attempts - 1, 0), next_attempt_at = coalesce(retry_at, now()),
         detail = coalesce(detail_in, detail), updated_at = now()
   where id = any (recipient_ids) and status = 'sending';
  select message_id into msg from classroom.mail_outbound where id = recipient_ids[1];
  if msg is not null then perform classroom.mail_outbound_settle(msg); end if;
end;
$fn$;
revoke all on function classroom.mail_outbound_release(uuid[], timestamptz, text) from public, anon, authenticated;
grant execute on function classroom.mail_outbound_release(uuid[], timestamptz, text) to service_role;
notify pgrst, 'reload schema';

-- Received mail that failed after Resend already had its answer (large
-- files, finished in the background): tried again every few minutes, up to
-- 8 times, since Resend will not send it again.
create table if not exists classroom.mail_inbound_retry (
  school_id uuid not null references classroom.schools (id) on delete cascade,
  email_id text not null,
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  primary key (school_id, email_id)
);
alter table classroom.mail_inbound_retry enable row level security;
revoke all on classroom.mail_inbound_retry from public, anon, authenticated;

create or replace function classroom.mail_inbound_retry_add(target_school uuid, email_id_in text, error_in text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  insert into classroom.mail_inbound_retry as r (school_id, email_id, attempts, next_at, last_error)
  values (target_school, email_id_in, 1, now() + interval '2 minutes', error_in)
  on conflict (school_id, email_id) do update
     set attempts = r.attempts + 1, last_error = error_in,
         next_at = now() + least(interval '2 hours', interval '2 minutes' * power(2, r.attempts));
  delete from classroom.mail_inbound_retry where school_id = target_school and email_id = email_id_in and attempts > 8;
end;
$fn$;
create or replace function classroom.mail_inbound_retry_due()
returns table (school_id uuid, email_id text) language sql security definer set search_path = classroom, public as $fn$
  select r.school_id, r.email_id from classroom.mail_inbound_retry r where r.next_at <= now() order by r.next_at limit 20;
$fn$;
create or replace function classroom.mail_inbound_retry_done(target_school uuid, email_id_in text)
returns void language sql security definer set search_path = classroom, public as $fn$
  delete from classroom.mail_inbound_retry where school_id = target_school and email_id = email_id_in;
$fn$;
revoke all on function classroom.mail_inbound_retry_add(uuid, text, text) from public, anon, authenticated;
revoke all on function classroom.mail_inbound_retry_due() from public, anon, authenticated;
revoke all on function classroom.mail_inbound_retry_done(uuid, text) from public, anon, authenticated;
grant execute on function classroom.mail_inbound_retry_add(uuid, text, text) to service_role;
grant execute on function classroom.mail_inbound_retry_due() to service_role;
grant execute on function classroom.mail_inbound_retry_done(uuid, text) to service_role;

select cron.unschedule('schoolivio-mail-inbound-retry') where exists (select 1 from cron.job where jobname = 'schoolivio-mail-inbound-retry');
select cron.schedule('schoolivio-mail-inbound-retry', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/mail-resend-webhook?retry=1',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ticket_mail_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from classroom.mail_inbound_retry where next_at <= now());
$job$);
notify pgrst, 'reload schema';

-- Mail set to "View only" for someone (People → module access): they read
-- and file, nothing else, in the database too, not only in the menus.
create or replace function classroom.mail_access(target_mailbox uuid, who uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  with a as (
    select case
      when (select auth.uid()) is not null and who is distinct from (select auth.uid()) then null
      when not exists (select 1 from classroom.mail_mailboxes b join classroom.school_members sm on sm.school_id = b.school_id
                        where b.id = target_mailbox and sm.user_id = who and sm.is_active) then null
      when exists (select 1 from classroom.mail_mailboxes where id = target_mailbox and user_id = who) then 'own'
      else (select access from classroom.mail_mailbox_members where mailbox_id = target_mailbox and user_id = who) end as access,
    case when (select auth.uid()) is null then ''
         else coalesce(classroom.module_override((select b.school_id from classroom.mail_mailboxes b where b.id = target_mailbox), 'mail'), '') end as module)
  select case when a.access is null or a.module = 'none' then null when a.module = 'read' then 'read' else a.access end from a;
$fn$;
