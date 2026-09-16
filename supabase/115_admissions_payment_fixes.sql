-- =============================================================================
-- Four real bugs found testing the admissions payment flow end to end.
--
--   1. payable_now() joins to classroom.schools, and that table's own RLS
--      ("members read their own school") only allows a school_members row —
--      which an applicant never has. pay-init calling payable_now() as the
--      applicant therefore always returned nothing, so an applicant could
--      never actually reach Paystack for an application/acceptance fee, no
--      matter what the frontend button did.
--   2. Nothing ever moves payment_state back out of 'processing'. If the
--      attempt above failed, or the applicant abandoned the gateway's own
--      page, they were stuck forever with no retry and no admin override.
--   3. start_application()/accept_offer() issue the application-fee and
--      acceptance-fee invoices with NO invoice_items row at all. Every
--      figure on classroom.invoice_balances is a sum over invoice_items, so
--      both invoices were permanently billed ₦0 — which the view's own
--      standing logic then reads as "paid" regardless of whether anyone
--      paid anything.
--   4. Bursary's invoice list shows the student's name by looking up
--      student_id, which is null on these same invoices (the applicant is
--      not a student yet) — so it fell back to the literal word "Student".
--
-- Run after 114. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   1. payable_now() — security definer with an explicit ownership check,
   instead of leaning on RLS across two tables it doesn't fully control.
   is_my_invoice() already recognises an applicant on their own
   application/acceptance-fee invoice (043_admissions_validation_fixes.sql),
   so this is the same authorisation pay-init already trusted — just
   evaluated directly rather than through a join that happened to also need
   membership on classroom.schools.
   --------------------------------------------------------------------------- */
create or replace function classroom.payable_now(target_invoice uuid)
returns table (
  invoice_id  uuid,
  reference   text,
  school_id   uuid,
  currency    text,
  balance     numeric,
  payer_email text,
  school_name text
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    b.invoice_id,
    b.reference,
    b.school_id,
    s.currency,
    b.balance,
    coalesce(auth.jwt() ->> 'email', ''),
    s.name
  from classroom.invoice_balances b
  join classroom.schools s on s.id = b.school_id
  where b.invoice_id = target_invoice
    and classroom.is_my_invoice(target_invoice)
$fn$;

grant execute on function classroom.payable_now(uuid) to authenticated;


/* ---------------------------------------------------------------------------
   2. A way out of "processing" — reverts to unpaid so the same invoice can
   be paid again. Guarded to the applicant's own application, and only acts
   when genuinely stuck in processing (a no-op otherwise, same idempotent
   shape as pay_application_fee_initiated).
   --------------------------------------------------------------------------- */
create or replace function classroom.cancel_application_payment_attempt(
  target_application uuid
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  actually_changed boolean := false;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot cancel payment on this application';
  end if;

  update classroom.applications
  set payment_state = 'unpaid', updated_at = now()
  where id = target_application and payment_state = 'processing'
  returning * into app;

  if found then
    actually_changed := true;
  else
    select * into app from classroom.applications where id = target_application;
  end if;

  if actually_changed then
    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (target_application, app.status, app.status, auth.uid(), 'Applicant',
       'Cancelled the payment attempt — can try again');
  end if;

  return app;
end;
$fn$;

grant execute on function classroom.cancel_application_payment_attempt(uuid) to authenticated;


/* ---------------------------------------------------------------------------
   3. The missing invoice_items. Both functions are reproduced in full
   (create or replace needs the whole body) with one insert added each,
   right after the invoice itself is created — everything else is
   unchanged from 040/050.
   --------------------------------------------------------------------------- */
create or replace function classroom.start_application(
  target_session   uuid,
  target_programme uuid default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  sess       classroom.sessions;
  acct       classroom.applicant_accounts;
  cfg        jsonb;
  app        classroom.applications;
  new_ref    text;
  next_seq   int;
  invoice_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to start an application';
  end if;

  select * into sess from classroom.sessions where id = target_session;
  if not found then
    raise exception 'That admission session no longer exists';
  end if;
  if not sess.applications_open then
    raise exception 'Applications are not open for that session yet';
  end if;

  select * into acct from classroom.applicant_accounts
  where school_id = sess.school_id and user_id = auth.uid();
  if not found then
    raise exception 'Create your applicant account for this school first';
  end if;

  -- Serialise reference numbering per school/session. Same technique as
  -- submit_application(); guarantees no two concurrent starts collide.
  perform pg_advisory_xact_lock(hashtext(sess.school_id::text || ':' || sess.id::text));

  select coalesce(max(seq), 0) + 1 into next_seq
  from classroom.applications
  where school_id = sess.school_id and session_id = sess.id;

  new_ref := format(
    '%s/%s/%s',
    (select coalesce(nullif(substring(regexp_replace(upper(name), '[^A-Z]', '', 'g') from 1 for 3), ''), 'APP')
       from classroom.schools where id = sess.school_id),
    classroom.reference_year(sess.name),
    lpad(next_seq::text, 4, '0')
  );

  -- Personal name filled from the applicant account; the form pass fills
  -- in whatever else the school configured as required.
  insert into classroom.applications
    (school_id, session_id, reference, seq, applicant_id, programme_id,
     first_name, surname, middle_name, date_of_birth,
     guardian_name, guardian_email,
     status, form_state)
  values
    (sess.school_id, sess.id, new_ref, next_seq, acct.id, target_programme,
     acct.first_name, acct.surname, acct.middle_name, acct.date_of_birth,
     acct.first_name || ' ' || acct.surname, acct.email,
     'draft'::classroom.application_status, 'draft')
  returning * into app;

  -- Apply the admission-config fee rules.
  cfg := classroom.effective_admission_config(sess.school_id, sess.id);
  if coalesce((cfg->>'application_fee_enabled')::boolean, false) then
    -- Invoice generated on the existing bursary table. The bursary UI
    -- already handles the payment/verification lifecycle — we just add
    -- purpose='application_fee' and the application_id link.
    insert into classroom.invoices (
      school_id, session_id, structure_id, student_id,
      reference, seq, status, purpose, application_id, notes, issued_at, created_by
    ) values (
      sess.school_id, sess.id, null, null,
      new_ref || '-AF',
      next_seq,
      'issued',
      'application_fee',
      app.id,
      'Application fee — ' || new_ref,
      now(),
      auth.uid()
    )
    returning id into invoice_id;

    -- The line item invoice_balances actually sums. Without this the
    -- invoice is permanently billed ₦0 and reads as "paid" on arrival.
    insert into classroom.invoice_items (invoice_id, name, amount, position)
    values (invoice_id, 'Application fee', coalesce((cfg->>'application_fee_amount')::numeric, 0), 0);

    update classroom.applications
    set payment_state = 'unpaid'
    where id = app.id
    returning * into app;
  end if;

  -- Timeline entry.
  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, null, 'draft'::classroom.application_status, auth.uid(),
     'Applicant',
     case
       when coalesce((cfg->>'application_fee_enabled')::boolean, false)
         then 'Application started, fee invoice generated'
       else 'Application started'
     end);

  return app;
end;
$fn$;

grant execute on function classroom.start_application(uuid, uuid) to authenticated;


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

    -- Same fix as the application fee above — the amount invoice_balances
    -- actually sums.
    insert into classroom.invoice_items (invoice_id, name, amount, position)
    values (invoice_id, 'Acceptance fee', coalesce((cfg->>'acceptance_fee_amount')::numeric, 0), 0);

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


/* ---------------------------------------------------------------------------
   4. The applicant's name on an admissions invoice. invoice_balances is
   security_invoker, so a plain join to classroom.applications here would
   come back null for a bursar — "admissions staff read applications" only
   grants owner/admin/admissions, not bursar, and a bursar is exactly who
   needs to see this name. A security definer function sidesteps that, but
   it is grantable to every authenticated user (it has to be, to be callable
   from inside the invoker view for whoever is querying it) — so unlike the
   view, it cannot lean on classroom.invoices' RLS to keep a stranger from
   simply calling it with a guessed or leaked invoice id. The same ownership
   check invoices' own SELECT policies apply (030/043) is repeated explicitly
   here instead.
   --------------------------------------------------------------------------- */
create or replace function classroom.invoice_applicant_name(target_invoice uuid)
returns text
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select nullif(btrim(a.first_name || ' ' || a.surname), '')
  from classroom.invoices i
  join classroom.applications a on a.id = i.application_id
  where i.id = target_invoice
    and (classroom.can_do_bursary(i.school_id) or classroom.is_my_invoice(i.id));
$fn$;

revoke all on function classroom.invoice_applicant_name(uuid) from public;
grant execute on function classroom.invoice_applicant_name(uuid) to authenticated;

create or replace view classroom.invoice_balances with (security_invoker = true) as
select
  i.id            as invoice_id,
  i.school_id,
  i.student_id,
  i.session_id,
  i.term_id,
  i.class_id,
  i.reference,
  i.status,
  i.due_on,
  i.discount,
  i.discount_reason,
  i.issued_at,
  coalesce(items.gross, 0)                              as gross,
  coalesce(items.gross, 0) - i.discount                 as payable,
  coalesce(paid.approved, 0)                            as paid,
  coalesce(items.gross, 0) - i.discount - coalesce(paid.approved, 0) as balance,
  coalesce(pending.waiting, 0)                          as awaiting_approval,
  case
    when i.status = 'cancelled' then 'cancelled'
    when coalesce(items.gross, 0) - i.discount - coalesce(paid.approved, 0) <= 0 then 'paid'
    when coalesce(paid.approved, 0) > 0 then 'part paid'
    when i.due_on is not null and i.due_on < current_date then 'overdue'
    else 'unpaid'
  end                                                   as standing,
  -- New: only ever non-null for an admissions invoice (student_id is null
  -- on those), and only when the caller could already see this row.
  case
    when i.student_id is null then classroom.invoice_applicant_name(i.id)
    else null
  end                                                   as applicant_name
from classroom.invoices i
left join lateral (
  select sum(amount) as gross from classroom.invoice_items where invoice_id = i.id
) items on true
left join lateral (
  select sum(amount) as approved from classroom.payments
  where invoice_id = i.id and status = 'approved'
) paid on true
left join lateral (
  select sum(amount) as waiting from classroom.payments
  where invoice_id = i.id and status = 'submitted'
) pending on true;

grant select on classroom.invoice_balances to authenticated;

notify pgrst, 'reload schema';
