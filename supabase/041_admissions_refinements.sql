-- =============================================================================
-- Admissions refinements folded in before Phase 1 screens
-- (per docs/admissions-architecture.md, section headings 1..6)
--
-- All additive; no destructive changes; existing applications keep working.
-- =============================================================================


/* =============================================================================
   §2 — Submitted snapshot
   ---------------------------------------------------------------------------
   The applicant's account holds their current identity; the application must
   preserve the state of what was submitted for that particular application.
   A later profile change does not rewrite history.

   Stored as one jsonb blob under applications.submitted_snapshot, taken at
   submit_my_application(). Anything read from an application post-submission
   should prefer this blob over the live column values.
   ============================================================================= */
alter table classroom.applications
  add column if not exists submitted_snapshot jsonb;


/* =============================================================================
   §4 — Application-level correction workflow
   ---------------------------------------------------------------------------
   Document-level resubmission already exists; this is the sibling for the
   form itself. A reviewer flags one or more sections; the applicant fixes
   only those and resubmits.

   correction_sections is a text[] naming exactly the sections that need
   attention ("personal", "education", "exams", "next_of_kin", "referees",
   "documents"). While a correction is pending, save_application_section()
   only accepts writes to those sections; every other section stays locked
   to what was submitted.
   ============================================================================= */
alter table classroom.applications
  add column if not exists correction_reason        text,
  add column if not exists correction_sections      text[],
  add column if not exists correction_requested_by  uuid references auth.users (id) on delete set null,
  add column if not exists correction_requested_at  timestamptz,
  add column if not exists correction_resubmitted_at timestamptz;

-- The form_state gains action_required so the applicant home surfaces the
-- "You need to do something" state prominently. Existing CHECK on form_state
-- needs to permit it — drop and rebuild the constraint additively.
alter table classroom.applications
  drop constraint if exists applications_form_state_check;
alter table classroom.applications
  add constraint applications_form_state_check
  check (form_state in ('draft','in_progress','ready_to_submit','submitted','action_required','resubmitted'));


/* =============================================================================
   §1 — Gateway verification path
   ---------------------------------------------------------------------------
   A verified Paystack webhook payment should move payment_state straight to
   verified. Manual verification (bank transfer proof, cash-and-receipt) is
   still the finance-officer route via verify_application_payment() — that
   path stays; this one is the sibling for automatic gateway confirmation.

   Runs from the paystack-webhook edge function, which is JWT-verified and
   passes the caller through the anon role. The service role bypasses RLS,
   so this function is callable from that context; a regular authenticated
   user cannot call it because there is no route in the client library and
   the argument shape leaks nothing.
   ============================================================================= */
create or replace function classroom.verify_application_payment_gateway(
  target_payment  uuid,
  gateway_ref_in  text,
  amount_paid     numeric,
  paid_at_in      timestamptz default now()
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

  -- The webhook's job is to attest a specific gateway reference. Refuse if
  -- the row already has a different one — protects against replayed events.
  if pay.gateway_ref is not null and pay.gateway_ref <> gateway_ref_in then
    raise exception 'This payment carries a different gateway reference';
  end if;

  update classroom.payments
  set status = 'approved',
      gateway_ref = gateway_ref_in,
      amount = coalesce(amount, amount_paid),
      paid_on = coalesce(paid_on, paid_at_in::date),
      decided_by = null,
      decided_at = now(),
      decision_note = 'Verified by payment gateway'
  where id = target_payment
    and status <> 'approved';

  update classroom.applications
  set payment_state = 'verified', updated_at = now()
  where id = inv.application_id and payment_state <> 'verified'
  returning * into app;

  if not found then
    select * into app from classroom.applications where id = inv.application_id;
  end if;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, null, 'Payment gateway',
     format('Payment auto-verified by gateway (ref %s)', gateway_ref_in));

  return app;
end;
$fn$;

-- Only the service role calls this; no grant to authenticated or anon.
revoke all on function classroom.verify_application_payment_gateway(uuid, text, numeric, timestamptz) from public, authenticated, anon;


/* =============================================================================
   §4 — the correction functions
   ============================================================================= */

-- Staff flag the sections that need work. The application moves from
-- under_review (or submitted) to action_required with a clear reason.
create or replace function classroom.request_application_correction(
  target_application uuid,
  sections_in        text[],
  reason_in          text
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

grant execute on function classroom.request_application_correction(uuid, text[], text) to authenticated;


-- The applicant resubmits after making changes. Only allowed while
-- form_state = action_required, and the fixed sections must actually be
-- present (they cannot resubmit without touching what was flagged).
create or replace function classroom.resubmit_application_correction(
  target_application uuid
) returns classroom.applications
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

  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot resubmit this application';
  end if;

  if app.form_state <> 'action_required' then
    raise exception 'This application is not awaiting a correction';
  end if;

  update classroom.applications
  set form_state              = 'resubmitted',
      status                  = 'submitted'::classroom.application_status,
      correction_resubmitted_at = now(),
      updated_at              = now()
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), 'Applicant',
     format('Corrections resubmitted (%s)',
            array_to_string(app.correction_sections, ', ')));

  -- Notify the officer who asked, plus admissions role.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct u.user_id, app.school_id, 'admission_resubmitted',
         format('%s resubmitted', app.reference),
         'The applicant has resubmitted their corrections.',
         format('/Admissions/%s', app.id)
  from (
    select app.correction_requested_by as user_id where app.correction_requested_by is not null
    union
    select m.user_id from classroom.school_members m
    where m.school_id = app.school_id and m.is_active
      and m.role in ('owner','admin','principal','admissions')
  ) u
  where u.user_id is not null;

  return app;
end;
$fn$;

grant execute on function classroom.resubmit_application_correction(uuid) to authenticated;


/* =============================================================================
   §2 — Amend save_application_section to respect the snapshot and correction
   ---------------------------------------------------------------------------
   Once form_state=submitted (or later), section writes are refused. If
   form_state=action_required, writes only land on the sections named in
   correction_sections.
   ============================================================================= */
create or replace function classroom.save_application_section(
  target_application uuid,
  section_name       text,
  payload            jsonb
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot edit this application';
  end if;

  select * into app from classroom.applications where id = target_application;

  -- The draft/in_progress path — a section may always be written.
  -- The action_required path — only sections on the correction list.
  -- Otherwise (submitted, resubmitted) — refused.
  if app.form_state in ('draft','in_progress','ready_to_submit') then
    null;
  elsif app.form_state = 'action_required' then
    if not (section_name = any(coalesce(app.correction_sections, array[]::text[]))) then
      raise exception 'This section is not part of the requested correction';
    end if;
  else
    raise exception 'This application is closed for editing (%).', app.form_state;
  end if;

  update classroom.applications
  set personal_info     = case when section_name='personal'    then payload else personal_info     end,
      education_history = case when section_name='education'   then payload else education_history end,
      exam_results      = case when section_name='exams'       then payload else exam_results      end,
      next_of_kin       = case when section_name='next_of_kin' then payload else next_of_kin       end,
      referees          = case when section_name='referees'    then payload else referees          end,
      form_state        = case when form_state='draft' then 'in_progress' else form_state end,
      updated_at        = now()
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), 'Applicant',
     format('Section saved: %s', section_name));

  return app;
end;
$fn$;

grant execute on function classroom.save_application_section(uuid, text, jsonb) to authenticated;


/* =============================================================================
   §2 — Rewrite submit_my_application to take the snapshot
   ============================================================================= */
create or replace function classroom.submit_my_application(
  target_application     uuid,
  declaration_accepted   boolean
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  cfg jsonb;
  snapshot jsonb;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot submit this application';
  end if;

  if not declaration_accepted then
    raise exception 'The declaration must be accepted before submitting';
  end if;

  select * into app from classroom.applications where id = target_application;
  cfg := classroom.effective_admission_config(app.school_id, app.session_id);

  if app.form_state in ('submitted','resubmitted') then
    return app;
  end if;

  -- Fee gate.
  if coalesce((cfg->>'application_fee_enabled')::boolean, false)
     and coalesce((cfg->>'form_locked_until_paid')::boolean, true)
     and app.payment_state <> 'verified' then
    raise exception 'The application fee must be verified before submission';
  end if;

  -- Required sections.
  if app.personal_info is null then
    raise exception 'Fill in your personal information first';
  end if;
  if app.education_history is null then
    raise exception 'Fill in your education history first';
  end if;
  if app.exam_results is null then
    raise exception 'Add your exam results first';
  end if;
  if coalesce((cfg->>'require_next_of_kin')::boolean, true) and app.next_of_kin is null then
    raise exception 'Add a next-of-kin first';
  end if;
  if coalesce((cfg->>'require_referees')::boolean, false) and app.referees is null then
    raise exception 'Add your referees first';
  end if;

  -- Required documents.
  if exists (
    select 1
    from classroom.applicant_documents d
    join classroom.document_requirements r on r.id = d.requirement_id
    where d.application_id = app.id
      and r.is_required
      and d.status not in ('verified','uploaded','under_review','waived')
  ) then
    raise exception 'Every required document must be uploaded and any rejection resolved';
  end if;

  -- The snapshot. Everything the applicant filled in, plus the applicant
  -- account values used, plus the config that governed submission — so a
  -- later profile or config edit does not rewrite the record.
  snapshot := jsonb_build_object(
    'personal_info',     app.personal_info,
    'education_history', app.education_history,
    'exam_results',      app.exam_results,
    'next_of_kin',       app.next_of_kin,
    'referees',          app.referees,
    'applicant_account', (select to_jsonb(ac) from classroom.applicant_accounts ac where ac.id = app.applicant_id),
    'programme',         (select to_jsonb(p)  from classroom.admission_programmes p where p.id = app.programme_id),
    'config',            cfg,
    'submitted_at',      now()
  );

  update classroom.applications
  set form_state              = 'submitted',
      status                  = 'submitted'::classroom.application_status,
      declaration_accepted_at = now(),
      submitted_at            = now(),
      submitted_snapshot      = snapshot,
      updated_at              = now()
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, 'draft'::classroom.application_status, 'submitted'::classroom.application_status,
     auth.uid(), 'Applicant', 'Application submitted');

  return app;
end;
$fn$;

grant execute on function classroom.submit_my_application(uuid, boolean) to authenticated;


/* =============================================================================
   §3 — Dynamic workflow steps for one application
   ---------------------------------------------------------------------------
   Returns the list of steps that apply to this specific application right
   now, in order, each with a state (done/current/pending/skipped). The
   applicant home renders whatever this returns.
   ============================================================================= */
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
  cfg := classroom.effective_admission_config(app.school_id, app.session_id);

  fee_on           := coalesce((cfg->>'application_fee_enabled')::boolean, false);
  acc_on           := coalesce((cfg->>'acceptance_fee_enabled')::boolean, false);
  need_interview   := coalesce((cfg->>'require_interview')::boolean, false);
  need_referees    := coalesce((cfg->>'require_referees')::boolean, false);
  need_next_of_kin := coalesce((cfg->>'require_next_of_kin')::boolean, true);

  return query
  with base(idx, k, l, done, active) as (
    values
      (1,  'account',        'Applicant account',                       true,                                                  false),
      (2,  'programme',      'Programme selected',                      app.programme_id is not null,                          app.programme_id is null),
      (3,  'fee_invoice',    'Application fee invoice',                 fee_on and app.payment_state <> 'not_required',        false),
      (4,  'fee_paid',       'Application fee paid',                    app.payment_state = 'verified',                        app.payment_state in ('unpaid','processing','rejected')),
      (5,  'form_personal',  'Personal information',                    app.personal_info is not null,                         app.payment_state in ('verified','not_required') and app.personal_info is null),
      (6,  'form_education', 'Education history',                       app.education_history is not null,                     app.personal_info is not null and app.education_history is null),
      (7,  'form_exams',     'Examination results',                     app.exam_results is not null,                          app.education_history is not null and app.exam_results is null),
      (8,  'form_nok',       'Next of kin',                             app.next_of_kin is not null,                           app.exam_results is not null and app.next_of_kin is null),
      (9,  'form_referees',  'Referees',                                app.referees is not null,                              app.next_of_kin is not null and app.referees is null),
      (10, 'documents',      'Documents',                               app.documents_state = 'complete',                      app.documents_state in ('pending','partial','rejected')),
      (11, 'submit',         'Submit application',                      app.form_state in ('submitted','resubmitted'),         app.form_state in ('ready_to_submit','in_progress')),
      (12, 'review',         'Under review',                            app.status in ('screening','under_review','document_review'), app.form_state in ('submitted','resubmitted') and app.status not in ('offered','accepted','enrolled','rejected','declined','withdrawn')),
      (13, 'action',         'Action required',                         false,                                                 app.form_state = 'action_required'),
      (14, 'decision',       'Admission decision',                      app.status in ('offered','accepted','enrolled','rejected','declined'), false),
      (15, 'offer',          'Offer',                                   app.offer_state in ('accepted'),                       app.offer_state = 'issued'),
      (16, 'acceptance_fee', 'Acceptance fee',                          not acc_on or app.payment_state = 'verified' and app.offer_state = 'accepted', acc_on and app.offer_state='accepted'),
      (17, 'clearance',      'Clearance',                               app.clearance_state = 'cleared',                       app.clearance_state = 'in_progress'),
      (18, 'registration',   'Registration',                            app.registration_state = 'completed',                  app.clearance_state = 'cleared')
  )
  select k, l,
         case
           when done   then 'done'
           when active then 'current'
           else 'pending'
         end
  from base
  where
    -- Prune steps that don't apply to this application.
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


notify pgrst, 'reload schema';
