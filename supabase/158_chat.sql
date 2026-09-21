-- =============================================================================
-- Schoolivio Chat — tenant-scoped DMs and group channels.
--
-- One shape covers both: chat_channels.kind decides dm vs group. A DM's
-- identity is dm_key (the two participants' ids, sorted and joined), guarded
-- by a partial unique index — that's what lets open_dm() below be safely
-- called from both sides of a "message someone" click at once and still
-- converge on one channel, via insert ... on conflict do nothing rather than
-- a client-side select-then-insert race.
--
-- RLS follows the same helper-indirection pattern as every other membership
-- check in this codebase (classroom.can_do_admissions, classroom.
-- is_applicant_for): a security definer function, never an inlined
-- subquery in the policy itself. Inlining membership subqueries directly
-- into a policy on the same table they read is exactly what
-- 025_fix_result_policy_recursion.sql had to undo — the function
-- indirection (running with RLS bypassed inside the function body) is what
-- avoids the recursion, not a stylistic choice.
-- =============================================================================

create table if not exists classroom.chat_channels (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references classroom.schools (id) on delete cascade,
  kind            text not null check (kind in ('dm', 'group')),
  name            text,
  dm_key          text,
  is_private      boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chat_channels_name_shape check (
    (kind = 'group' and name is not null) or (kind = 'dm' and name is null)
  ),
  constraint chat_channels_dm_key_shape check (
    (kind = 'dm' and dm_key is not null) or (kind = 'group' and dm_key is null)
  )
);

create unique index if not exists chat_channels_dm_key_idx
  on classroom.chat_channels (school_id, dm_key) where dm_key is not null;
create index if not exists chat_channels_school_kind_idx
  on classroom.chat_channels (school_id, kind, last_message_at desc);

create table if not exists classroom.chat_channel_members (
  channel_id   uuid not null references classroom.chat_channels (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  last_read_at timestamptz not null default now(),
  is_muted     boolean not null default false,
  joined_at    timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists chat_channel_members_user_idx
  on classroom.chat_channel_members (user_id, channel_id);

create table if not exists classroom.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references classroom.chat_channels (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  body        text not null,
  reply_to_id uuid references classroom.chat_messages (id) on delete set null,
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_channel_created_idx
  on classroom.chat_messages (channel_id, created_at desc);

-- Keeps the channel list sortable with no extra query — last_message_at
-- moves forward on every new message, same idea as tickets bumping
-- updated_at on a new ticket_messages row.
create or replace function classroom.bump_chat_channel_last_message()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  update classroom.chat_channels
  set last_message_at = new.created_at, updated_at = now()
  where id = new.channel_id;
  return new;
end;
$fn$;

drop trigger if exists chat_messages_bump_channel_trg on classroom.chat_messages;
create trigger chat_messages_bump_channel_trg
  after insert on classroom.chat_messages
  for each row execute function classroom.bump_chat_channel_last_message();

/* ---------------------------------------------------------------------------
   RLS
   --------------------------------------------------------------------------- */

create or replace function classroom.is_chat_member(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.chat_channel_members m
    where m.channel_id = target_channel and m.user_id = auth.uid()
  );
$fn$;

grant execute on function classroom.is_chat_member(uuid) to authenticated;

create or replace function classroom.is_chat_channel_admin(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.chat_channel_members m
    where m.channel_id = target_channel and m.user_id = auth.uid() and m.role = 'owner'
  );
$fn$;

grant execute on function classroom.is_chat_channel_admin(uuid) to authenticated;

alter table classroom.chat_channels enable row level security;
alter table classroom.chat_channel_members enable row level security;
alter table classroom.chat_messages enable row level security;

drop policy if exists "chat members read their channels" on classroom.chat_channels;
create policy "chat members read their channels"
  on classroom.chat_channels for select to authenticated
  using (classroom.is_chat_member(id));

-- No insert/delete policy on purpose: creation is RPC-only (open_dm /
-- create_group_channel below), which is what lets channel creation and its
-- first member rows happen atomically instead of leaving an orphan channel
-- if a second insert failed.
drop policy if exists "chat channel admins update settings" on classroom.chat_channels;
create policy "chat channel admins update settings"
  on classroom.chat_channels for update to authenticated
  using (classroom.is_chat_channel_admin(id))
  with check (classroom.is_chat_channel_admin(id));

grant select, update on classroom.chat_channels to authenticated;

drop policy if exists "chat members read their roster" on classroom.chat_channel_members;
create policy "chat members read their roster"
  on classroom.chat_channel_members for select to authenticated
  using (classroom.is_chat_member(channel_id));

drop policy if exists "chat members update their own row" on classroom.chat_channel_members;
create policy "chat members update their own row"
  on classroom.chat_channel_members for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chat members leave or admins remove" on classroom.chat_channel_members;
create policy "chat members leave or admins remove"
  on classroom.chat_channel_members for delete to authenticated
  using (user_id = auth.uid() or classroom.is_chat_channel_admin(channel_id));

grant select, update, delete on classroom.chat_channel_members to authenticated;

drop policy if exists "chat members read messages" on classroom.chat_messages;
create policy "chat members read messages"
  on classroom.chat_messages for select to authenticated
  using (classroom.is_chat_member(channel_id));

drop policy if exists "chat members send messages" on classroom.chat_messages;
create policy "chat members send messages"
  on classroom.chat_messages for insert to authenticated
  with check (classroom.is_chat_member(channel_id) and author_id = auth.uid());

drop policy if exists "authors edit or delete their own messages" on classroom.chat_messages;
create policy "authors edit or delete their own messages"
  on classroom.chat_messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

grant select, insert, update on classroom.chat_messages to authenticated;

/* ---------------------------------------------------------------------------
   RPCs — the parts a plain client insert can't do safely
   --------------------------------------------------------------------------- */

-- Race-proof "open a DM with this person": two people clicking "message
-- each other" at the same instant both land on the same channel, because
-- the unique partial index on (school_id, dm_key) plus ON CONFLICT DO
-- NOTHING makes the second insert a no-op rather than a second channel.
create or replace function classroom.open_dm(target_school uuid, other_user uuid)
returns classroom.chat_channels
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  me      uuid := auth.uid();
  key     text;
  channel classroom.chat_channels;
begin
  if me is null then
    raise exception 'You must be signed in to start a chat';
  end if;
  if other_user = me then
    raise exception 'You cannot start a DM with yourself';
  end if;

  if not exists (
    select 1 from classroom.school_members
    where school_id = target_school and user_id = me and is_active
  ) or not exists (
    select 1 from classroom.school_members
    where school_id = target_school and user_id = other_user and is_active
  ) then
    raise exception 'Both people must be active members of this school';
  end if;

  key := case when me < other_user
    then me::text || ':' || other_user::text
    else other_user::text || ':' || me::text
  end;

  insert into classroom.chat_channels (school_id, kind, dm_key, created_by)
  values (target_school, 'dm', key, me)
  on conflict (school_id, dm_key) do nothing;

  select * into channel from classroom.chat_channels
  where school_id = target_school and dm_key = key;

  insert into classroom.chat_channel_members (channel_id, user_id)
  values (channel.id, me), (channel.id, other_user)
  on conflict (channel_id, user_id) do nothing;

  return channel;
end;
$fn$;

grant execute on function classroom.open_dm(uuid, uuid) to authenticated;

create or replace function classroom.create_group_channel(
  target_school uuid,
  channel_name  text,
  member_ids    uuid[]
) returns classroom.chat_channels
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  me      uuid := auth.uid();
  channel classroom.chat_channels;
  bad_count int;
begin
  if me is null then
    raise exception 'You must be signed in to create a channel';
  end if;
  if btrim(coalesce(channel_name, '')) = '' then
    raise exception 'A channel needs a name';
  end if;
  if not exists (
    select 1 from classroom.school_members
    where school_id = target_school and user_id = me and is_active
  ) then
    raise exception 'You are not an active member of this school';
  end if;

  select count(*) into bad_count
  from unnest(coalesce(member_ids, array[]::uuid[])) as u(user_id)
  where not exists (
    select 1 from classroom.school_members
    where school_id = target_school and user_id = u.user_id and is_active
  );
  if bad_count > 0 then
    raise exception 'Every member must be an active member of this school';
  end if;

  insert into classroom.chat_channels (school_id, kind, name, created_by)
  values (target_school, 'group', btrim(channel_name), me)
  returning * into channel;

  insert into classroom.chat_channel_members (channel_id, user_id, role)
  values (channel.id, me, 'owner');

  insert into classroom.chat_channel_members (channel_id, user_id)
  select channel.id, u.user_id
  from unnest(coalesce(member_ids, array[]::uuid[])) as u(user_id)
  where u.user_id <> me
  on conflict (channel_id, user_id) do nothing;

  return channel;
end;
$fn$;

grant execute on function classroom.create_group_channel(uuid, text, uuid[]) to authenticated;

create or replace function classroom.add_chat_members(target_channel uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  target_school uuid;
  bad_count int;
begin
  if not classroom.is_chat_channel_admin(target_channel) then
    raise exception 'Only a channel admin can add members';
  end if;

  select school_id into target_school from classroom.chat_channels where id = target_channel;

  select count(*) into bad_count
  from unnest(coalesce(member_ids, array[]::uuid[])) as u(user_id)
  where not exists (
    select 1 from classroom.school_members
    where school_id = target_school and user_id = u.user_id and is_active
  );
  if bad_count > 0 then
    raise exception 'Every member must be an active member of this school';
  end if;

  insert into classroom.chat_channel_members (channel_id, user_id)
  select target_channel, u.user_id
  from unnest(coalesce(member_ids, array[]::uuid[])) as u(user_id)
  on conflict (channel_id, user_id) do nothing;
end;
$fn$;

grant execute on function classroom.add_chat_members(uuid, uuid[]) to authenticated;

create or replace function classroom.remove_chat_member(target_channel uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  if not classroom.is_chat_channel_admin(target_channel) then
    raise exception 'Only a channel admin can remove members';
  end if;
  delete from classroom.chat_channel_members
  where channel_id = target_channel and user_id = target_user;
end;
$fn$;

grant execute on function classroom.remove_chat_member(uuid, uuid) to authenticated;

-- One round trip for the channel list: name to show, last-message preview,
-- unread count. Same aggregate-RPC shape as admissions_queues()/
-- application_workspace() elsewhere in this app.
create or replace function classroom.chat_overview(target_school uuid)
returns jsonb
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select coalesce(jsonb_agg(row_to_json(t) order by t.last_message_at desc), '[]'::jsonb)
  from (
    select
      c.id,
      c.kind,
      case
        when c.kind = 'group' then c.name
        else (
          select coalesce(p.first_name || ' ' || p.surname, p.email)
          from classroom.chat_channel_members om
          join classroom.profiles p on p.id = om.user_id
          where om.channel_id = c.id and om.user_id <> auth.uid()
          limit 1
        )
      end as name,
      c.last_message_at,
      (
        select m.body from classroom.chat_messages m
        where m.channel_id = c.id and m.deleted_at is null
        order by m.created_at desc limit 1
      ) as last_message_preview,
      (
        select count(*) from classroom.chat_messages m
        where m.channel_id = c.id
          and m.deleted_at is null
          and m.author_id <> auth.uid()
          and m.created_at > mine.last_read_at
      ) as unread_count
    from classroom.chat_channels c
    join classroom.chat_channel_members mine
      on mine.channel_id = c.id and mine.user_id = auth.uid()
    where c.school_id = target_school
  ) t;
$fn$;

grant execute on function classroom.chat_overview(uuid) to authenticated;

alter publication supabase_realtime add table classroom.chat_messages;
alter publication supabase_realtime add table classroom.chat_channels;
alter publication supabase_realtime add table classroom.chat_channel_members;

notify pgrst, 'reload schema';
