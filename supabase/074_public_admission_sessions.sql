-- =============================================================================
-- A non-member-safe way to read which sessions are open for applications
--
-- ApplyStart.jsx (the accounted/signed-in applicant flow) needs to list the
-- sessions currently accepting applications, but classroom.sessions' only
-- SELECT policy (012_academic_structure.sql) is membership-gated
-- (classroom.is_member_of(school_id)) — and an applicant is deliberately
-- never a school_members row (040_admissions_engine.sql's own comment on
-- applicant_accounts). Every other read that flow needs already has a
-- non-member-safe path: classroom.public_school() for the school itself,
-- classroom.admission_config's own "to authenticated, anon using (true)"
-- policy, classroom.admission_programmes' "using (is_active)" policy. This
-- is the one that was missing.
--
-- Deliberately narrow: name and whether it's open, nothing else — no
-- start/end dates, no internal ids beyond the session's own.
--
-- Run after 040. Safe to re-run.
-- =============================================================================

create or replace function classroom.public_admission_sessions(target_school uuid)
returns table (id uuid, name text)
language sql stable security definer
set search_path = classroom, public
as $fn$
  select s.id, s.name
  from classroom.sessions s
  where s.school_id = target_school and s.applications_open
  order by s.name desc;
$fn$;

grant execute on function classroom.public_admission_sessions(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
