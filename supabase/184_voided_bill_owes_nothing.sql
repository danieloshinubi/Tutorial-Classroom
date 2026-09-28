-- A voided bill owes nothing, and takes no money.
--
-- Found in testing the store: voiding a sale cancelled its bill, and Bursary
-- then showed that cancelled bill with "Balance ₦6,000" and a working "Take
-- payment" form. Not a store bug — every voided bill did this. The balance
-- was billed-minus-paid whatever the bill's status, so a cancelled bill still
-- "owed" its full amount wherever balance was read.
--
-- Four changes:
--   1. invoice_balances: a cancelled bill's balance is 0. Everything else in
--      the view is exactly as it was — read from the live definition — and
--      security_invoker stays on: it is what makes a parent see only their
--      own family's bills. Leaving it out would have shown every parent
--      every bill in the school.
--   2. approve_payment refuses a payment on a cancelled bill (it had no
--      status check at all). Taking a payment at the desk, a family declaring
--      one, and online payments already refused anything but an issued bill.
--   3. cancel_invoice refuses while a family's declared payment is still
--      waiting, so it cannot be left hanging on a cancelled bill. (Voiding a
--      store sale goes through cancel_invoice and inherits this.)
--   4. The bursary's direct-insert policy on payments now also requires an
--      issued bill. Nothing in the app inserts that way — the desk goes
--      through take_payment — so this only closes a path around it.

create or replace view classroom.invoice_balances
with (security_invoker = true)
as
SELECT i.id AS invoice_id,
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
    COALESCE(items.gross, 0::numeric) AS gross,
    COALESCE(items.gross, 0::numeric) - i.discount AS payable,
    COALESCE(paid.approved, 0::numeric) AS paid,
    CASE
            WHEN i.status = 'cancelled'::classroom.invoice_status THEN 0::numeric
            ELSE COALESCE(items.gross, 0::numeric) - i.discount - COALESCE(paid.approved, 0::numeric)
        END AS balance,
    COALESCE(pending.waiting, 0::numeric) AS awaiting_approval,
        CASE
            WHEN i.status = 'cancelled'::classroom.invoice_status THEN 'cancelled'::text
            WHEN (COALESCE(items.gross, 0::numeric) - i.discount - COALESCE(paid.approved, 0::numeric)) <= 0::numeric THEN 'paid'::text
            WHEN COALESCE(paid.approved, 0::numeric) > 0::numeric THEN 'part paid'::text
            WHEN i.due_on IS NOT NULL AND i.due_on < CURRENT_DATE THEN 'overdue'::text
            ELSE 'unpaid'::text
        END AS standing,
        CASE
            WHEN i.student_id IS NULL THEN classroom.invoice_applicant_name(i.id)
            ELSE NULL::text
        END AS applicant_name,
    i.purpose
   FROM classroom.invoices i
     LEFT JOIN LATERAL ( SELECT sum(invoice_items.amount) AS gross
           FROM classroom.invoice_items
          WHERE invoice_items.invoice_id = i.id) items ON true
     LEFT JOIN LATERAL ( SELECT sum(payments.amount) AS approved
           FROM classroom.payments
          WHERE payments.invoice_id = i.id AND payments.status = 'approved'::classroom.payment_status) paid ON true
     LEFT JOIN LATERAL ( SELECT sum(payments.amount) AS waiting
           FROM classroom.payments
          WHERE payments.invoice_id = i.id AND payments.status = 'submitted'::classroom.payment_status) pending ON true;

CREATE OR REPLACE FUNCTION classroom.approve_payment(target_payment uuid, decision text DEFAULT NULL::text)
 RETURNS classroom.payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
declare
  pay classroom.payments;
  inv classroom.invoices;
  app classroom.applications;
  is_admissions boolean;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  if not classroom.can_do_bursary(pay.school_id) then
    raise exception 'Only the bursary can approve a payment';
  end if;

  if pay.status <> 'submitted' then
    raise exception 'That payment is already %', pay.status;
  end if;

  select * into inv from classroom.invoices where id = pay.invoice_id;

  -- A voided bill takes no money. Without this, a payment the family
  -- declared before the bill was voided could still be approved after it,
  -- leaving real money attached to a cancelled bill (found in testing).
  if inv.status = 'cancelled' then
    raise exception 'Invoice % was voided, so this payment cannot be approved. Reject it, and refund the family if the money did arrive.', inv.reference;
  end if;
  is_admissions := inv.purpose in ('application_fee', 'acceptance_fee') and inv.application_id is not null;

  -- Admissions-only guard, same wording verify_application_payment() already
  -- uses. Never applies to a term-fee invoice.
  if is_admissions and pay.submitted_by is not null and pay.submitted_by = auth.uid() then
    raise exception 'You submitted this payment; somebody else must confirm it';
  end if;

  update classroom.payments
  set status = 'approved', decided_by = auth.uid(),
      decided_at = now(), decision_note = decision
  where id = target_payment
  returning * into pay;

  if is_admissions then
    update classroom.applications
    set payment_state = 'verified', updated_at = now()
    where id = inv.application_id and payment_state <> 'verified'
    returning * into app;

    if found then
      insert into classroom.application_events
        (application_id, status_from, status_to, actor_id, actor_label, note)
      values
        (app.id, app.status, app.status, auth.uid(), 'Bursary',
         format('%s payment confirmed by the bursary',
           case when inv.purpose = 'acceptance_fee' then 'Acceptance-fee' else 'Application-fee' end));

      -- The applicant — same kind verify_acceptance_payment() already uses.
      insert into classroom.notifications (user_id, school_id, kind, title, body, link)
      select ac.user_id, app.school_id, 'admission_payment_verified',
             format('%s: fee confirmed', app.reference),
             'Your payment has been confirmed by the bursary.',
             format('/Applications/%s', app.id)
      from classroom.applicant_accounts ac where ac.id = app.applicant_id;

      -- The admissions team — new. decide_application() gates on
      -- payment_state = 'verified', so this is the signal that lets them
      -- actually move the application forward. Same recipient shape
      -- accept_offer() already uses for "notify the finalisers".
      insert into classroom.notifications (user_id, school_id, kind, title, body, link)
      select m.user_id, app.school_id, 'admission_payment_confirmed',
             format('%s: fee confirmed', app.reference),
             format('%s %s — %s against %s, confirmed by the bursary.',
               app.first_name, app.surname, to_char(pay.amount, 'FM999,999,999.00'), inv.reference),
             format('/AdmissionsWorkspace/%s', app.id)
      from classroom.school_members m
      where m.school_id = app.school_id and m.is_active
        and m.role in ('owner','admin','principal','admissions');
    end if;
  else
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select recipient, pay.school_id, 'payment_approved',
           'Payment received',
           format('%s against %s', to_char(pay.amount, 'FM999,999,999.00'), inv.reference),
           '/Fees'
    from lateral (
      select inv.student_id as recipient
      union
      select g.guardian_id from classroom.guardian_students g where g.student_id = inv.student_id
    ) people
    where recipient is not null;
  end if;

  return pay;
end;
$function$;

CREATE OR REPLACE FUNCTION classroom.cancel_invoice(target_invoice uuid, reason text)
 RETURNS classroom.invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
declare
  inv  classroom.invoices;
  paid numeric;
begin
  select * into inv from classroom.invoices where id = target_invoice;
  if not found then
    raise exception 'No such invoice';
  end if;

  if not classroom.can_do_bursary(inv.school_id) then
    raise exception 'Only the bursary can cancel an invoice';
  end if;

  if btrim(coalesce(reason, '')) = '' then
    raise exception 'Say why the invoice is being cancelled';
  end if;

  select coalesce(sum(amount), 0) into paid
  from classroom.payments
  where invoice_id = target_invoice and status = 'approved';

  -- Money has been taken against this. Cancelling it would leave an approved
  -- payment attached to nothing, which is how a refund goes missing.
  if paid > 0 then
    raise exception 'Approved payments totalling % are attached to this invoice — refund or move them first', paid;
  end if;

  -- A payment the family has declared but nobody has decided yet would be
  -- left hanging on a cancelled bill — and approve_payment now refuses it —
  -- so it has to be dealt with first.
  if exists (select 1 from classroom.payments
             where invoice_id = target_invoice and status = 'submitted') then
    raise exception 'A payment the family declared on this invoice is still waiting. Approve or reject it under Bursary → Payments first.';
  end if;

  update classroom.invoices
  set status = 'cancelled', cancelled_at = now(),
      cancel_reason = btrim(reason), updated_at = now()
  where id = target_invoice
  returning * into inv;

  return inv;
end;
$function$;

drop policy if exists "bursary records a payment" on classroom.payments;
create policy "bursary records a payment" on classroom.payments
  for insert to authenticated
  with check (
    classroom.can_do_bursary(school_id)
    and exists (
      select 1 from classroom.invoices i
      where i.id = payments.invoice_id and i.status = 'issued'::classroom.invoice_status
    )
  );
