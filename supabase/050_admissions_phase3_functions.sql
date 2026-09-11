-- =============================================================================
-- Admissions engine — Phase 3 functions
--
-- Offers, self-service acceptance, and the acceptance fee. Same rules as
-- every function before it: SECURITY DEFINER, search_path pinned, role or
-- ownership checked before anything moves, an application_events row on
-- every real transition, no client-facing UPDATE policy anywhere in reach.
--
-- Three functions from 048/035 are extended in place (create or replace,
-- same signature, additive body only) rather than duplicated:
--
--   decide_application()      — offered now also issues the admission_offers
--                                row and finally writes offer_state, which
--                                has existed since 040 but nothing has ever
--                                set.
--   settle_online_payment()   — the *actual* Paystack webhook target (see
--                                supabase/functions/paystack-webhook). It had
--                                no idea admissions invoices existed, so an
--                                application fee or acceptance fee paid
--                                online settled the payment row but never
--                                moved applications.payment_state to
--                                'verified'. verify_application_payment_
--                                gateway() (041/045) was written to do this
--                                but the webhook was never wired to call it —
--                                it calls settle_online_payment() for every
--                                invoice, admissions or not. Fixed here at
--                                the function the webhook actually calls.
--   application_workspace()   — gains the offer and the acceptance-fee
--                                invoice, so the staff workspace stays a
--                                single round trip.
-- =============================================================================


/* =============================================================================
   1. decide_application — extended: issuing an offer creates its record
   ---------------------------------------------------------------------------
   Everything above the marked block is the deployed 048 body, unchanged.

   This adds a 5th parameter (conditions_in), which changes the function's
   signature — Postgres identifies a function by name *and* argument types,
   so `create or replace` with a different arity does not replace the old
   4-argument version, it adds a second overload alongside it. The old one
   is dropped explicitly first so there is exactly one decide_application
   in the schema, not two ambiguous ones.
   ============================================================================= */

drop function if exists classroom.decide_application(uuid, classroom.application_status, text, timestamptz);

create or replace function classroom.decide_application(
  target_application uuid,
  new_status         classroom.application_status,
  note               text default null,
  offer_expires      timestamptz default null,
  conditions_in      text default null
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
  resolved_expiry timestamptz;
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

  resolved_expiry := case
    when new_status = 'offered' then coalesce(offer_expires, now() + interval '14 days')
    else app.offer_expires_at
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
      offer_expires_at = resolved_expiry,
      -- =====================================================================
      -- Phase 3 addition: offer_state has existed since 040 but nothing has
      -- ever written to it. Written here, atomically with the rest of the
      -- decision, so the applicant's progress tracker (application_workflow_
      -- steps, step 'offer') finally reflects reality. A finaliser rescinding
      -- an offer directly (offered -> rejected/withdrawn, both already
      -- allowed above) retires it the same way accept_offer/decline_offer
      -- would, so the applicant's dashboard never shows a stale offer to act on.
      -- =====================================================================
      offer_state = case
        when new_status = 'offered' then 'issued'
        when was = 'offered' and new_status in ('rejected','withdrawn') then 'expired'
        else offer_state
      end
  where id = target_application
  returning * into app;

  -- =========================================================================
  -- Phase 3 addition: the offer becomes a first-class record. Any previously
  -- issued (but never accepted/declined) offer on this application is
  -- superseded first — defensive only, the state machine above should never
  -- allow a second 'offered' while one is already live.
  -- =========================================================================
  if new_status = 'offered' then
    update classroom.admission_offers
    set status = 'expired', updated_at = now()
    where application_id = app.id and status = 'issued';

    insert into classroom.admission_offers
      (application_id, programme_id, status, conditions, issued_by, issued_at, expires_at)
    values
      (app.id, app.programme_id, 'issued', conditions_in, auth.uid(), now(), resolved_expiry);
  elsif was = 'offered' and new_status in ('rejected','withdrawn') then
    update classroom.admission_offers
    set status = 'expired', updated_at = now()
    where application_id = app.id and status = 'issued';
  end if;

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

grant execute on function classroom.decide_application(uuid, classroom.application_status, text, timestamptz, text) to authenticated;


/* =============================================================================
   2. accept_offer / decline_offer — the applicant's own action
   ---------------------------------------------------------------------------
   Deliberately separate from decide_application: that function is gated on
   can_finalise_admission (owner/admin/principal), but accepting or declining
   an offer is the applicant's decision, not the school's. These check
   is_applicant_for() instead. An anonymous applicant (no applicant_accounts
   row — the pre-Phase-1 submit_application() path) has no self-service
   surface at all, exactly as they have none for the application fee; a
   finaliser can still record their answer directly with decide_application
   ('accepted'/'declined'), untouched above, the same way that screen already
   worked before Phase 3.
   ============================================================================= */

create or replace function classroom.accept_offer(
  target_offer uuid
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
begin
  select * into offer from classroom.admission_offers where id = target_offer;
  if not found then
    raise exception 'No such offer';
  end if;

  select * into app from classroom.applications where id = offer.application_id;
  if not classroom.is_applicant_for(app.id) then
    raise exception 'You cannot accept this offer';
  end if;

  if offer.status <> 'issued' then
    raise exception 'This offer is %, not open to accept', offer.status;
  end if;

  if offer.expires_at is not null and offer.expires_at < now() then
    update classroom.admission_offers
    set status = 'expired', updated_at = now()
    where id = target_offer;
    raise exception 'This offer expired on %', to_char(offer.expires_at, 'DD Mon YYYY');
  end if;

  update classroom.admission_offers
  set status = 'accepted', accepted_at = now(), updated_at = now()
  where id = target_offer;

  cfg := classroom.effective_admission_config(app.school_id, app.session_id);

  update classroom.applications
  set status = 'accepted'::classroom.application_status,
      offer_state = 'accepted',
      -- A fresh payment cycle for the acceptance fee, same column the
      -- application fee used — the two never overlap in time.
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
      app.reference || '-ACF',
      app.seq,
      'issued',
      'acceptance_fee',
      app.id,
      'Acceptance fee — ' || app.reference,
      now(),
      auth.uid()
    )
    returning id into invoice_id;

    fee_note := ', acceptance-fee invoice generated';
  end if;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, 'offered'::classroom.application_status, 'accepted'::classroom.application_status,
     auth.uid(), 'Applicant', 'Offer accepted' || fee_note);

  -- Notify the finalisers — the school needs to know the seat is taken.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select m.user_id, app.school_id, 'offer_accepted',
         format('Offer accepted: %s', app.reference),
         format('%s %s accepted their offer.', app.first_name, app.surname),
         format('/AdmissionsWorkspace/%s', app.id)
  from classroom.school_members m
  where m.school_id = app.school_id and m.is_active
    and m.role in ('owner','admin','principal');

  return app;
end;
$fn$;

grant execute on function classroom.accept_offer(uuid) to authenticated;


create or replace function classroom.decline_offer(
  target_offer uuid,
  reason_in    text default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  offer classroom.admission_offers;
  app   classroom.applications;
begin
  select * into offer from classroom.admission_offers where id = target_offer;
  if not found then
    raise exception 'No such offer';
  end if;

  select * into app from classroom.applications where id = offer.application_id;
  if not classroom.is_applicant_for(app.id) then
    raise exception 'You cannot decline this offer';
  end if;

  if offer.status <> 'issued' then
    raise exception 'This offer is %, not open to decline', offer.status;
  end if;

  update classroom.admission_offers
  set status = 'declined', declined_at = now(), decline_reason = reason_in, updated_at = now()
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
     auth.uid(), 'Applicant',
     case when reason_in is not null then 'Offer declined — ' || reason_in else 'Offer declined' end);

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select m.user_id, app.school_id, 'offer_declined',
         format('Offer declined: %s', app.reference),
         format('%s %s declined their offer.', app.first_name, app.surname),
         format('/AdmissionsWorkspace/%s', app.id)
  from classroom.school_members m
  where m.school_id = app.school_id and m.is_active
    and m.role in ('owner','admin','principal');

  return app;
end;
$fn$;

grant execute on function classroom.decline_offer(uuid, text) to authenticated;


/* =============================================================================
   3. verify_acceptance_payment — the manual (bursar/admissions) path
   ---------------------------------------------------------------------------
   Mirrors verify_application_payment exactly, scoped to purpose =
   'acceptance_fee'. The applicant who submitted a manual proof may not
   verify their own payment, same rule as the application fee.
   ============================================================================= */

create or replace function classroom.verify_acceptance_payment(
  target_payment uuid,
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

grant execute on function classroom.verify_acceptance_payment(uuid, text) to authenticated;


/* =============================================================================
   4. settle_online_payment — fixed to recognise admissions invoices
   ---------------------------------------------------------------------------
   This is the function supabase/functions/paystack-webhook actually calls
   for every gateway payment, admissions or not. Everything above the marked
   block is the deployed 035 body, unchanged; the marked block is the only
   addition. verify_application_payment_gateway (041/045) is untouched but is
   not, and never was, wired to the live webhook.
   ============================================================================= */

create or replace function classroom.settle_online_payment(
  target_invoice uuid,
  paid_amount    numeric,
  gateway_name   text,
  gateway_reference text,
  gateway_fee    numeric default null,
  payer          uuid default null
)
returns classroom.payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv classroom.invoices;
  pay classroom.payments;
  app classroom.applications;
begin
  -- Already settled by an earlier delivery of the same event: say so quietly
  -- rather than raising, so the webhook still gets its 200 and stops retrying.
  select * into pay from classroom.payments
  where gateway = gateway_name and gateway_ref = gateway_reference;
  if found then
    return pay;
  end if;

  select * into inv from classroom.invoices where id = target_invoice;
  if not found then
    raise exception 'No such invoice';
  end if;

  if inv.status <> 'issued' then
    raise exception 'Invoice % is %, so nothing can be paid against it',
      inv.reference, inv.status;
  end if;

  if paid_amount is null or paid_amount <= 0 then
    raise exception 'A payment has to be more than nothing';
  end if;

  -- Approved on arrival. Unlike a declared transfer there is nothing for a
  -- bursar to verify: the money is already at the gateway, and asking them to
  -- approve it would be theatre.
  insert into classroom.payments (
    school_id, invoice_id, amount, method, status,
    reference, paid_on, submitted_by, decided_at,
    decision_note, gateway, gateway_ref, gateway_fee
  ) values (
    inv.school_id, target_invoice, paid_amount, 'online', 'approved',
    gateway_reference, current_date, payer, now(),
    format('Paid online through %s', gateway_name),
    gateway_name, gateway_reference, gateway_fee
  )
  returning * into pay;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select people.recipient, inv.school_id, 'payment_approved',
         'Payment received',
         format('%s against %s', to_char(paid_amount, 'FM999,999,999.00'), inv.reference),
         '/Fees'
  from lateral (
    select inv.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g
    where g.student_id = inv.student_id
  ) people
  where people.recipient is not null;

  -- =========================================================================
  -- Phase 3 addition: an application-fee or acceptance-fee invoice has no
  -- student_id, so the notify block above matches nobody, and — the actual
  -- bug — nothing here ever told classroom.applications that the fee was
  -- paid. Every online admissions payment before this fix settled correctly
  -- as a payment row but left payment_state stuck at 'processing' forever.
  -- =========================================================================
  if inv.purpose in ('application_fee', 'acceptance_fee') and inv.application_id is not null then
    update classroom.applications
    set payment_state = 'verified', updated_at = now()
    where id = inv.application_id and payment_state <> 'verified'
    returning * into app;

    if found then
      insert into classroom.application_events
        (application_id, status_from, status_to, actor_id, actor_label, note)
      values
        (app.id, app.status, app.status, null, 'Payment gateway',
         format('%s payment auto-verified by gateway (ref %s)',
           case when inv.purpose = 'acceptance_fee' then 'Acceptance-fee' else 'Application-fee' end,
           gateway_reference));

      insert into classroom.notifications (user_id, school_id, kind, title, body, link)
      select ac.user_id, app.school_id, 'payment_approved',
             format('%s: payment received', app.reference),
             format('%s confirmed.', case when inv.purpose = 'acceptance_fee' then 'Your acceptance fee has been' else 'Your application fee has been' end),
             format('/Applications/%s', app.id)
      from classroom.applicant_accounts ac
      where ac.id = app.applicant_id;
    end if;
  end if;

  return pay;
end;
$fn$;

revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) from public;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) from authenticated;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) from anon;
grant execute on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) to service_role;


/* =============================================================================
   5. application_workspace — extended with the offer and its fee invoice
   ============================================================================= */

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
    'config',      classroom.effective_admission_config(app.school_id, app.session_id),
    -- Phase 3: the most recent offer, and its acceptance-fee invoice with
    -- payments, so the staff workspace can verify a manual payment without a
    -- second round trip.
    'offer',       (select to_jsonb(o) from classroom.admission_offers o
                     where o.application_id = app.id
                     order by o.issued_at desc limit 1),
    'acceptance_invoice', (
      select jsonb_build_object(
        'invoice', to_jsonb(i),
        'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.submitted_at desc)
                               from classroom.payments p where p.invoice_id = i.id), '[]'::jsonb)
      )
      from classroom.invoices i
      where i.application_id = app.id and i.purpose = 'acceptance_fee'
      order by i.issued_at desc limit 1
    )
  ) into out;

  return out;
end;
$fn$;

grant execute on function classroom.application_workspace(uuid) to authenticated;


notify pgrst, 'reload schema';
