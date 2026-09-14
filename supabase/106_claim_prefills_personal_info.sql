-- claim_application() only ever set applicant_id — the application's
-- "Personal information" section (personal_info jsonb) stayed exactly as
-- blank as a brand-new accounted application's, even though the anonymous
-- /Apply form the applicant used already collected first/middle/surname,
-- date of birth, gender and address as plain columns on the row. Re-asking
-- for those specific fields right after claiming is the same "make them
-- retype it" problem the name-prefill on /Apply/Claim's signup form just
-- fixed, one step further into the flow.
--
-- Deliberately NOT carried over: phone/email. The anonymous form only ever
-- captured guardian_phone/guardian_email — a parent's, not necessarily the
-- applicant's own — and personal_info's phone/email fields are asked as the
-- applicant's own. Prefilling those from the wrong person's contact details
-- would be worse than leaving them blank.
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
        'address',       app.address
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
