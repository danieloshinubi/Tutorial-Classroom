-- =============================================================================
-- Finish cutting the platform out of tenant data
--
-- 027 removed the platform bypass from has_role_in(), which covered anything
-- gated on a ROLE. is_member_of() still carried its own copy, and that one
-- gates plain membership reads:
--
--   schools, school_members, levels, courses, sessions, terms, classes,
--   subjects, class_subjects, class_students
--
-- So vendor staff could still read every school's roster — names, emails and
-- roles of every student, parent and teacher on the platform — along with its
-- whole academic structure. Structural rather than marks or fees, but a
-- roster of children's names is exactly the kind of thing that should not be
-- readable by default.
--
-- The console does not need it. platform_schools(), platform_overview(),
-- platform_tenant() and platform_tenant_admins() are all SECURITY DEFINER and
-- check is_platform_admin() for themselves, so they see what they need
-- regardless of this function. The bypass was only ever incidental.
-- =============================================================================

create or replace function classroom.is_member_of(target_school uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  -- Membership, and nothing else. A platform administrator reads tenants
  -- through the platform_* functions, which authorise themselves.
  select target_school is not null and exists (
    select 1 from classroom.school_members
    where user_id = auth.uid()
      and school_id = target_school
      and is_active
  );
$fn$;

notify pgrst, 'reload schema';
