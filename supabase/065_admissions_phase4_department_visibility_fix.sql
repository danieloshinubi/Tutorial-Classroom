-- =============================================================================
-- Admissions engine — Phase 4 fix
--
-- Found live: an applicant reading their own clearance_checklists rows
-- (fetchMyClearance, embedding clearance_departments for the name) got the
-- checklist row back fine but the joined department came back null — the
-- department's own RLS only let staff read it (can_do_admissions), so
-- PostgREST's embed silently dropped a row the applicant has no policy
-- letting them see. The applicant's dashboard rendered every department as
-- the fallback "Department" instead of "Bursary"/"Library".
--
-- Fixed by giving an applicant read access to a department the moment they
-- have a checklist item against it — never before, since there is nothing
-- for them to see until clearance has actually opened on their application.
-- =============================================================================

drop policy if exists "applicants read their own clearance departments" on classroom.clearance_departments;
create policy "applicants read their own clearance departments"
  on classroom.clearance_departments for select to authenticated
  using (
    exists (
      select 1 from classroom.clearance_checklists c
      where c.department_id = clearance_departments.id
        and classroom.is_applicant_for(c.application_id)
    )
  );

notify pgrst, 'reload schema';
