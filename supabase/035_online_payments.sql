-- =============================================================================
-- Paying online
--
-- The rule that shapes all of this: the browser is not trusted with the
-- amount, and the browser is never told the secret key.
--
-- What happens:
--
--   1. The family presses Pay. The client sends only an invoice id to an Edge
--      Function.
--   2. The function reads the OUTSTANDING BALANCE from this database, as that
--      user, and initialises a Paystack transaction for that figure. Nothing
--      the client said about money is used.
--   3. Paystack calls the webhook. The function checks the signature against
--      the secret, then calls settle_online_payment() below.
--
-- settle_online_payment() is deliberately not callable by a signed-in user:
-- it is granted to service_role only. A family cannot mark their own fees
-- paid by calling it, which is exactly the hole that a client-side "payment
-- successful, please credit me" callback leaves open.
--
-- Idempotency matters here more than anywhere else in the system. Paystack
-- retries a webhook it did not get a 200 for, and a parent who refreshes the
-- callback page produces a second verify. A unique index on the gateway
-- reference means the second one changes nothing rather than crediting twice.
-- =============================================================================

alter table classroom.payments
  add column if not exists gateway text,
  add column if not exists gateway_ref text,
  add column if not exists gateway_fee numeric(14,2);

-- One payment per Paystack reference. This is the whole defence against
-- double-crediting a retried webhook.
create unique index if not exists payments_gateway_ref_once
  on classroom.payments (gateway, gateway_ref)
  where gateway_ref is not null;

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

  return pay;
end;
$fn$;

-- service_role ONLY. Not authenticated, not anon. The webhook holds that key;
-- a browser never does.
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) from public;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) from authenticated;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) from anon;
grant execute on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid) to service_role;

-- What the Edge Function needs before it can charge anybody: is this invoice
-- really theirs, and what is actually outstanding on it? Runs as the caller,
-- so RLS decides, and returns the figure the gateway should be given.
create or replace function classroom.payable_now(target_invoice uuid)
returns table (
  invoice_id uuid,
  reference  text,
  school_id  uuid,
  currency   text,
  balance    numeric,
  payer_email text,
  school_name text
)
language sql
stable
security invoker
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
    and b.status = 'issued'
    and b.balance > 0;
$fn$;

grant execute on function classroom.payable_now(uuid) to authenticated;

notify pgrst, 'reload schema';
