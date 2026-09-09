-- =============================================================================
-- Administrator-issued passwords
--
-- An administrator creates an account, the system generates a password, and
-- the person is made to replace it the first time they sign in — the way
-- Microsoft 365 and most school systems work.
--
-- Run after 012. Safe to re-run.
-- =============================================================================

alter table classroom.profiles
  add column if not exists must_change_password boolean not null default false;

/* ---------------------------------------------------------------------------
   A school administrator may edit the profiles of people in their school.

   The old policy called classroom.is_admin(), which read the legacy global
   profiles.role — a leftover from before tenancy that would have let an
   administrator at one school edit a profile at another.
   --------------------------------------------------------------------------- */
drop policy if exists "admins update any profile" on classroom.profiles;
create policy "school admins update profiles in their school"
  on classroom.profiles for update to authenticated
  using (
    classroom.is_platform_admin()
    or exists (
      select 1 from classroom.school_members m
      where m.user_id = classroom.profiles.id
        and classroom.is_school_admin(m.school_id)
    )
  )
  with check (
    classroom.is_platform_admin()
    or exists (
      select 1 from classroom.school_members m
      where m.user_id = classroom.profiles.id
        and classroom.is_school_admin(m.school_id)
    )
  );

drop policy if exists "admins delete profiles" on classroom.profiles;
create policy "school admins delete profiles in their school"
  on classroom.profiles for delete to authenticated
  using (
    classroom.is_platform_admin()
    or exists (
      select 1 from classroom.school_members m
      where m.user_id = classroom.profiles.id
        and classroom.is_school_admin(m.school_id)
    )
  );

/* ---------------------------------------------------------------------------
   Clearing the flag.

   Runs as definer and only ever touches the caller's own row, so finishing
   the forced change cannot be used to clear it for anybody else.
   --------------------------------------------------------------------------- */
create or replace function classroom.password_changed()
returns void
language sql security definer
set search_path = classroom, public as $$
  update classroom.profiles
  set must_change_password = false
  where id = auth.uid();
$$;

grant execute on function classroom.password_changed() to authenticated;

/* ---------------------------------------------------------------------------
   Marking a newly created account. The caller must administer a school the
   person belongs to, and the flag can only ever be set — never cleared — from
   here, so an administrator cannot quietly lift someone else's requirement.
   --------------------------------------------------------------------------- */
create or replace function classroom.require_password_change(target_user uuid)
returns void
language plpgsql security definer
set search_path = classroom, public as $$
begin
  if not exists (
    select 1 from classroom.school_members m
    where m.user_id = target_user and classroom.is_school_admin(m.school_id)
  ) then
    raise exception 'You do not administer a school that person belongs to';
  end if;

  update classroom.profiles
  set must_change_password = true
  where id = target_user;
end;
$$;

grant execute on function classroom.require_password_change(uuid) to authenticated;

notify pgrst, 'reload schema';
