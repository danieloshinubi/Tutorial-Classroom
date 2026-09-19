-- =============================================================================
-- 137's platform_audit_log() joined schools on a.school_id — which
-- write_audit_log() only ever populates from row_data->>'school_id'. A row
-- ABOUT the schools table itself (a logo change, a plan change) has no such
-- column pointing at itself, so every one of those rows showed
-- "— platform —" instead of which school it was actually about, even
-- though a.record_id already holds that school's own id in exactly this
-- case. Confirmed live: every schools-table row in the audit log came back
-- with a null school_name before this fix.
-- =============================================================================

create or replace function classroom.platform_audit_log(
  target_school   uuid default null,
  limit_rows      int  default 100
)
returns table (
  id             uuid,
  created_at     timestamptz,
  school_id      uuid,
  school_name    text,
  table_name     text,
  record_id      text,
  action         text,
  actor_label    text,
  changed_fields text[]
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    a.id, a.created_at,
    coalesce(a.school_id, case when a.table_name = 'schools' then a.record_id::uuid end),
    s.name,
    a.table_name, a.record_id, a.action, a.actor_label, a.changed_fields
  from classroom.audit_log a
  left join classroom.schools s
    on s.id = coalesce(a.school_id, case when a.table_name = 'schools' then a.record_id::uuid end)
  where classroom.is_platform_admin()
    and a.table_name in ('schools', 'platform_admins', 'payment_gateways')
    and (
      target_school is null
      or a.school_id = target_school
      or (a.table_name = 'schools' and a.record_id = target_school::text)
    )
  order by a.created_at desc
  limit greatest(1, least(limit_rows, 500));
$fn$;

grant execute on function classroom.platform_audit_log(uuid, int) to authenticated;

notify pgrst, 'reload schema';
