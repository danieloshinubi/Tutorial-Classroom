-- =============================================================================
-- TenantDetail.jsx now shows a trial countdown/extend action and an archive
-- action, both needing fields platform_tenant() never returned.
-- =============================================================================

drop function if exists classroom.platform_tenant(uuid);

create or replace function classroom.platform_tenant(target_school uuid)
returns table (
  id            uuid,
  name          text,
  slug          text,
  plan          text,
  is_active     boolean,
  created_at    timestamptz,
  trial_ends_at timestamptz,
  archived_at   timestamptz,
  logo_url      text,
  email         text,
  phone         text,
  currency      text,
  timezone      text,
  members       int,
  students      int,
  staff         int,
  parents       int,
  courses       int,
  applications  int,
  result_sheets int,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    s.id, s.name, s.slug, s.plan, s.is_active, s.created_at,
    s.trial_ends_at, s.archived_at,
    s.logo_url, s.email, s.phone, s.currency, s.timezone,
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active),
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active and m.role = 'student'),
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active
        and m.role in ('owner','admin','principal','teacher','bursar','admissions')),
    (select count(*)::int from classroom.school_members m
      where m.school_id = s.id and m.is_active and m.role = 'parent'),
    (select count(*)::int from classroom.courses c
      where c.school_id = s.id and not c.archived),
    (select count(*)::int from classroom.applications a where a.school_id = s.id),
    (select count(*)::int from classroom.result_sheets r where r.school_id = s.id),
    greatest(
      (select max(m2.created_at) from classroom.messages m2
        join classroom.courses c2 on c2.id = m2.course_id where c2.school_id = s.id),
      (select max(a2.created_at) from classroom.applications a2 where a2.school_id = s.id),
      (select max(c3.created_at) from classroom.courses c3 where c3.school_id = s.id)
    )
  from classroom.schools s
  where s.id = target_school
    and classroom.is_platform_admin();
$fn$;

grant execute on function classroom.platform_tenant(uuid) to authenticated;

notify pgrst, 'reload schema';
