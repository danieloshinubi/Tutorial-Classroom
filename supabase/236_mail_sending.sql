-- Schoolivio Mail, step 1: mail to outside addresses goes out through each
-- school's own Resend account, from the school's own domain.
--
--   mail_settings     one row per school: its domain, the domain as Resend
--                     knows it (id, status, the DNS records to add), the
--                     school's Resend API key and the delivery-report signing
--                     secret, both kept in Vault and never shown again.
--   mail_outbound     each outside recipient of a sending: To / Cc / Bcc,
--                     Resend's id for it, and how far it got (sent,
--                     delivered, delayed, bounced, marked as spam, failed).
--   mail-settings     Edge Function (school admin): connects the key, adds
--                     the domain to Resend, checks the DNS records, turns on
--                     delivery reports.
--   mail-outbound     Edge Function (scheduler and mail_send): hands waiting
--                     mail to Resend, retrying what failed for a while.
--   mail-resend-webhook  Edge Function (Resend): delivery reports.
--
-- Mail between Schoolivio addresses still never leaves Schoolivio. A school
-- that has not set this up keeps outside mail in the Outbox until it does.

-- 1. The school's mail settings ------------------------------------------------------
create table if not exists classroom.mail_settings (
  school_id uuid primary key references classroom.schools (id) on delete cascade,
  domain text check (domain is null or domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  region text not null default 'us-east-1',
  resend_domain_id text,
  domain_status text not null default 'none',      -- none, not_started, pending, verified, failed, temporary_failure
  dns_records jsonb not null default '[]'::jsonb,   -- as Resend lists them: record, type, name, value, priority, status
  key_vault_id uuid,                                -- the Resend API key (Vault)
  key_hint text,                                    -- its last four characters
  webhook_id text,
  webhook_vault_id uuid,                            -- the delivery reports' signing secret (Vault)
  sending_enabled boolean not null default false,   -- domain verified and a key saved
  last_error text,
  checked_at timestamptz,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table classroom.mail_settings enable row level security;
-- One school per domain.
create unique index if not exists mail_settings_domain_key on classroom.mail_settings (domain) where domain is not null;
-- Nobody reads the table directly: mail_settings_get() shows what is safe.
revoke all on classroom.mail_settings from anon, authenticated;

-- What the school admin's Mail settings page shows (everything but the
-- secrets), and for any member of staff just whether outside mail goes out.
create or replace function classroom.mail_settings_get(target_school uuid)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare
  s classroom.mail_settings;
  fallback text;
begin
  if not exists (select 1 from classroom.school_members m where m.school_id = target_school and m.user_id = (select auth.uid()) and m.is_active) then
    raise exception 'Not a member of this school.';
  end if;
  select * into s from classroom.mail_settings where school_id = target_school;
  select slug || '.schoolivio.com' into fallback from classroom.schools where id = target_school;
  if not classroom.is_school_admin(target_school) then
    return jsonb_build_object('domain', coalesce(s.domain, fallback), 'sending_enabled', coalesce(s.sending_enabled, false));
  end if;
  return jsonb_build_object(
    'domain', s.domain,
    'fallback_domain', fallback,
    'region', coalesce(s.region, 'us-east-1'),
    'domain_status', coalesce(s.domain_status, 'none'),
    'dns_records', coalesce(s.dns_records, '[]'::jsonb),
    'has_key', s.key_vault_id is not null,
    'key_hint', s.key_hint,
    'reports_on', s.webhook_id is not null,
    'sending_enabled', coalesce(s.sending_enabled, false),
    'last_error', s.last_error,
    'checked_at', s.checked_at,
    'connected_at', s.connected_at,
    'waiting', (select count(*) from classroom.mail_outbound o join classroom.mail_messages m on m.id = o.message_id
                  join classroom.mail_mailboxes b on b.id = m.mailbox_id
                 where b.school_id = target_school and o.status in ('pending', 'sending')));
end;
$fn$;
revoke all on function classroom.mail_settings_get(uuid) from public, anon;
grant execute on function classroom.mail_settings_get(uuid) to authenticated;

-- Saving what mail-settings found out. Authorised by that function (it
-- checks the caller is a school admin first); granted to the service role
-- only, because by then there is no caller left to check. A new key or
-- signing secret replaces the old one in Vault; null leaves it as it is.
create or replace function classroom.mail_settings_save(
  target_school uuid,
  domain_in text,
  region_in text,
  resend_domain_id_in text,
  domain_status_in text,
  dns_records_in jsonb,
  api_key_in text default null,
  webhook_id_in text default null,
  webhook_secret_in text default null,
  last_error_in text default null,
  actor uuid default null
) returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare
  s classroom.mail_settings;
  new_key uuid;
  new_hook uuid;
begin
  if domain_in is not null and exists (select 1 from classroom.mail_settings where domain = lower(domain_in) and school_id <> target_school) then
    raise exception '% is already used by another school on Schoolivio.', lower(domain_in);
  end if;
  insert into classroom.mail_settings (school_id) values (target_school) on conflict (school_id) do nothing;
  select * into s from classroom.mail_settings where school_id = target_school for update;

  if api_key_in is not null then
    new_key := vault.create_secret(api_key_in, 'mail_resend_key:' || target_school || ':' || gen_random_uuid(), 'A school''s Resend API key (Schoolivio Mail)');
    if s.key_vault_id is not null then delete from vault.secrets where id = s.key_vault_id; end if;
    s.key_vault_id := new_key;
    s.key_hint := right(api_key_in, 4);
  end if;
  if webhook_secret_in is not null then
    new_hook := vault.create_secret(webhook_secret_in, 'mail_resend_webhook:' || target_school || ':' || gen_random_uuid(), 'Signing secret of a school''s Resend delivery reports');
    if s.webhook_vault_id is not null then delete from vault.secrets where id = s.webhook_vault_id; end if;
    s.webhook_vault_id := new_hook;
    s.webhook_id := webhook_id_in;
  end if;

  update classroom.mail_settings
     set domain = lower(domain_in),
         region = coalesce(region_in, region),
         resend_domain_id = resend_domain_id_in,
         domain_status = coalesce(domain_status_in, 'none'),
         dns_records = coalesce(dns_records_in, '[]'::jsonb),
         key_vault_id = s.key_vault_id,
         key_hint = s.key_hint,
         webhook_id = s.webhook_id,
         webhook_vault_id = s.webhook_vault_id,
         sending_enabled = coalesce(s.key_vault_id is not null and domain_status_in = 'verified', false),
         last_error = last_error_in,
         checked_at = now(),
         connected_by = coalesce(actor, connected_by),
         connected_at = case when api_key_in is not null then now() else connected_at end,
         updated_at = now()
   where school_id = target_school;
end;
$fn$;
revoke all on function classroom.mail_settings_save(uuid, text, text, text, text, jsonb, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function classroom.mail_settings_save(uuid, text, text, text, text, jsonb, text, text, text, text, uuid) to service_role;

-- The school's key and signing secret, for the Edge Functions only.
create or replace function classroom.mail_settings_secrets(target_school uuid)
returns table (domain text, region text, resend_domain_id text, domain_status text, sending_enabled boolean,
               webhook_id text, api_key text, webhook_secret text)
language sql stable security definer set search_path = classroom, public, vault as $fn$
  select s.domain, s.region, s.resend_domain_id, s.domain_status, s.sending_enabled, s.webhook_id,
         (select decrypted_secret from vault.decrypted_secrets where id = s.key_vault_id),
         (select decrypted_secret from vault.decrypted_secrets where id = s.webhook_vault_id)
    from classroom.mail_settings s where s.school_id = target_school;
$fn$;
revoke all on function classroom.mail_settings_secrets(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_settings_secrets(uuid) to service_role;

-- Disconnecting: the key and signing secret are deleted, outside mail stops.
-- Addresses stay as they are, and so does the domain in the school's Resend.
create or replace function classroom.mail_settings_clear(target_school uuid)
returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare s classroom.mail_settings;
begin
  select * into s from classroom.mail_settings where school_id = target_school for update;
  if not found then return; end if;
  if s.key_vault_id is not null then delete from vault.secrets where id = s.key_vault_id; end if;
  if s.webhook_vault_id is not null then delete from vault.secrets where id = s.webhook_vault_id; end if;
  update classroom.mail_settings
     set key_vault_id = null, key_hint = null, webhook_id = null, webhook_vault_id = null,
         resend_domain_id = null, domain_status = 'none', dns_records = '[]'::jsonb,
         sending_enabled = false, last_error = null, updated_at = now()
   where school_id = target_school;
end;
$fn$;
revoke all on function classroom.mail_settings_clear(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_settings_clear(uuid) to service_role;

-- New mailboxes take the school's own domain once one is set.
create or replace function classroom.mail_domain(target_school uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce((select domain from classroom.mail_settings where school_id = target_school and domain is not null),
                  (select slug || '.schoolivio.com' from classroom.schools where id = target_school));
$fn$;

-- 2. Staff addresses, managed by the school admin --------------------------------------
-- A changed address keeps working: mail to an old one still reaches the person.
alter table classroom.mail_mailboxes add column if not exists previous_addresses text[] not null default '{}';
create index if not exists mail_mailboxes_previous_idx on classroom.mail_mailboxes using gin (previous_addresses);

-- Making a member of staff's mailbox (the old body of mail_my_mailbox).
create or replace function classroom.mail_create_mailbox(target_school uuid, target_user uuid)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  prof classroom.profiles;
  base text;
  candidate text;
  domain text := classroom.mail_domain(target_school);
  n int := 1;
begin
  select * into box from classroom.mail_mailboxes where school_id = target_school and user_id = target_user;
  if found then return box; end if;
  if not exists (select 1 from classroom.school_members m where m.school_id = target_school and m.user_id = target_user and m.is_active
                  and m.granted_via is null and m.role not in ('student', 'parent')) then
    raise exception 'Mailboxes are for the school''s staff.';
  end if;
  select * into prof from classroom.profiles where id = target_user;
  base := lower(regexp_replace(
            -- First word of the first name and the last word of the surname: adeyemo.akintunde.
            coalesce(nullif(concat_ws('.', nullif(split_part(btrim(prof.first_name), ' ', 1), ''), nullif(regexp_replace(btrim(prof.surname), '^.* ', ''), '')), ''),
                     nullif(prof.username, ''), split_part(prof.email, '@', 1), 'staff'),
            '[^a-zA-Z0-9.]+', '', 'g'));
  base := btrim(base, '.');
  if base = '' then base := 'staff'; end if;
  candidate := base || '@' || domain;
  while exists (select 1 from classroom.mail_mailboxes where address = candidate or candidate = any (previous_addresses)) loop
    n := n + 1;
    candidate := base || n || '@' || domain;
  end loop;
  insert into classroom.mail_mailboxes (school_id, user_id, address, display_name)
  values (target_school, target_user, candidate, coalesce(nullif(btrim(concat_ws(' ', prof.first_name, prof.surname)), ''), base))
  returning * into box;
  return box;
end;
$fn$;
revoke all on function classroom.mail_create_mailbox(uuid, uuid) from public, anon, authenticated;

create or replace function classroom.mail_my_mailbox(target_school uuid)
returns classroom.mail_mailboxes language sql security definer set search_path = classroom, public as $fn$
  select * from classroom.mail_create_mailbox(target_school, (select auth.uid()));
$fn$;
revoke all on function classroom.mail_my_mailbox(uuid) from public, anon;
grant execute on function classroom.mail_my_mailbox(uuid) to authenticated;

-- Every member of staff and their address (null: no mailbox yet).
create or replace function classroom.mail_admin_people(target_school uuid)
returns table (user_id uuid, name text, job_title text, role text, mailbox_id uuid, address text, used_bytes bigint, quota_bytes bigint)
language plpgsql stable security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can manage mail addresses.'; end if;
  return query
    select distinct on (m.user_id) m.user_id,
           coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username, p.email)::text,
           m.job_title::text, m.role::text, b.id, b.address, b.used_bytes, b.quota_bytes
      from classroom.school_members m
      join classroom.profiles p on p.id = m.user_id
      left join classroom.mail_mailboxes b on b.school_id = m.school_id and b.user_id = m.user_id
     where m.school_id = target_school and m.is_active and m.granted_via is null and m.role not in ('student', 'parent')
     order by m.user_id;
end;
$fn$;
revoke all on function classroom.mail_admin_people(uuid) from public, anon;
grant execute on function classroom.mail_admin_people(uuid) to authenticated;

-- Make a mailbox for every member of staff who has none yet.
create or replace function classroom.mail_admin_create_all(target_school uuid)
returns int language plpgsql security definer set search_path = classroom, public as $fn$
declare
  u uuid;
  n int := 0;
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can manage mail addresses.'; end if;
  for u in select distinct m.user_id from classroom.school_members m
            where m.school_id = target_school and m.is_active and m.granted_via is null and m.role not in ('student', 'parent')
              and not exists (select 1 from classroom.mail_mailboxes b where b.school_id = target_school and b.user_id = m.user_id) loop
    perform classroom.mail_create_mailbox(target_school, u);
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
revoke all on function classroom.mail_admin_create_all(uuid) from public, anon;
grant execute on function classroom.mail_admin_create_all(uuid) to authenticated;

-- Change one person's address. It must be on the school's own domain or its
-- schoolivio.com address, and not taken.
create or replace function classroom.mail_admin_set_address(target_mailbox uuid, new_address text)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  addr text := lower(btrim(new_address));
  own text;
  fallback text;
begin
  select * into box from classroom.mail_mailboxes where id = target_mailbox;
  if not found then raise exception 'That mailbox no longer exists.'; end if;
  if not classroom.is_school_admin(box.school_id) then raise exception 'Only a school admin can change mail addresses.'; end if;
  select domain into own from classroom.mail_settings where school_id = box.school_id;
  select slug || '.schoolivio.com' into fallback from classroom.schools where id = box.school_id;
  if addr !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?@[a-z0-9.-]+$' then
    raise exception 'Use letters, numbers, dots, dashes or underscores before the @.';
  end if;
  if split_part(addr, '@', 2) not in (coalesce(own, ''), fallback) then
    raise exception 'The address must end in @%.', coalesce(own, fallback);
  end if;
  if exists (select 1 from classroom.mail_mailboxes where (address = addr or addr = any (previous_addresses)) and id <> box.id) then
    raise exception '% is already someone else''s address.', addr;
  end if;
  update classroom.mail_mailboxes
     set previous_addresses = case when address = addr then previous_addresses else array_append(array_remove(previous_addresses, addr), address) end,
         address = addr, updated_at = now()
   where id = box.id returning * into box;
  return box;
end;
$fn$;
revoke all on function classroom.mail_admin_set_address(uuid, text) from public, anon;
grant execute on function classroom.mail_admin_set_address(uuid, text) to authenticated;

-- Move everyone onto the school's own domain, keeping the part before the @
-- (a number is added only if that address is taken).
create or replace function classroom.mail_admin_move_to_domain(target_school uuid)
returns int language plpgsql security definer set search_path = classroom, public as $fn$
declare
  own text;
  box classroom.mail_mailboxes;
  base text;
  candidate text;
  k int;
  n int := 0;
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can change mail addresses.'; end if;
  select domain into own from classroom.mail_settings where school_id = target_school;
  if own is null then raise exception 'Add the school''s domain first.'; end if;
  for box in select * from classroom.mail_mailboxes where school_id = target_school and split_part(address, '@', 2) <> own loop
    base := split_part(box.address, '@', 1);
    candidate := base || '@' || own;
    k := 1;
    while exists (select 1 from classroom.mail_mailboxes where (address = candidate or candidate = any (previous_addresses)) and id <> box.id) loop
      k := k + 1;
      candidate := base || k || '@' || own;
    end loop;
    update classroom.mail_mailboxes
       set previous_addresses = array_append(array_remove(previous_addresses, candidate), address), address = candidate, updated_at = now()
     where id = box.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
revoke all on function classroom.mail_admin_move_to_domain(uuid) from public, anon;
grant execute on function classroom.mail_admin_move_to_domain(uuid) to authenticated;

-- 3. Outside recipients and how their delivery went -------------------------------------
alter table classroom.mail_outbound drop constraint if exists mail_outbound_status_check;
alter table classroom.mail_outbound
  add column if not exists kind text not null default 'to',
  add column if not exists provider_id text,
  add column if not exists detail text,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
alter table classroom.mail_outbound drop constraint if exists mail_outbound_kind_check;
alter table classroom.mail_outbound add constraint mail_outbound_kind_check check (kind in ('to', 'cc', 'bcc'));
alter table classroom.mail_outbound add constraint mail_outbound_status_check
  check (status in ('pending', 'sending', 'sent', 'delayed', 'delivered', 'bounced', 'complained', 'failed'));
drop index if exists classroom.mail_outbound_pending_idx;
create index if not exists mail_outbound_due_idx on classroom.mail_outbound (next_attempt_at) where status in ('pending', 'sending');
create index if not exists mail_outbound_provider_idx on classroom.mail_outbound (provider_id) where provider_id is not null;
create index if not exists mail_outbound_message_idx on classroom.mail_outbound (message_id);

-- A short "Not delivered" note in the sender's Inbox, from Schoolivio Mail.
create or replace function classroom.mail_notice(target_mailbox uuid, subject_in text, html_in text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare box classroom.mail_mailboxes;
begin
  select * into box from classroom.mail_mailboxes where id = target_mailbox;
  if not found then return; end if;
  insert into classroom.mail_messages (mailbox_id, folder, from_address, from_name, to_list, subject, body_html, snippet, is_read, sent_at)
  values (box.id, 'inbox', 'postmaster@schoolivio.com', 'Schoolivio Mail',
          jsonb_build_array(jsonb_build_object('name', box.display_name, 'address', box.address)),
          subject_in, html_in, classroom.mail_snippet(html_in), false, now());
end;
$fn$;
revoke all on function classroom.mail_notice(uuid, text, text) from public, anon, authenticated;

-- Asks mail-outbound to send now (after this transaction commits). Never
-- holds up the caller: the scheduler picks up anything this misses.
create or replace function classroom.mail_kick(target_message uuid default null)
returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
begin
  perform net.http_post(
    url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/mail-outbound',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ticket_mail_cron_secret')),
    body := jsonb_build_object('message_id', target_message),
    timeout_milliseconds := 60000);
exception when others then
  raise warning 'mail_kick could not reach mail-outbound: %', sqlerrm;
end;
$fn$;
revoke all on function classroom.mail_kick(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_kick(uuid) to service_role;

-- Sending (replaces 235's): the same checks and inside delivery, and each
-- outside recipient is queued with whether they were To, Cc or Bcc. If the
-- school's outside mail is on, it goes straight away.
create or replace function classroom.mail_send(target_draft uuid)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  d classroom.mail_messages;
  box classroom.mail_mailboxes;
  r record;
  addr text;
  rcpt classroom.mail_mailboxes;
  internal_count int := 0;
  external_count int := 0;
  unknown text[] := '{}';
  attach_size bigint;
  total_size bigint;
  seen text[] := '{}';
  parent_thread uuid;
  sending_on boolean;
begin
  select * into d from classroom.mail_messages where id = target_draft for update;
  if not found then raise exception 'That draft no longer exists.'; end if;
  select * into box from classroom.mail_mailboxes where id = d.mailbox_id;
  if box.user_id <> (select auth.uid()) then raise exception 'That is not your draft.'; end if;
  if d.folder <> 'drafts' then raise exception 'That message has already been sent.'; end if;
  if not box.is_active then raise exception 'Your mailbox is switched off.'; end if;
  if jsonb_array_length(d.to_list) + jsonb_array_length(d.cc_list) + jsonb_array_length(d.bcc_list) = 0 then
    raise exception 'Add at least one recipient.';
  end if;
  if jsonb_array_length(d.to_list) + jsonb_array_length(d.cc_list) + jsonb_array_length(d.bcc_list) > 500 then
    raise exception 'A message can go to at most 500 people.';
  end if;

  select coalesce(sum(size_bytes), 0) into attach_size from classroom.mail_attachments where envelope_id = d.envelope_id;
  total_size := octet_length(d.body_html) + octet_length(d.subject) + attach_size;

  -- A reply joins the conversation it answers.
  if d.in_reply_to is not null then
    select thread_id into parent_thread from classroom.mail_messages where mailbox_id = box.id and message_id = d.in_reply_to limit 1;
    if parent_thread is not null then d.thread_id := parent_thread; end if;
  end if;

  -- Every address is checked before anything is delivered.
  for r in select value from jsonb_array_elements(d.to_list || d.cc_list || d.bcc_list) loop
    addr := lower(btrim(r.value ->> 'address'));
    if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      unknown := unknown || coalesce(r.value ->> 'address', '(blank)');
    end if;
  end loop;
  if array_length(unknown, 1) > 0 then
    raise exception 'These addresses are not valid: %', array_to_string(unknown, ', ');
  end if;

  -- The sender's copy: Sent, or Outbox while outside addresses wait.
  update classroom.mail_messages
     set folder = 'sent', sent_at = now(), is_read = true, from_address = box.address, from_name = box.display_name,
         snippet = classroom.mail_snippet(body_html), size_bytes = total_size, thread_id = d.thread_id,
         has_attachments = attach_size > 0
   where id = d.id;

  for r in
    select x.value, x.kind from (
      select value, 'to' as kind, 1 as part, ord from jsonb_array_elements(d.to_list) with ordinality as t(value, ord)
      union all select value, 'cc', 2, ord from jsonb_array_elements(d.cc_list) with ordinality as t(value, ord)
      union all select value, 'bcc', 3, ord from jsonb_array_elements(d.bcc_list) with ordinality as t(value, ord)) x
    order by x.part, x.ord
  loop
    addr := lower(btrim(r.value ->> 'address'));
    continue when addr = any (seen);
    seen := seen || addr;
    select * into rcpt from classroom.mail_mailboxes where (address = addr or addr = any (previous_addresses)) and is_active limit 1;
    if found then
      -- Delivered inside Schoolivio. A full mailbox refuses it.
      if rcpt.used_bytes + total_size > rcpt.quota_bytes then
        unknown := unknown || addr;
        continue;
      end if;
      insert into classroom.mail_messages (mailbox_id, envelope_id, thread_id, message_id, in_reply_to, folder,
          from_address, from_name, to_list, cc_list, bcc_list, subject, body_html, snippet, importance,
          has_attachments, size_bytes, is_read, sent_at)
      values (rcpt.id, d.envelope_id, d.thread_id, d.message_id, d.in_reply_to, 'inbox',
          box.address, box.display_name, d.to_list, d.cc_list, '[]'::jsonb, d.subject, d.body_html,
          classroom.mail_snippet(d.body_html), d.importance, attach_size > 0, total_size,
          rcpt.id = box.id, now());
      internal_count := internal_count + 1;
    else
      insert into classroom.mail_outbound (message_id, recipient, kind) values (d.id, addr, r.kind);
      external_count := external_count + 1;
    end if;
  end loop;

  select coalesce(s.sending_enabled, false) into sending_on from classroom.mail_settings s where s.school_id = box.school_id;
  sending_on := coalesce(sending_on, false);
  if external_count > 0 then
    update classroom.mail_messages set folder = 'outbox', external_pending = external_count where id = d.id;
    if sending_on then perform classroom.mail_kick(d.id); end if;
  end if;

  -- Tell the sender about anyone whose mailbox was full.
  if array_length(unknown, 1) > 0 then
    perform classroom.mail_notice(box.id, 'Not delivered: ' || d.subject,
      '<p>Your message <strong>' || replace(replace(d.subject, '<', '&lt;'), '>', '&gt;') || '</strong> could not be delivered to: '
        || array_to_string(unknown, ', ') || '. Their mailbox is full.</p>');
  end if;

  return jsonb_build_object('delivered', internal_count, 'waiting', external_count, 'sending_on', sending_on,
                            'refused', coalesce(array_length(unknown, 1), 0), 'thread_id', d.thread_id);
end;
$fn$;
revoke all on function classroom.mail_send(uuid) from public, anon;
grant execute on function classroom.mail_send(uuid) to authenticated;

-- 4. Handing waiting mail to Resend ------------------------------------------------------
-- mail-outbound takes up to `max_messages` sendings that are due, from
-- schools whose outside mail is on, and marks their recipients as being
-- sent so a second run cannot take them too. One that has sat "sending" for
-- ten minutes (a run that died) is taken again.
create or replace function classroom.mail_outbound_claim(max_messages int default 20, only_message uuid default null)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  ids uuid[];
  out jsonb;
begin
  select array_agg(id) into ids from (
    select distinct o.message_id as id
      from classroom.mail_outbound o
      join classroom.mail_messages m on m.id = o.message_id
      join classroom.mail_mailboxes b on b.id = m.mailbox_id
      join classroom.mail_settings s on s.school_id = b.school_id and s.sending_enabled
     where (o.status = 'pending' and o.next_attempt_at <= now()
            or o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
       and (only_message is null or o.message_id = only_message)
     limit max_messages) q;
  if ids is null then return '[]'::jsonb; end if;

  -- Two runs at once cannot both take a recipient: the second's update waits
  -- for the first, then finds it no longer pending.
  with taken as (
    update classroom.mail_outbound o
       set status = 'sending', attempts = attempts + 1, updated_at = now()
     where o.message_id = any (ids)
       and (o.status = 'pending' and o.next_attempt_at <= now() or o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
    returning o.id, o.message_id, o.recipient, o.kind, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'message_id', m.id, 'school_id', b.school_id, 'mailbox_id', b.id,
           'from_address', m.from_address, 'from_name', m.from_name, 'subject', m.subject, 'body_html', m.body_html,
           'rfc_message_id', m.message_id, 'in_reply_to', m.in_reply_to, 'importance', m.importance,
           'attempts', (select max(t.attempts) from taken t where t.message_id = m.id),
           'recipients', (select jsonb_agg(jsonb_build_object('id', t.id, 'address', t.recipient, 'kind', t.kind)) from taken t where t.message_id = m.id),
           'attachments', (select coalesce(jsonb_agg(jsonb_build_object('file_path', a.file_path, 'file_name', a.file_name, 'mime_type', a.mime_type,
                                                                          'size_bytes', a.size_bytes, 'content_id', a.content_id)), '[]'::jsonb)
                             from classroom.mail_attachments a where a.envelope_id = m.envelope_id))), '[]'::jsonb)
    into out
    from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
   where m.id in (select distinct message_id from taken);
  return out;
end;
$fn$;
revoke all on function classroom.mail_outbound_claim(int, uuid) from public, anon, authenticated;
grant execute on function classroom.mail_outbound_claim(int, uuid) to service_role;

-- Keeps the sender's copy in step with its outside recipients: it leaves the
-- Outbox once none is waiting. Touching it also refreshes the sender's open
-- Mail page (rt_mail_messages).
create or replace function classroom.mail_outbound_settle(target_message uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare waiting int;
begin
  select count(*) into waiting from classroom.mail_outbound where message_id = target_message and status in ('pending', 'sending');
  update classroom.mail_messages
     set external_pending = waiting,
         folder = case when waiting = 0 and folder = 'outbox' then 'sent' else folder end,
         updated_at = now()
   where id = target_message;
end;
$fn$;
revoke all on function classroom.mail_outbound_settle(uuid) from public, anon, authenticated;

-- What happened when mail-outbound handed a sending to Resend.
--   ok         Resend took it: the recipients are "sent".
--   permanent  Resend refused it for good (or it could never go): "failed",
--              and the sender gets a note saying why.
--   otherwise  try again later: 1, 2, 4 … minutes, up to 6 hours apart; after
--              8 tries it is given up as failed.
create or replace function classroom.mail_outbound_result(recipient_ids uuid[], ok boolean, provider_id_in text, error_in text, permanent boolean)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare
  msg uuid;
  box uuid;
  subj text;
  failed text[];
begin
  select message_id into msg from classroom.mail_outbound where id = recipient_ids[1];
  if msg is null then return; end if;

  if ok then
    update classroom.mail_outbound set status = 'sent', provider_id = provider_id_in, detail = null, sent_at = now(), updated_at = now()
     where id = any (recipient_ids) and status = 'sending';
  else
    update classroom.mail_outbound
       set status = case when permanent or attempts >= 8 then 'failed' else 'pending' end,
           detail = error_in,
           next_attempt_at = now() + least(interval '6 hours', interval '1 minute' * power(2, greatest(attempts - 1, 0))),
           updated_at = now()
     where id = any (recipient_ids) and status = 'sending';
    select array_agg(recipient) into failed from classroom.mail_outbound where id = any (recipient_ids) and status = 'failed';
    if failed is not null then
      select m.mailbox_id, m.subject into box, subj from classroom.mail_messages m where m.id = msg;
      perform classroom.mail_notice(box, 'Not delivered: ' || subj,
        '<p>Your message <strong>' || replace(replace(subj, '<', '&lt;'), '>', '&gt;') || '</strong> could not be delivered to: '
          || array_to_string(failed, ', ') || '.</p><p>' || replace(replace(coalesce(error_in, 'The mail service refused it.'), '<', '&lt;'), '>', '&gt;') || '</p>');
    end if;
  end if;
  perform classroom.mail_outbound_settle(msg);
end;
$fn$;
revoke all on function classroom.mail_outbound_result(uuid[], boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function classroom.mail_outbound_result(uuid[], boolean, text, text, boolean) to service_role;

-- 5. Delivery reports from Resend ----------------------------------------------------------
-- One report for one Resend email: delivered, delayed, bounced, marked as
-- spam, failed or suppressed. Applies only to that school's mail, and never
-- moves a recipient backwards (a late "delayed" after "delivered" is
-- ignored). A bounce or failure leaves the sender a note.
create or replace function classroom.mail_delivery_event(target_school uuid, provider_id_in text, event_in text, detail_in text, recipients_in text[] default null)
returns int language plpgsql security definer set search_path = classroom, public as $fn$
declare
  new_status text;
  rank_new int;
  msg uuid;
  box uuid;
  subj text;
  changed text[];
  n int;
begin
  new_status := case event_in
    when 'email.sent' then 'sent'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.suppressed' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    else null end;
  if new_status is null then return 0; end if;
  rank_new := case new_status when 'sent' then 1 when 'delayed' then 2 when 'delivered' then 3 else 4 end;

  with hit as (
    update classroom.mail_outbound o
       set status = new_status, detail = coalesce(detail_in, o.detail), updated_at = now()
      from classroom.mail_messages m, classroom.mail_mailboxes b
     where o.provider_id = provider_id_in
       and m.id = o.message_id and b.id = m.mailbox_id and b.school_id = target_school
       and (recipients_in is null or cardinality(recipients_in) = 0 or o.recipient = any (recipients_in))
       and o.status <> new_status
       and case o.status when 'pending' then 0 when 'sending' then 0 when 'sent' then 1 when 'delayed' then 2 when 'delivered' then 3 else 4 end
           <= case when new_status = 'complained' then 3 else rank_new end
    returning o.message_id, o.recipient
  )
  select max(message_id::text)::uuid, array_agg(recipient) into msg, changed from hit;
  n := coalesce(cardinality(changed), 0);
  if n = 0 then return 0; end if;

  if new_status in ('bounced', 'failed') then
    select m.mailbox_id, m.subject into box, subj from classroom.mail_messages m where m.id = msg;
    perform classroom.mail_notice(box, 'Not delivered: ' || subj,
      '<p>Your message <strong>' || replace(replace(subj, '<', '&lt;'), '>', '&gt;') || '</strong> could not be delivered to: '
        || array_to_string(changed, ', ') || '.</p><p>'
        || replace(replace(coalesce(detail_in, 'The receiving mail server refused it.'), '<', '&lt;'), '>', '&gt;') || '</p>');
  end if;
  perform classroom.mail_outbound_settle(msg);
  return n;
end;
$fn$;
revoke all on function classroom.mail_delivery_event(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function classroom.mail_delivery_event(uuid, text, text, text, text[]) to service_role;

-- 6. The scheduler: every minute, only when something outside is due -------------------
select cron.unschedule('schoolivio-mail-outbound')
 where exists (select 1 from cron.job where jobname = 'schoolivio-mail-outbound');
select cron.schedule(
  'schoolivio-mail-outbound',
  '* * * * *',
  $job$
    select classroom.mail_kick(null)
     where exists (select 1 from classroom.mail_outbound o
                     join classroom.mail_messages m on m.id = o.message_id
                     join classroom.mail_mailboxes b on b.id = m.mailbox_id
                     join classroom.mail_settings s on s.school_id = b.school_id and s.sending_enabled
                    where o.status = 'pending' and o.next_attempt_at <= now()
                       or o.status = 'sending' and o.updated_at < now() - interval '10 minutes');
  $job$
);

notify pgrst, 'reload schema';
