-- Schoolivio Mail, phase 1: every member of staff has a mailbox and an
-- address (firstname.surname@<school>.schoolivio.com), and mail between
-- Schoolivio addresses is delivered inside Schoolivio itself, with no outside
-- provider. Mail to other addresses waits in the sender's Outbox
-- (mail_outbound) until Schoolivio's own mail server is connected (phase 1b);
-- incoming outside mail arrives through mail_receive, built for that server.
--
--   mail_mailboxes    one per member of staff: address, name, signature,
--                     5 GB quota and what is used.
--   mail_messages     a copy per mailbox, the way Outlook keeps them: the
--                     sender's in Sent, each recipient's in their Inbox, so
--                     each person files, flags and deletes their own copy.
--                     Copies of one sending share an envelope_id (for recall
--                     later) and a thread_id (conversation view).
--   mail_attachments  files of a sending, kept once per envelope in the
--                     private "mail" bucket; whoever holds a copy can open
--                     them.
--   mail_send         sends a draft: checks every address, delivers inside
--                     Schoolivio, queues the rest, keeps the sender's copy.
--
-- Only the mailbox's owner sees or touches its messages (RLS). Bcc is kept on
-- the sender's copy only: recipients never see who was blind-copied.

-- 1. Mailboxes -------------------------------------------------------------------
create table if not exists classroom.mail_mailboxes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null unique check (address = lower(address) and address ~ '^[a-z0-9._-]+@[a-z0-9.-]+$'),
  display_name text not null default '',
  signature_html text not null default '',
  quota_bytes bigint not null default 5368709120,   -- 5 GB
  used_bytes bigint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id)
);
create index if not exists mail_mailboxes_user_idx on classroom.mail_mailboxes (user_id);
alter table classroom.mail_mailboxes enable row level security;
drop policy if exists "people read their own mailbox" on classroom.mail_mailboxes;
create policy "people read their own mailbox" on classroom.mail_mailboxes
  for select to authenticated using (user_id = (select auth.uid()) or classroom.is_school_admin(school_id));
drop policy if exists "people update their own mailbox" on classroom.mail_mailboxes;
create policy "people update their own mailbox" on classroom.mail_mailboxes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on classroom.mail_mailboxes to authenticated;
grant update (display_name, signature_html, updated_at) on classroom.mail_mailboxes to authenticated;

create or replace function classroom.owns_mailbox(target_mailbox uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_mailboxes where id = target_mailbox and user_id = (select auth.uid()));
$fn$;
grant execute on function classroom.owns_mailbox(uuid) to authenticated;

-- 2. Messages ---------------------------------------------------------------------
create table if not exists classroom.mail_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  envelope_id uuid not null default gen_random_uuid(),
  thread_id uuid not null default gen_random_uuid(),
  message_id text not null default ('<' || gen_random_uuid() || '@schoolivio.com>'),
  in_reply_to text,
  folder text not null default 'inbox' check (folder in ('inbox', 'drafts', 'sent', 'outbox', 'archive', 'junk', 'deleted')),
  previous_folder text,
  from_address text not null default '',
  from_name text not null default '',
  to_list jsonb not null default '[]'::jsonb,       -- [{ "name": "", "address": "" }]
  cc_list jsonb not null default '[]'::jsonb,
  bcc_list jsonb not null default '[]'::jsonb,      -- the sender's copy only
  subject text not null default '',
  body_html text not null default '',
  snippet text not null default '',
  importance text not null default 'normal' check (importance in ('low', 'normal', 'high')),
  has_attachments boolean not null default false,
  size_bytes bigint not null default 0,
  is_read boolean not null default false,
  is_flagged boolean not null default false,
  is_pinned boolean not null default false,
  sent_at timestamptz,
  external_pending int not null default 0,          -- outside addresses still waiting
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mail_messages_folder_idx on classroom.mail_messages (mailbox_id, folder, coalesce(sent_at, created_at) desc);
create index if not exists mail_messages_thread_idx on classroom.mail_messages (mailbox_id, thread_id);
create index if not exists mail_messages_envelope_idx on classroom.mail_messages (envelope_id);
create index if not exists mail_messages_unread_idx on classroom.mail_messages (mailbox_id) where not is_read and folder = 'inbox';
alter table classroom.mail_messages enable row level security;
drop policy if exists "owners read their mail" on classroom.mail_messages;
create policy "owners read their mail" on classroom.mail_messages
  for select to authenticated using (classroom.owns_mailbox(mailbox_id));
drop policy if exists "owners write drafts" on classroom.mail_messages;
create policy "owners write drafts" on classroom.mail_messages
  for insert to authenticated with check (classroom.owns_mailbox(mailbox_id) and folder = 'drafts');
drop policy if exists "owners file their mail" on classroom.mail_messages;
create policy "owners file their mail" on classroom.mail_messages
  for update to authenticated using (classroom.owns_mailbox(mailbox_id)) with check (classroom.owns_mailbox(mailbox_id));
drop policy if exists "owners delete their mail" on classroom.mail_messages;
create policy "owners delete their mail" on classroom.mail_messages
  for delete to authenticated using (classroom.owns_mailbox(mailbox_id) and folder in ('deleted', 'drafts'));
grant select, insert, delete on classroom.mail_messages to authenticated;
-- What a person may change on their own copy: filing, flags, and a draft's content.
grant update (folder, previous_folder, is_read, is_flagged, is_pinned, to_list, cc_list, bcc_list, subject, body_html,
              snippet, importance, in_reply_to, thread_id, has_attachments, updated_at) on classroom.mail_messages to authenticated;

-- A sent message's content never changes: only drafts can be edited.
create or replace function classroom.mail_messages_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  if current_user in ('authenticated', 'anon') and old.folder <> 'drafts' and (
       new.subject is distinct from old.subject or new.body_html is distinct from old.body_html
       or new.to_list is distinct from old.to_list or new.cc_list is distinct from old.cc_list
       or new.bcc_list is distinct from old.bcc_list or new.importance is distinct from old.importance) then
    raise exception 'A sent or received message cannot be edited.';
  end if;
  if current_user in ('authenticated', 'anon') and new.folder = 'drafts' and old.folder <> 'drafts' then
    raise exception 'Only an unsent message can be a draft.';
  end if;
  if current_user in ('authenticated', 'anon') and new.folder in ('sent', 'outbox') and old.folder <> new.folder then
    raise exception 'Use Send to send a message.';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;
drop trigger if exists mail_messages_guard on classroom.mail_messages;
create trigger mail_messages_guard before update on classroom.mail_messages
  for each row execute function classroom.mail_messages_guard();

-- 3. Attachments ------------------------------------------------------------------
create table if not exists classroom.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null,
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,  -- whose upload
  file_path text not null unique,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0 and size_bytes <= 26214400),  -- 25 MB each
  content_id text,                                  -- a picture shown inside the body
  created_at timestamptz not null default now()
);
create index if not exists mail_attachments_envelope_idx on classroom.mail_attachments (envelope_id);
alter table classroom.mail_attachments enable row level security;

create or replace function classroom.can_see_envelope(target_envelope uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
                  where m.envelope_id = target_envelope and b.user_id = (select auth.uid()));
$fn$;
grant execute on function classroom.can_see_envelope(uuid) to authenticated;

drop policy if exists "holders read attachments" on classroom.mail_attachments;
create policy "holders read attachments" on classroom.mail_attachments
  for select to authenticated using (classroom.can_see_envelope(envelope_id));
drop policy if exists "owners attach to drafts" on classroom.mail_attachments;
create policy "owners attach to drafts" on classroom.mail_attachments
  for insert to authenticated with check (
    classroom.owns_mailbox(mailbox_id)
    and exists (select 1 from classroom.mail_messages m where m.envelope_id = mail_attachments.envelope_id
                  and m.mailbox_id = mail_attachments.mailbox_id and m.folder = 'drafts'));
drop policy if exists "owners remove draft attachments" on classroom.mail_attachments;
create policy "owners remove draft attachments" on classroom.mail_attachments
  for delete to authenticated using (
    classroom.owns_mailbox(mailbox_id)
    and exists (select 1 from classroom.mail_messages m where m.envelope_id = mail_attachments.envelope_id
                  and m.mailbox_id = mail_attachments.mailbox_id and m.folder = 'drafts'));
grant select, insert, delete on classroom.mail_attachments to authenticated;

-- The files: mail/<mailbox_id>/<envelope_id>/<uuid>-<name>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mail', 'mail', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "mail owners upload" on storage.objects;
create policy "mail owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'mail' and classroom.owns_mailbox(classroom.try_uuid((storage.foldername(name))[1])));
drop policy if exists "mail holders read" on storage.objects;
create policy "mail holders read" on storage.objects for select to authenticated
  using (bucket_id = 'mail' and (
    classroom.owns_mailbox(classroom.try_uuid((storage.foldername(name))[1]))
    or classroom.can_see_envelope(classroom.try_uuid((storage.foldername(name))[2]))));
drop policy if exists "mail owners remove" on storage.objects;
create policy "mail owners remove" on storage.objects for delete to authenticated
  using (bucket_id = 'mail' and classroom.owns_mailbox(classroom.try_uuid((storage.foldername(name))[1])));

-- 4. Outside mail waiting for Schoolivio's mail server ------------------------------
create table if not exists classroom.mail_outbound (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references classroom.mail_messages (id) on delete cascade,  -- the sender's copy
  recipient text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists mail_outbound_pending_idx on classroom.mail_outbound (status, created_at) where status = 'pending';
alter table classroom.mail_outbound enable row level security;
drop policy if exists "senders see their outside deliveries" on classroom.mail_outbound;
create policy "senders see their outside deliveries" on classroom.mail_outbound
  for select to authenticated using (exists (select 1 from classroom.mail_messages m where m.id = mail_outbound.message_id and classroom.owns_mailbox(m.mailbox_id)));
grant select on classroom.mail_outbound to authenticated;

-- 5. Mailboxes for staff -------------------------------------------------------------
create or replace function classroom.mail_domain(target_school uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select slug || '.schoolivio.com' from classroom.schools where id = target_school;
$fn$;

-- The caller's mailbox at a school, made the first time it is needed. Staff
-- only; parents and pupils use their own email.
create or replace function classroom.mail_my_mailbox(target_school uuid)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare
  me uuid := (select auth.uid());
  box classroom.mail_mailboxes;
  prof classroom.profiles;
  base text;
  candidate text;
  domain text := classroom.mail_domain(target_school);
  n int := 1;
begin
  select * into box from classroom.mail_mailboxes where school_id = target_school and user_id = me;
  if found then return box; end if;
  if not exists (select 1 from classroom.school_members m where m.school_id = target_school and m.user_id = me and m.is_active
                  and m.granted_via is null and m.role not in ('student', 'parent')) then
    raise exception 'Mailboxes are for the school''s staff.';
  end if;
  select * into prof from classroom.profiles where id = me;
  base := lower(regexp_replace(
            -- First word of the first name and the last word of the surname: adeyemo.akintunde.
            coalesce(nullif(concat_ws('.', nullif(split_part(btrim(prof.first_name), ' ', 1), ''), nullif(regexp_replace(btrim(prof.surname), '^.* ', ''), '')), ''),
                     nullif(prof.username, ''), split_part(prof.email, '@', 1), 'staff'),
            '[^a-zA-Z0-9.]+', '', 'g'));
  base := btrim(base, '.');
  if base = '' then base := 'staff'; end if;
  candidate := base || '@' || domain;
  while exists (select 1 from classroom.mail_mailboxes where address = candidate) loop
    n := n + 1;
    candidate := base || n || '@' || domain;
  end loop;
  insert into classroom.mail_mailboxes (school_id, user_id, address, display_name)
  values (target_school, me, candidate, coalesce(nullif(btrim(concat_ws(' ', prof.first_name, prof.surname)), ''), base))
  returning * into box;
  return box;
end;
$fn$;
revoke all on function classroom.mail_my_mailbox(uuid) from public, anon;
grant execute on function classroom.mail_my_mailbox(uuid) to authenticated;

-- Addresses to suggest while typing To / Cc / Bcc: the school's staff.
create or replace function classroom.mail_directory(target_school uuid)
returns table (address text, name text, job_title text, avatar_url text)
language sql stable security definer set search_path = classroom, public as $fn$
  select b.address, b.display_name, m.job_title, p.avatar_url
    from classroom.mail_mailboxes b
    join classroom.profiles p on p.id = b.user_id
    left join lateral (select job_title from classroom.school_members sm where sm.school_id = b.school_id and sm.user_id = b.user_id and sm.is_active limit 1) m on true
   where b.school_id = target_school and b.is_active
     and exists (select 1 from classroom.school_members me where me.school_id = target_school and me.user_id = (select auth.uid()) and me.is_active)
   order by b.display_name;
$fn$;
grant execute on function classroom.mail_directory(uuid) to authenticated;

-- 6. Sending ------------------------------------------------------------------------
create or replace function classroom.mail_snippet(html text)
returns text language sql immutable as $fn$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(html, ''), '<(style|script)[^>]*>.*?</\1>', ' ', 'gi'), '<[^>]+>', ' ', 'g'),
                                   '(&nbsp;|\s)+', ' ', 'g')), 200);
$fn$;

-- Sends one of the caller's drafts to everyone on it.
create or replace function classroom.mail_send(target_draft uuid)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare
  d classroom.mail_messages;
  box classroom.mail_mailboxes;
  r jsonb;
  addr text;
  rcpt classroom.mail_mailboxes;
  internal_count int := 0;
  external text[] := '{}';
  unknown text[] := '{}';
  attach_size bigint;
  total_size bigint;
  seen text[] := '{}';
  parent_thread uuid;
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
    addr := lower(btrim(r ->> 'address'));
    if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      unknown := unknown || coalesce(r ->> 'address', '(blank)');
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

  for r in select value from jsonb_array_elements(d.to_list || d.cc_list || d.bcc_list) loop
    addr := lower(btrim(r ->> 'address'));
    continue when addr = any (seen);
    seen := seen || addr;
    select * into rcpt from classroom.mail_mailboxes where address = addr and is_active;
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
      external := external || addr;
    end if;
  end loop;

  if array_length(external, 1) > 0 then
    insert into classroom.mail_outbound (message_id, recipient) select d.id, unnest(external);
    update classroom.mail_messages set folder = 'outbox', external_pending = array_length(external, 1) where id = d.id;
  end if;

  -- Tell the sender about anyone whose mailbox was full.
  if array_length(unknown, 1) > 0 then
    insert into classroom.mail_messages (mailbox_id, folder, from_address, from_name, to_list, subject, body_html, snippet, is_read, sent_at)
    values (box.id, 'inbox', 'postmaster@schoolivio.com', 'Schoolivio Mail',
            jsonb_build_array(jsonb_build_object('name', box.display_name, 'address', box.address)),
            'Not delivered: ' || d.subject,
            '<p>Your message <strong>' || replace(replace(d.subject, '<', '&lt;'), '>', '&gt;') || '</strong> could not be delivered to: '
              || array_to_string(unknown, ', ') || '. Their mailbox is full.</p>',
            'Their mailbox is full.', false, now());
  end if;

  return jsonb_build_object('delivered', internal_count, 'waiting', coalesce(array_length(external, 1), 0),
                            'refused', coalesce(array_length(unknown, 1), 0), 'thread_id', d.thread_id);
end;
$fn$;
revoke all on function classroom.mail_send(uuid) from public, anon;
grant execute on function classroom.mail_send(uuid) to authenticated;

-- 7. Quota, new-mail alerts, live updates -----------------------------------------------
create or replace function classroom.mail_usage()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if tg_op = 'INSERT' then
    update classroom.mail_mailboxes set used_bytes = used_bytes + new.size_bytes where id = new.mailbox_id;
  elsif tg_op = 'DELETE' then
    update classroom.mail_mailboxes set used_bytes = greatest(0, used_bytes - old.size_bytes) where id = old.mailbox_id;
  elsif new.size_bytes is distinct from old.size_bytes then
    update classroom.mail_mailboxes set used_bytes = greatest(0, used_bytes - old.size_bytes + new.size_bytes) where id = new.mailbox_id;
  end if;
  return null;
end;
$fn$;
drop trigger if exists mail_usage on classroom.mail_messages;
create trigger mail_usage after insert or delete or update of size_bytes on classroom.mail_messages
  for each row execute function classroom.mail_usage();

-- The owner's open Mail page and their unread count update live.
create or replace function classroom.rt_mail_messages()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare owner uuid;
begin
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
drop trigger if exists rt_mail_messages on classroom.mail_messages;
create trigger rt_mail_messages after insert or update or delete on classroom.mail_messages
  for each row execute function classroom.rt_mail_messages();

-- Unread mail per mailbox, for the menu dot.
create or replace function classroom.mail_unread(target_school uuid)
returns int language sql stable security definer set search_path = classroom, public as $fn$
  select count(*)::int from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
   where b.school_id = target_school and b.user_id = (select auth.uid()) and m.folder = 'inbox' and not m.is_read;
$fn$;
grant execute on function classroom.mail_unread(uuid) to authenticated;

-- 8. Unread mail on the menu's Mail item (module_attention, the menu dots).
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.module_attention(uuid)'::regprocedure);
  if position('''mail''' in d) = 0 then
    d := regexp_replace(d, 'return out;\s*end;\s*\$function\$\s*
,
      E'n := classroom.mail_unread(target_school);\n  if n > 0 then out := out || jsonb_build_object(''mail'', n); end if;\n\n  return out;\nend;\n$function$\n');
    execute d;
  end if;
end
$do$;

notify pgrst, 'reload schema';
