-- =============================================================================
-- The admission letter only ever existed on the staff side (AdmissionsWorkspace
-- "Admission letter" button → fetchApplication(), staff-only via school_id
-- RLS) — confirmed live: an applicant whose application is 'accepted' has no
-- way to see the letter at all, even though staff can open and print it any
-- time. Same shape as my_application_documents()/my_application_screening():
-- a security-definer RPC gated on is_applicant_for(), returning the same
-- joined shape fetchApplication() gives staff so AdmissionLetter.jsx (already
-- a pure presentational component — no staff-only logic baked in) can be
-- reused as-is on the applicant side.
-- =============================================================================

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
        'signatory_title', sc.signatory_title
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

grant execute on function classroom.my_application_letter(uuid) to authenticated;

notify pgrst, 'reload schema';
