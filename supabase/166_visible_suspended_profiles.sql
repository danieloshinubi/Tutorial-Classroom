-- =============================================================================
-- Found while testing the org chart's "manager leaves" bubble-up: suspending
-- someone (school_members.is_active = false) made their PROFILE invisible to
-- everyone at the school, not just hidden from active-duty views. The old
-- "profiles are readable by people who share a school" policy (007_tenancy.sql)
-- required theirs.is_active — a suspended colleague's own membership row no
-- longer being active blocked the profile join entirely.
--
-- Two real features depended on that join succeeding for a suspended person:
--   - PeoplePanel's own intent (fetchSchoolMembers .filter(row => row.profiles),
--     the "suspended" row style, the "Restore" button) — a suspended member
--     was meant to still show up, greyed out, not vanish from the list.
--   - The org chart's bubble-up (buildOrgTree in src/lib/orgChart.js): when a
--     manager is suspended, their own manager_id needs to stay readable so
--     their reports can bubble up to the next real manager instead of
--     stranding as false roots.
--
-- Fix: only the VIEWER needs to be an active member (mine.is_active) — that
-- part was already correct and is unchanged. Whether the person being looked
-- AT is still active is not a visibility question at all.
-- =============================================================================

drop policy if exists "profiles are readable by people who share a school" on classroom.profiles;
create policy "profiles are readable by people who share a school"
  on classroom.profiles for select to authenticated
  using (
    id = auth.uid()
    or classroom.is_platform_admin()
    or exists (
      select 1
      from classroom.school_members mine
      join classroom.school_members theirs on theirs.school_id = mine.school_id
      where mine.user_id = auth.uid() and mine.is_active
        and theirs.user_id = classroom.profiles.id
    )
  );

notify pgrst, 'reload schema';
