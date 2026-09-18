-- =============================================================================
-- Two admissions-payment gaps closed together:
--
-- 1. Nothing stopped a screening phase from starting before the application
--    fee was verified. decide_application() already refuses to finalise a
--    decision (offered/rejected/waitlisted/deferred) on an unpaid fee
--    (095_scope_decide_and_promote_to_school.sql), but the actual, real
--    entry point into screening — create_application_screening_items(), the
--    RPC behind AdmissionsWorkspace's "Prepare items from config" button —
--    had no such check. applications.status never actually moves to the
--    'screening' enum value anywhere in the current frontend (only
--    screening_state does, driven entirely by this RPC), so gating
--    decide_application for that status would have guarded a path nothing
--    takes. This is the path that matters.
--
-- 2. When an applicant declares "I've paid by transfer", or a gateway
--    payment settles into a school's "require bursary confirmation" queue,
--    nothing told the bursary team it was waiting on them — only an
--    application_events timeline breadcrumb, visible only to someone who
--    happens to already have that one application open. Bursary staff had
--    to remember to keep checking the Payments tab. Both call sites now
--    also insert a classroom.notifications row for every owner/admin/bursar
--    at the school (the same role set classroom.can_do_bursary() already
--    uses to decide who can act on the Payment queue), linking straight to
--    /Bursary.
--
-- Run after 120.
-- =============================================================================

drop function if exists classroom.create_application_screening_items(uuid, uuid);

create or replace function classroom.create_application_screening_items(
  target_application uuid,
  target_school      uuid
) returns setof classroom.application_screening_items
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  cfg jsonb;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;
  if app.school_id <> target_school then
    raise exception 'Application does not belong to this school';
  end if;
  if not classroom.can_do_admissions(app.school_id) then
    raise exception 'Only admissions staff can prepare screening items';
  end if;

  cfg := classroom.effective_admission_config(app.school_id, app.session_id);
  if coalesce((cfg->>'application_fee_enabled')::boolean, false)
     and app.payment_state <> 'verified' then
    raise exception 'The application fee must be verified before screening can begin';
  end if;

  insert into classroom.application_screening_items
    (application_id, requirement_id, kind, label, is_required, position)
  select
    target_application, r.id, r.kind, r.label, r.is_required, r.position
  from classroom.screening_requirements r
  where r.school_id = app.school_id
    and (r.session_id is null   or r.session_id   = app.session_id)
    and (r.programme_id is null or r.programme_id = app.programme_id)
    and not exists (
      select 1 from classroom.application_screening_items i
      where i.application_id = target_application and i.kind = r.kind
    );

  return query
    select * from classroom.application_screening_items
    where application_id = target_application
    order by position, label;
end;
$fn$;

grant execute on function classroom.create_application_screening_items(uuid, uuid) to authenticated;


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

    -- Put it in front of the people who can actually act on it, rather
    -- than leaving it to be found by whoever next opens the Payments tab.
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select m.user_id, app.school_id, 'admission_payment_declared',
           format('%s: payment declared — needs confirming', app.reference),
           format('%s %s says they paid the %s fee by %s. Confirm it in the Payment queue.',
             app.first_name, app.surname,
             case when inv.purpose = 'acceptance_fee' then 'acceptance' else 'application' end,
             coalesce(pay.method::text, 'transfer')),
           '/Bursary'
    from classroom.school_members m
    where m.school_id = app.school_id and m.is_active
      and m.role in ('owner','admin','bursar');
  end if;

  return pay;
end;
$fn$;

grant execute on function classroom.declare_admissions_payment(
  uuid, numeric, classroom.payment_method, text, date, text, text
) to authenticated;


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
      insert into classroom.application_events
        (application_id, status_from, status_to, actor_id, actor_label, note)
      select a.id, a.status, a.status, null, 'Payment gateway',
             format('%s payment reported by gateway (ref %s) — awaiting bursary confirmation',
               case when inv.purpose = 'acceptance_fee' then 'Acceptance-fee' else 'Application-fee' end,
               gateway_reference)
      from classroom.applications a where a.id = inv.application_id;

      insert into classroom.notifications (user_id, school_id, kind, title, body, link)
      select m.user_id, a.school_id, 'admission_payment_declared',
             format('%s: gateway payment needs confirming', a.reference),
             format('The %s fee was reported paid via %s. Confirm it in the Payment queue.',
               case when inv.purpose = 'acceptance_fee' then 'acceptance' else 'application' end,
               gateway_name),
             '/Bursary'
      from classroom.applications a
      join classroom.school_members m on m.school_id = a.school_id and m.is_active
      where a.id = inv.application_id
        and m.role in ('owner','admin','bursar');
    end if;
  end if;

  return pay;
end;
$fn$;

revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) from public;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) from authenticated;
revoke all on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) from anon;
grant execute on function classroom.settle_online_payment(uuid, numeric, text, text, numeric, uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
