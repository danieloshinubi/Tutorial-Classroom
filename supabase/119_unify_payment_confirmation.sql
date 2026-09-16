-- =============================================================================
-- One Approve/Reject button, correct for every kind of invoice.
--
-- The Bursary "Payment queue" UI has exactly two call sites — approvePayment
-- and rejectPayment — for every declared payment regardless of what it's
-- for. Rather than add a parallel "confirm admissions payment" path the UI
-- would have to choose between, approve_payment()/reject_payment() are
-- extended in place: when the invoice is an application/acceptance fee, they
-- now also sync classroom.applications.payment_state and notify both the
-- applicant and the admissions team, exactly the way settle_online_payment()
-- was already extended in place in 050_admissions_phase3_functions.sql for
-- the identical reason — it's the one function every caller already uses.
-- A plain term-fee invoice keeps its existing behaviour untouched.
--
-- The second parameter is named `decision`, not `note` — copied from
-- 031_fix_payment_note_ambiguity.sql, not the original 030 version it
-- superseded. classroom.payments has its own `note` column, and
-- `set decision_note = note` inside an UPDATE is genuinely ambiguous
-- (table columns are in scope there, unlike INSERT ... VALUES) — that's
-- the exact bug 031 already fixed once; reproducing 030's signature here
-- would silently reintroduce it for every payment, not just admissions
-- ones, and would also stop matching src/lib/api.js's approvePayment/
-- rejectPayment, which already call this RPC with a `decision` argument.
--
-- Also: invoice_balances gains `purpose`, appended as the LAST column
-- (CREATE OR REPLACE VIEW only allows new columns at the end — inserting
-- it in the middle, as an earlier draft of this migration did, fails to
-- apply at all). And a real RLS gap this uncovers — a family's own
-- "fix"/"withdraw" policies on a submitted payment don't yet distinguish a
-- genuine self-declaration from a gateway-sourced row (which can also land
-- as 'submitted' once 120_gateway_confirmation_required.sql ships) — is
-- closed now rather than left open in between migrations.
--
-- Run after 118. Safe to re-run.
-- =============================================================================

drop function if exists classroom.approve_payment(uuid, text);
drop function if exists classroom.reject_payment(uuid, text);

create or replace function classroom.approve_payment(
  target_payment uuid,
  decision       text default null
)
returns classroom.payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
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
$fn$;


create or replace function classroom.reject_payment(
  target_payment uuid,
  decision       text
)
returns classroom.payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
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
    raise exception 'Only the bursary can reject a payment';
  end if;

  -- Telling a parent (or an applicant) their money was refused without
  -- saying why is how a bursary spends its week on the phone.
  if btrim(coalesce(decision, '')) = '' then
    raise exception 'Say why the payment is being rejected';
  end if;

  if pay.status <> 'submitted' then
    raise exception 'That payment is already %', pay.status;
  end if;

  update classroom.payments
  set status = 'rejected', decided_by = auth.uid(),
      decided_at = now(), decision_note = btrim(decision)
  where id = target_payment
  returning * into pay;

  select * into inv from classroom.invoices where id = pay.invoice_id;
  is_admissions := inv.purpose in ('application_fee', 'acceptance_fee') and inv.application_id is not null;

  if is_admissions then
    -- Guarded so a stray duplicate rejection can never undo an
    -- already-confirmed fee.
    update classroom.applications
    set payment_state = 'rejected', updated_at = now()
    where id = inv.application_id and payment_state <> 'verified'
    returning * into app;

    if found then
      insert into classroom.application_events
        (application_id, status_from, status_to, actor_id, actor_label, note)
      values
        (app.id, app.status, app.status, auth.uid(), 'Bursary',
         format('%s payment rejected — %s',
           case when inv.purpose = 'acceptance_fee' then 'Acceptance-fee' else 'Application-fee' end,
           btrim(decision)));

      -- The applicant needs to know both that it was rejected and why, so
      -- they know a retry (pay_application_fee_initiated /
      -- declare_admissions_payment both accept 'rejected' as retryable) is
      -- what happens next.
      insert into classroom.notifications (user_id, school_id, kind, title, body, link)
      select ac.user_id, app.school_id, 'admission_payment_declined',
             format('%s: payment could not be confirmed', app.reference),
             btrim(decision),
             format('/Applications/%s', app.id)
      from classroom.applicant_accounts ac where ac.id = app.applicant_id;
    end if;
  else
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select recipient, pay.school_id, 'payment_rejected',
           'A payment could not be accepted',
           format('%s against %s — %s',
                  to_char(pay.amount, 'FM999,999,999.00'), inv.reference, btrim(decision)),
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
$fn$;

grant execute on function classroom.approve_payment(uuid, text) to authenticated;
grant execute on function classroom.reject_payment(uuid, text)  to authenticated;


/* ---------------------------------------------------------------------------
   invoice_balances gains `purpose` — appended as the LAST column (CREATE OR
   REPLACE VIEW requires every pre-existing column to keep its name and
   position; a new one is only ever allowed at the end) — so the Bursary
   queue can label a row as a term fee / application fee / acceptance fee
   instead of guessing from its reference suffix.
   --------------------------------------------------------------------------- */
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
  case
    when i.student_id is null then classroom.invoice_applicant_name(i.id)
    else null
  end                                                   as applicant_name,
  i.purpose
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


/* ---------------------------------------------------------------------------
   A gateway-sourced 'submitted' row (once 120_gateway_confirmation_required
   ships) is not a family's own declaration — it's the record of money the
   gateway already reports as taken. These two policies previously let
   whoever is named as submitted_by edit or delete ANY submitted payment,
   which would let a family erase a real, already-charged payment before a
   bursar ever reviews it. Scoping both to `gateway_ref is null` limits them
   to genuinely family-authored declarations, exactly as originally
   intended.
   --------------------------------------------------------------------------- */
drop policy if exists "families fix a waiting declaration" on classroom.payments;
create policy "families fix a waiting declaration"
  on classroom.payments for update to authenticated
  using (status = 'submitted' and submitted_by = auth.uid() and gateway_ref is null and classroom.is_my_invoice(invoice_id))
  with check (status = 'submitted' and submitted_by = auth.uid() and gateway_ref is null);

drop policy if exists "families withdraw a waiting declaration" on classroom.payments;
create policy "families withdraw a waiting declaration"
  on classroom.payments for delete to authenticated
  using (status = 'submitted' and submitted_by = auth.uid() and gateway_ref is null and classroom.is_my_invoice(invoice_id));

notify pgrst, 'reload schema';
