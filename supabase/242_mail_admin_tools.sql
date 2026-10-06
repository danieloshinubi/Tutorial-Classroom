-- Schoolivio Mail, step 6: the school admin's tools.
--
--   Shared mailboxes  admissions@, bursar@: one mailbox, no single owner,
--                     opened by the staff the admin chooses, each with
--                     full access (send as it), on behalf (sent "Ada on behalf
--                     of Admissions") or read only.
--   Group addresses   ss3teachers@: an address that hands each message to its
--                     members' own Inboxes; from outside only if allowed.
--   Other addresses   extra addresses that reach a person (kept with their
--                     earlier addresses, which already worked this way).
--   Rules             each person's own: when mail arrives from / about …,
--                     move it, mark it read, flag it, forward it, delete it.
--   Storage           a limit per person.
--   Suspend, convert, delete   suspend or resume a mailbox; turn a leaver's
--                     mailbox into a shared one; delete one that is suspended.

-- 1. Shared mailboxes ------------------------------------------------------------------------
alter table classroom.mail_mailboxes add column if not exists kind text not null default 'person';
alter table classroom.mail_mailboxes alter column user_id drop not null;
alter table classroom.mail_mailboxes drop constraint if exists mail_mailboxes_kind_check;
alter table classroom.mail_mailboxes add constraint mail_mailboxes_kind_check
  check (kind = 'person' and user_id is not null or kind = 'shared' and user_id is null);

create table if not exists classroom.mail_mailbox_members (
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  access text not null default 'full' check (access in ('full', 'on_behalf', 'read')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (mailbox_id, user_id)
);
create index if not exists mail_mailbox_members_user_idx on classroom.mail_mailbox_members (user_id);
alter table classroom.mail_mailbox_members enable row level security;
drop policy if exists "members and admins see membership" on classroom.mail_mailbox_members;
create policy "members and admins see membership" on classroom.mail_mailbox_members for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from classroom.mail_mailboxes b where b.id = mailbox_id and classroom.is_school_admin(b.school_id)));
grant select on classroom.mail_mailbox_members to authenticated;

-- How someone may use a mailbox: own, full, on_behalf, read, or not at all.
create or replace function classroom.mail_access(target_mailbox uuid, who uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select case when exists (select 1 from classroom.mail_mailboxes where id = target_mailbox and user_id = who) then 'own'
              else (select access from classroom.mail_mailbox_members where mailbox_id = target_mailbox and user_id = who) end;
$fn$;
revoke all on function classroom.mail_access(uuid, uuid) from public, anon;
grant execute on function classroom.mail_access(uuid, uuid) to authenticated, service_role;

-- "Mine": my own mailbox, or a shared one I am a member of. Every policy
-- (messages, attachments, files, drafts) follows from this.
create or replace function classroom.owns_mailbox(target_mailbox uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_mailboxes where id = target_mailbox and user_id = (select auth.uid()))
      or exists (select 1 from classroom.mail_mailbox_members where mailbox_id = target_mailbox and user_id = (select auth.uid()));
$fn$;

create or replace function classroom.can_see_envelope(target_envelope uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_messages m where m.envelope_id = target_envelope and classroom.owns_mailbox(m.mailbox_id));
$fn$;

drop policy if exists "people read their own mailbox" on classroom.mail_mailboxes;
create policy "people read their own mailbox" on classroom.mail_mailboxes
  for select to authenticated using (classroom.owns_mailbox(id) or classroom.is_school_admin(school_id));
drop policy if exists "people update their own mailbox" on classroom.mail_mailboxes;
create policy "people update their own mailbox" on classroom.mail_mailboxes
  for update to authenticated
  using (classroom.mail_access(id, (select auth.uid())) in ('own', 'full'))
  with check (classroom.mail_access(id, (select auth.uid())) in ('own', 'full'));

-- Read-only members file and read; they do not write.
drop policy if exists "owners write drafts" on classroom.mail_messages;
create policy "owners write drafts" on classroom.mail_messages
  for insert to authenticated with check (classroom.mail_access(mailbox_id, (select auth.uid())) in ('own', 'full', 'on_behalf') and folder = 'drafts');

create or replace function classroom.mail_can_import(target_mailbox uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.mail_access(target_mailbox, (select auth.uid())) in ('own', 'full')
      or exists (select 1 from classroom.mail_mailboxes b where b.id = target_mailbox and classroom.is_school_admin(b.school_id));
$fn$;

-- The mailboxes I can open at a school: my own first, then shared ones.
create or replace function classroom.mail_my_mailboxes(target_school uuid)
returns table (id uuid, kind text, address text, display_name text, access text, unread int, is_active boolean)
language plpgsql security definer set search_path = classroom, public as $fn$
begin
  perform classroom.mail_my_mailbox(target_school);
  return query
    select b.id, b.kind, b.address, b.display_name,
           classroom.mail_access(b.id, (select auth.uid())),
           (select count(*)::int from classroom.mail_messages m where m.mailbox_id = b.id and m.folder = 'inbox' and not m.is_read),
           b.is_active
      from classroom.mail_mailboxes b
     where b.school_id = target_school and classroom.owns_mailbox(b.id)
     order by (b.kind = 'person') desc, b.display_name;
end;
$fn$;
revoke all on function classroom.mail_my_mailboxes(uuid) from public, anon;
grant execute on function classroom.mail_my_mailboxes(uuid) to authenticated;

-- Unread on the menu counts shared mailboxes too.
create or replace function classroom.mail_unread(target_school uuid)
returns int language sql stable security definer set search_path = classroom, public as $fn$
  select count(*)::int from classroom.mail_messages m join classroom.mail_mailboxes b on b.id = m.mailbox_id
   where b.school_id = target_school and classroom.owns_mailbox(b.id) and m.folder = 'inbox' and not m.is_read;
$fn$;

-- Live updates reach every member of a shared mailbox.
create or replace function classroom.rt_mail_messages()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare who uuid; box uuid := coalesce(new.mailbox_id, old.mailbox_id);
begin
  if tg_op = 'INSERT' and new.inbound_id like 'imp:%' then return null; end if;
  for who in select user_id from classroom.mail_mailboxes where id = box and user_id is not null
             union select user_id from classroom.mail_mailbox_members where mailbox_id = box loop
    perform classroom.rt_send('user:' || who, 'change',
      classroom.rt_body(tg_op, tg_table_name,
        case when new is null then null else jsonb_build_object('id', new.id, 'mailbox_id', new.mailbox_id, 'folder', new.folder, 'is_read', new.is_read, 'thread_id', new.thread_id) end,
        case when old is null then null else jsonb_build_object('id', old.id, 'mailbox_id', old.mailbox_id, 'folder', old.folder) end));
  end loop;
  return null;
end;
$fn$;

-- "Opened" notifications for mail sent from a shared mailbox go to its members.
create or replace function classroom.mail_record_open(sender_copy uuid, recipient_in text, via_in text)
returns boolean language plpgsql security definer set search_path = classroom, public as $fn$
declare
  m classroom.mail_messages;
  box classroom.mail_mailboxes;
  first boolean;
  open_id uuid;
  who text := btrim(recipient_in);
  u uuid;
begin
  select * into m from classroom.mail_messages where id = sender_copy;
  if not found or not m.track_opens then return false; end if;
  select * into box from classroom.mail_mailboxes where id = m.mailbox_id;
  insert into classroom.mail_opens (message_id, recipient, via) values (m.id, who, via_in)
  on conflict (message_id, recipient) do update set last_at = now(), times = classroom.mail_opens.times + 1
  returning id, (xmax = 0) into open_id, first;
  if first then
    for u in select box.user_id where box.user_id is not null
             union select user_id from classroom.mail_mailbox_members where mailbox_id = box.id and access <> 'read' loop
      insert into classroom.notifications (user_id, school_id, kind, title, body, link, ref_id)
      values (u, box.school_id, 'mail_opened',
              who || ' opened ' || case when box.kind = 'shared' then box.display_name || '''s email' else 'your email' end,
              coalesce(nullif(m.subject, ''), '(no subject)'),
              '/Mail?thread=' || m.thread_id || '&folder=sent&box=' || box.id, open_id)
      on conflict do nothing;
    end loop;
  end if;
  return first;
end;
$fn$;
revoke all on function classroom.mail_record_open(uuid, text, text) from public, anon, authenticated;

-- 2. Group addresses (distribution lists) -------------------------------------------------------
create table if not exists classroom.mail_lists (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  address text not null unique check (address = lower(address) and address ~ '^[a-z0-9._-]+@[a-z0-9.-]+$'),
  allow_outside boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists classroom.mail_list_members (
  list_id uuid not null references classroom.mail_lists (id) on delete cascade,
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  primary key (list_id, mailbox_id)
);
alter table classroom.mail_lists enable row level security;
alter table classroom.mail_list_members enable row level security;
drop policy if exists "admins see lists" on classroom.mail_lists;
create policy "admins see lists" on classroom.mail_lists for select to authenticated using (classroom.is_school_admin(school_id));
drop policy if exists "admins see list members" on classroom.mail_list_members;
create policy "admins see list members" on classroom.mail_list_members for select to authenticated
  using (exists (select 1 from classroom.mail_lists l where l.id = list_id and classroom.is_school_admin(l.school_id)));
grant select on classroom.mail_lists, classroom.mail_list_members to authenticated;

-- Suggestions include shared mailboxes (no person behind them) and group addresses.
create or replace function classroom.mail_directory(target_school uuid)
returns table (address text, name text, job_title text, avatar_url text)
language sql stable security definer set search_path = classroom, public as $fn$
  select b.address, b.display_name, case when b.kind = 'shared' then 'Shared mailbox' else m.job_title end, p.avatar_url
    from classroom.mail_mailboxes b
    left join classroom.profiles p on p.id = b.user_id
    left join lateral (select job_title from classroom.school_members sm where sm.school_id = b.school_id and sm.user_id = b.user_id and sm.is_active limit 1) m on true
   where b.school_id = target_school and b.is_active
     and exists (select 1 from classroom.school_members me where me.school_id = target_school and me.user_id = (select auth.uid()) and me.is_active)
  union all
  select l.address, l.name, 'Group address', null from classroom.mail_lists l
   where l.school_id = target_school
     and exists (select 1 from classroom.school_members me where me.school_id = target_school and me.user_id = (select auth.uid()) and me.is_active)
   order by 2;
$fn$;

-- Is an address already somebody's (a mailbox, an earlier or other address, a group)?
create or replace function classroom.mail_address_taken(addr text, except_mailbox uuid default null, except_list uuid default null)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.mail_mailboxes b
                  where (b.address = lower(addr) or lower(addr) = any (b.previous_addresses)) and b.id is distinct from except_mailbox)
      or exists (select 1 from classroom.mail_lists l where l.address = lower(addr) and l.id is distinct from except_list);
$fn$;
revoke all on function classroom.mail_address_taken(text, uuid, uuid) from public, anon, authenticated;

-- An address on the school's own domain or its schoolivio.com one, written properly.
create or replace function classroom.mail_check_address(target_school uuid, addr text)
returns text language plpgsql stable security definer set search_path = classroom, public as $fn$
declare
  a text := lower(btrim(addr));
  own text;
  fallback text;
begin
  select domain into own from classroom.mail_settings where school_id = target_school;
  select slug || '.schoolivio.com' into fallback from classroom.schools where id = target_school;
  if a !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?@[a-z0-9.-]+$' then
    raise exception 'Use letters, numbers, dots, dashes or underscores before the @.';
  end if;
  if split_part(a, '@', 2) not in (coalesce(own, ''), fallback) then
    raise exception 'The address must end in @%.', coalesce(own, fallback);
  end if;
  return a;
end;
$fn$;
revoke all on function classroom.mail_check_address(uuid, text) from public, anon, authenticated;

-- New mailboxes' addresses avoid group addresses too.
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
            coalesce(nullif(concat_ws('.', nullif(split_part(btrim(prof.first_name), ' ', 1), ''), nullif(regexp_replace(btrim(prof.surname), '^.* ', ''), '')), ''),
                     nullif(prof.username, ''), split_part(prof.email, '@', 1), 'staff'),
            '[^a-zA-Z0-9.]+', '', 'g'));
  base := btrim(base, '.');
  if base = '' then base := 'staff'; end if;
  candidate := base || '@' || domain;
  while classroom.mail_address_taken(candidate) loop
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

-- 3. The admin's controls on a mailbox --------------------------------------------------------------
create or replace function classroom.mail_admin_box(target_mailbox uuid)
returns classroom.mail_mailboxes language plpgsql stable security definer set search_path = classroom, public as $fn$
declare box classroom.mail_mailboxes;
begin
  select * into box from classroom.mail_mailboxes where id = target_mailbox;
  if not found then raise exception 'That mailbox no longer exists.'; end if;
  if not classroom.is_school_admin(box.school_id) then raise exception 'Only a school admin can do that.'; end if;
  return box;
end;
$fn$;
revoke all on function classroom.mail_admin_box(uuid) from public, anon;
grant execute on function classroom.mail_admin_box(uuid) to authenticated;

create or replace function classroom.mail_admin_set_address(target_mailbox uuid, new_address text)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes := classroom.mail_admin_box(target_mailbox);
  addr text := classroom.mail_check_address(box.school_id, new_address);
begin
  if classroom.mail_address_taken(addr, box.id) and not (addr = any (box.previous_addresses)) then
    raise exception '% is already in use.', addr;
  end if;
  update classroom.mail_mailboxes
     set previous_addresses = case when address = addr then previous_addresses else array_append(array_remove(previous_addresses, addr), address) end,
         address = addr, updated_at = now()
   where id = box.id returning * into box;
  return box;
end;
$fn$;
grant execute on function classroom.mail_admin_set_address(uuid, text) to authenticated;

-- Other addresses that reach this mailbox (kept with its earlier ones).
create or replace function classroom.mail_admin_set_aliases(target_mailbox uuid, aliases text[])
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes := classroom.mail_admin_box(target_mailbox);
  a text;
  clean text[] := '{}';
begin
  foreach a in array coalesce(aliases, '{}') loop
    continue when btrim(coalesce(a, '')) = '';
    a := classroom.mail_check_address(box.school_id, a);
    if a = box.address then continue; end if;
    if classroom.mail_address_taken(a, box.id) then raise exception '% is already in use.', a; end if;
    if not (a = any (clean)) then clean := clean || a; end if;
  end loop;
  if cardinality(clean) > 20 then raise exception 'At most 20 other addresses per mailbox.'; end if;
  update classroom.mail_mailboxes set previous_addresses = clean, updated_at = now() where id = box.id returning * into box;
  return box;
end;
$fn$;
revoke all on function classroom.mail_admin_set_aliases(uuid, text[]) from public, anon;
grant execute on function classroom.mail_admin_set_aliases(uuid, text[]) to authenticated;

create or replace function classroom.mail_admin_set_quota(target_mailbox uuid, gigabytes int)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare box classroom.mail_mailboxes := classroom.mail_admin_box(target_mailbox);
begin
  if gigabytes not in (1, 2, 5, 10, 25, 50) then raise exception 'Pick 1, 2, 5, 10, 25 or 50 GB.'; end if;
  update classroom.mail_mailboxes set quota_bytes = gigabytes::bigint * 1073741824, updated_at = now() where id = box.id returning * into box;
  return box;
end;
$fn$;
revoke all on function classroom.mail_admin_set_quota(uuid, int) from public, anon;
grant execute on function classroom.mail_admin_set_quota(uuid, int) to authenticated;

-- Suspended: nothing in or out, and it cannot be opened; mail to it is
-- refused like an unknown address. Resuming puts everything back.
create or replace function classroom.mail_admin_set_active(target_mailbox uuid, active boolean)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare box classroom.mail_mailboxes := classroom.mail_admin_box(target_mailbox);
begin
  update classroom.mail_mailboxes set is_active = active, updated_at = now() where id = box.id returning * into box;
  return box;
end;
$fn$;
revoke all on function classroom.mail_admin_set_active(uuid, boolean) from public, anon;
grant execute on function classroom.mail_admin_set_active(uuid, boolean) to authenticated;

-- A leaver's mailbox becomes a shared one the chosen staff can open.
create or replace function classroom.mail_admin_convert_to_shared(target_mailbox uuid, members jsonb)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare box classroom.mail_mailboxes := classroom.mail_admin_box(target_mailbox);
begin
  if box.kind = 'shared' then raise exception 'It is already a shared mailbox.'; end if;
  update classroom.mail_mailboxes set kind = 'shared', user_id = null, is_active = true, updated_at = now() where id = box.id returning * into box;
  perform classroom.mail_admin_set_members(box.id, members);
  return box;
end;
$fn$;
revoke all on function classroom.mail_admin_convert_to_shared(uuid, jsonb) from public, anon;
grant execute on function classroom.mail_admin_convert_to_shared(uuid, jsonb) to authenticated;

-- Who can open a shared mailbox, and how: [{ "user_id": "…", "access": "full" }].
create or replace function classroom.mail_admin_set_members(target_mailbox uuid, members jsonb)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes := classroom.mail_admin_box(target_mailbox);
  m jsonb;
begin
  if box.kind <> 'shared' then raise exception 'Only a shared mailbox has members.'; end if;
  delete from classroom.mail_mailbox_members where mailbox_id = box.id
     and user_id not in (select (x ->> 'user_id')::uuid from jsonb_array_elements(coalesce(members, '[]'::jsonb)) x);
  for m in select value from jsonb_array_elements(coalesce(members, '[]'::jsonb)) loop
    if not exists (select 1 from classroom.school_members s where s.school_id = box.school_id and s.user_id = (m ->> 'user_id')::uuid and s.is_active
                    and s.role not in ('student', 'parent')) then
      raise exception 'Only the school''s staff can open a shared mailbox.';
    end if;
    insert into classroom.mail_mailbox_members (mailbox_id, user_id, access, added_by)
    values (box.id, (m ->> 'user_id')::uuid, coalesce(nullif(m ->> 'access', ''), 'full'), (select auth.uid()))
    on conflict (mailbox_id, user_id) do update set access = excluded.access;
  end loop;
end;
$fn$;
revoke all on function classroom.mail_admin_set_members(uuid, jsonb) from public, anon;
grant execute on function classroom.mail_admin_set_members(uuid, jsonb) to authenticated;

-- A new shared mailbox, or its name and address changed.
create or replace function classroom.mail_admin_save_shared(target_school uuid, target_mailbox uuid, name_in text, address_in text, members jsonb)
returns classroom.mail_mailboxes language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  addr text;
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can do that.'; end if;
  if btrim(coalesce(name_in, '')) = '' then raise exception 'Give the mailbox a name, like Admissions.'; end if;
  addr := classroom.mail_check_address(target_school, address_in);
  if target_mailbox is null then
    if classroom.mail_address_taken(addr) then raise exception '% is already in use.', addr; end if;
    insert into classroom.mail_mailboxes (school_id, user_id, kind, address, display_name)
    values (target_school, null, 'shared', addr, btrim(name_in)) returning * into box;
  else
    box := classroom.mail_admin_box(target_mailbox);
    if box.kind <> 'shared' then raise exception 'That is not a shared mailbox.'; end if;
    if addr <> box.address then box := classroom.mail_admin_set_address(box.id, addr); end if;
    update classroom.mail_mailboxes set display_name = btrim(name_in), updated_at = now() where id = box.id returning * into box;
  end if;
  perform classroom.mail_admin_set_members(box.id, members);
  return box;
end;
$fn$;
revoke all on function classroom.mail_admin_save_shared(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function classroom.mail_admin_save_shared(uuid, uuid, text, text, jsonb) to authenticated;

create or replace function classroom.mail_admin_shared(target_school uuid)
returns table (id uuid, name text, address text, aliases text[], is_active boolean, used_bytes bigint, quota_bytes bigint, members jsonb)
language plpgsql stable security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can see this.'; end if;
  return query
    select b.id, b.display_name, b.address, b.previous_addresses, b.is_active, b.used_bytes, b.quota_bytes,
           coalesce((select jsonb_agg(jsonb_build_object('user_id', mm.user_id, 'access', mm.access,
                       'name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username, p.email)) order by p.first_name)
                     from classroom.mail_mailbox_members mm join classroom.profiles p on p.id = mm.user_id where mm.mailbox_id = b.id), '[]'::jsonb)
      from classroom.mail_mailboxes b where b.school_id = target_school and b.kind = 'shared' order by b.display_name;
end;
$fn$;
revoke all on function classroom.mail_admin_shared(uuid) from public, anon;
grant execute on function classroom.mail_admin_shared(uuid) to authenticated;

-- The staff list now says who is suspended and their other addresses.
drop function if exists classroom.mail_admin_people(uuid);
create or replace function classroom.mail_admin_people(target_school uuid)
returns table (user_id uuid, name text, job_title text, role text, mailbox_id uuid, address text, used_bytes bigint, quota_bytes bigint,
               is_active boolean, aliases text[])
language plpgsql stable security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can manage mail addresses.'; end if;
  return query
    select distinct on (m.user_id) m.user_id,
           coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username, p.email)::text,
           m.job_title::text, m.role::text, b.id, b.address, b.used_bytes, b.quota_bytes, b.is_active, b.previous_addresses
      from classroom.school_members m
      join classroom.profiles p on p.id = m.user_id
      left join classroom.mail_mailboxes b on b.school_id = m.school_id and b.user_id = m.user_id
     where m.school_id = target_school and m.is_active and m.granted_via is null and m.role not in ('student', 'parent')
     order by m.user_id;
end;
$fn$;
revoke all on function classroom.mail_admin_people(uuid) from public, anon;
grant execute on function classroom.mail_admin_people(uuid) to authenticated;

-- Deleting a suspended mailbox for good (service role, from mail-settings,
-- which checks the caller is a school admin and that they typed the address).
-- Files of mail other people still hold move to one of them, so nobody else
-- loses an attachment; the rest are returned for mail-settings to remove.
create or replace function classroom.mail_delete_mailbox(target_mailbox uuid)
returns text[] language plpgsql security definer set search_path = classroom, public as $fn$
declare
  box classroom.mail_mailboxes;
  orphans text[];
begin
  select * into box from classroom.mail_mailboxes where id = target_mailbox for update;
  if not found then return '{}'; end if;
  if box.is_active then raise exception 'Suspend the mailbox before deleting it.'; end if;
  update classroom.mail_attachments a
     set mailbox_id = (select m.mailbox_id from classroom.mail_messages m where m.envelope_id = a.envelope_id and m.mailbox_id <> box.id limit 1)
   where a.mailbox_id = box.id
     and exists (select 1 from classroom.mail_messages m where m.envelope_id = a.envelope_id and m.mailbox_id <> box.id);
  select coalesce(array_agg(file_path), '{}') into orphans from classroom.mail_attachments where mailbox_id = box.id;
  delete from classroom.mail_mailboxes where id = box.id;
  return orphans;
end;
$fn$;
revoke all on function classroom.mail_delete_mailbox(uuid) from public, anon, authenticated;
grant execute on function classroom.mail_delete_mailbox(uuid) to service_role;

-- 4. Group addresses: the admin's side --------------------------------------------------------
create or replace function classroom.mail_admin_save_list(target_school uuid, target_list uuid, name_in text, address_in text,
                                                         allow_outside_in boolean, member_mailboxes uuid[])
returns uuid language plpgsql security definer set search_path = classroom, public as $fn$
declare
  lid uuid := target_list;
  addr text;
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can do that.'; end if;
  if btrim(coalesce(name_in, '')) = '' then raise exception 'Give the group a name, like SS3 teachers.'; end if;
  addr := classroom.mail_check_address(target_school, address_in);
  if classroom.mail_address_taken(addr, null, lid) then raise exception '% is already in use.', addr; end if;
  if coalesce(cardinality(member_mailboxes), 0) = 0 then raise exception 'Add at least one member.'; end if;
  if exists (select 1 from unnest(member_mailboxes) x where not exists (select 1 from classroom.mail_mailboxes b where b.id = x and b.school_id = target_school)) then
    raise exception 'Members must have mailboxes at this school.';
  end if;
  if lid is null then
    insert into classroom.mail_lists (school_id, name, address, allow_outside, created_by)
    values (target_school, btrim(name_in), addr, coalesce(allow_outside_in, false), (select auth.uid())) returning id into lid;
  else
    update classroom.mail_lists set name = btrim(name_in), address = addr, allow_outside = coalesce(allow_outside_in, false), updated_at = now()
     where id = lid and school_id = target_school;
    if not found then raise exception 'That group no longer exists.'; end if;
  end if;
  delete from classroom.mail_list_members where list_id = lid and not (mailbox_id = any (member_mailboxes));
  insert into classroom.mail_list_members (list_id, mailbox_id) select lid, x from unnest(member_mailboxes) x on conflict do nothing;
  return lid;
end;
$fn$;
revoke all on function classroom.mail_admin_save_list(uuid, uuid, text, text, boolean, uuid[]) from public, anon;
grant execute on function classroom.mail_admin_save_list(uuid, uuid, text, text, boolean, uuid[]) to authenticated;

create or replace function classroom.mail_admin_delete_list(target_list uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if not exists (select 1 from classroom.mail_lists l where l.id = target_list and classroom.is_school_admin(l.school_id)) then
    raise exception 'Only a school admin can do that.';
  end if;
  delete from classroom.mail_lists where id = target_list;
end;
$fn$;
revoke all on function classroom.mail_admin_delete_list(uuid) from public, anon;
grant execute on function classroom.mail_admin_delete_list(uuid) to authenticated;

create or replace function classroom.mail_admin_lists(target_school uuid)
returns table (id uuid, name text, address text, allow_outside boolean, members jsonb)
language plpgsql stable security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only a school admin can see this.'; end if;
  return query
    select l.id, l.name, l.address, l.allow_outside,
           coalesce((select jsonb_agg(jsonb_build_object('mailbox_id', b.id, 'name', b.display_name, 'address', b.address) order by b.display_name)
                     from classroom.mail_list_members lm join classroom.mail_mailboxes b on b.id = lm.mailbox_id where lm.list_id = l.id), '[]'::jsonb)
      from classroom.mail_lists l where l.school_id = target_school order by l.name;
end;
$fn$;
revoke all on function classroom.mail_admin_lists(uuid) from public, anon;
grant execute on function classroom.mail_admin_lists(uuid) to authenticated;

-- "All staff" means people, not shared mailboxes.
create or replace function classroom.mail_group_members(sender_box uuid, token text)
returns table (name text, address text)
language sql stable security definer set search_path = classroom, public as $fn$
  select b.display_name, b.address from classroom.mail_mailboxes b
   where token = 'group:all' and b.kind = 'person' and b.school_id = (select school_id from classroom.mail_mailboxes where id = sender_box) and b.is_active and b.id <> sender_box
  union
  select b.display_name, b.address from classroom.mail_mailboxes b
    join classroom.school_members m on m.school_id = b.school_id and m.user_id = b.user_id and m.is_active
   where token like 'group:role:%' and m.role::text = substr(token, 12)
     and b.school_id = (select school_id from classroom.mail_mailboxes where id = sender_box) and b.is_active and b.id <> sender_box
  union
  select coalesce(x ->> 'name', ''), lower(x ->> 'address')
    from classroom.mail_contact_groups g, jsonb_array_elements(g.members) x
   where token like 'group:mine:%' and g.id = classroom.try_uuid(substr(token, 12)) and g.mailbox_id = sender_box;
$fn$;
revoke all on function classroom.mail_group_members(uuid, text) from public, anon, authenticated;

-- Mail from outside: a group address reaches each member (if it takes
-- outside mail); a suspended mailbox is refused like an unknown one.
create or replace function classroom.mail_inbound_targets(target_school uuid, addresses text[], size_in bigint)
returns table (address text, mailbox_id uuid, outcome text)
language sql stable security definer set search_path = classroom, public as $fn$
  with wanted as (select distinct lower(btrim(a)) as address from unnest(addresses) a where btrim(coalesce(a, '')) <> ''),
  own as (select domain from classroom.mail_settings where school_id = target_school),
  direct as (
    select w.address,
           (select b.id from classroom.mail_mailboxes b
             where b.school_id = target_school and b.is_active
               and (b.address = w.address or w.address = any (b.previous_addresses)
                    or (split_part(w.address, '@', 2) like '%.resend.app' and split_part(b.address, '@', 1) = split_part(w.address, '@', 1)))
             order by (b.address = w.address) desc limit 1) as mailbox_id
      from wanted w
     where not exists (select 1 from classroom.mail_lists l where l.school_id = target_school and l.address = w.address)
       and (split_part(w.address, '@', 2) = (select domain from own)
            or split_part(w.address, '@', 2) like '%.resend.app'
            or exists (select 1 from classroom.mail_mailboxes b where b.school_id = target_school
                        and (b.address = w.address or w.address = any (b.previous_addresses))))
  ),
  listed as (
    select w.address, b.id as mailbox_id, l.allow_outside
      from wanted w join classroom.mail_lists l on l.school_id = target_school and l.address = w.address
      left join classroom.mail_list_members lm on lm.list_id = l.id
      left join classroom.mail_mailboxes b on b.id = lm.mailbox_id and b.is_active
  )
  select d.address, d.mailbox_id,
         case when d.mailbox_id is null then 'unknown'
              when (select used_bytes + size_in > quota_bytes from classroom.mail_mailboxes where id = d.mailbox_id) then 'full'
              else 'ok' end
    from direct d
  union all
  select l.address, case when l.allow_outside then l.mailbox_id end,
         case when not l.allow_outside then 'closed'
              when l.mailbox_id is null then 'unknown'
              when (select used_bytes + size_in > quota_bytes from classroom.mail_mailboxes where id = l.mailbox_id) then 'full'
              else 'ok' end
    from listed l;
$fn$;
revoke all on function classroom.mail_inbound_targets(uuid, text[], bigint) from public, anon, authenticated;
grant execute on function classroom.mail_inbound_targets(uuid, text[], bigint) to service_role;

-- 5. Sending from a shared mailbox, and to group addresses -----------------------------------
-- (Replaces 241's.) actor is the person sending, or null for the system
-- itself (a rule forwarding a message).
create or replace function classroom.mail_send_as(target_draft uuid, actor uuid)
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
  wanted jsonb := '[]'::jsonb;
  g record;
  n_people int;
  perm text;
  shown_name text;
begin
  select * into d from classroom.mail_messages where id = target_draft for update;
  if not found then raise exception 'That draft no longer exists.'; end if;
  select * into box from classroom.mail_mailboxes where id = d.mailbox_id;
  if actor is not null then
    perm := classroom.mail_access(box.id, actor);
    if perm is null then raise exception 'That is not your draft.'; end if;
    if perm = 'read' then raise exception 'You can read % but not send from it.', box.display_name; end if;
  end if;
  if d.folder <> 'drafts' then raise exception 'That message has already been sent.'; end if;
  if not box.is_active then raise exception 'This mailbox is switched off.'; end if;
  -- "On behalf of": the person and the mailbox both show.
  shown_name := box.display_name;
  if perm = 'on_behalf' then
    select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username, 'Someone') || ' on behalf of ' || box.display_name
      into shown_name from classroom.profiles p where p.id = actor;
  end if;

  -- Personal groups become their people; school groups stay as their name.
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into d.to_list from (
    select x as e, o from jsonb_array_elements(d.to_list) with ordinality t(x, o) where x ->> 'address' not like 'group:mine:%'
    union all select jsonb_build_object('name', gm.name, 'address', gm.address), 100000 + o
      from jsonb_array_elements(d.to_list) with ordinality t(x, o), classroom.mail_group_members(box.id, x ->> 'address') gm
     where x ->> 'address' like 'group:mine:%') q;
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into d.cc_list from (
    select x as e, o from jsonb_array_elements(d.cc_list) with ordinality t(x, o) where x ->> 'address' not like 'group:mine:%'
    union all select jsonb_build_object('name', gm.name, 'address', gm.address), 100000 + o
      from jsonb_array_elements(d.cc_list) with ordinality t(x, o), classroom.mail_group_members(box.id, x ->> 'address') gm
     where x ->> 'address' like 'group:mine:%') q;
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into d.bcc_list from (
    select x as e, o from jsonb_array_elements(d.bcc_list) with ordinality t(x, o) where x ->> 'address' not like 'group:mine:%'
    union all select jsonb_build_object('name', gm.name, 'address', gm.address), 100000 + o
      from jsonb_array_elements(d.bcc_list) with ordinality t(x, o), classroom.mail_group_members(box.id, x ->> 'address') gm
     where x ->> 'address' like 'group:mine:%') q;

  -- Everyone it goes to: school groups and group addresses opened up.
  for r in
    select x.value, x.kind from (
      select value, 'to' as kind, 1 as part, ord from jsonb_array_elements(d.to_list) with ordinality as t(value, ord)
      union all select value, 'cc', 2, ord from jsonb_array_elements(d.cc_list) with ordinality as t(value, ord)
      union all select value, 'bcc', 3, ord from jsonb_array_elements(d.bcc_list) with ordinality as t(value, ord)) x
    order by x.part, x.ord
  loop
    addr := lower(btrim(r.value ->> 'address'));
    if addr like 'group:%' then
      n_people := 0;
      for g in select * from classroom.mail_group_members(box.id, addr) loop
        wanted := wanted || jsonb_build_object('address', g.address, 'kind', r.kind);
        n_people := n_people + 1;
      end loop;
      if n_people = 0 then raise exception 'The group % has nobody in it.', coalesce(r.value ->> 'name', addr); end if;
    elsif exists (select 1 from classroom.mail_lists l where l.address = addr and l.school_id = box.school_id) then
      n_people := 0;
      for g in select b.address from classroom.mail_lists l join classroom.mail_list_members lm on lm.list_id = l.id
                 join classroom.mail_mailboxes b on b.id = lm.mailbox_id and b.is_active
                where l.address = addr and l.school_id = box.school_id loop
        wanted := wanted || jsonb_build_object('address', g.address, 'kind', r.kind);
        n_people := n_people + 1;
      end loop;
      if n_people = 0 then raise exception 'The group address % has nobody in it.', addr; end if;
    else
      wanted := wanted || jsonb_build_object('address', r.value ->> 'address', 'kind', r.kind);
    end if;
  end loop;

  if jsonb_array_length(wanted) = 0 then raise exception 'Add at least one recipient.'; end if;
  if jsonb_array_length(wanted) > 1000 then raise exception 'A message can go to at most 1,000 people.'; end if;

  select coalesce(sum(size_bytes), 0) into attach_size from classroom.mail_attachments where envelope_id = d.envelope_id;
  total_size := octet_length(d.body_html) + octet_length(d.subject) + attach_size;

  if d.in_reply_to is not null then
    select thread_id into parent_thread from classroom.mail_messages where mailbox_id = box.id and message_id = d.in_reply_to limit 1;
    if parent_thread is not null then d.thread_id := parent_thread; end if;
  end if;

  for r in select value from jsonb_array_elements(wanted) loop
    addr := lower(btrim(r.value ->> 'address'));
    if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then unknown := unknown || coalesce(r.value ->> 'address', '(blank)'); end if;
  end loop;
  if array_length(unknown, 1) > 0 then
    raise exception 'These addresses are not valid: %', array_to_string(unknown, ', ');
  end if;

  update classroom.mail_messages
     set folder = 'sent', sent_at = now(), is_read = true, from_address = box.address, from_name = shown_name,
         snippet = classroom.mail_snippet(body_html), size_bytes = total_size, thread_id = d.thread_id,
         has_attachments = attach_size > 0, scheduled_at = null,
         to_list = d.to_list, cc_list = d.cc_list, bcc_list = d.bcc_list
   where id = d.id;

  for r in select value from jsonb_array_elements(wanted) loop
    addr := lower(btrim(r.value ->> 'address'));
    continue when addr = any (seen);
    seen := seen || addr;
    select * into rcpt from classroom.mail_mailboxes where (address = addr or addr = any (previous_addresses)) and is_active limit 1;
    if found then
      if rcpt.used_bytes + total_size > rcpt.quota_bytes then
        unknown := unknown || addr;
        continue;
      end if;
      insert into classroom.mail_messages (mailbox_id, envelope_id, thread_id, message_id, in_reply_to, folder,
          from_address, from_name, to_list, cc_list, bcc_list, subject, body_html, snippet, importance,
          has_attachments, size_bytes, is_read, sent_at, is_auto)
      values (rcpt.id, d.envelope_id, d.thread_id, d.message_id, d.in_reply_to, 'inbox',
          box.address, shown_name, d.to_list, d.cc_list, '[]'::jsonb, d.subject, d.body_html,
          classroom.mail_snippet(d.body_html), d.importance, attach_size > 0, total_size,
          rcpt.id = box.id, now(), d.is_auto);
      internal_count := internal_count + 1;
      if not d.is_auto and rcpt.id <> box.id then
        perform classroom.mail_autoreply(rcpt.id, box.address, shown_name, d.subject, d.message_id, null, false);
      end if;
    else
      insert into classroom.mail_outbound (message_id, recipient, kind, open_token)
      values (d.id, addr, r.value ->> 'kind', case when d.track_opens then gen_random_uuid() end);
      external_count := external_count + 1;
    end if;
  end loop;

  select coalesce(s.sending_enabled, false) into sending_on from classroom.mail_settings s where s.school_id = box.school_id;
  sending_on := coalesce(sending_on, false);
  if external_count > 0 then
    update classroom.mail_messages set folder = 'outbox', external_pending = external_count where id = d.id;
    if sending_on then perform classroom.mail_kick(d.id); end if;
  end if;

  if array_length(unknown, 1) > 0 then
    perform classroom.mail_notice(box.id, 'Not delivered: ' || d.subject,
      '<p>Your message <strong>' || replace(replace(d.subject, '<', '&lt;'), '>', '&gt;') || '</strong> could not be delivered to: '
        || array_to_string(unknown, ', ') || '. Their mailbox is full.</p>');
  end if;

  return jsonb_build_object('delivered', internal_count, 'waiting', external_count, 'sending_on', sending_on,
                            'refused', coalesce(array_length(unknown, 1), 0), 'thread_id', d.thread_id);
end;
$fn$;
revoke all on function classroom.mail_send_as(uuid, uuid) from public, anon, authenticated;

-- A draft started in one mailbox, sent from another ("From" in Compose).
create or replace function classroom.mail_move_draft(target_draft uuid, target_mailbox uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare d classroom.mail_messages;
begin
  select * into d from classroom.mail_messages where id = target_draft for update;
  if not found or d.folder <> 'drafts' or classroom.mail_access(d.mailbox_id, (select auth.uid())) not in ('own', 'full', 'on_behalf') then
    raise exception 'That draft is not yours.';
  end if;
  if coalesce(classroom.mail_access(target_mailbox, (select auth.uid())), 'read') not in ('own', 'full', 'on_behalf') then
    raise exception 'You cannot send from that mailbox.';
  end if;
  update classroom.mail_attachments set mailbox_id = target_mailbox where envelope_id = d.envelope_id and mailbox_id = d.mailbox_id;
  update classroom.mail_messages set mailbox_id = target_mailbox where id = d.id;
end;
$fn$;
revoke all on function classroom.mail_move_draft(uuid, uuid) from public, anon;
grant execute on function classroom.mail_move_draft(uuid, uuid) to authenticated;

-- Read-only members cannot schedule mail either.
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
  update classroom.mail_messages set scheduled_at = at_in where id = d.id;
end;
$fn$;

-- 6. Rules ------------------------------------------------------------------------------------
create table if not exists classroom.mail_rules (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references classroom.mail_mailboxes (id) on delete cascade,
  name text not null default '',
  position int not null default 0,
  enabled boolean not null default true,
  -- When: every filled-in condition must match.
  from_contains text not null default '',
  subject_contains text not null default '',
  with_attachments boolean not null default false,
  -- Then:
  move_to text check (move_to is null or move_to in ('inbox', 'archive', 'junk', 'deleted')),
  mark_read boolean not null default false,
  flag boolean not null default false,
  forward_to text check (forward_to is null or forward_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  stop boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_contains <> '' or subject_contains <> '' or with_attachments),
  check (move_to is not null or mark_read or flag or forward_to is not null)
);
create index if not exists mail_rules_mailbox_idx on classroom.mail_rules (mailbox_id, position);
alter table classroom.mail_rules enable row level security;
drop policy if exists "own rules" on classroom.mail_rules;
create policy "own rules" on classroom.mail_rules for all to authenticated
  using (classroom.mail_access(mailbox_id, (select auth.uid())) in ('own', 'full'))
  with check (classroom.mail_access(mailbox_id, (select auth.uid())) in ('own', 'full'));
grant select, insert, update, delete on classroom.mail_rules to authenticated;

-- A rule's "forward to": a copy goes on, with the same files, marked
-- automatic so no further rule or out-of-office answers it.
create or replace function classroom.mail_rule_forward(src classroom.mail_messages, target text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare draft uuid;
begin
  insert into classroom.mail_messages (mailbox_id, envelope_id, folder, to_list, subject, body_html, is_auto)
  values (src.mailbox_id, src.envelope_id, 'drafts', jsonb_build_array(jsonb_build_object('name', '', 'address', lower(target))),
          case when src.subject ~* '^fw:' then src.subject else 'FW: ' || src.subject end,
          '<p>Forwarded automatically by a rule.</p><hr><p><b>From:</b> '
            || replace(replace(coalesce(nullif(src.from_name, ''), src.from_address), '<', '&lt;'), '>', '&gt;')
            || '<br><b>Subject:</b> ' || replace(replace(src.subject, '<', '&lt;'), '>', '&gt;') || '</p><blockquote>' || src.body_html || '</blockquote>',
          true)
  returning id into draft;
  perform classroom.mail_send_as(draft, null);
exception when others then
  raise warning 'A rule could not forward message %: %', src.id, sqlerrm;
end;
$fn$;
revoke all on function classroom.mail_rule_forward(classroom.mail_messages, text) from public, anon, authenticated;

create or replace function classroom.mail_apply_rules()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare
  r classroom.mail_rules;
  folder_to text;
  read_it boolean := false;
  flag_it boolean := false;
begin
  if new.folder <> 'inbox' or new.is_auto or coalesce(new.inbound_id, '') like 'imp:%' then return null; end if;
  for r in select * from classroom.mail_rules where mailbox_id = new.mailbox_id and enabled order by position, created_at loop
    continue when r.from_contains <> '' and not (new.from_address ilike '%' || r.from_contains || '%' or new.from_name ilike '%' || r.from_contains || '%');
    continue when r.subject_contains <> '' and not new.subject ilike '%' || r.subject_contains || '%';
    continue when r.with_attachments and not new.has_attachments;
    if r.move_to is not null and folder_to is null then folder_to := r.move_to; end if;
    read_it := read_it or r.mark_read;
    flag_it := flag_it or r.flag;
    if r.forward_to is not null then perform classroom.mail_rule_forward(new, r.forward_to); end if;
    exit when r.stop;
  end loop;
  if folder_to is not null or read_it or flag_it then
    -- A rule marking mail read is not the reader opening it.
    perform set_config('classroom.by_rule', 'on', true);
    update classroom.mail_messages
       set folder = coalesce(folder_to, folder),
           previous_folder = case when folder_to is not null and folder_to <> 'inbox' then 'inbox' else previous_folder end,
           is_read = is_read or read_it, is_flagged = is_flagged or flag_it
     where id = new.id;
    perform set_config('classroom.by_rule', 'off', true);
  end if;
  return null;
end;
$fn$;
drop trigger if exists mail_apply_rules on classroom.mail_messages;
create trigger mail_apply_rules after insert on classroom.mail_messages
  for each row execute function classroom.mail_apply_rules();

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_opened_inside()'::regprocedure);
  if position('by_rule' in d) = 0 then
    d := replace(d, 'if new.is_read and not old.is_read and new.folder not in (''sent'', ''outbox'', ''drafts'') and not new.is_auto then',
      'if new.is_read and not old.is_read and new.folder not in (''sent'', ''outbox'', ''drafts'') and not new.is_auto
     and coalesce(current_setting(''classroom.by_rule'', true), ''off'') <> ''on'' then');
    execute d;
  end if;
end
$do$;

notify pgrst, 'reload schema';

-- 7. Mail to a suspended colleague is refused with a note, never sent
-- outside to the school's old provider.
do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mail_send_as(uuid,uuid)'::regprocedure);
  if position('switched off.</p>' in d) = 0 then
    d := replace(d, '    else
      insert into classroom.mail_outbound (message_id, recipient, kind, open_token)',
'    elsif exists (select 1 from classroom.mail_mailboxes x where (x.address = addr or addr = any (x.previous_addresses)) and not x.is_active) then
      unknown := unknown || addr;
    else
      insert into classroom.mail_outbound (message_id, recipient, kind, open_token)');
    d := replace(d, '|| array_to_string(unknown, '', '') || ''. Their mailbox is full.</p>'');',
                    '|| array_to_string(unknown, '', '') || ''. Their mailbox is full or switched off.</p>'');');
    execute d;
  end if;
end
$do$;

notify pgrst, 'reload schema';
