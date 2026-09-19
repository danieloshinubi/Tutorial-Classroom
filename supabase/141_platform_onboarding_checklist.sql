-- =============================================================================
-- Onboarding-progress visibility. Overview's own "Quiet tenants" card
-- (026_platform_console.sql) already flags a school with zero students as
-- possibly stalled — this generalises that same instinct into an actual
-- checklist, computed entirely from data that already exists (no new
-- columns): has anyone besides the seed owner signed in, is branding set,
-- is a payment gateway confirmed, is there at least one class/level and one
-- student. Lets customer success see "this school is stuck at step 2 of 5"
-- instead of only "this school has 0 students" and having to guess why.
-- =============================================================================

create or replace function classroom.platform_onboarding(target_school uuid)
returns table (
  has_second_admin   boolean,
  has_logo           boolean,
  has_theme          boolean,
  has_gateway        boolean,
  has_levels         boolean,
  has_class          boolean,
  has_student        boolean,
  has_application    boolean
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    (select count(*) from classroom.school_members m
      where m.school_id = target_school and m.is_active
        and m.role in ('owner','admin','principal')) > 1,
    (select s.logo_url is not null from classroom.schools s where s.id = target_school),
    (select s.theme_color is not null from classroom.schools s where s.id = target_school),
    exists (select 1 from classroom.payment_gateways g
      where g.school_id = target_school and g.confirmed_at is not null),
    exists (select 1 from classroom.levels lv where lv.school_id = target_school),
    exists (select 1 from classroom.classes c where c.school_id = target_school),
    exists (select 1 from classroom.school_members m
      where m.school_id = target_school and m.is_active and m.role = 'student'),
    exists (select 1 from classroom.applications a where a.school_id = target_school)
  where classroom.is_platform_admin();
$fn$;

grant execute on function classroom.platform_onboarding(uuid) to authenticated;

notify pgrst, 'reload schema';
