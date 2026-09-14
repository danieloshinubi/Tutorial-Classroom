-- =============================================================================
-- Scope four more admissions RPCs to the caller's current school
--
-- verify_application_payment, verify_acceptance_payment, set_document_status
-- and request_application_correction all load a row by id and authorize via
-- has_role_in(row's real school_id, ...) — correct for THAT row's school,
-- but blind to which tenant the caller currently has open. Staff active at
-- more than one school could act on a DIFFERENT one of their schools'
-- payments/documents/corrections while believing they were on the current
-- tenant, if a stale id ever reached the client. Each function gains a
-- required target_school parameter checked immediately after the row loads.
-- =============================================================================

drop function if exists classroom.verify_application_payment(uuid, text);

create or replace function classroom.verify_application_payment(
  target_payment uuid,
  target_school  uuid,
  note_in        text default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  pay classroom.payments;
  inv classroom.invoices;
  app classroom.applications;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  select * into inv from classroom.invoices where id = pay.invoice_id;
  if not found or inv.purpose <> 'application_fee' or inv.application_id is null then
    raise exception 'Not an application-fee payment';
  end if;

  if inv.school_id <> target_school then
    raise exception 'This payment does not belong to the current school';
  end if;

  if not classroom.has_role_in(
    inv.school_id, array['owner','admin','principal','admissions','bursar']::classroom.member_role[]
  ) then
    raise exception 'Only admissions or finance staff can verify payments';
  end if;

  if pay.submitted_by is not null and pay.submitted_by = auth.uid() then
    raise exception 'You submitted this payment; somebody else must verify it';
  end if;

  update classroom.payments
  set status = 'approved', decided_by = auth.uid(),
      decided_at = now(), decision_note = note_in
  where id = target_payment;

  update classroom.applications
  set payment_state = 'verified', updated_at = now()
  where id = inv.application_id
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(),
     coalesce((select first_name || ' ' || surname from classroom.profiles where id = auth.uid()), 'Officer'),
     'Application-fee payment verified');

  return app;
end;
$fn$;

grant execute on function classroom.verify_application_payment(uuid, uuid, text) to authenticated;

drop function if exists classroom.verify_acceptance_payment(uuid, text);

create or replace function classroom.verify_acceptance_payment(
  target_payment uuid,
  target_school  uuid,
  note_in        text default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  pay classroom.payments;
  inv classroom.invoices;
  app classroom.applications;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  select * into inv from classroom.invoices where id = pay.invoice_id;
  if not found or inv.purpose <> 'acceptance_fee' or inv.application_id is null then
    raise exception 'Not an acceptance-fee payment';
  end if;

  if inv.school_id <> target_school then
    raise exception 'This payment does not belong to the current school';
  end if;

  if not classroom.has_role_in(
    inv.school_id, array['owner','admin','principal','admissions','bursar']::classroom.member_role[]
  ) then
    raise exception 'Only admissions or finance staff can verify payments';
  end if;

  if pay.submitted_by is not null and pay.submitted_by = auth.uid() then
    raise exception 'You submitted this payment; somebody else must verify it';
  end if;

  update classroom.payments
  set status = 'approved', decided_by = auth.uid(),
      decided_at = now(), decision_note = note_in
  where id = target_payment;

  update classroom.applications
  set payment_state = 'verified', updated_at = now()
  where id = inv.application_id
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(),
     classroom.admissions_actor_label(),
     'Acceptance-fee payment verified');

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select ac.user_id, app.school_id, 'admission_payment_verified',
         format('%s: acceptance fee received', app.reference),
         'Your acceptance fee has been confirmed.',
         format('/Applications/%s', app.id)
  from classroom.applicant_accounts ac
  where ac.id = app.applicant_id;

  return app;
end;
$fn$;

grant execute on function classroom.verify_acceptance_payment(uuid, uuid, text) to authenticated;

drop function if exists classroom.set_document_status(uuid, text, text);

create or replace function classroom.set_document_status(
  target_doc     uuid,
  new_status     text,
  target_school  uuid,
  note_in        text default null
) returns classroom.applicant_documents
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  doc classroom.applicant_documents;
  app classroom.applications;
  is_applicant boolean;
  is_staff     boolean;
begin
  select * into doc from classroom.applicant_documents where id = target_doc;
  if not found then
    raise exception 'No such document';
  end if;

  select * into app from classroom.applications where id = doc.application_id;

  if app.school_id <> target_school then
    raise exception 'This document does not belong to the current school';
  end if;

  is_applicant := classroom.is_applicant_for(app.id);
  is_staff := classroom.has_role_in(
    app.school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  );

  if not (is_applicant or is_staff) then
    raise exception 'You cannot change this document';
  end if;

  if is_applicant and not is_staff then
    if new_status not in ('uploaded') then
      raise exception 'Applicants may only upload — verification is done by staff';
    end if;
    if doc.status not in ('not_uploaded','rejected','resubmission_required') then
      raise exception 'This document is already %', doc.status;
    end if;
  end if;

  update classroom.applicant_documents
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(note_in, decision_note),
      updated_at = now()
  where id = target_doc
  returning * into doc;

  -- Documents_state on the application follows the aggregate.
  update classroom.applications a
  set documents_state = case
    when not exists (
      select 1 from classroom.applicant_documents d
      join classroom.document_requirements r on r.id = d.requirement_id
      where d.application_id = a.id and r.is_required
        and d.status not in ('verified','waived')
    ) then 'complete'
    when exists (
      select 1 from classroom.applicant_documents d
      where d.application_id = a.id and d.status = 'rejected'
    ) then 'rejected'
    else 'partial'
    end,
    updated_at = now()
  where a.id = doc.application_id;

  return doc;
end;
$fn$;

grant execute on function classroom.set_document_status(uuid, text, uuid, text) to authenticated;

drop function if exists classroom.request_application_correction(uuid, text[], text);

create or replace function classroom.request_application_correction(
  target_application uuid,
  sections_in        text[],
  reason_in          text,
  caller_school      uuid
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  actor_name text;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  if app.school_id is distinct from caller_school then
    raise exception 'Application does not belong to this school';
  end if;

  if not classroom.has_role_in(
    app.school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  ) then
    raise exception 'Only admissions staff can request a correction';
  end if;

  if btrim(coalesce(reason_in, '')) = '' then
    raise exception 'Give the applicant a reason — otherwise they will not know what to fix';
  end if;

  if array_length(sections_in, 1) is null then
    raise exception 'Name at least one section that needs correcting';
  end if;

  if app.form_state <> 'submitted' and app.form_state <> 'resubmitted' then
    raise exception 'Corrections can only be requested on a submitted application';
  end if;

  update classroom.applications
  set form_state             = 'action_required',
      correction_reason      = reason_in,
      correction_sections    = sections_in,
      correction_requested_by = auth.uid(),
      correction_requested_at = now(),
      updated_at             = now()
  where id = target_application
  returning * into app;

  select coalesce(nullif(btrim(first_name || ' ' || surname), ''), username, email, 'Officer')
  into actor_name
  from classroom.profiles where id = auth.uid();

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), actor_name,
     format('Correction requested (%s): %s',
            array_to_string(sections_in, ', '),
            reason_in));

  -- Notify the applicant.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select ac.user_id, app.school_id, 'admission_action_required',
         format('Action needed on %s', app.reference),
         reason_in,
         format('/Applications/%s', app.id)
  from classroom.applicant_accounts ac
  where ac.id = app.applicant_id;

  return app;
end;
$fn$;

grant execute on function classroom.request_application_correction(uuid, text[], text, uuid) to authenticated;

notify pgrst, 'reload schema';
