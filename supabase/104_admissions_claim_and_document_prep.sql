-- =============================================================================
-- Closes two gaps in the admissions correction flow:
--
-- 1. An applicant who applied through the public form (no account) has no
--    way to ever see a correction request or act on it. request_application_
--    correction() already sets form_state/correction_reason/correction_
--    sections, but track_application() — the only page such an applicant
--    can reach — never selected them, and its notification insert silently
--    matches zero rows because applications.applicant_id is null for these.
--    claim_application() lets that applicant sign in (or create an account)
--    and link their existing application by the same reference+email pair
--    the public status page already asks for — no weaker a check than that
--    page already relies on. Once linked, they get the exact same
--    my_applications()/application dashboard flow an accounted applicant
--    already has (edit flagged sections, resubmit).
--
-- 2. Documents have a full status workflow (applicant_documents, verify/
--    reject/waive, set_document_status already lets an applicant flip a
--    document to 'uploaded') but nothing has ever populated
--    applicant_documents from document_requirements for an application —
--    screening has create_application_screening_items() for exactly this;
--    documents never got the equivalent. create_application_document_items()
--    is that missing counterpart, and record_applicant_document_upload()
--    is the missing "register what I just uploaded to storage" step —
--    application_documents' only other insert path is submit_application(),
--    which only ever runs pre-submission.
-- =============================================================================

drop function if exists classroom.track_application(text, text);

create or replace function classroom.track_application(target_reference text, target_email text)
returns table (
  reference text, status classroom.application_status, applicant text,
  school_name text, session_name text, submitted_at timestamptz,
  decided_at timestamptz, offer_expires_at timestamptz,
  form_state text, correction_reason text, correction_sections text[]
)
language sql stable security definer set search_path = classroom, public
as $fn$
  select a.reference, a.status, btrim(a.first_name || ' ' || a.surname), s.name, sess.name,
         a.created_at, a.decided_at, a.offer_expires_at,
         a.form_state, a.correction_reason, a.correction_sections
  from classroom.applications a
  join classroom.schools s on s.id = a.school_id
  left join classroom.sessions sess on sess.id = a.session_id
  where upper(btrim(a.reference)) = upper(btrim(target_reference))
    and lower(a.guardian_email) = lower(btrim(target_email));
$fn$;

grant execute on function classroom.track_application(text, text) to anon, authenticated;


-- Links an unclaimed application (applicant_id is null — always the
-- anonymous /Apply form's case, since the accounted flow's start_application
-- sets it immediately) to the signed-in caller's applicant account for that
-- school, creating that account from the application's own on-file details
-- if they don't have one yet. Refuses to steal an application someone else
-- already claimed; claiming the same one twice from the same account is a
-- harmless no-op, since a person double-checking or re-following the same
-- link shouldn't see an error.
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
  set applicant_id = acct.id, updated_at = now()
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


-- The documents counterpart to create_application_screening_items()
-- (048_admissions_phase2_functions.sql / most recently 098). Same shape,
-- same idempotent not-exists guard, same session/programme matching rule.
create or replace function classroom.create_application_document_items(
  target_application uuid,
  target_school      uuid
) returns setof classroom.applicant_documents
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if app.school_id <> target_school then
    raise exception 'Application does not belong to this school';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can prepare document items';
  end if;

  insert into classroom.applicant_documents (application_id, requirement_id, status)
  select
    target_application, r.id, 'not_uploaded'
  from classroom.document_requirements r
  where r.school_id = app.school_id
    and (r.session_id is null   or r.session_id   = app.session_id)
    and (r.programme_id is null or r.programme_id = app.programme_id)
    and not exists (
      select 1 from classroom.applicant_documents d
      where d.application_id = target_application and d.requirement_id = r.id
    );

  return query
    select * from classroom.applicant_documents
    where application_id = target_application
    order by created_at;
end;
$fn$;

grant execute on function classroom.create_application_document_items(uuid, uuid) to authenticated;


-- The applicant's own read of their document checklist — application_
-- workspace()'s "documents" shape, minus the staff-only gate, so
-- ApplicationDashboard.jsx can render identical data to what staff see.
create or replace function classroom.my_application_documents(target_application uuid)
returns jsonb
language plpgsql stable security definer
set search_path = classroom, public
as $fn$
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'Not your application';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id,
             'requirement_id', d.requirement_id,
             'status', d.status,
             'decision_note', d.decision_note,
             'decided_at', d.decided_at,
             'requirement', to_jsonb(r),
             'file', to_jsonb(af)
           ) order by r.position, r.label)
    from classroom.applicant_documents d
    left join classroom.document_requirements r on r.id = d.requirement_id
    left join classroom.application_documents af on af.id = d.document_id
    where d.application_id = target_application
  ), '[]'::jsonb);
end;
$fn$;

grant execute on function classroom.my_application_documents(uuid) to authenticated;


-- Registers a file the applicant already uploaded to storage (the same
-- admissions/<school_id>/<application_id>/... path and bucket policy the
-- anonymous pre-submission form uses — see 051 — reused here since it
-- already permits any signed-in write under an active school's prefix) and
-- links it to their own checklist entry. application_documents has no
-- direct-insert policy for anyone (submit_application() is its only other
-- writer), so this has to be the write path, not a plain client insert.
create or replace function classroom.record_applicant_document_upload(
  target_school      uuid,
  target_application uuid,
  target_requirement uuid,
  file_path_in       text,
  file_name_in       text,
  file_size_in       bigint,
  mime_type_in       text,
  kind_in            text default 'other'
) returns classroom.applicant_documents
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app     classroom.applications;
  item    classroom.applicant_documents;
  new_doc uuid;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if app.school_id <> target_school then
    raise exception 'Application does not belong to this school';
  end if;
  if not classroom.is_applicant_for(target_application) then
    raise exception 'Only the applicant can upload their own documents';
  end if;

  select * into item from classroom.applicant_documents
  where id = target_requirement and application_id = target_application;
  if not found then
    raise exception 'No such document on this application';
  end if;
  if item.status not in ('not_uploaded', 'rejected', 'resubmission_required') then
    raise exception 'This document is already %', item.status;
  end if;

  if file_path_in !~ ('^admissions/' || target_school::text || '/') then
    raise exception 'That file was not uploaded to this school''s folder';
  end if;

  insert into classroom.application_documents
    (application_id, kind, file_path, file_name, file_size, mime_type)
  values
    (target_application, coalesce(nullif(btrim(kind_in), ''), 'other'),
     file_path_in, file_name_in, file_size_in, mime_type_in)
  returning id into new_doc;

  update classroom.applicant_documents
  set document_id   = new_doc,
      status        = 'uploaded',
      decided_by    = null,
      decided_at    = null,
      decision_note = null,
      updated_at    = now()
  where id = target_requirement
  returning * into item;

  update classroom.applications a
  set documents_state = case
    when not exists (
      select 1 from classroom.applicant_documents d
      join classroom.document_requirements r on r.id = d.requirement_id
      where d.application_id = a.id and r.is_required
        and d.status not in ('verified', 'waived')
    ) then 'complete'
    when exists (
      select 1 from classroom.applicant_documents d
      where d.application_id = a.id and d.status = 'rejected'
    ) then 'rejected'
    else 'partial'
    end,
    updated_at = now()
  where a.id = target_application;

  return item;
end;
$fn$;

grant execute on function classroom.record_applicant_document_upload(uuid, uuid, uuid, text, text, bigint, text, text) to authenticated;
