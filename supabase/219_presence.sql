-- Online / last seen, and last signed in.
--
--   Online now      Realtime presence on the private topic presence:<school>:
--                   each open app joins it; anyone may join only a school
--                   they belong to (realtime_can_listen, 215).
--   Last seen       classroom.user_presence, touched by the app every couple
--                   of minutes while it is open (touch_presence), so it is
--                   right even after a crash or a closed laptop lid.
--   Last signed in  auth.users.last_sign_in_at: when they last actually
--                   signed in, not just used the app. Owners and admins only
--                   (People), like Teams' admin centre.
--
-- school_presence answers for the people the caller may already see on the
-- roster (can_see_person), and nobody else.

create table if not exists classroom.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table classroom.user_presence enable row level security;
-- No policies: read and written only through the two functions below.

create or replace function classroom.touch_presence()
returns void
language sql
security definer
set search_path = classroom, public
as $fn$
  insert into classroom.user_presence (user_id, last_seen_at)
  select auth.uid(), now() where auth.uid() is not null
  on conflict (user_id) do update set last_seen_at = now()
   where classroom.user_presence.last_seen_at < now() - interval '45 seconds';
$fn$;
revoke all on function classroom.touch_presence() from public, anon;
grant execute on function classroom.touch_presence() to authenticated;

create or replace function classroom.school_presence(target_school uuid)
returns table (user_id uuid, last_seen_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select m.user_id,
         p.last_seen_at,
         case when classroom.is_school_admin(target_school) then u.last_sign_in_at end
    from (select distinct user_id from classroom.school_members where school_id = target_school) m
    left join classroom.user_presence p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
   where classroom.is_member_of(target_school)
     and (m.user_id = auth.uid() or classroom.can_see_person(m.user_id));
$fn$;
revoke all on function classroom.school_presence(uuid) from public, anon;
grant execute on function classroom.school_presence(uuid) to authenticated;

-- Realtime: presence:<school> for members of that school. Joining presence
-- also writes (announcing yourself), so the insert rule allows it too.
create or replace function classroom.realtime_can_listen(target_topic text)
returns boolean
language plpgsql
stable
set search_path = classroom, public
as $fn$
declare
  kind text := split_part(coalesce(target_topic, ''), ':', 1);
  ref uuid := classroom.try_uuid(split_part(coalesce(target_topic, ''), ':', 2));
begin
  if auth.uid() is null or ref is null then
    return false;
  end if;
  return coalesce(case kind
    when 'user' then ref = auth.uid()
    when 'chat' then classroom.is_chat_member(ref)
    when 'typing' then classroom.is_chat_member(ref)
    when 'presence' then classroom.is_member_of(ref)
    when 'course' then classroom.is_enrolled_in(ref) or classroom.can_manage_course(ref)
    when 'application' then exists (select 1 from classroom.applications a where a.id = ref)
    when 'applications' then classroom.can_view_admissions(ref)
    when 'tickets' then classroom.is_ticket_staff(ref)
    when 'ticket' then exists (select 1 from classroom.tickets t where t.id = ref)
    else false
  end, false);
end;
$fn$;

drop policy if exists "schoolivio topics: typing" on realtime.messages;
create policy "schoolivio topics: typing" on realtime.messages
  for insert to authenticated
  with check (
    split_part(realtime.topic(), ':', 1) in ('typing', 'presence')
    and classroom.realtime_can_listen(realtime.topic())
  );

notify pgrst, 'reload schema';
