-- =============================================================================
-- Email the bursary team the moment a payment is actually money in hand.
--
-- "Made" here means approved, not merely declared: classroom.payments picks
-- up an approved row along the same two shapes regardless of what the
-- invoice is for — a term-fee bill, or an admissions application/acceptance
-- fee (classroom.invoices.purpose; student_id and term_id are both null on
-- the latter two, see 043_admissions_validation_fixes.sql) —
--
--   direct-approved insert   nothing for a bursar to verify: take_payment()
--                            (a bursar counting cash at the desk, 030), or
--                            settle_online_payment() crediting a Paystack
--                            charge for a term fee (035) or, unchanged since
--                            050_admissions_phase3_functions.sql, an
--                            application/acceptance fee
--   submitted -> approved    a human decides: approve_payment() for a
--                            parent's declared transfer (030), or
--                            verify_application_payment() /
--                            verify_acceptance_payment() for admissions (040
--                            / 050)
--
-- A single trigger watching for the transition INTO approved — by insert or
-- by update — catches every one of these in one place, and never fires for
-- a payment that is only submitted or that gets rejected. Because it isn't
-- scoped to purpose = 'term_fee', get_payment_notification_context() below
-- has to tolerate a null student_id (falling back to classroom.applications
-- for the applicant's name) — an inner join there would silently drop every
-- admissions payment's notification.
--
-- The email itself is sent by an Edge Function (Postgres can't speak SMTP),
-- reusing the mailbox a school already connected for Tickets
-- (080_ticket_mailboxes.sql) rather than inventing a second "school mailbox"
-- concept — a school with no mailbox connected simply gets no emails yet,
-- exactly like an unconnected mailbox already means no inbound tickets.
-- Postgres reaches that function the same way 084_ticket_mail_cron.sql
-- reaches ticket-mail-poll: pg_net's http_post, fire-and-forget, proven with
-- a shared secret rather than a caller JWT (there is no signed-in user by
-- the time a trigger fires — the bursar who approved the payment is not who
-- this call should be authenticated as).
--
-- Run after 113. Safe to re-run.
-- =============================================================================

create extension if not exists pg_net;

/* ---------------------------------------------------------------------------
   Everything the Edge Function needs, in one call. service_role has no
   table-level grant on payments/invoices/profiles/schools/school_members/
   ticket_mailboxes (only `authenticated` does — the same gap 081 and 083
   already worked around for tickets), so this is the only way in: a single
   SECURITY DEFINER function granted to service_role alone, never a raw
   table read.
   --------------------------------------------------------------------------- */
create or replace function classroom.get_payment_notification_context(target_payment uuid)
returns table (
  school_id         uuid,
  school_name       text,
  currency          text,
  amount            numeric,
  method            classroom.payment_method,
  paid_on           date,
  payment_reference text,
  invoice_reference text,
  student_name      text,
  class_name        text,
  mailbox_id        uuid,
  recipients        text[]
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    pay.school_id,
    s.name,
    s.currency,
    pay.amount,
    pay.method,
    pay.paid_on,
    pay.reference,
    inv.reference,
    -- inv.student_id is null for an application/acceptance-fee invoice
    -- (043_admissions_validation_fixes.sql) — the applicant has no profile
    -- yet, so their name lives on classroom.applications instead.
    coalesce(
      nullif(btrim(sp.first_name || ' ' || sp.surname), ''), sp.username, sp.email,
      nullif(btrim(ap.first_name || ' ' || ap.surname), '')
    ),
    c.name,
    (
      select mb.id from classroom.ticket_mailboxes mb
      where mb.school_id = pay.school_id and mb.is_active and mb.provider = 'imap_smtp'
      order by mb.created_at
      limit 1
    ),
    (
      select array_agg(distinct bp.email) filter (where bp.email is not null)
      from classroom.school_members sm
      join classroom.profiles bp on bp.id = sm.user_id
      where sm.school_id = pay.school_id
        and sm.is_active
        and sm.role in ('owner', 'admin', 'bursar')
    )
  from classroom.payments pay
  join classroom.invoices inv on inv.id = pay.invoice_id
  left join classroom.profiles sp on sp.id = inv.student_id
  left join classroom.applications ap on ap.id = inv.application_id
  join classroom.schools s on s.id = pay.school_id
  left join classroom.classes c on c.id = inv.class_id
  where pay.id = target_payment;
$fn$;

revoke all on function classroom.get_payment_notification_context(uuid) from public;
grant execute on function classroom.get_payment_notification_context(uuid) to service_role;

/* ---------------------------------------------------------------------------
   The shared secret payment-notify checks. Same idea as
   ticket_mail_cron_secret (084) — proves a call came from our own database,
   not a stranger — kept separate from that one so the two integrations can
   be rotated independently. It still has to match whatever is set as the
   Edge Function's own PAYMENT_NOTIFY_SECRET environment secret; that part is
   a separate step (Supabase CLI/dashboard), not this migration:
     npx supabase secrets set PAYMENT_NOTIFY_SECRET=<the value below> --project-ref <ref>
   --------------------------------------------------------------------------- */
do $secret$
begin
  if not exists (select 1 from vault.secrets where name = 'payment_notify_secret') then
    perform vault.create_secret(
      '71dadc52068486fbe6aa00b52e52c513fae46da0e46a716b5eebd8dff350f19b',
      'payment_notify_secret',
      'Shared secret this trigger sends to the payment-notify Edge Function as x-cron-secret'
    );
  end if;
end;
$secret$;

/* ---------------------------------------------------------------------------
   The trigger. Fires once per genuine "money received" event and never
   blocks the payment itself — the money already moved (or the bursar
   already counted it), so a failed or misconfigured notification is not a
   reason to roll back the payment that triggered it.
   --------------------------------------------------------------------------- */
create or replace function classroom.notify_payment_received()
returns trigger
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
begin
  perform net.http_post(
    url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/payment-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'payment_notify_secret')
    ),
    body := jsonb_build_object('payment_id', new.id)
  );
  return new;
exception when others then
  raise warning 'notify_payment_received could not queue a notification for payment %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

-- WHEN runs in plain SQL, not plpgsql — TG_OP isn't visible there, only
-- inside the trigger function body — and Postgres separately refuses to
-- let an INSERT trigger's WHEN reference OLD at all (not even to check it
-- IS NULL), so one combined INSERT-OR-UPDATE trigger can't express "OLD
-- wasn't already approved" in a WHEN clause that also has to cover INSERT.
-- Two triggers instead, sharing the same function: INSERT needs no OLD
-- comparison at all (there is no prior row), UPDATE keeps the guard
-- against re-firing on an unrelated change to an already-approved row.
drop trigger if exists notify_payment_received_trg on classroom.payments;
drop trigger if exists notify_payment_received_insert_trg on classroom.payments;
drop trigger if exists notify_payment_received_update_trg on classroom.payments;

create trigger notify_payment_received_insert_trg
  after insert on classroom.payments
  for each row
  when (new.status = 'approved')
  execute function classroom.notify_payment_received();

create trigger notify_payment_received_update_trg
  after update on classroom.payments
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function classroom.notify_payment_received();

notify pgrst, 'reload schema';
