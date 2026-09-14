-- =============================================================================
-- Scope five more admissions RPCs to the caller's current school
--
-- application_workflow_steps, record_offer_response, application_workspace,
-- set_clearance_status and record_original_verification all resolve an
-- application/offer/checklist row by id, then authorize via
-- is_applicant_for/can_finalise_admission/can_do_admissions(row's real
-- school_id) — correct for THAT row's school, blind to which tenant the
-- caller currently has open. Same class of gap as the other admissions RPCs
-- already fixed in 095/096.
--
-- application_workflow_steps is read-only and every existing caller already
-- treats "no steps" as a valid empty result, so it gets a behavioural guard
-- (return zero rows when the caller isn't the applicant) rather than a new
-- parameter. The other four gain a required school parameter.
-- =============================================================================

create or replace function classroom.application_workflow_steps(
  target_application uuid
) returns table (
  step_key   text,
  step_label text,
  state      text
) language plpgsql stable security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  cfg jsonb;
  fee_on boolean;
  acc_on boolean;
  need_interview boolean;
  need_referees  boolean;
  need_next_of_kin boolean;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    return;
  end if;

  if not classroom.is_applicant_for(target_application) then
    return;
  end if;

  cfg := classroom.effective_admission_config(app.school_id, app.session_id);

  fee_on           := coalesce((cfg->>'application_fee_enabled')::boolean, false);
  acc_on           := coalesce((cfg->>'acceptance_fee_enabled')::boolean, false);
  need_interview   := coalesce((cfg->>'require_interview')::boolean, false);
  need_referees    := coalesce((cfg->>'require_referees')::boolean, false);
  need_next_of_kin := coalesce((cfg->>'require_next_of_kin')::boolean, true);

  return query
  with base(idx, k, l, done, active) as (
    values
      (1,  'account',        'Applicant account',
            true, false),
      (2,  'programme',      'Programme selected',
            app.programme_id is not null,
            app.programme_id is null),
      (3,  'fee_invoice',    'Application fee invoice',
            fee_on and app.payment_state <> 'not_required',
            false),
      (4,  'fee_paid',       'Application fee paid',
            app.payment_state = 'verified',
            app.payment_state in ('unpaid','processing','rejected')),
      (5,  'form_personal',  'Personal information',
            app.personal_info is not null,
            app.payment_state in ('verified','not_required') and app.personal_info is null),
      (6,  'form_education', 'Education history',
            app.education_history is not null,
            app.personal_info is not null and app.education_history is null),
      (7,  'form_exams',     'Examination results',
            app.exam_results is not null,
            app.education_history is not null and app.exam_results is null),
      (8,  'form_nok',       'Next of kin',
            app.next_of_kin is not null,
            app.exam_results is not null and app.next_of_kin is null),
      (9,  'form_referees',  'Referees',
            app.referees is not null,
            app.next_of_kin is not null and app.referees is null),
      (10, 'documents',      'Documents',
            app.documents_state = 'complete',
            app.documents_state in ('pending','partial','rejected')),
      (11, 'submit',         'Submit application',
            app.form_state in ('submitted','resubmitted'),
            app.form_state in ('ready_to_submit','in_progress')),
      (12, 'review',         'Under review',
            app.status in ('screening'::classroom.application_status,
                           'under_review'::classroom.application_status,
                           'document_review'::classroom.application_status),
            app.form_state in ('submitted','resubmitted')
              and app.status not in ('offered'::classroom.application_status,
                                     'accepted'::classroom.application_status,
                                     'enrolled'::classroom.application_status,
                                     'rejected'::classroom.application_status,
                                     'declined'::classroom.application_status,
                                     'withdrawn'::classroom.application_status)),
      (13, 'action',         'Action required',
            false,
            app.form_state = 'action_required'),
      (14, 'interview',      'Interview',
            app.status = 'interview_completed'::classroom.application_status,
            app.status = 'interview_required'::classroom.application_status),
      (15, 'decision',       'Admission decision',
            app.status in ('offered'::classroom.application_status,
                           'accepted'::classroom.application_status,
                           'enrolled'::classroom.application_status,
                           'rejected'::classroom.application_status,
                           'declined'::classroom.application_status),
            false),
      (16, 'offer',          'Offer accepted',
            app.offer_state = 'accepted',
            app.offer_state = 'issued'),
      -- The acceptance-fee row: only shown when acceptance_fee is enabled.
      -- Done only when the offer has been accepted AND payment is verified;
      -- current when the offer is accepted but payment is not yet in.
      (17, 'acceptance_fee', 'Acceptance fee',
            acc_on and app.offer_state = 'accepted' and app.payment_state = 'verified',
            acc_on and app.offer_state = 'accepted' and app.payment_state <> 'verified'),
      (18, 'clearance',      'Clearance',
            app.clearance_state = 'cleared',
            app.clearance_state = 'in_progress'),
      (19, 'registration',   'Registration',
            app.registration_state = 'completed',
            app.clearance_state = 'cleared' and app.registration_state <> 'completed')
  )
  select k, l,
         case
           when done   then 'done'
           when active then 'current'
           else 'pending'
         end
  from base
  where
    (k not in ('fee_invoice','fee_paid') or fee_on)
    and (k <> 'form_nok'       or need_next_of_kin)
    and (k <> 'form_referees'  or need_referees)
    and (k <> 'interview'      or need_interview)
    and (k <> 'acceptance_fee' or acc_on)
    and (k <> 'action'         or app.form_state = 'action_required')
  order by idx;
end;
$fn$;

grant execute on function classroom.application_workflow_steps(uuid) to authenticated;

drop function if exists classroom.record_offer_response(uuid, text, text);

create or replace function classroom.record_offer_response(
  target_offer   uuid,
  response       text,
  current_school uuid,
  note_in        text default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  offer classroom.admission_offers;
  app   classroom.applications;
  cfg   jsonb;
  invoice_id uuid;
  fee_note text := '';
  who text;
begin
  if response not in ('accepted', 'declined') then
    raise exception 'Unknown response: %', response;
  end if;

  select * into offer from classroom.admission_offers where id = target_offer;
  if not found then
    raise exception 'No such offer';
  end if;

  select * into app from classroom.applications where id = offer.application_id;

  if app.school_id <> current_school then
    raise exception 'This offer does not belong to the current school';
  end if;

  if not classroom.can_finalise_admission(app.school_id) then
    raise exception 'Only owner/admin/principal can record a response on the applicant''s behalf';
  end if;

  if app.applicant_id is not null then
    raise exception 'This applicant has their own account — they accept or decline the offer themselves';
  end if;

  if offer.status <> 'issued' then
    raise exception 'This offer is %, not open to respond to', offer.status;
  end if;

  if offer.expires_at is not null and offer.expires_at < now() then
    update classroom.admission_offers
    set status = 'expired', updated_at = now()
    where id = target_offer;
    raise exception 'This offer expired on %', to_char(offer.expires_at, 'DD Mon YYYY');
  end if;

  who := classroom.admissions_actor_label();

  if response = 'accepted' then
    update classroom.admission_offers
    set status = 'accepted', accepted_at = now(), updated_at = now()
    where id = target_offer;

    cfg := classroom.effective_admission_config(app.school_id, app.session_id);

    update classroom.applications
    set status = 'accepted'::classroom.application_status,
        offer_state = 'accepted',
        payment_state = case
          when coalesce((cfg->>'acceptance_fee_enabled')::boolean, false) then 'unpaid'
          else payment_state
        end,
        updated_at = now()
    where id = app.id
    returning * into app;

    if coalesce((cfg->>'acceptance_fee_enabled')::boolean, false) then
      insert into classroom.invoices (
        school_id, session_id, structure_id, student_id,
        reference, seq, status, purpose, application_id, notes, issued_at, created_by
      ) values (
        app.school_id, app.session_id, null, null,
        app.reference || '-ACF', app.seq, 'issued', 'acceptance_fee', app.id,
        'Acceptance fee — ' || app.reference, now(), auth.uid()
      )
      returning id into invoice_id;
      fee_note := ', acceptance-fee invoice generated';
    end if;

    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (app.id, 'offered'::classroom.application_status, 'accepted'::classroom.application_status,
       auth.uid(), who,
       'Offer accepted on the applicant''s behalf' || fee_note
       || case when note_in is not null then ' — ' || note_in else '' end);
  else
    update classroom.admission_offers
    set status = 'declined', declined_at = now(), decline_reason = note_in, updated_at = now()
    where id = target_offer;

    update classroom.applications
    set status = 'declined'::classroom.application_status,
        offer_state = 'declined',
        updated_at = now()
    where id = app.id
    returning * into app;

    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (app.id, 'offered'::classroom.application_status, 'declined'::classroom.application_status,
       auth.uid(), who,
       'Offer declined on the applicant''s behalf'
       || case when note_in is not null then ' — ' || note_in else '' end);
  end if;

  return app;
end;
$fn$;

grant execute on function classroom.record_offer_response(uuid, text, uuid, text) to authenticated;

drop function if exists classroom.application_workspace(uuid);

create or replace function classroom.application_workspace(target_application uuid, target_school uuid)
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
  if app.school_id <> target_school then
    raise exception 'Application not found in this school';
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
    'config',      classroom.effective_admission_config(app.school_id, app.session_id),
    'offer',       (select to_jsonb(o) from classroom.admission_offers o
                     where o.application_id = app.id
                     order by o.issued_at desc limit 1),
    'application_invoice', (
      select jsonb_build_object(
        'invoice', to_jsonb(i),
        'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.submitted_at desc)
                               from classroom.payments p where p.invoice_id = i.id), '[]'::jsonb)
      )
      from classroom.invoices i
      where i.application_id = app.id and i.purpose = 'application_fee'
      order by i.issued_at desc limit 1
    ),
    'acceptance_invoice', (
      select jsonb_build_object(
        'invoice', to_jsonb(i),
        'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.submitted_at desc)
                               from classroom.payments p where p.invoice_id = i.id), '[]'::jsonb)
      )
      from classroom.invoices i
      where i.application_id = app.id and i.purpose = 'acceptance_fee'
      order by i.issued_at desc limit 1
    ),
    'clearance_departments', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.position)
      from classroom.clearance_departments d
      where d.school_id = app.school_id and d.is_active
    ), '[]'::jsonb),
    'clearance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'department_id', c.department_id,
               'department_name', dep.name,
               'position', dep.position,
               'status', c.status,
               'decided_by', c.decided_by,
               'decided_at', c.decided_at,
               'decision_note', c.decision_note
             ) order by dep.position)
      from classroom.clearance_checklists c
      join classroom.clearance_departments dep on dep.id = c.department_id
      where c.application_id = app.id
    ), '[]'::jsonb),
    'original_verifications', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.seen_at desc)
      from classroom.original_verifications v
      where v.application_id = app.id
    ), '[]'::jsonb)
  ) into out;

  return out;
end;
$fn$;

grant execute on function classroom.application_workspace(uuid, uuid) to authenticated;

drop function if exists classroom.set_clearance_status(uuid, text, text);

create or replace function classroom.set_clearance_status(
  target_checklist uuid,
  expected_school  uuid,
  new_status       text,
  note_in          text default null
) returns classroom.clearance_checklists
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  item classroom.clearance_checklists;
  app  classroom.applications;
  dept_name text;
  was  text;
  old_clearance_state text;
begin
  select * into item from classroom.clearance_checklists where id = target_checklist;
  if not found then
    raise exception 'No such clearance item';
  end if;
  select * into app from classroom.applications where id = item.application_id;
  select name into dept_name from classroom.clearance_departments where id = item.department_id;

  if app.school_id <> expected_school then
    raise exception 'Clearance item does not belong to the current school';
  end if;

  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can move a clearance item';
  end if;

  if new_status not in ('pending','in_progress','cleared','rejected','waived') then
    raise exception 'Unknown clearance status: %', new_status;
  end if;

  -- Waiving a clearance requirement is a policy exception, same bar as
  -- waiving a required document (048).
  if new_status = 'waived'
     and not classroom.has_role_in(app.school_id, array['owner','admin','principal']::classroom.member_role[]) then
    raise exception 'Only admin/principal can waive a clearance requirement';
  end if;

  if new_status = 'rejected' and btrim(coalesce(note_in, '')) = '' then
    raise exception 'A rejected clearance item must carry a reason';
  end if;

  was := item.status;
  old_clearance_state := app.clearance_state;

  if was = new_status then
    return item;
  end if;

  update classroom.clearance_checklists
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(note_in, decision_note),
      updated_at = now()
  where id = target_checklist
  returning * into item;

  perform classroom.recompute_clearance_state(app.id);
  select * into app from classroom.applications where id = app.id;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Clearance — %s: %s%s', coalesce(dept_name, 'department'), new_status,
            case when note_in is not null then ' — ' || note_in else '' end));

  if new_status = 'rejected' then
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select ac.user_id, app.school_id, 'clearance_action_required',
           format('%s: clearance needs attention', app.reference),
           format('%s — %s', coalesce(dept_name, 'A department'), note_in),
           format('/Applications/%s', app.id)
    from classroom.applicant_accounts ac
    where ac.id = app.applicant_id;
  end if;

  -- Whole-application milestone: only fires the moment every department
  -- clears, not on every individual item change once already cleared.
  if old_clearance_state <> 'cleared' and app.clearance_state = 'cleared' then
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select ac.user_id, app.school_id, 'clearance_completed',
           format('%s: clearance complete', app.reference),
           'Every clearance department has signed off. The school will confirm your next steps.',
           format('/Applications/%s', app.id)
    from classroom.applicant_accounts ac
    where ac.id = app.applicant_id;
  end if;

  return item;
end;
$fn$;

grant execute on function classroom.set_clearance_status(uuid, uuid, text, text) to authenticated;

drop function if exists classroom.record_original_verification(uuid, text, text);

create or replace function classroom.record_original_verification(
  target_application uuid,
  target_school      uuid,
  document_kind_in    text,
  remarks_in          text default null
) returns classroom.original_verifications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  row_out classroom.original_verifications;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if app.school_id <> target_school then
    raise exception 'Application does not belong to this school';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can record an original-document sighting';
  end if;
  if btrim(coalesce(document_kind_in, '')) = '' then
    raise exception 'Say which document was seen';
  end if;

  insert into classroom.original_verifications
    (application_id, document_kind, seen_by, remarks)
  values (target_application, document_kind_in, auth.uid(), remarks_in)
  returning * into row_out;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), classroom.admissions_actor_label(),
     format('Original sighted: %s%s', document_kind_in,
            case when remarks_in is not null then ' — ' || remarks_in else '' end));

  return row_out;
end;
$fn$;

grant execute on function classroom.record_original_verification(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
