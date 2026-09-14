-- 106 deliberately left personal_info.email blank on claim, reasoning that
-- the anonymous form's guardian_email might belong to a parent rather than
-- the applicant. On reflection that's the wrong call for email specifically
-- (unlike phone, which stays excluded): the email being claimed WITH is, by
-- construction, the same address the applicant is right now proving they
-- can access — it's exactly as much "theirs" as the account they're
-- creating. Leaving it blank just means retyping something already in
-- hand, the same annoyance every other field in this prefill exists to
-- avoid.
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
  set applicant_id  = acct.id,
      personal_info = coalesce(personal_info, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'first_name',    app.first_name,
        'middle_name',   app.middle_name,
        'surname',       app.surname,
        'date_of_birth', app.date_of_birth,
        'gender',        app.gender,
        'address',       app.address,
        'email',         lower(btrim(target_email))
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
