-- =============================================================================
-- payroll-payout-sznd/index.ts's service-role client queries payment_gateways,
-- payslips and payroll_staff directly (not through a SECURITY DEFINER
-- function, unlike everywhere else service_role touches these) — none of
-- the three had ever been granted to service_role, so every lookup
-- silently returned nothing and the function failed every payslip with
-- "Payslip no longer exists." The exact same class of bug
-- 072_service_role_schema_usage.sql and 249_sznd_checkout_sessions_grant.sql
-- already document once each: schema USAGE is not table-level access, and
-- every table a service-role client reads/writes directly needs its own
-- grant. Found live, 2026-10-12, running the very first real payroll
-- payout test.
--
-- Run after 250. Safe to re-run.
-- =============================================================================

grant select on classroom.payment_gateways to service_role;
grant select on classroom.payslips to service_role;
grant select, update on classroom.payroll_staff to service_role;

-- -------------------------------------------------------------------------
-- Same live test also surfaced a real logic bug in settle_sznd_payroll_
-- payout (250): it flipped a run to 'paid' once every payout had resolved,
-- with no check that any of them actually succeeded. A run where every
-- single payslip failed (as this test's did, entirely because of the grant
-- bug above) showed as "Paid 12 Oct 2026" in the UI — exactly backwards.
-- Now: 'paid' only when at least one payout actually paid; all-failed
-- reverts the run to 'approved' so the bursar sees it needs retrying, not
-- a false "done".
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
  any_paid boolean;
begin
  if new_status not in ('paid', 'failed') then
    raise exception 'settle_sznd_payroll_payout only accepts paid or failed, got %', new_status;
  end if;

  select * into po from classroom.payroll_payouts where gateway_ref = target_reference for update;
  if po.id is null then
    raise exception 'No payroll payout found for reference %', target_reference;
  end if;

  if po.status in ('paid', 'failed') then
    return po;
  end if;

  update classroom.payroll_payouts
  set status = new_status, failure_reason = failure_reason_in, updated_at = now()
  where id = po.id
  returning * into po;

  select count(*) filter (where status in ('pending', 'processing')),
         bool_or(status = 'paid')
    into still_open, any_paid
  from classroom.payroll_payouts
  where run_id = po.run_id;

  if still_open = 0 then
    if any_paid then
      update classroom.payroll_runs
      set status = 'paid', paid_on = current_date, updated_at = now()
      where id = po.run_id and status = 'disbursing';
    else
      update classroom.payroll_runs
      set status = 'approved', updated_at = now()
      where id = po.run_id and status = 'disbursing';
    end if;
  end if;

  return po;
end;
$fn$;

revoke all on function classroom.settle_sznd_payroll_payout(text, text, text) from public;
grant execute on function classroom.settle_sznd_payroll_payout(text, text, text) to service_role;

notify pgrst, 'reload schema';
