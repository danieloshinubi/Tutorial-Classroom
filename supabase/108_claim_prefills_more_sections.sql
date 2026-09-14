-- A fuller pass over claim_application()'s prefill, after 106/107 only
-- covered personal_info: everything the anonymous form actually asked for
-- should carry over, not just the fields that happened to get picked the
-- first two times.
--
--   - personal_info.phone now comes from guardian_phone too — the same
--     "this address is already proven, not new information" logic 107
--     applied to email applies here.
--   - education_history.school_name comes from previous_school, the one
--     education-history-shaped field the anonymous form actually has.
--   - next_of_kin.* comes from guardian_name/guardian_relation/
--     guardian_phone/guardian_email/address — "guardian" on the anonymous
--     form and "next of kin" on the accounted one are the same concept
--     under two different names; the form never asked this question twice,
--     it just renamed it later.
--
-- Still deliberately NOT touched: education_history.country/start_year/
-- end_year/qualification and exam_results/referees — the anonymous form
-- never collected any of that, so there's nothing on the row to carry over.
create or replace function classroom.claim_application(
  target_reference text,
  target_email     text
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app  classroom.applications;
  acct classroom.applicant_accounts;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to claim an application';
  end if;

  select * into app from classroom.applications
  where upper(btrim(reference)) = upper(btrim(target_reference))
    and lower(guardian_email) = lower(btrim(target_email));
  if not found then
    raise exception 'That reference and email do not go together';
  end if;

  if app.applicant_id is not null then
    select * into acct from classroom.applicant_accounts where id = app.applicant_id;
    if found and acct.user_id = auth.uid() then
      return app;
    end if;
    raise exception 'This application is already linked to an account. Sign in with that account, or contact the school.';
  end if;

  select * into acct from classroom.applicant_accounts
  where school_id = app.school_id and user_id = auth.uid();
  if not found then
    insert into classroom.applicant_accounts
      (school_id, user_id, email, phone, first_name, surname)
    values
      (app.school_id, auth.uid(), lower(btrim(target_email)), app.guardian_phone,
       app.first_name, app.surname)
    returning * into acct;
  end if;

  update classroom.applications
  set applicant_id     = acct.id,
      personal_info    = coalesce(personal_info, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'first_name',    app.first_name,
        'middle_name',   app.middle_name,
        'surname',       app.surname,
        'date_of_birth', app.date_of_birth,
        'gender',        app.gender,
        'address',       app.address,
        'email',         lower(btrim(target_email)),
        'phone',         app.guardian_phone
      )),
      education_history = coalesce(education_history, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'school_name', app.previous_school
      )),
      next_of_kin      = coalesce(next_of_kin, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'name',         app.guardian_name,
        'relationship', app.guardian_relation,
        'phone',        app.guardian_phone,
        'email',        app.guardian_email,
        'address',      app.address
      )),
      updated_at = now()
  where id = app.id
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), 'Applicant', 'Application claimed and linked to an account');

  return app;
end;
$fn$;

grant execute on function classroom.claim_application(text, text) to authenticated;
