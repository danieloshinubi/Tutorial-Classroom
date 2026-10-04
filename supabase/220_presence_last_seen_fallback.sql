-- "Last seen" from day one.
--
-- 219 counted only the app's own heartbeat (user_presence), so anyone who had
-- not opened the new app yet showed no last seen at all. The sign-in system
-- already knows when each person was last active: when they signed in, and
-- when their session last renewed itself (about hourly while the app is
-- open). Last seen is now the latest of all three.

create or replace function classroom.school_presence(target_school uuid)
returns table (user_id uuid, last_seen_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select m.user_id,
         nullif(greatest(
           coalesce(p.last_seen_at, '-infinity'),
           coalesce(u.last_sign_in_at, '-infinity'),
           coalesce((select max(coalesce(s.refreshed_at, s.updated_at)) from auth.sessions s where s.user_id = m.user_id), '-infinity')
         ), '-infinity'::timestamptz),
         case when classroom.is_school_admin(target_school) then u.last_sign_in_at end
    from (select distinct user_id from classroom.school_members where school_id = target_school) m
    left join classroom.user_presence p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
   where classroom.is_member_of(target_school)
     and (m.user_id = auth.uid() or classroom.can_see_person(m.user_id));
$fn$;

create index if not exists user_presence_seen_idx on classroom.user_presence (last_seen_at);

notify pgrst, 'reload schema';
