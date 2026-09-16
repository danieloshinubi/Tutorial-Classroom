-- =============================================================================
-- An applicant declaring "I've paid" for an application/acceptance fee.
--
-- A parent already has this for term fees: declarePayment() (src/lib/api.js)
-- does a plain client-side insert into classroom.payments, allowed straight
-- through by the "families declare a payment" RLS policy (030_bursary.sql).
-- That same raw insert would actually pass RLS for an admissions invoice too
-- — is_my_invoice() already recognises an applicant via applicant_accounts
-- (043_admissions_validation_fixes.sql) — but nothing would then keep
-- classroom.applications.payment_state in sync, which is exactly the kind
-- of second table write a plain client insert cannot do atomically. Hence a
-- real RPC here, the same reasoning 030_bursary.sql gives for why
-- take_payment() exists instead of a client doing insert-then-approve as
-- two separate calls.
--
-- Run after 117. Safe to re-run.
-- =============================================================================

create or replace function classroom.declare_admissions_payment(
  target_invoice uuid,
  amount         numeric,
  method         classroom.payment_method default 'transfer',
  reference      text default null,
  paid_on        date default current_date,
  note           text default null,
  proof_path     text default null
) returns classroom.payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv classroom.invoices;
  app classroom.applications;
  pay classroom.payments;
begin
  if not classroom.is_my_invoice(target_invoice) then
    raise exception 'That invoice is not yours';
  end if;

  select * into inv from classroom.invoices where id = target_invoice;
  if not found then
    raise exception 'No such invoice';
  end if;
  if inv.purpose not in ('application_fee', 'acceptance_fee') or inv.application_id is null then
    raise exception 'Use the regular payment form for this invoice';
  end if;
  if inv.status <> 'issued' then
    raise exception 'That invoice is %, so nothing can be paid against it', inv.status;
  end if;
  if amount is null or amount <= 0 then
    raise exception 'A payment has to be more than nothing';
  end if;

  select * into app from classroom.applications where id = inv.application_id;
  if app.payment_state = 'verified' then
    raise exception 'This fee has already been confirmed as paid';
  end if;

  insert into classroom.payments (
    school_id, invoice_id, amount, method, status, reference, paid_on, note, proof_path, submitted_by
  ) values (
    inv.school_id, target_invoice, amount, coalesce(method, 'transfer'), 'submitted',
    nullif(btrim(coalesce(reference, '')), ''), coalesce(paid_on, current_date),
    nullif(btrim(coalesce(note, '')), ''), proof_path, auth.uid()
  )
  returning * into pay;

  -- Same idempotent shape as pay_application_fee_initiated(): only a real
  -- transition gets a timeline entry, and 'processing' is shared with the
  -- gateway path deliberately — from the application's own point of view,
  -- "processing" already means exactly "an attempt is in, not yet
  -- confirmed", regardless of which path produced it.
  update classroom.applications
  set payment_state = 'processing', updated_at = now()
  where id = app.id and payment_state in ('unpaid', 'rejected')
  returning * into app;

  if found then
    insert into classroom.application_events
      (application_id, status_from, status_to, actor_id, actor_label, note)
    values
      (app.id, app.status, app.status, auth.uid(), 'Applicant',
       format('%s payment declared — awaiting bursary confirmation',
         case when inv.purpose = 'acceptance_fee' then 'Acceptance-fee' else 'Application-fee' end));
  end if;

  return pay;
end;
$fn$;

grant execute on function classroom.declare_admissions_payment(
  uuid, numeric, classroom.payment_method, text, date, text, text
) to authenticated;


/* ---------------------------------------------------------------------------
   Payment-proof uploads. may_touch_payment_proof() (033_payment_proof_
   storage.sql) only recognised student/guardian ownership — the same gap
   is_my_invoice() had before 043 fixed it for applicants. Without this, an
   applicant attaching a bank-transfer receipt to their application-fee
   invoice above would be refused by storage RLS.
   --------------------------------------------------------------------------- */
create or replace function classroom.may_touch_payment_proof(path_invoice text)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.invoices i
    where i.id = classroom.try_uuid(path_invoice)
      and (
        classroom.can_do_bursary(i.school_id)
        or i.student_id = auth.uid()
        or exists (
          select 1 from classroom.guardian_students g
          where g.student_id = i.student_id and g.guardian_id = auth.uid()
        )
        or (
          i.application_id is not null and exists (
            select 1
            from classroom.applications a
            join classroom.applicant_accounts ac on ac.id = a.applicant_id
            where a.id = i.application_id
              and ac.user_id = auth.uid()
          )
        )
      )
  );
$fn$;

grant execute on function classroom.may_touch_payment_proof(text) to authenticated;

notify pgrst, 'reload schema';
