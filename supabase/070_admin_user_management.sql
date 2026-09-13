-- =============================================================================
-- Admin account management within a tenant
--
-- Lets a school owner/admin edit another person's profile details and reset
-- their password — the way an IT admin manages a user from Microsoft 365's
-- admin center.
--
-- Editing profile fields needs nothing new here: the "school admins update
-- profiles in their school" policy (013_temp_passwords.sql) already allows
-- it. Resetting a password is different — Supabase only lets someone change
-- their OWN password from the client; only the Auth Admin API (which needs
-- the service_role key, never shipped to a browser) can set someone else's.
-- That happens in the admin-reset-password Edge Function; this migration
-- adds only the one thing it needs from the database first: authorization,
-- checked as the calling admin — the same way pay-init asks payable_now() as
-- the paying user rather than trusting the client.
--
-- Run after 013. Safe to re-run.
-- =============================================================================

create or replace function classroom.can_manage_member_account(target_school uuid, target_user uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public as $$
  select
    classroom.is_school_admin(target_school)
    and exists (
      select 1 from classroom.school_members
      where school_id = target_school and user_id = target_user
    );
$$;

grant execute on function classroom.can_manage_member_account(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
