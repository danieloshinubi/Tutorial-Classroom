-- =============================================================================
-- Fix verify_document() / reject_document() / waive_document(): each builds
-- its application_events note with
--   (select coalesce(label, kind) from classroom.applicant_documents where id = target_doc)
-- but classroom.applicant_documents has neither a `label` nor a `kind`
-- column — those live on classroom.document_requirements (joined via
-- applicant_documents.requirement_id) and classroom.application_documents
-- (joined via applicant_documents.document_id). That subquery has raised
-- "column \"label\" does not exist" on every call since 099 introduced it,
-- and because it runs inside the same INSERT as the rest of the function's
-- work, Postgres rolled back the whole transaction on every attempt — the
-- preceding UPDATE that actually marks the document verified/rejected/
-- waived never survived either. Staff clicking Verify/Reject/Waive have
-- been getting an error with no effect at all, not just a cosmetic one.
-- =============================================================================

create or replace function classroom.verify_document(
  target_doc     uuid,
  target_school  uuid,
  note_in        text default null
) returns classroom.applicant_documents
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  doc classroom.applicant_documents;
  app classroom.applications;
begin
  select * into doc from classroom.applicant_documents where id = target_doc;
  if not found then
    raise exception 'No such document';
  end if;
  select * into app from classroom.applications where id = doc.application_id;

  if app.school_id <> target_school then
    raise exception 'Document does not belong to the current school';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can verify a document';
  end if;
  if doc.document_id is null then
    raise exception 'Cannot verify a document that has not been uploaded';
  end if;
  if doc.status = 'verified' then
    return doc;
  end if;

  update classroom.applicant_documents
  set status = 'verified',
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(note_in, decision_note),
      updated_at = now()
  where id = target_doc
  returning * into doc;

  perform classroom.refresh_documents_state(app.id);

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Document verified: %s%s',
       (select coalesce(dr.label, dr.kind, ad.kind, 'Document')
        from classroom.applicant_documents adoc
        left join classroom.document_requirements dr on dr.id = adoc.requirement_id
        left join classroom.application_documents ad on ad.id = adoc.document_id
        where adoc.id = target_doc),
       case when note_in is not null then ' — ' || note_in else '' end));

  return doc;
end;
$fn$;

grant execute on function classroom.verify_document(uuid, uuid, text) to authenticated;

create or replace function classroom.reject_document(
  target_doc    uuid,
  reason_in     text,
  target_school uuid
) returns classroom.applicant_documents
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  doc classroom.applicant_documents;
  app classroom.applications;
begin
  if btrim(coalesce(reason_in, '')) = '' then
    raise exception 'A rejection reason is required';
  end if;

  select * into doc from classroom.applicant_documents where id = target_doc;
  if not found then
    raise exception 'No such document';
  end if;
  select * into app from classroom.applications where id = doc.application_id;

  if app.school_id is distinct from target_school then
    raise exception 'Document does not belong to the current school';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can reject a document';
  end if;

  update classroom.applicant_documents
  set status = 'rejected',
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = reason_in,
      updated_at = now()
  where id = target_doc
  returning * into doc;

  perform classroom.refresh_documents_state(app.id);

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Document rejected: %s — %s',
       (select coalesce(dr.label, dr.kind, ad.kind, 'Document')
        from classroom.applicant_documents adoc
        left join classroom.document_requirements dr on dr.id = adoc.requirement_id
        left join classroom.application_documents ad on ad.id = adoc.document_id
        where adoc.id = target_doc),
       reason_in));

  -- Notify the applicant.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select ac.user_id, app.school_id, 'document_rejected',
         format('%s: a document needs attention', app.reference),
         reason_in,
         format('/Applications/%s', app.id)
  from classroom.applicant_accounts ac
  where ac.id = app.applicant_id;

  return doc;
end;
$fn$;

grant execute on function classroom.reject_document(uuid, text, uuid) to authenticated;

create or replace function classroom.waive_document(
  target_doc    uuid,
  target_school uuid,
  reason_in     text
) returns classroom.applicant_documents
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  doc classroom.applicant_documents;
  app classroom.applications;
begin
  if btrim(coalesce(reason_in, '')) = '' then
    raise exception 'A waiver reason is required';
  end if;

  select * into doc from classroom.applicant_documents where id = target_doc;
  if not found then
    raise exception 'No such document';
  end if;
  select * into app from classroom.applications where id = doc.application_id;

  if app.school_id <> target_school then
    raise exception 'Document does not belong to this school';
  end if;

  if not classroom.has_role_in(app.school_id, array['owner','admin','principal']::classroom.member_role[]) then
    raise exception 'Only admin/principal can waive a document';
  end if;

  update classroom.applicant_documents
  set status = 'waived',
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = reason_in,
      updated_at = now()
  where id = target_doc
  returning * into doc;

  perform classroom.refresh_documents_state(app.id);

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Document waived: %s — %s',
       (select coalesce(dr.label, dr.kind, ad.kind, 'Document')
        from classroom.applicant_documents adoc
        left join classroom.document_requirements dr on dr.id = adoc.requirement_id
        left join classroom.application_documents ad on ad.id = adoc.document_id
        where adoc.id = target_doc),
       reason_in));

  return doc;
end;
$fn$;

grant execute on function classroom.waive_document(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
