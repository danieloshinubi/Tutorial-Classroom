-- =============================================================================
-- Admissions engine — Phase 2 functions
--
-- Every state transition. Each function:
--   * runs SECURITY DEFINER with search_path pinned
--   * checks the caller's role or ownership
--   * checks the state guards spelled out in the architecture doc
--   * writes an application_events row only on real transitions
--   * fans out notifications where appropriate
--
-- Nothing here trusts the client — the state machines cannot be moved by an
-- UPDATE from a browser. UPDATE policies on the state columns are absent by
-- design.
-- =============================================================================


/* =============================================================================
   0. Role helpers
   ============================================================================= */

-- Final decision maker: owner, admin, principal. Kept separate from
-- can_do_admissions so screening and review can be done by an officer, but
-- the final act is a proprietor-level one.
create or replace function classroom.can_finalise_admission(target_school uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select classroom.has_role_in(
    target_school,
    array['owner','admin','principal']::classroom.member_role[]
  );
$fn$;

grant execute on function classroom.can_finalise_admission(uuid) to authenticated;


-- Actor label the way decide_application already builds it: real name if
-- present, otherwise username, otherwise email. Used by every event insert.
create or replace function classroom.admissions_actor_label()
returns text
language sql stable security definer
set search_path = classroom, public
as $fn$
  select coalesce(
    nullif(btrim(p.first_name || ' ' || p.surname), ''),
    p.username,
    p.email,
    'Officer'
  ) from classroom.profiles p where p.id = auth.uid();
$fn$;

grant execute on function classroom.admissions_actor_label() to authenticated;


/* =============================================================================
   1. Screening
   ============================================================================= */

-- Instantiate items on this application from the effective config: any
-- screening_requirements row that matches this application's school and
-- (session or default) and (programme or default). Idempotent: called
-- repeatedly, it only inserts the ones that don't already exist.
create or replace function classroom.create_application_screening_items(
  target_application uuid
) returns setof classroom.application_screening_items
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
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can prepare screening items';
  end if;

  insert into classroom.application_screening_items
    (application_id, requirement_id, kind, label, is_required, position)
  select
    target_application, r.id, r.kind, r.label, r.is_required, r.position
  from classroom.screening_requirements r
  where r.school_id = app.school_id
    and (r.session_id is null   or r.session_id   = app.session_id)
    and (r.programme_id is null or r.programme_id = app.programme_id)
    and not exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = target_application and i.kind = r.kind
    );

  return query
    select * from classroom.application_screening_items
    where application_id = target_application
    order by position, label;
end;
$fn$;

grant execute on function classroom.create_application_screening_items(uuid) to authenticated;


-- Move one screening item. Refresh screening_state on the parent based on
-- the aggregate.
create or replace function classroom.set_screening_item_status(
  target_item uuid,
  new_status  text,
  note_in     text default null
) returns classroom.application_screening_items
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  item classroom.application_screening_items;
  app  classroom.applications;
  was  text;
  new_screening_state text;
begin
  select * into item from classroom.application_screening_items where id = target_item;
  if not found then
    raise exception 'No such screening item';
  end if;
  select * into app from classroom.applications where id = item.application_id;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can move a screening item';
  end if;

  if new_status not in ('pending','passed','failed','waived','correction_required') then
    raise exception 'Unknown screening status: %', new_status;
  end if;

  if new_status = 'failed' and btrim(coalesce(note_in, '')) = '' then
    raise exception 'A failed screening item must carry a reason';
  end if;
  if new_status = 'correction_required' and btrim(coalesce(note_in, '')) = '' then
    raise exception 'A correction request must carry a reason';
  end if;

  was := item.status;

  if was = new_status then
    return item;
  end if;

  update classroom.application_screening_items
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(note_in, decision_note),
      updated_at = now()
  where id = target_item
  returning * into item;

  -- Aggregate state.
  new_screening_state := case
    when exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.is_required
        and i.status not in ('passed','waived')
    ) and exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.status = 'failed'
    ) then 'failed'
    when exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.status = 'correction_required'
    ) then 'correction_required'
    when not exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = app.id and i.is_required
        and i.status not in ('passed','waived')
    ) then 'passed'
    else 'in_progress'
  end;

  update classroom.applications
  set screening_state = new_screening_state,
      screening_completed_at = case
        when new_screening_state in ('passed','failed') then now()
        else null
      end,
      updated_at = now()
  where id = app.id;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Screening item %s → %s%s', item.kind, new_status,
            case when note_in is not null then ' — ' || note_in else '' end));

  return item;
end;
$fn$;

grant execute on function classroom.set_screening_item_status(uuid, text, text) to authenticated;


/* =============================================================================
   2. Documents — verify / reject / waive
   ============================================================================= */

create or replace function classroom.verify_document(
  target_doc uuid,
  note_in    text default null
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
       (select coalesce(label, kind) from classroom.applicant_documents where id = target_doc),
       case when note_in is not null then ' — ' || note_in else '' end));

  return doc;
end;
$fn$;

grant execute on function classroom.verify_document(uuid, text) to authenticated;


create or replace function classroom.reject_document(
  target_doc uuid,
  reason_in  text
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
       (select coalesce(label, kind) from classroom.applicant_documents where id = target_doc),
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

grant execute on function classroom.reject_document(uuid, text) to authenticated;


create or replace function classroom.waive_document(
  target_doc uuid,
  reason_in  text
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
       (select coalesce(label, kind) from classroom.applicant_documents where id = target_doc),
       reason_in));

  return doc;
end;
$fn$;

grant execute on function classroom.waive_document(uuid, text) to authenticated;


-- Shared documents_state recompute used by verify/reject/waive above and
-- by the Phase 1 set_document_status. Kept as its own helper so the same
-- logic is not duplicated in five places.
create or replace function classroom.refresh_documents_state(target_application uuid)
returns void
language sql security definer
set search_path = classroom, public
as $fn$
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
  where a.id = target_application;
$fn$;


/* =============================================================================
   3. Review assignment and recording
   ============================================================================= */

create or replace function classroom.assign_review(
  target_application uuid,
  target_reviewer    uuid
) returns classroom.application_reviews
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app  classroom.applications;
  rev  classroom.application_reviews;
  reviewer_is_staff boolean;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can assign a review';
  end if;

  -- The reviewer must be a school member with admissions authority.
  select classroom.has_role_in(app.school_id, array['owner','admin','principal','admissions']::classroom.member_role[])
    from classroom.school_members m
   where m.user_id = target_reviewer and m.school_id = app.school_id and m.is_active
   limit 1
   into reviewer_is_staff;

  if not coalesce(reviewer_is_staff, false) then
    -- Fallback: check role directly on school_members
    if not exists (
      select 1 from classroom.school_members m
      where m.user_id = target_reviewer
        and m.school_id = app.school_id
        and m.is_active
        and m.role in ('owner','admin','principal','admissions')
    ) then
      raise exception 'The reviewer must be an admissions member of this school';
    end if;
  end if;

  -- Close any active review before re-assigning.
  update classroom.application_reviews
  set completed_at = now(), updated_at = now(),
      notes = coalesce(notes, '') || case when notes is null then '' else E'\n' end
              || '[Reassigned]'
  where application_id = target_application and completed_at is null;

  insert into classroom.application_reviews
    (application_id, reviewer_id, assigned_by, assigned_at)
  values (target_application, target_reviewer, auth.uid(), now())
  returning * into rev;

  update classroom.applications
  set review_state = 'assigned',
      assigned_reviewer_id = target_reviewer,
      updated_at = now()
  where id = target_application;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (target_application, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     'Review assigned');

  -- Notify the reviewer.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  values
    (target_reviewer, app.school_id, 'review_assigned',
     format('Review assigned: %s', app.reference),
     'Open the admissions workspace to record your recommendation.',
     format('/Admissions/%s', app.id));

  return rev;
end;
$fn$;

grant execute on function classroom.assign_review(uuid, uuid) to authenticated;


create or replace function classroom.record_review(
  target_application uuid,
  recommendation_in  text,
  notes_in           text default null,
  academic_score_in  numeric default null,
  interview_score_in numeric default null
) returns classroom.application_reviews
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  rev classroom.application_reviews;
begin
  if recommendation_in not in
     ('recommend_admit','recommend_reject','recommend_waitlist','recommend_correction','recommend_defer') then
    raise exception 'Unknown recommendation: %', recommendation_in;
  end if;

  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  select * into rev from classroom.application_reviews
  where application_id = target_application and completed_at is null
  order by assigned_at desc limit 1;
  if not found then
    raise exception 'No active review is assigned to this application';
  end if;

  if rev.reviewer_id <> auth.uid() then
    raise exception 'Only the assigned reviewer can record this recommendation';
  end if;

  update classroom.application_reviews
  set recommendation = recommendation_in,
      notes = coalesce(notes_in, notes),
      academic_score = coalesce(academic_score_in, academic_score),
      interview_score = coalesce(interview_score_in, interview_score),
      total_score = coalesce(academic_score_in, academic_score, 0)
                  + coalesce(interview_score_in, interview_score, 0),
      completed_at = now(),
      updated_at = now()
  where id = rev.id
  returning * into rev;

  update classroom.applications
  set review_state = 'completed',
      review_completed_at = now(),
      updated_at = now()
  where id = target_application;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (target_application, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Review completed: %s%s',
       recommendation_in,
       case when notes_in is not null then E'\n' || notes_in else '' end));

  -- Notify decision makers.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct m.user_id, app.school_id, 'review_completed',
         format('Review ready: %s', app.reference),
         format('Recommendation: %s', recommendation_in),
         format('/Admissions/%s', app.id)
  from classroom.school_members m
  where m.school_id = app.school_id and m.is_active
    and m.role in ('owner','admin','principal')
    and m.user_id <> auth.uid();

  return rev;
end;
$fn$;

grant execute on function classroom.record_review(uuid, text, text, numeric, numeric) to authenticated;


/* =============================================================================
   4. Interviews
   ============================================================================= */

create or replace function classroom.schedule_interview(
  target_application uuid,
  when_at            timestamptz,
  location_in        text default null,
  meeting_link_in    text default null,
  interviewer_in     uuid default null
) returns classroom.application_interviews
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  itv classroom.application_interviews;
  cfg jsonb;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can schedule an interview';
  end if;

  cfg := classroom.effective_admission_config(app.school_id, app.session_id);
  if not coalesce((cfg->>'require_interview')::boolean, false) then
    raise exception 'Interviews are not enabled for this session/programme';
  end if;

  if when_at < now() then
    raise exception 'The interview must be scheduled in the future';
  end if;

  insert into classroom.application_interviews
    (application_id, scheduled_at, location, meeting_link, interviewer_id, scheduled_by)
  values (target_application, when_at, location_in, meeting_link_in, interviewer_in, auth.uid())
  returning * into itv;

  update classroom.applications
  set interview_state = 'scheduled', updated_at = now()
  where id = target_application;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (target_application, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Interview scheduled for %s%s',
       to_char(when_at, 'DD Mon YYYY HH24:MI'),
       case when location_in is not null then ' at ' || location_in else '' end));

  -- Notify the applicant.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select ac.user_id, app.school_id, 'interview_scheduled',
         format('Interview scheduled: %s', app.reference),
         format('Your interview is scheduled for %s.', to_char(when_at, 'DD Mon YYYY HH24:MI')),
         format('/Applications/%s', app.id)
  from classroom.applicant_accounts ac
  where ac.id = app.applicant_id;

  return itv;
end;
$fn$;

grant execute on function classroom.schedule_interview(uuid, timestamptz, text, text, uuid) to authenticated;


create or replace function classroom.record_interview_outcome(
  target_interview uuid,
  new_status       text,
  outcome_in       text default null,
  notes_in         text default null
) returns classroom.application_interviews
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  itv classroom.application_interviews;
  app classroom.applications;
begin
  select * into itv from classroom.application_interviews where id = target_interview;
  if not found then
    raise exception 'No such interview';
  end if;
  select * into app from classroom.applications where id = itv.application_id;

  if not (classroom.can_do_admissions(app.school_id)
          or itv.interviewer_id = auth.uid()) then
    raise exception 'Only the interviewer or admissions staff can record the outcome';
  end if;

  if new_status not in ('completed','no_show','cancelled') then
    raise exception 'Unknown interview outcome: %', new_status;
  end if;

  if new_status = 'completed' and outcome_in is null then
    raise exception 'A completed interview needs an outcome (pass/fail/inconclusive)';
  end if;

  update classroom.application_interviews
  set status = new_status,
      outcome = outcome_in,
      notes = coalesce(notes_in, notes),
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now()
  where id = target_interview
  returning * into itv;

  update classroom.applications
  set interview_state = new_status, updated_at = now()
  where id = app.id;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Interview %s%s%s',
       new_status,
       case when outcome_in is not null then ' — ' || outcome_in else '' end,
       case when notes_in is not null then E'\n' || notes_in else '' end));

  return itv;
end;
$fn$;

grant execute on function classroom.record_interview_outcome(uuid, text, text, text) to authenticated;


/* =============================================================================
   5. Final decision — extend decide_application with Phase 2 guards
   ---------------------------------------------------------------------------
   The existing function stays, extended: only finalisers may call it, and
   the transition to offered/rejected/waitlisted/deferred is gated by the
   configured prerequisites. decision_state is populated alongside status.
   ============================================================================= */

create or replace function classroom.decide_application(
  target_application uuid,
  new_status         classroom.application_status,
  note               text default null,
  offer_expires      timestamptz default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app     classroom.applications;
  allowed classroom.application_status[];
  was     classroom.application_status;
  who     text;
  cfg     jsonb;
  new_decision_state text;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  -- Backwards-compatible transitions that don't require finaliser rights.
  -- These are the workflow moves an admissions officer already makes today:
  --   submitted → screening, screening → screening (no-op), withdrawn, etc.
  -- Everything that lands as an offer/rejection/waitlist/defer is a
  -- finaliser-only act.
  if new_status in ('offered','rejected','waitlisted','deferred','declined','accepted','enrolled') then
    if not classroom.can_finalise_admission(app.school_id) then
      raise exception 'Only owner/admin/principal can make the final admission decision';
    end if;
  else
    if not classroom.can_do_admissions(app.school_id) then
      raise exception 'Only admissions staff can move this application';
    end if;
  end if;

  was := app.status;

  allowed := case was
    when 'submitted'  then array['screening','under_review','offered','rejected','waitlisted','deferred','withdrawn']::classroom.application_status[]
    when 'screening'  then array['under_review','offered','rejected','waitlisted','deferred','withdrawn']::classroom.application_status[]
    when 'under_review' then array['offered','rejected','waitlisted','deferred','withdrawn']::classroom.application_status[]
    when 'waitlisted' then array['offered','rejected','withdrawn']::classroom.application_status[]
    when 'deferred'   then array['screening','under_review','offered','rejected','withdrawn']::classroom.application_status[]
    when 'offered'    then array['accepted','declined','rejected','withdrawn']::classroom.application_status[]
    when 'accepted'   then array['enrolled','withdrawn']::classroom.application_status[]
    when 'rejected'   then array['screening']::classroom.application_status[]
    when 'withdrawn'  then array['screening']::classroom.application_status[]
    when 'declined'   then array['offered']::classroom.application_status[]
    else array[]::classroom.application_status[]
  end;

  if new_status = was then
    return app;
  end if;

  if not (new_status = any(allowed)) then
    raise exception 'An application that is % cannot become %', was, new_status;
  end if;

  if new_status = 'enrolled' then
    raise exception 'Use enrol_applicant() to enrol — a student account and class are required';
  end if;

  -- Finaliser guards. Applied for offered/rejected/waitlisted/deferred, not
  -- for intermediate moves. Every check reads from config so a school that
  -- has disabled a step (no fee, no interview, no screening) does not have
  -- to satisfy it.
  if new_status in ('offered','rejected','waitlisted','deferred') then
    cfg := classroom.effective_admission_config(app.school_id, app.session_id);

    -- Form must be in.
    if app.form_state not in ('submitted','resubmitted') then
      raise exception 'The application has not been submitted (form_state=%)', app.form_state;
    end if;

    -- No open corrections.
    if app.form_state = 'action_required' then
      raise exception 'There is an open correction request — resolve it first';
    end if;

    -- Fee.
    if coalesce((cfg->>'application_fee_enabled')::boolean, false)
       and app.payment_state <> 'verified' then
      raise exception 'The application fee is not verified yet';
    end if;

    -- Documents. Every required requirement must be verified or waived.
    if exists (
      select 1
      from classroom.applicant_documents d
      join classroom.document_requirements r on r.id = d.requirement_id
      where d.application_id = app.id
        and r.is_required
        and d.status not in ('verified','waived')
    ) then
      raise exception 'Every required document must be verified before this decision';
    end if;

    -- Screening. If any screening items were configured, every required one
    -- must be passed or waived. Schools with no screening_requirements
    -- rows for this session/programme skip this check.
    if exists (
      select 1 from classroom.screening_requirements r
      where r.school_id = app.school_id
        and (r.session_id is null   or r.session_id   = app.session_id)
        and (r.programme_id is null or r.programme_id = app.programme_id)
    ) then
      if exists (
        select 1 from classroom.application_screening_items i
        where i.application_id = app.id and i.is_required
          and i.status not in ('passed','waived')
      ) or not exists (
        select 1 from classroom.application_screening_items i
        where i.application_id = app.id
      ) then
        raise exception 'Screening must be complete before this decision';
      end if;
    end if;

    -- Interview if the config requires one.
    if coalesce((cfg->>'require_interview')::boolean, false) then
      if not exists (
        select 1 from classroom.application_interviews i
        where i.application_id = app.id and i.status = 'completed'
      ) then
        raise exception 'An interview must be completed before this decision';
      end if;
    end if;
  end if;

  who := classroom.admissions_actor_label();

  new_decision_state := case new_status
    when 'offered'    then 'admit'
    when 'rejected'   then 'reject'
    when 'waitlisted' then 'waitlist'
    when 'deferred'   then 'defer'
    else app.decision_state
  end;

  update classroom.applications
  set status = new_status,
      decision_state = new_decision_state,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now(),
      final_decided_by = case
        when new_status in ('offered','rejected','waitlisted','deferred') then auth.uid()
        else final_decided_by
      end,
      final_decided_at = case
        when new_status in ('offered','rejected','waitlisted','deferred') then now()
        else final_decided_at
      end,
      final_decision_note = case
        when new_status in ('offered','rejected','waitlisted','deferred') then note
        else final_decision_note
      end,
      offer_expires_at = case
        when new_status = 'offered' then coalesce(offer_expires, now() + interval '14 days')
        else offer_expires_at
      end
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values (target_application, was, new_status, auth.uid(), who, note);

  -- Notify the applicant. Reuses the existing 'application_<status>' scheme
  -- so the mailer/notification templates already downstream still work.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select ac.user_id, app.school_id, 'application_' || new_status::text,
         format('%s: application %s', app.reference, new_status),
         coalesce(note, format('%s %s', app.first_name, app.surname)),
         format('/Applications/%s', app.id)
  from classroom.applicant_accounts ac
  where ac.id = app.applicant_id;

  -- Legacy anonymous applicants still notified by email match, same as
  -- before. Kept so the existing anonymous flow keeps behaving.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select p.id, app.school_id, 'application_' || new_status::text,
         format('%s: application %s', app.reference, new_status),
         format('%s %s', app.first_name, app.surname),
         '/Apply/Status'
  from classroom.profiles p
  where app.applicant_id is null
    and lower(p.email) = lower(app.guardian_email);

  return app;
end;
$fn$;

grant execute on function classroom.decide_application(uuid, classroom.application_status, text, timestamptz) to authenticated;


/* =============================================================================
   6. Read helpers for the staff workspace
   ============================================================================= */

-- The three queues the staff dashboard renders.
create or replace function classroom.admissions_queues(target_school uuid)
returns table (
  bucket text,
  application_id uuid,
  reference text,
  applicant text,
  status classroom.application_status,
  form_state text,
  payment_state text,
  documents_state text,
  screening_state text,
  review_state text,
  interview_state text,
  submitted_at timestamptz,
  updated_at timestamptz
) language sql stable security definer
set search_path = classroom, public
as $fn$
  with base as (
    select a.*,
      trim(a.first_name || ' ' || a.surname) as applicant
    from classroom.applications a
    where a.school_id = target_school
      and classroom.can_do_admissions(target_school)
  )
  select 'payment' as bucket, id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where payment_state = 'processing'
  union all
  select 'documents', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where documents_state in ('pending','partial','rejected') and form_state in ('submitted','resubmitted')
  union all
  select 'screening', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where screening_state in ('not_started','in_progress','failed','correction_required') and form_state in ('submitted','resubmitted')
  union all
  select 'action', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where form_state = 'action_required'
  union all
  select 'review', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where review_state in ('assigned','in_progress')
  union all
  select 'interview', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where interview_state = 'scheduled'
  union all
  select 'decision', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where review_state = 'completed' and decision_state = 'pending';
$fn$;

grant execute on function classroom.admissions_queues(uuid) to authenticated;


-- Fetch every Phase 2 object for one application in one round trip.
create or replace function classroom.application_workspace(target_application uuid)
returns jsonb
language plpgsql stable security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  out jsonb;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    return null;
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can open the workspace';
  end if;

  select jsonb_build_object(
    'application', to_jsonb(app),
    'screening',   coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from classroom.application_screening_items i where i.application_id = app.id), '[]'::jsonb),
    'documents',   coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', d.id,
                                 'requirement_id', d.requirement_id,
                                 'status', d.status,
                                 'decided_by', d.decided_by,
                                 'decided_at', d.decided_at,
                                 'decision_note', d.decision_note,
                                 'requirement', to_jsonb(r),
                                 'file', to_jsonb(ad)
                               )) from classroom.applicant_documents d
                              left join classroom.document_requirements r on r.id = d.requirement_id
                              left join classroom.application_documents ad on ad.id = d.document_id
                              where d.application_id = app.id), '[]'::jsonb),
    'reviews',     coalesce((select jsonb_agg(to_jsonb(r) order by r.assigned_at desc) from classroom.application_reviews r where r.application_id = app.id), '[]'::jsonb),
    'interviews',  coalesce((select jsonb_agg(to_jsonb(i) order by i.scheduled_at desc) from classroom.application_interviews i where i.application_id = app.id), '[]'::jsonb),
    'events',      coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at asc) from classroom.application_events e where e.application_id = app.id), '[]'::jsonb),
    'config',      classroom.effective_admission_config(app.school_id, app.session_id)
  ) into out;

  return out;
end;
$fn$;

grant execute on function classroom.application_workspace(uuid) to authenticated;


notify pgrst, 'reload schema';
