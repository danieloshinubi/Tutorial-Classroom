-- =============================================================================
-- The platform console, which is not part of any school
--
-- admin.schoolivio.com answers questions no tenant may ask: how many schools
-- are there, which of them are actually being used, who runs them. Every
-- function here checks classroom.is_platform_admin() first and reads across
-- all tenants deliberately — that is the whole point of the console, and the
-- reason none of it is reachable from a school's own subdomain.
-- =============================================================================

-- Every school, with enough life signs to tell a real deployment from a
-- tenant that was created and abandoned.
create or replace function classroom.platform_overview()
returns table (
  schools        int,
  active_schools int,
  people         int,
  students       int,
  staff          int,
  courses        int,
  applications   int,
  schools_added_30d int
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    (select count(*)::int from classroom.schools),
    (select count(*)::int from classroom.schools where is_active),
    (select count(distinct user_id)::int from classroom.school_members where is_active),
    (select count(*)::int from classroom.school_members where is_active and role = 'student'),
    (select count(*)::int from classroom.school_members
      where is_active and role in ('owner','admin','principal','teacher','bursar','admissions')),
    (select count(*)::int from classroom.courses where not archived),
    (select count(*)::int from classroom.applications),
    (select count(*)::int from classroom.schools where created_at > now() - interval '30 days')
  where classroom.is_platform_admin();
$fn$;

-- One tenant, in enough detail to answer a support call.
create or replace function classroom.platform_tenant(target_school uuid)
returns table (
  id            uuid,
  name          text,
  slug          text,
  plan          text,
  is_active     boolean,
  created_at    timestamptz,
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

-- Who administers a tenant, so support knows who to call.
create or replace function classroom.platform_tenant_admins(target_school uuid)
returns table (user_id uuid, name text, email text, role classroom.member_role, is_active boolean)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    p.id,
    coalesce(nullif(btrim(p.first_name || ' ' || p.surname), ''), p.username, p.email),
    p.email,
    m.role,
    m.is_active
  from classroom.school_members m
  join classroom.profiles p on p.id = m.user_id
  where m.school_id = target_school
    and m.role in ('owner', 'admin', 'principal')
    and classroom.is_platform_admin()
  order by m.role, 2;
$fn$;

-- Moving a tenant between plans is a platform decision, never a school's.
create or replace function classroom.platform_set_plan(target_school uuid, new_plan text)
returns classroom.schools
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  row classroom.schools;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can change a plan';
  end if;

  if new_plan not in ('trial', 'basic', 'standard', 'premium') then
    raise exception 'Unknown plan: %', new_plan;
  end if;

  update classroom.schools set plan = new_plan
  where id = target_school
  returning * into row;

  if not found then
    raise exception 'No such school';
  end if;

  return row;
end;
$fn$;

grant execute on function classroom.platform_overview()                  to authenticated;
grant execute on function classroom.platform_tenant(uuid)                to authenticated;
grant execute on function classroom.platform_tenant_admins(uuid)         to authenticated;
grant execute on function classroom.platform_set_plan(uuid, text)        to authenticated;

notify pgrst, 'reload schema';
