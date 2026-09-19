-- =============================================================================
-- Offboarding — today "suspend" (is_active = false) is the only lifecycle
-- action past active, and there is no export or deletion path at all. Two
-- additions, both deliberately conservative:
--
--   export    A structural export (school settings, the member roster,
--             course list, application list) — not full content export
--             (messages, exam answers, submissions). That's the same
--             "how much, never what's inside" line every other platform_*
--             function already draws, kept here on purpose: a genuine
--             deep-content GDPR-style export is real future work, but
--             building it by quietly crossing a boundary this codebase
--             states deliberately elsewhere (TenantDetail.jsx: "this
--             console deliberately cannot read a tenant's coursework,
--             marks or fees") is not a decision to make silently while
--             building eight other things. This gives a school leaving
--             today something real to hand back, without that.
--
--   archive   NOT a hard delete. A school's data is real customer data;
--             a one-click irreversible delete button in an admin console
--             is a bigger risk than the problem it solves. Archiving sets
--             is_active = false (the same effect Suspend already has) plus
--             a distinct archived_at, so "offboarded on purpose" reads
--             differently from "temporarily suspended" without adding a
--             second way to destroy something permanently.
-- =============================================================================

alter table classroom.schools
  add column if not exists archived_at timestamptz;

create or replace function classroom.platform_export_school(target_school uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = classroom, public
as $fn$
declare
  out jsonb;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can export a school';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'school', (
      select jsonb_build_object(
        'id', s.id, 'name', s.name, 'slug', s.slug, 'plan', s.plan,
        'is_active', s.is_active, 'created_at', s.created_at,
        'email', s.email, 'phone', s.phone, 'address', s.address,
        'currency', s.currency, 'timezone', s.timezone
      ) from classroom.schools s where s.id = target_school
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', nullif(btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.surname,'')), ''),
        'email', p.email, 'role', m.role, 'is_active', m.is_active, 'joined_at', m.created_at
      )), '[]'::jsonb)
      from classroom.school_members m join classroom.profiles p on p.id = m.user_id
      where m.school_id = target_school
    ),
    'courses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', c.code, 'title', c.title, 'archived', c.archived, 'created_at', c.created_at
      )), '[]'::jsonb)
      from classroom.courses c where c.school_id = target_school
    ),
    'applications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', a.reference, 'status', a.status, 'created_at', a.created_at
      )), '[]'::jsonb)
      from classroom.applications a where a.school_id = target_school
    )
  ) into out;

  return out;
end;
$fn$;

grant execute on function classroom.platform_export_school(uuid) to authenticated;

create or replace function classroom.platform_archive_school(target_school uuid, archived boolean)
returns classroom.schools
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  row classroom.schools;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can archive a school';
  end if;

  update classroom.schools
  set is_active = not archived,
      archived_at = case when archived then now() else null end
  where id = target_school
  returning * into row;

  if not found then raise exception 'No such school'; end if;
  return row;
end;
$fn$;

grant execute on function classroom.platform_archive_school(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
