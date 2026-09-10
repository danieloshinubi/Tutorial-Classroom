-- =============================================================================
-- Admissions validation pass — gateway verification writes one event only
--
-- A repeated Paystack webhook (same payment, same ref) was writing a second
-- "auto-verified" row to application_events. The payment state is correctly
-- idempotent — but the timeline should be too, so a nervous webhook does
-- not produce a stream of identical events.
--
-- Fix: only write the event when the UPDATE actually flips the row from
-- something other than approved to approved. Same for the applications row.
-- =============================================================================

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
  was_status classroom.payment_status;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  select * into inv from classroom.invoices where id = pay.invoice_id;
  if not found or inv.purpose <> 'application_fee' or inv.application_id is null then
    raise exception 'Not an application-fee payment';
  end if;

  if pay.gateway_ref is not null and pay.gateway_ref <> gateway_ref_in then
    raise exception 'This payment carries a different gateway reference';
  end if;

  was_status := pay.status;

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

  -- Only when the state actually moved: repeated webhooks stay silent.
  if was_status <> 'approved' then
    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (app.id, app.status, app.status, null, 'Payment gateway',
       format('Payment auto-verified by gateway (ref %s)', gateway_ref_in));
  end if;

  return app;
end;
$fn$;

revoke all on function classroom.verify_application_payment_gateway(uuid, text, numeric, timestamptz) from public, authenticated, anon;
