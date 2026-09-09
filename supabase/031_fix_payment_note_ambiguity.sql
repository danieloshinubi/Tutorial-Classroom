-- =============================================================================
-- Fix: approving or rejecting a payment failed with
--
--   column reference "note" is ambiguous
--
-- Both functions took a parameter called `note`, and payments has a column of
-- that name. In `set decision_note = note` Postgres cannot tell which is
-- meant and refuses the statement — so no payment could be approved at all.
--
-- The same mistake as on_comment_posted() in 020. Parameters are renamed to
-- `decision` rather than qualified, so the shadowing is gone instead of
-- worked around at one call site.
--
-- Only these two are affected. take_payment() and raise_invoice() also take
-- parameters that share a column name, but they use them inside INSERT ...
-- VALUES, where table columns are not in scope.
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

  update classroom.payments
  set status = 'approved', decided_by = auth.uid(),
      decided_at = now(), decision_note = decision
  where id = target_payment
  returning * into pay;

  select * into inv from classroom.invoices where id = pay.invoice_id;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select people.recipient, pay.school_id, 'payment_approved',
         'Payment received',
         format('%s against %s', to_char(pay.amount, 'FM999,999,999.00'), inv.reference),
         '/Fees'
  from lateral (
    select inv.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g where g.student_id = inv.student_id
  ) people
  where people.recipient is not null;

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
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  if not classroom.can_do_bursary(pay.school_id) then
    raise exception 'Only the bursary can reject a payment';
  end if;

  -- Telling a parent their money was refused without saying why is how a
  -- bursary spends its week on the phone.
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

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select people.recipient, pay.school_id, 'payment_rejected',
         'A payment could not be accepted',
         format('%s against %s — %s',
                to_char(pay.amount, 'FM999,999,999.00'), inv.reference, btrim(decision)),
         '/Fees'
  from lateral (
    select inv.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g where g.student_id = inv.student_id
  ) people
  where people.recipient is not null;

  return pay;
end;
$fn$;

grant execute on function classroom.approve_payment(uuid, text) to authenticated;
grant execute on function classroom.reject_payment(uuid, text)  to authenticated;

notify pgrst, 'reload schema';
