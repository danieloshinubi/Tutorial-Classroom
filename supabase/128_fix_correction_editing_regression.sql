-- =============================================================================
-- save_application_section() regression: 075_application_section_fee_gate.sql
-- rewrote this function to add the fee-lock check, but in doing so silently
-- reverted the form_state branch all the way back to 040's original,
-- simplest form — "editable only in draft/in_progress/ready_to_submit,
-- closed otherwise" — dropping 041_admissions_refinements.sql's own fix:
-- form_state = 'action_required' should still allow writes, but only to
-- the sections actually named in correction_sections. Since 075, an
-- applicant asked to fix a specific section (via "Request correction") has
-- been unable to touch ANY section at all — the exact error surfaced as
-- "This application is closed for editing (action_required)" the moment
-- they try to edit the very thing they were asked to fix. Restored here,
-- alongside 075's fee gate (kept) and 041's application_events entry on
-- save (also dropped by 075, restored here too).
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

  if app.form_state in ('draft','in_progress','ready_to_submit') then
    null;
  elsif app.form_state = 'action_required' then
    if not (section_name = any(coalesce(app.correction_sections, array[]::text[]))) then
      raise exception 'This section is not part of the requested correction';
    end if;
  else
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

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), 'Applicant',
     format('Section saved: %s', section_name));

  return app;
end;
$fn$;

notify pgrst, 'reload schema';
