-- =============================================================================
-- classroom.audit_log already records every plan change, suspension and
-- (as of 136) platform-admin grant/revoke — has done since 062_audit_log.sql
-- — but its only RLS policy is "a school's own administrators see that
-- school's rows" (school_id = one of theirs). Nothing anywhere lets
-- platform staff see what THEY did across the console: who suspended which
-- school, who changed a plan, when. It was being written the whole time,
-- just never read back.
--
-- Deliberately narrow: only the columns already safe to show a tenant's own
-- admins (062's own policy proves that), and only rows this console's own
-- actions produce — school_id null (platform-only, e.g. an admin grant) or
-- table_name in a fixed allow-list of platform-actionable tables. This is
-- not a general "read any school's audit log" backdoor; a row about a
-- school's own internal activity (a grade entered, a message sent) is not
-- reachable through this function even though the table has one.
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
    a.id, a.created_at, a.school_id, s.name,
    a.table_name, a.record_id, a.action, a.actor_label, a.changed_fields
  from classroom.audit_log a
  left join classroom.schools s on s.id = a.school_id
  where classroom.is_platform_admin()
    and a.table_name in ('schools', 'platform_admins', 'payment_gateways')
    and (target_school is null or a.school_id = target_school)
  order by a.created_at desc
  limit greatest(1, least(limit_rows, 500));
$fn$;

grant execute on function classroom.platform_audit_log(uuid, int) to authenticated;

notify pgrst, 'reload schema';
