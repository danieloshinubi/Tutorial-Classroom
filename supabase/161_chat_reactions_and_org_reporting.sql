-- =============================================================================
-- Two independent additions, bundled in one migration since both are small:
--
-- 1. Emoji reactions on a chat message — its own table (a message can carry
--    several different emoji, each from several people), RLS gated through
--    the same "is a member of this message's channel" check the messages
--    themselves use, just resolved through chat_messages -> chat_channel_
--    members since a reaction row has no channel_id of its own.
--
-- 2. "Reports to" on a school membership — classroom.school_members.
--    manager_id, not classroom.profiles, because who you report to is a
--    fact about your job at THIS school, same tenant-scoping reasoning as
--    role itself (a person could in principle staff two schools with two
--    different managers). Already covered by the existing "school admins
--    manage membership" policy (owner/admin, all commands) — no new RLS
--    policy needed, just the column and a trigger to keep it sane.
-- =============================================================================

create table classroom.chat_message_reactions (
  message_id uuid not null references classroom.chat_messages(id) on delete cascade,
  user_id    uuid not null references classroom.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index chat_message_reactions_message_idx on classroom.chat_message_reactions (message_id);

create or replace function classroom.is_chat_member_of_message(target_message uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1
    from classroom.chat_messages m
    join classroom.chat_channel_members cm on cm.channel_id = m.channel_id
    where m.id = target_message and cm.user_id = auth.uid()
  );
$fn$;
grant execute on function classroom.is_chat_member_of_message(uuid) to authenticated;

alter table classroom.chat_message_reactions enable row level security;

create policy "chat members read message reactions"
  on classroom.chat_message_reactions for select
  using (classroom.is_chat_member_of_message(message_id));

create policy "chat members add their own reaction"
  on classroom.chat_message_reactions for insert
  with check (user_id = auth.uid() and classroom.is_chat_member_of_message(message_id));

create policy "people remove their own reaction"
  on classroom.chat_message_reactions for delete
  using (user_id = auth.uid());

alter publication supabase_realtime add table classroom.chat_message_reactions;

-- ---------------------------------------------------------------- reporting

alter table classroom.school_members
  add column manager_id uuid references classroom.profiles(id) on delete set null;

create or replace function classroom.validate_school_member_manager()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  if new.manager_id is null then
    return new;
  end if;
  if new.manager_id = new.user_id then
    raise exception 'A staff member cannot report to themselves';
  end if;
  if not exists (
    select 1 from classroom.school_members
    where school_id = new.school_id and user_id = new.manager_id and is_active
  ) then
    raise exception 'The selected manager is not an active member of this school';
  end if;
  return new;
end;
$fn$;

create trigger school_members_manager_check
  before insert or update of manager_id on classroom.school_members
  for each row execute function classroom.validate_school_member_manager();

notify pgrst, 'reload schema';
