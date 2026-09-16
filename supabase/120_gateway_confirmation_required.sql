-- =============================================================================
-- settle_online_payment() respects the per-school "require bursary
-- confirmation for gateway payments too" toggle (classroom.payment_gateways.
-- require_confirmation, see 116).
--
-- No new payment_state value is needed. When confirmation is required, the
-- payment row is inserted 'submitted' instead of 'approved' — exactly the
-- shape a family's own declared payment already takes — and
-- classroom.applications.payment_state simply stays at 'processing' (it was
-- already set there before checkout began, by pay_application_fee_
-- initiated() or declare_admissions_payment()) until a bursar confirms
-- through the now-admissions-aware approve_payment()/reject_payment()
-- (119_unify_payment_confirmation.sql). The existing Payment queue already
-- lists every 'submitted' row school-wide, so this needs no new UI surface.
--
-- The toggle is read FRESH at settlement time, not carried in the
-- checkout's own metadata — so a school flipping it between "start
-- checkout" and "webhook arrives" can never produce a stale decision. A
-- school with no payment_gateways row at all (should not happen after 116's
-- backfill + seed trigger, but never assume) falls back to false — today's
-- exact behaviour — which is the load-bearing backward-compatibility
-- guarantee for this migration.
--
-- payments_gateway_ref_once (035_online_payments.sql) already makes this
-- idempotent regardless of which status a retried webhook finds.
--
-- SECURITY: verified_school_id. Once a school can hold its own real,
-- valid signing secret (BYO mode), a school that legitimately knows its
-- own secret could otherwise sign a payload naming a DIFFERENT school's
-- invoice — the webhook's signature check only proves "this came from
-- whoever holds gatewayId's secret", not "gatewayId's school is the one
-- this payment is for". The Edge Function resolves gatewayId to a school
-- BEFORE verifying (see paystack-webhook/index.ts) and passes that
-- verified school id here; this function now refuses to settle a payment
-- against an invoice belonging to any other school. Null (no gatewayId
-- resolved — the platform-credential fallback for a pre-migration
-- checkout in flight during deploy) skips the check, matching the single
-- shared-secret trust model that already existed before this feature.
--
-- Run after 119. Safe to re-run.
-- =============================================================================

create or replace function classroom.settle_online_payment(
  target_invoice uuid,
  paid_amount    numeric,
  gateway_name   text,
  gateway_reference text,
  gateway_fee    numeric default null,
  payer          uuid default null,
  gateway_mode   text default null,
  verified_school_id uuid default null
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
  wants_confirmation boolean;
  settled_status classroom.payment_status;
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

  if verified_school_id is not null and inv.school_id is distinct from verified_school_id then
    -- The signature was genuinely valid — for a DIFFERENT school's
    -- gateway than the one this invoice belongs to. Never settle across
    -- that boundary regardless of how plausible the rest of the payload
    -- looks.
    raise exception 'This payment does not belong to the gateway that verified it';
  end if;

  if inv.status <> 'issued' then
    raise exception 'Invoice % is %, so nothing can be paid against it',
      inv.reference, inv.status;
  end if;

  if paid_amount is null or paid_amount <= 0 then
    raise exception 'A payment has to be more than nothing';
  end if;

  select require_confirmation into wants_confirmation
  from classroom.payment_gateways where school_id = inv.school_id;
  wants_confirmation := coalesce(wants_confirmation, false);
  settled_status := case when wants_confirmation then 'submitted' else 'approved' end;

  insert into classroom.payments (
    school_id, invoice_id, amount, method, status,
    reference, paid_on, submitted_by, decided_by, decided_at,
    decision_note, gateway, gateway_ref, gateway_fee, gateway_mode
  ) values (
    inv.school_id, target_invoice, paid_amount, 'online', settled_status,
    gateway_reference, current_date, payer,
    case when settled_status = 'approved' then payer else null end,
    case when settled_status = 'approved' then now() else null end,
    case when settled_status = 'approved' then format('Paid online through %s', gateway_name) else null end,
    gateway_name, gateway_reference, gateway_fee, gateway_mode
  )
  returning * into pay;

  if settled_status = 'approved' then
    -- Unchanged: notify the family (term-fee case) — only ever fires once
    -- actually settled, exactly as before this migration.
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
  end if;

  if inv.purpose in ('application_fee', 'acceptance_fee') and inv.application_id is not null then
    if settled_status = 'approved' then
      -- Unchanged Phase-3 behaviour: auto-verified, applicant notified.
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
    else
      -- Confirmation required: payment_state stays at 'processing' (already
      -- set before checkout began) until a bursar confirms via
      -- approve_payment()/reject_payment(). Leave a timeline breadcrumb so
      -- the applicant isn't staring at silence during the wait.
      insert into classroom.application_events
        (application_id, status_from, status_to, actor_id, actor_label, note)
      select a.id, a.status, a.status, null, 'Payment gateway',
             format('%s payment reported by gateway (ref %s) — awaiting bursary confirmation',
               case when inv.purpose = 'acceptance_fee' then 'Acceptance-fee' else 'Application-fee' end,
               gateway_reference)
      from classroom.applications a where a.id = inv.application_id;
    end if;
  end if;

  return pay;
end;
$fn$;

revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) from public;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) from authenticated;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) from anon;
grant execute on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) to service_role;

-- The old 6- and 7-argument signatures are superseded by the 8-argument one
-- above (gateway_mode, then verified_school_id, added) — drop both so
-- PostgREST/Postgres never has more than one overload of this function
-- silently coexisting.
drop function if exists classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid);
drop function if exists classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text);

notify pgrst, 'reload schema';
