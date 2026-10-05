-- Schoolivio Mail, step 4: bringing old mail across, once, when a school
-- leaves its previous provider (Google, Microsoft, Zoho, cPanel, any).
--
--   mail_imports   one import into one mailbox: where from, how far it has
--                  got, and what it found. Sources:
--                    imap       any provider; host, user and password (Vault).
--                               "Catch up" on switch day fetches only what
--                               arrived since.
--                    mbox       a Google Takeout (or any) .mbox file, uploaded
--                               in parts of up to 45 MB and read as one.
--                    eml        .eml files, into a folder chosen at upload.
--                    microsoft  Microsoft 365, through the school's one-time
--                               admin approval (no passwords): every folder.
--   mail-import    Edge Function: starts imports, and (scheduler, every
--                  minute) works through them in short turns, picking up
--                  where the last turn stopped.
--   Once only      every imported message is keyed "imp:<Message-ID>" in
--                  inbound_id, so the same message from two folders, two
--                  uploads or a catch-up is kept once per mailbox.

-- 1. Imports ---------------------------------------------------------------------------
create table if not exists classroom.mail_imports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  source text not null check (source in ('imap', 'mbox', 'eml', 'microsoft')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  label text not null default '',                     -- what the person sees: "Gmail (ada@gmail.com)", "Takeout.mbox"
  -- imap
  imap_host text,
  imap_port int,
  imap_security text check (imap_security is null or imap_security in ('ssl', 'starttls', 'none')),
  imap_username text,
  secret_vault_id uuid,
  since date,                                         -- only mail on or after this day (optional)
  -- files (mbox, eml), in the private "mail-imports" bucket
  file_paths text[] not null default '{}',
  target_folder text check (target_folder is null or target_folder in ('inbox', 'sent', 'archive')),
  -- microsoft
  source_user text,                                   -- the Microsoft 365 user (their address)
  -- progress
  cursor jsonb not null default '{}'::jsonb,          -- where the next turn starts
  found int not null default 0,
  imported int not null default 0,
  skipped int not null default 0,                     -- already there
  failed int not null default 0,
  bytes bigint not null default 0,
  last_error text,
  lease_until timestamptz,                            -- a turn is working on it until then
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mail_imports_due_idx on classroom.mail_imports (status, updated_at) where status in ('queued', 'running');
create index if not exists mail_imports_mailbox_idx on classroom.mail_imports (mailbox_id, created_at desc);
alter table classroom.mail_imports enable row level security;
drop policy if exists "owners and admins see imports" on classroom.mail_imports;
create policy "owners and admins see imports" on classroom.mail_imports
  for select to authenticated using (classroom.owns_mailbox(mailbox_id) or classroom.is_school_admin(school_id));
revoke all on classroom.mail_imports from anon, authenticated;
grant select (id, school_id, mailbox_id, created_by, source, status, label, imap_host, imap_username, since, target_folder,
              source_user, found, imported, skipped, failed, bytes, last_error, started_at, finished_at, created_at, updated_at)
  on classroom.mail_imports to authenticated;

-- Live progress on the Mail page.
create or replace function classroom.rt_mail_imports()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare owner uuid;
begin
  select user_id into owner from classroom.mail_mailboxes where id = new.mailbox_id;
  if owner is not null then
    perform classroom.rt_send('user:' || owner, 'change',
      classroom.rt_body(tg_op, tg_table_name, jsonb_build_object('id', new.id, 'status', new.status, 'imported', new.imported), null));
  end if;
  return null;
end;
$fn$;
drop trigger if exists rt_mail_imports on classroom.mail_imports;
create trigger rt_mail_imports after insert or update of status, imported on classroom.mail_imports
  for each row execute function classroom.rt_mail_imports();

-- Uploaded .mbox parts and .eml files: <mailbox_id>/<import_id>/<n>-<name>.
-- Deleted as soon as they have been read.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-imports', 'mail-imports', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;
drop policy if exists "mail import uploads" on storage.objects;
create policy "mail import uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'mail-imports' and (
    classroom.owns_mailbox(classroom.try_uuid((storage.foldername(name))[1]))
    or exists (select 1 from classroom.mail_mailboxes b where b.id = classroom.try_uuid((storage.foldername(name))[1]) and classroom.is_school_admin(b.school_id))));
drop policy if exists "mail import remove" on storage.objects;
create policy "mail import remove" on storage.objects for delete to authenticated
  using (bucket_id = 'mail-imports' and classroom.owns_mailbox(classroom.try_uuid((storage.foldername(name))[1])));

-- 2. Who may import into a mailbox: its owner, or a school admin -------------------------------
create or replace function classroom.mail_can_import(target_mailbox uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_mailboxes b where b.id = target_mailbox
                  and (b.user_id = (select auth.uid()) or classroom.is_school_admin(b.school_id)));
$fn$;
grant execute on function classroom.mail_can_import(uuid) to authenticated;

-- Starting one (service role, after mail-import has checked mail_can_import as the caller).
create or replace function classroom.mail_import_create(target_mailbox uuid, actor uuid, fields jsonb, password_in text default null)
returns classroom.mail_imports language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare
  box classroom.mail_mailboxes;
  imp classroom.mail_imports;
  vid uuid;
begin
  select * into box from classroom.mail_mailboxes where id = target_mailbox;
  if not found then raise exception 'That mailbox no longer exists.'; end if;
  if exists (select 1 from classroom.mail_imports where mailbox_id = target_mailbox and status in ('queued', 'running')
               and source = fields ->> 'source' and coalesce(imap_username, source_user, '') = coalesce(fields ->> 'imap_username', fields ->> 'source_user', '')
               and fields ->> 'source' in ('imap', 'microsoft')) then
    raise exception 'That import is already running.';
  end if;
  if password_in is not null then
    vid := vault.create_secret(password_in, 'mail_import:' || gen_random_uuid(), 'Password for a one-time mail import');
  end if;
  insert into classroom.mail_imports (school_id, mailbox_id, created_by, source, label, imap_host, imap_port, imap_security,
      imap_username, secret_vault_id, since, file_paths, target_folder, source_user, cursor)
  values (box.school_id, box.id, actor, fields ->> 'source', coalesce(fields ->> 'label', ''), fields ->> 'imap_host',
      (fields ->> 'imap_port')::int, fields ->> 'imap_security', fields ->> 'imap_username', vid,
      nullif(fields ->> 'since', '')::date,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(fields -> 'file_paths', '[]'::jsonb)) x), '{}'),
      nullif(fields ->> 'target_folder', ''), fields ->> 'source_user', coalesce(fields -> 'cursor', '{}'::jsonb))
  returning * into imp;
  return imp;
end;
$fn$;
revoke all on function classroom.mail_import_create(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function classroom.mail_import_create(uuid, uuid, jsonb, text) to service_role;

-- Cancel, or (imap / microsoft) catch up on what arrived since: as the caller.
create or replace function classroom.mail_import_control(target_import uuid, action_in text)
returns classroom.mail_imports language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare imp classroom.mail_imports;
begin
  select * into imp from classroom.mail_imports where id = target_import for update;
  if not found or not classroom.mail_can_import(imp.mailbox_id) then raise exception 'That import is not yours.'; end if;
  if action_in = 'cancel' then
    if imp.status in ('queued', 'running') then
      update classroom.mail_imports set status = 'cancelled', finished_at = now(), lease_until = null, updated_at = now() where id = imp.id returning * into imp;
    end if;
  elsif action_in = 'catch_up' then
    if imp.source not in ('imap', 'microsoft') then raise exception 'Only an account import can catch up. Upload a new export instead.'; end if;
    if imp.source = 'imap' and imp.secret_vault_id is null then raise exception 'The password was removed when this import finished. Start a new one.'; end if;
    if imp.status in ('done', 'failed', 'cancelled') then
      -- Folders start again from where they ended; everything already here is skipped.
      update classroom.mail_imports
         set status = 'queued', last_error = null, finished_at = null, lease_until = null,
             cursor = case when cursor ? 'folders' then jsonb_set(cursor, '{folders}',
                        (select coalesce(jsonb_agg(f - 'done' - 'next'), '[]'::jsonb) from jsonb_array_elements(cursor -> 'folders') f)) else cursor end,
             updated_at = now()
       where id = imp.id returning * into imp;
    end if;
  else
    raise exception 'Unknown action.';
  end if;
  return imp;
end;
$fn$;
revoke all on function classroom.mail_import_control(uuid, text) from public, anon;
grant execute on function classroom.mail_import_control(uuid, text) to authenticated;

-- 3. The worker's side (service role only) ---------------------------------------------------
-- Take the next import that is due; a turn holds it for two minutes.
create or replace function classroom.mail_import_claim()
returns jsonb language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare imp classroom.mail_imports;
begin
  select * into imp from classroom.mail_imports
   where status in ('queued', 'running') and (lease_until is null or lease_until < now())
   order by updated_at limit 1 for update skip locked;
  if not found then return null; end if;
  update classroom.mail_imports
     set status = 'running', lease_until = now() + interval '2 minutes', started_at = coalesce(started_at, now()), updated_at = now()
   where id = imp.id returning * into imp;
  return to_jsonb(imp) - 'secret_vault_id' || jsonb_build_object(
    'password', (select decrypted_secret from vault.decrypted_secrets where id = imp.secret_vault_id),
    'mailbox_address', (select address from classroom.mail_mailboxes where id = imp.mailbox_id),
    'previous_addresses', (select to_jsonb(previous_addresses) from classroom.mail_mailboxes where id = imp.mailbox_id),
    'school_domain', (select domain from classroom.mail_settings where school_id = imp.school_id));
end;
$fn$;
revoke all on function classroom.mail_import_claim() from public, anon, authenticated;
grant execute on function classroom.mail_import_claim() to service_role;

-- Save progress at the end of a turn (or when it finishes or fails). A
-- finished import forgets its password.
create or replace function classroom.mail_import_progress(target_import uuid, cursor_in jsonb, status_in text, add jsonb, error_in text default null)
returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare imp classroom.mail_imports;
begin
  select * into imp from classroom.mail_imports where id = target_import for update;
  if not found then return; end if;
  if imp.status = 'cancelled' then
    update classroom.mail_imports set lease_until = null where id = imp.id;
    return;
  end if;
  update classroom.mail_imports mi
     set cursor = coalesce(cursor_in, mi.cursor),
         status = coalesce(status_in, mi.status),
         found = mi.found + coalesce((add ->> 'found')::int, 0),
         imported = mi.imported + coalesce((add ->> 'imported')::int, 0),
         skipped = mi.skipped + coalesce((add ->> 'skipped')::int, 0),
         failed = mi.failed + coalesce((add ->> 'failed')::int, 0),
         bytes = mi.bytes + coalesce((add ->> 'bytes')::bigint, 0),
         last_error = case when status_in in ('failed') or error_in is not null then error_in else mi.last_error end,
         lease_until = null,
         finished_at = case when status_in in ('done', 'failed') then now() else mi.finished_at end,
         updated_at = now()
   where mi.id = imp.id;
  -- An account import keeps its password for a switch-day catch-up for 30 days (see mail_import_forget).
end;
$fn$;
revoke all on function classroom.mail_import_progress(uuid, jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function classroom.mail_import_progress(uuid, jsonb, text, jsonb, text) to service_role;

-- Already in this mailbox?
create or replace function classroom.mail_import_seen(target_mailbox uuid, keys text[])
returns text[] language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(array_agg(inbound_id), '{}') from classroom.mail_messages where mailbox_id = target_mailbox and inbound_id = any (keys);
$fn$;
revoke all on function classroom.mail_import_seen(uuid, text[]) from public, anon, authenticated;
grant execute on function classroom.mail_import_seen(uuid, text[]) to service_role;

-- One imported message into its folder, keeping read and flagged as they were.
-- Returns 'imported', 'skipped' (already there) or 'full'.
create or replace function classroom.mail_import_message(target_mailbox uuid, key_in text, envelope_in uuid, folder_in text,
                                                        msg jsonb, files jsonb default '[]'::jsonb)
returns text language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  thread uuid;
  refs text[];
  subj text := coalesce(msg ->> 'subject', '');
  bare text;
  sender text := lower(coalesce(msg ->> 'from_address', ''));
  sent timestamptz := coalesce((msg ->> 'sent_at')::timestamptz, now());
  sz bigint := coalesce((msg ->> 'size')::bigint, 0);
  f jsonb;
  has_files boolean := jsonb_array_length(coalesce(files, '[]'::jsonb)) > 0;
  inserted uuid;
begin
  select * into box from classroom.mail_mailboxes where id = target_mailbox;
  if not found then return 'skipped'; end if;
  if exists (select 1 from classroom.mail_messages where mailbox_id = box.id and inbound_id = key_in) then return 'skipped'; end if;
  if box.used_bytes + sz > box.quota_bytes then return 'full'; end if;

  select coalesce(array_agg(x), '{}') into refs
    from (select jsonb_array_elements_text(coalesce(msg -> 'references', '[]'::jsonb)) x
          union select msg ->> 'in_reply_to') r where x is not null and x <> '';
  bare := lower(btrim(regexp_replace(subj, '^((re|fw|fwd|aw|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i')));
  if array_length(refs, 1) > 0 then
    select m.thread_id into thread from classroom.mail_messages m
     where m.mailbox_id = box.id and m.message_id = any (refs) order by m.created_at desc limit 1;
  end if;
  if thread is null and bare <> '' then
    select m.thread_id into thread from classroom.mail_messages m
     where m.mailbox_id = box.id and m.folder <> 'drafts'
       and coalesce(m.sent_at, m.created_at) between sent - interval '60 days' and sent + interval '60 days'
       and lower(btrim(regexp_replace(m.subject, '^((re|fw|fwd|aw|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i'))) = bare
       and (lower(m.from_address) = sender
            or exists (select 1 from jsonb_array_elements(m.to_list || m.cc_list) a where lower(a ->> 'address') = sender))
     order by abs(extract(epoch from coalesce(m.sent_at, m.created_at) - sent)) limit 1;
  end if;

  insert into classroom.mail_messages (mailbox_id, envelope_id, thread_id, message_id, in_reply_to, folder,
      from_address, from_name, to_list, cc_list, bcc_list, reply_to, subject, body_html, snippet, importance,
      has_attachments, size_bytes, is_read, is_flagged, sent_at, inbound_id)
  values (box.id, envelope_in, coalesce(thread, gen_random_uuid()),
      coalesce(nullif(msg ->> 'message_id', ''), '<' || key_in || '@import.schoolivio.com>'),
      nullif(msg ->> 'in_reply_to', ''),
      case when folder_in in ('inbox', 'drafts', 'sent', 'archive', 'junk', 'deleted') then folder_in else 'archive' end,
      sender, coalesce(msg ->> 'from_name', ''),
      coalesce(msg -> 'to_list', '[]'::jsonb), coalesce(msg -> 'cc_list', '[]'::jsonb), coalesce(msg -> 'bcc_list', '[]'::jsonb),
      coalesce(msg -> 'reply_to', '[]'::jsonb),
      subj, coalesce(msg ->> 'html', ''), classroom.mail_snippet(coalesce(msg ->> 'html', '')),
      coalesce(nullif(msg ->> 'importance', ''), 'normal'),
      has_files, sz, coalesce((msg ->> 'is_read')::boolean, true), coalesce((msg ->> 'is_flagged')::boolean, false),
      sent, key_in)
  on conflict (mailbox_id, inbound_id) where inbound_id is not null do nothing
  returning id into inserted;
  if inserted is null then return 'skipped'; end if;

  if has_files then
    for f in select value from jsonb_array_elements(files) loop
      insert into classroom.mail_attachments (envelope_id, mailbox_id, file_path, file_name, mime_type, size_bytes, content_id)
      values (envelope_in, box.id, f ->> 'file_path', coalesce(nullif(f ->> 'file_name', ''), 'attachment'),
              coalesce(nullif(f ->> 'mime_type', ''), 'application/octet-stream'), least(coalesce((f ->> 'size_bytes')::bigint, 0), 26214400),
              nullif(f ->> 'content_id', ''))
      on conflict (file_path) do nothing;
    end loop;
  end if;
  return 'imported';
end;
$fn$;
revoke all on function classroom.mail_import_message(uuid, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function classroom.mail_import_message(uuid, text, uuid, text, jsonb, jsonb) to service_role;

-- Account passwords are kept 30 days after an import ends (for a switch-day
-- catch-up), then deleted. Run daily by the scheduler below.
create or replace function classroom.mail_import_forget()
returns int language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare r record; n int := 0;
begin
  for r in select id, secret_vault_id from classroom.mail_imports
            where secret_vault_id is not null and status in ('done', 'failed', 'cancelled')
              and coalesce(finished_at, updated_at) < now() - interval '30 days' loop
    delete from vault.secrets where id = r.secret_vault_id;
    update classroom.mail_imports set secret_vault_id = null where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
revoke all on function classroom.mail_import_forget() from public, anon, authenticated;

-- 4. Microsoft 365: the school's one-time admin approval --------------------------------------
-- Tekktopia's Microsoft app (Console → Mail): its client id here, its secret in Vault.
alter table classroom.platform_settings
  add column if not exists microsoft_client_id text,
  add column if not exists microsoft_secret_id uuid;
revoke select (microsoft_secret_id) on classroom.platform_settings from authenticated;
alter table classroom.mail_settings
  add column if not exists microsoft_tenant text,       -- set when the school's Microsoft 365 admin approves
  add column if not exists microsoft_consent_at timestamptz;

create or replace function classroom.platform_set_secret(which text, plaintext text)
returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare new_id uuid; old_id uuid;
begin
  if which not in ('smtp', 'paystack', 'vercel', 'microsoft') then raise exception 'Unknown secret'; end if;
  new_id := vault.create_secret(plaintext, 'platform:' || which || ':' || gen_random_uuid()::text, 'Schoolivio platform credential');
  select case which when 'smtp' then smtp_secret_id when 'paystack' then paystack_secret_id
                    when 'vercel' then vercel_secret_id else microsoft_secret_id end
    into old_id from classroom.platform_settings where id;
  update classroom.platform_settings
     set smtp_secret_id = case when which = 'smtp' then new_id else smtp_secret_id end,
         paystack_secret_id = case when which = 'paystack' then new_id else paystack_secret_id end,
         vercel_secret_id = case when which = 'vercel' then new_id else vercel_secret_id end,
         microsoft_secret_id = case when which = 'microsoft' then new_id else microsoft_secret_id end,
         updated_at = now()
   where id;
  if old_id is not null then delete from vault.secrets where id = old_id; end if;
end;
$fn$;

create or replace function classroom.platform_get_secret(which text)
returns text language sql stable security definer set search_path = classroom, public, vault as $fn$
  select s.decrypted_secret from vault.decrypted_secrets s
   where s.id = (select case which when 'smtp' then smtp_secret_id when 'paystack' then paystack_secret_id
                                   when 'vercel' then vercel_secret_id when 'microsoft' then microsoft_secret_id end
                   from classroom.platform_settings where id);
$fn$;
revoke all on function classroom.platform_set_secret(text, text) from public, anon, authenticated;
revoke all on function classroom.platform_get_secret(text) from public, anon, authenticated;
grant execute on function classroom.platform_set_secret(text, text), classroom.platform_get_secret(text) to service_role;

create or replace function classroom.platform_microsoft()
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  select jsonb_build_object('client_id', microsoft_client_id, 'ready', microsoft_client_id is not null and microsoft_secret_id is not null)
    from classroom.platform_settings where id;
$fn$;
revoke all on function classroom.platform_microsoft() from public, anon;
grant execute on function classroom.platform_microsoft() to authenticated, service_role;

create or replace function classroom.platform_set_microsoft_client(client_in text)
returns void language sql security definer set search_path = classroom, public as $fn$
  update classroom.platform_settings set microsoft_client_id = nullif(btrim(client_in), ''), updated_at = now() where id;
$fn$;
revoke all on function classroom.platform_set_microsoft_client(text) from public, anon, authenticated;
grant execute on function classroom.platform_set_microsoft_client(text) to service_role;

create or replace function classroom.mail_set_microsoft_tenant(target_school uuid, tenant_in text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  insert into classroom.mail_settings (school_id) values (target_school) on conflict (school_id) do nothing;
  update classroom.mail_settings set microsoft_tenant = tenant_in, microsoft_consent_at = case when tenant_in is null then null else now() end,
         updated_at = now() where school_id = target_school;
end;
$fn$;
revoke all on function classroom.mail_set_microsoft_tenant(uuid, text) from public, anon, authenticated;
grant execute on function classroom.mail_set_microsoft_tenant(uuid, text) to service_role;

create or replace function classroom.mail_microsoft_tenant(target_school uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select microsoft_tenant from classroom.mail_settings where school_id = target_school;
$fn$;
revoke all on function classroom.mail_microsoft_tenant(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_microsoft_tenant(uuid) to service_role;

-- The school admin's Mail settings show whether Microsoft 365 is approved.
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_settings_get(uuid)'::regprocedure);
  if position('microsoft_consent_at' in d) = 0 then
    d := replace(d, '''platform_dns_at'', s.platform_dns_at,', '''platform_dns_at'', s.platform_dns_at,
    ''microsoft_consent_at'', s.microsoft_consent_at,
    ''microsoft_ready'', coalesce((select microsoft_client_id is not null and microsoft_secret_id is not null from classroom.platform_settings where id), false),');
    execute d;
  end if;
end
$do$;

-- 5. The scheduler: a turn every minute while anything is waiting; passwords forgotten daily.
select cron.unschedule('schoolivio-mail-import') where exists (select 1 from cron.job where jobname = 'schoolivio-mail-import');
select cron.schedule(
  'schoolivio-mail-import',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/mail-import',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ticket_mail_cron_secret')),
      body := '{"action":"work"}'::jsonb,
      timeout_milliseconds := 150000)
     where exists (select 1 from classroom.mail_imports where status in ('queued', 'running') and (lease_until is null or lease_until < now()));
  $job$
);
select cron.unschedule('schoolivio-mail-import-forget') where exists (select 1 from cron.job where jobname = 'schoolivio-mail-import-forget');
select cron.schedule('schoolivio-mail-import-forget', '30 2 * * *', $job$ select classroom.mail_import_forget(); $job$);

notify pgrst, 'reload schema';

-- 6. Imported mail arrives quietly: one live refresh per turn (the import's
-- own progress), not one per message, so a 10,000-message import does not
-- reload the person's Mail page 10,000 times.
create or replace function classroom.rt_mail_messages()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare owner uuid;
begin
  if tg_op = 'INSERT' and new.inbound_id like 'imp:%' then return null; end if;
  select user_id into owner from classroom.mail_mailboxes where id = coalesce(new.mailbox_id, old.mailbox_id);
  if owner is not null then
    perform classroom.rt_send('user:' || owner, 'change',
      classroom.rt_body(tg_op, tg_table_name,
        case when new is null then null else jsonb_build_object('id', new.id, 'mailbox_id', new.mailbox_id, 'folder', new.folder, 'is_read', new.is_read, 'thread_id', new.thread_id) end,
        case when old is null then null else jsonb_build_object('id', old.id, 'mailbox_id', old.mailbox_id, 'folder', old.folder) end));
  end if;
  return null;
end;
$fn$;

notify pgrst, 'reload schema';

-- 7. Outlook .pst: read in the person's browser (tools/pst-worker), which
-- sends the mail up in mbox parts as it goes. The import stays open
-- (cursor.open) and takes each part as it arrives; the browser says when
-- the file is finished. As the caller.
create or replace function classroom.mail_import_append(target_import uuid, path_in text, size_in bigint)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare imp classroom.mail_imports;
begin
  select * into imp from classroom.mail_imports where id = target_import for update;
  if not found or not classroom.mail_can_import(imp.mailbox_id) then raise exception 'That import is not yours.'; end if;
  if imp.status not in ('queued', 'running') then raise exception 'That import has stopped. Start it again.'; end if;
  if not coalesce((imp.cursor ->> 'open')::boolean, false) then raise exception 'That import is already complete.'; end if;
  if split_part(path_in, '/', 1) <> imp.mailbox_id::text or size_in <= 0 then raise exception 'That part is not in your upload area.'; end if;
  update classroom.mail_imports
     set file_paths = array_append(file_paths, path_in),
         cursor = jsonb_set(jsonb_set(cursor, '{sizes}', coalesce(cursor -> 'sizes', '[]'::jsonb) || to_jsonb(size_in)),
                            '{appended_at}', to_jsonb(now())),
         updated_at = now()
   where id = imp.id;
end;
$fn$;
revoke all on function classroom.mail_import_append(uuid, text, bigint) from public, anon;
grant execute on function classroom.mail_import_append(uuid, text, bigint) to authenticated;

create or replace function classroom.mail_import_finish(target_import uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare imp classroom.mail_imports;
begin
  select * into imp from classroom.mail_imports where id = target_import for update;
  if not found or not classroom.mail_can_import(imp.mailbox_id) then raise exception 'That import is not yours.'; end if;
  update classroom.mail_imports set cursor = jsonb_set(cursor, '{open}', 'false'::jsonb), updated_at = now() where id = imp.id;
end;
$fn$;
revoke all on function classroom.mail_import_finish(uuid) from public, anon;
grant execute on function classroom.mail_import_finish(uuid) to authenticated;

notify pgrst, 'reload schema';
