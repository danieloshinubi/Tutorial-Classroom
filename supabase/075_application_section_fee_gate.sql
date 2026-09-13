-- =============================================================================
-- The application form must actually lock until the fee is paid
--
-- ApplicationDashboard.jsx already tells an applicant "Complete the fee
-- before the form is unlocked. You can still see the sections but cannot
-- edit them." — but classroom.save_application_section (040_admissions_engine.sql)
-- never checked payment_state at all. Only classroom.submit_my_application
-- gated on the fee, at the very end. Between starting an application and
-- submitting it, every section could be filled in and saved regardless of
-- an unpaid, unverified fee — the UI's own claim was not enforced by the
-- database it depends on.
--
-- This adds the exact same fee gate submit_my_application already uses
-- (same config keys, same default), so the form is locked at the point the
-- applicant is actually told it is, not just at the final submit.
--
-- Run after 040. Safe to re-run.
-- =============================================================================

create or replace function classroom.save_application_section(
  target_application uuid, section_name text, payload jsonb
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  cfg jsonb;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot edit this application';
  end if;

  select * into app from classroom.applications where id = target_application;
  if app.form_state not in ('draft','in_progress','ready_to_submit') then
    raise exception 'This application is closed for editing (%).', app.form_state;
  end if;

  cfg := classroom.effective_admission_config(app.school_id, app.session_id);
  if coalesce((cfg->>'application_fee_enabled')::boolean, false)
     and coalesce((cfg->>'form_locked_until_paid')::boolean, true)
     and app.payment_state <> 'verified' then
    raise exception 'The application fee must be verified before the form unlocks';
  end if;

  update classroom.applications
  set personal_info     = case when section_name='personal'  then payload else personal_info     end,
      education_history = case when section_name='education' then payload else education_history end,
      exam_results       = case when section_name='exams'     then payload else exam_results      end,
      next_of_kin        = case when section_name='next_of_kin' then payload else next_of_kin     end,
      referees           = case when section_name='referees'  then payload else referees          end,
      form_state = case when form_state = 'draft' then 'in_progress' else form_state end,
      updated_at = now()
  where id = target_application
  returning * into app;

  return app;
end;
$fn$;

notify pgrst, 'reload schema';
