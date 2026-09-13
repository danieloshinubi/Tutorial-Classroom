-- =============================================================================
-- Finishing the admin password reset — must_change_password + the audit log
--
-- admin-reset-password's service-role client calls auth.admin.updateUserById()
-- freely (the Auth Admin API, not PostgREST), but writing to
-- classroom.profiles or classroom.audit_log through supabase-js's .from()
-- goes through PostgREST as an ordinary table write — and service_role,
-- unlike a SECURITY DEFINER function's owner, has no GRANT on either table
-- in this schema (confirmed against information_schema.role_table_grants:
-- only `authenticated` appears for both). BYPASSRLS only skips row level
-- security *policies*; the underlying GRANT is a separate requirement it
-- does not stand in for. Both writes came back silently unapplied — found
-- live, by actually signing in as the reset account afterwards, not from
-- reading the code alone.
--
-- The fix is the one this codebase already uses everywhere else for a
-- privileged write: a SECURITY DEFINER function, executing with its owner's
-- privileges rather than the caller's — the same shape as
-- settle_online_payment(), restricted to service_role the same way.
--
-- Run after 070. Safe to re-run.
-- =============================================================================

create or replace function classroom.record_password_reset(target_school uuid, target_user uuid, actor uuid)
returns void
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  actor_name text;
  actor_role_val text;
begin
  update classroom.profiles
  set must_change_password = true
  where id = target_user;

  select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''), p.username, p.email)
    into actor_name
    from classroom.profiles p where p.id = actor;

  select string_agg(distinct m.role::text, ', ' order by m.role::text)
    into actor_role_val
    from classroom.school_members m
    where m.user_id = actor and m.school_id = target_school and m.is_active;

  insert into classroom.audit_log
    (school_id, table_name, record_id, action, actor_id, actor_label, actor_role, new_data)
  values
    (target_school, 'account_security', target_user::text, 'UPDATE', actor,
     coalesce(actor_name, 'Anonymous / system'), actor_role_val,
     jsonb_build_object('event', 'password_reset'));
end;
$fn$;

revoke all on function classroom.record_password_reset(uuid, uuid, uuid) from public;
revoke all on function classroom.record_password_reset(uuid, uuid, uuid) from authenticated;
revoke all on function classroom.record_password_reset(uuid, uuid, uuid) from anon;
grant execute on function classroom.record_password_reset(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
