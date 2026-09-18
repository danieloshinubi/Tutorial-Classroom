-- =============================================================================
-- Lets a tenant admin write their own wording for the admission letter's
-- intro paragraph (offer vs. enrolment differ) and closing line, with merge
-- tags filled in from the actual application. The facts table, the offer-
-- expiry/fees notices and the signature block stay as-is either way — those
-- carry operational information, not house style — so a school that writes
-- nothing keeps getting exactly the default Schoolivio letter AdmissionLetter
-- .jsx already renders. Same nullable-text-on-schools shape as 132's
-- signature_url/signatory_name/signatory_title right next to it.
-- =============================================================================

alter table classroom.schools
  add column if not exists admission_letter_offer_intro    text,
  add column if not exists admission_letter_enrolled_intro text,
  add column if not exists admission_letter_closing        text;

-- Re-declared with the three new fields added to the schools object, plus
-- signature_url/signatory_name/signatory_title which 133's first version
-- already carried — no change to those, just growing the same jsonb_build_object.
create or replace function classroom.my_application_letter(target_application uuid)
returns jsonb
language plpgsql stable security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'Not your application';
  end if;

  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  if app.status not in ('offered', 'accepted', 'enrolled') then
    raise exception 'No admission letter is available yet';
  end if;

  return jsonb_build_object(
    'id', app.id,
    'school_id', app.school_id,
    'reference', app.reference,
    'first_name', app.first_name,
    'surname', app.surname,
    'middle_name', app.middle_name,
    'date_of_birth', app.date_of_birth,
    'gender', app.gender,
    'guardian_name', app.guardian_name,
    'guardian_email', app.guardian_email,
    'status', app.status,
    'offer_expires_at', app.offer_expires_at,
    'decided_at', app.decided_at,
    'created_at', app.created_at,
    'class_id', app.class_id,
    'sessions', (select to_jsonb(s) from classroom.sessions s where s.id = app.session_id),
    'classes', (select to_jsonb(c) from classroom.classes c where c.id = app.class_id),
    'schools', (
      select jsonb_build_object(
        'id', sc.id, 'name', sc.name, 'slug', sc.slug, 'logo_url', sc.logo_url,
        'address', sc.address, 'phone', sc.phone, 'email', sc.email,
        'signature_url', sc.signature_url, 'signatory_name', sc.signatory_name,
        'signatory_title', sc.signatory_title,
        'admission_letter_offer_intro', sc.admission_letter_offer_intro,
        'admission_letter_enrolled_intro', sc.admission_letter_enrolled_intro,
        'admission_letter_closing', sc.admission_letter_closing
      )
      from classroom.schools sc where sc.id = app.school_id
    ),
    'registration_number', (
      select r.registration_number from classroom.student_registrations r
      where r.application_id = app.id
    )
  );
end;
$fn$;

notify pgrst, 'reload schema';
