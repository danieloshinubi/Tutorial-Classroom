-- =============================================================================
-- Automated payroll payout through Sznd — bank transfers straight to staff,
-- triggered by a bursar/owner/admin after a run is already approved. Manual
-- "mark as paid" (200_payroll_paid_follows_approval.sql) still exists
-- unchanged for schools not on Sznd, or for a run a school would rather
-- settle by hand.
--
-- THE CENTRAL CONSTRAINT THIS MIGRATION EXISTS TO ENFORCE: Sznd confirmed
-- (2026-10-12, via their team) that multiple businesses sharing one Sznd
-- account get ONE POOLED WALLET — no separation on their end at all. In
-- platform mode that means every school sharing Schoolivio's account draws
-- from the same literal balance; nothing on Sznd's side stops School B's
-- payroll from spending money School A collected. Even in BYO mode (a
-- school's own Sznd account), nothing stops a school overdrawing against
-- fees it hasn't actually collected yet. Sznd will never catch either
-- case — this has to be enforced here, before any payout API call, or not
-- at all.
--
-- classroom.sznd_school_balance(school_id) is therefore the one number a
-- payout can never exceed: everything that school has ever collected
-- through Sznd (classroom.payments, gateway='sznd', status='approved'),
-- minus everything already paid out or in flight for that school
-- (classroom.payroll_payouts, status in ('processing','paid')). Computed
-- live from both tables rather than a maintained running total — nothing to
-- drift out of sync, and it is cheap at the volumes this system runs at.
--
-- Run after 249. Safe to re-run.
-- =============================================================================

-- ------------------------------------------------------------- beneficiary cache
-- One Sznd beneficiary per staff member, reused across every payroll run —
-- avoids recreating it (and paying whatever rate-limit/cost that carries)
-- every single month. Null until their first automated payout.
alter table classroom.payroll_staff
  add column if not exists sznd_beneficiary_id text;

-- ------------------------------------------------------------------- payouts
-- One row per payslip per payout attempt. A payslip can have more than one
-- row over time only if a prior attempt failed and was retried — never two
-- rows "in flight" at once for the same payslip (payroll_payouts_one_active
-- below).
create table if not exists classroom.payroll_payouts (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  run_id       uuid not null references classroom.payroll_runs (id) on delete cascade,
  payslip_id   uuid not null references classroom.payslips (id) on delete cascade,
  gateway      text not null default 'sznd' check (gateway in ('sznd')),
  -- Our own reference, generated when the payout is submitted to Sznd —
  -- exactly the role classroom.sznd_checkout_sessions.reference plays for
  -- collections (248): Sznd doesn't echo metadata back, so this is what a
  -- webhook delivery gets matched against.
  gateway_ref  text not null unique,
  beneficiary_id text,
  amount       numeric(14,2) not null check (amount > 0),
  status       text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed')),
  failure_reason text,
  submitted_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists payroll_payouts_run_idx on classroom.payroll_payouts (run_id);
create index if not exists payroll_payouts_school_idx on classroom.payroll_payouts (school_id);

-- A payslip can only ever have one payout that's still pending or
-- processing at a time — never two simultaneous attempts racing each other
-- to pay the same person twice.
create unique index if not exists payroll_payouts_one_active
  on classroom.payroll_payouts (payslip_id)
  where status in ('pending', 'processing');

alter table classroom.payroll_payouts enable row level security;

drop policy if exists "payroll staff read payouts" on classroom.payroll_payouts;
create policy "payroll staff read payouts" on classroom.payroll_payouts for select to authenticated
  using (classroom.can_do_payroll(school_id));

-- Written only by start_sznd_payroll_payout/settle_sznd_payroll_payout
-- below (service role) — never directly by a browser client, the same
-- boundary payroll_runs already draws around its own status changes.
revoke insert, update, delete on classroom.payroll_payouts from authenticated;
grant select on classroom.payroll_payouts to authenticated;
grant select, insert, update on classroom.payroll_payouts to service_role;

drop trigger if exists audit_trg on classroom.payroll_payouts;
create trigger audit_trg after insert or update or delete on classroom.payroll_payouts
  for each row execute function classroom.write_audit_log();

-- --------------------------------------------------------- run status: disbursing
-- A run sits here from the moment payout starts until every payslip's
-- payout has resolved (paid or failed) — same meaning as a checkout
-- "AWAITING_PAYMENT" state elsewhere in this codebase: money is in motion,
-- not yet known to have landed.
alter table classroom.payroll_runs drop constraint if exists payroll_runs_status_check;
alter table classroom.payroll_runs add constraint payroll_runs_status_check
  check (status in ('draft', 'submitted', 'approved', 'disbursing', 'paid'));

-- ------------------------------------------------------------- the balance
create or replace function classroom.sznd_school_balance(target_school uuid)
returns numeric
language sql stable security definer
set search_path = classroom, public
as $fn$
  select
    coalesce((
      select sum(p.amount) from classroom.payments p
      join classroom.invoices i on i.id = p.invoice_id
      where i.school_id = target_school and p.gateway = 'sznd' and p.status = 'approved'
    ), 0)
    -
    coalesce((
      select sum(po.amount) from classroom.payroll_payouts po
      where po.school_id = target_school and po.status in ('processing', 'paid')
    ), 0);
$fn$;

revoke all on function classroom.sznd_school_balance(uuid) from public;
grant execute on function classroom.sznd_school_balance(uuid) to authenticated, service_role;

-- --------------------------------------------------------- start a payout
-- Called once, when the bursar clicks "Pay via Sznd". Atomically: claims
-- the run (draft/submitted/paid callers get a clear rejection, not a
-- silent no-op), checks every payslip with real bank details against the
-- school's current Sznd balance, and inserts one 'pending' payout row per
-- payslip — or raises, moving nothing, if the balance would go negative.
--
-- pg_advisory_xact_lock on the school id is the guard against two payout
-- attempts for two different runs of the SAME school racing each other's
-- balance check — classroom.sznd_school_balance alone, read twice by two
-- concurrent transactions, could let both see "enough" and together
-- overdraw. The lock is released automatically at transaction end either
-- way (commit or the exception below).
create or replace function classroom.start_sznd_payroll_payout(target_run uuid, actor uuid)
returns setof classroom.payroll_payouts
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  r classroom.payroll_runs;
  gw classroom.payment_gateways;
  total_payable numeric(14,2);
  available numeric(14,2);
  skipped_no_bank int;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if r.id is null then raise exception 'That payroll run does not exist.'; end if;
  if r.status <> 'approved' then
    raise exception 'This run is %, not approved — nothing to pay out.', r.status;
  end if;

  select * into gw from classroom.payment_gateways where school_id = r.school_id;
  if gw.provider is distinct from 'sznd' or not gw.is_active then
    raise exception 'This school is not currently set up to pay out through Sznd.';
  end if;

  perform pg_advisory_xact_lock(hashtext(r.school_id::text));

  select count(*) into skipped_no_bank
  from classroom.payslips p
  where p.run_id = target_run and p.net > 0
    and (p.account_number is null or btrim(p.account_number) = '' or p.bank_name is null or btrim(p.bank_name) = '');

  select coalesce(sum(p.net), 0) into total_payable
  from classroom.payslips p
  where p.run_id = target_run and p.net > 0
    and p.account_number is not null and btrim(p.account_number) <> ''
    and p.bank_name is not null and btrim(p.bank_name) <> ''
    -- Already has a live payout — do not double-queue it (a second click
    -- of the same button, or a retry after only some payslips failed).
    and not exists (
      select 1 from classroom.payroll_payouts po
      where po.payslip_id = p.id and po.status in ('pending', 'processing', 'paid')
    );

  if total_payable = 0 then
    raise exception 'Nothing left to pay out for this run — every payslip with a bank account on file has already been paid or queued.';
  end if;

  available := classroom.sznd_school_balance(r.school_id);
  if total_payable > available then
    raise exception 'Insufficient Sznd balance: this payout needs %, this school has % available.', total_payable, available;
  end if;

  update classroom.payroll_runs set status = 'disbursing', updated_at = now() where id = target_run;

  return query
    insert into classroom.payroll_payouts (school_id, run_id, payslip_id, gateway_ref, amount, submitted_by)
    select r.school_id, target_run, p.id, 'szp' || gen_random_uuid()::text, p.net, actor
    from classroom.payslips p
    where p.run_id = target_run and p.net > 0
      and p.account_number is not null and btrim(p.account_number) <> ''
      and p.bank_name is not null and btrim(p.bank_name) <> ''
      and not exists (
        select 1 from classroom.payroll_payouts po
        where po.payslip_id = p.id and po.status in ('pending', 'processing', 'paid')
      )
    returning *;
end;
$fn$;

revoke all on function classroom.start_sznd_payroll_payout(uuid, uuid) from public;
grant execute on function classroom.start_sznd_payroll_payout(uuid, uuid) to service_role;

-- -------------------------------------------------------- settle a payout
-- Called by sznd-webhook when a WITHDRAWAL transaction it recognises (by
-- gateway_ref, the same reference-matching discipline
-- 248_sznd_checkout_sessions.sql established for collections, since Sznd
-- doesn't echo metadata here either) resolves. Flips the run to 'paid' once
-- every payout belonging to it has resolved one way or the other — some
-- failed payslips do not block the rest from being recorded as paid; they
-- stay visible in payroll_payouts for the bursar to see and retry.
create or replace function classroom.settle_sznd_payroll_payout(
  target_reference text,
  new_status text,
  failure_reason_in text default null
)
returns classroom.payroll_payouts
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  po classroom.payroll_payouts;
  still_open int;
begin
  if new_status not in ('paid', 'failed') then
    raise exception 'settle_sznd_payroll_payout only accepts paid or failed, got %', new_status;
  end if;

  select * into po from classroom.payroll_payouts where gateway_ref = target_reference for update;
  if po.id is null then
    raise exception 'No payroll payout found for reference %', target_reference;
  end if;

  -- Idempotent — a retried webhook delivery for an already-resolved payout
  -- is a no-op, not a double-update.
  if po.status in ('paid', 'failed') then
    return po;
  end if;

  update classroom.payroll_payouts
  set status = new_status, failure_reason = failure_reason_in, updated_at = now()
  where id = po.id
  returning * into po;

  select count(*) into still_open
  from classroom.payroll_payouts
  where run_id = po.run_id and status in ('pending', 'processing');

  if still_open = 0 then
    update classroom.payroll_runs
    set status = 'paid', paid_on = current_date, updated_at = now()
    where id = po.run_id and status = 'disbursing';
  end if;

  return po;
end;
$fn$;

revoke all on function classroom.settle_sznd_payroll_payout(text, text, text) from public;
grant execute on function classroom.settle_sznd_payroll_payout(text, text, text) to service_role;

notify pgrst, 'reload schema';
