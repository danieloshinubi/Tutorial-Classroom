-- =============================================================================
-- Patch: backfill profiles for users who signed up before the trigger existed
--
-- `on_auth_user_created` only fires for NEW rows in auth.users, so anyone who
-- registered before schema.sql was run has a login but no profile — the app
-- then signs them in and immediately has no role to work with.
--
-- Safe to run more than once.
-- =============================================================================

insert into classroom.profiles (id, email, first_name, surname, username, role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'first_name', ''),
  coalesce(u.raw_user_meta_data ->> 'surname', ''),
  nullif(u.raw_user_meta_data ->> 'username', ''),
  case when u.raw_user_meta_data ->> 'role' = 'tutor' then 'tutor'::classroom.user_role
       else 'student'::classroom.user_role end
from auth.users u
on conflict (id) do nothing;

-- Show what exists now, so you can see who to promote.
select id, email, first_name, surname, username, role
from classroom.profiles
order by created_at;
