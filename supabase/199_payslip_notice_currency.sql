-- The payslip notice now shows its currency ("Net pay ₦256,940.00");
-- 197 printed the bare number. Otherwise payroll_approve exactly as in 197.

create or replace function classroom.payroll_approve(target_run uuid)
returns classroom.payroll_runs
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  r   classroom.payroll_runs;
  cfg classroom.payroll_settings;
  t   record;
  label text;
  on_date date;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  select * into cfg from classroom.payroll_settings where school_id = r.school_id;
  if not classroom.has_role_in(r.school_id, cfg.approver_roles) then
    raise exception 'Only % can approve payroll at this school.',
      array_to_string(array(select initcap(x::text) from unnest(cfg.approver_roles) x), ' or ');
  end if;
  if r.status <> 'draft' then raise exception 'This payroll is already %.', r.status; end if;
  if cfg.bands_confirmed_at is null then
    raise exception 'Confirm the PAYE bands under Payroll → Settings before approving the first payroll.';
  end if;
  if not exists (select 1 from classroom.payslips where run_id = r.id) then
    raise exception 'There are no payslips in this payroll.';
  end if;

  update classroom.payroll_runs
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = r.id returning * into r;

  -- Loans and advances go down by what this month took.
  update classroom.payroll_staff_deductions sd
     set balance = greatest(0, sd.balance - x.amount)
    from (
      select (d ->> 'deduction_id')::uuid as id, sum((d ->> 'amount')::numeric) as amount
        from classroom.payslips p, jsonb_array_elements(p.deductions) d
       where p.run_id = r.id
       group by 1
    ) x
   where sd.id = x.id and sd.balance is not null;

  -- The books, when the school keeps them.
  on_date := (r.period + interval '1 month - 1 day')::date;
  if classroom.acct_enabled(r.school_id, on_date) then
    select sum(gross) gross, sum(pension_employee) pe, sum(pension_employer) per, sum(nhf) nhf,
           sum(paye) paye, sum(other_deductions) other, sum(net) net
      into t from classroom.payslips where run_id = r.id;
    label := 'Payroll for ' || to_char(r.period, 'FMMonth YYYY');
    perform classroom.acct_post(r.school_id, on_date, label || ' approved', 'payroll', r.id, 'approve',
      jsonb_build_array(
        jsonb_build_object('key', 'salaries', 'debit', t.gross),
        jsonb_build_object('key', 'pension_expense', 'debit', t.per),
        jsonb_build_object('key', 'paye_payable', 'credit', t.paye),
        jsonb_build_object('key', 'pension_payable', 'credit', t.pe + t.per),
        jsonb_build_object('key', 'nhf_payable', 'credit', t.nhf),
        jsonb_build_object('key', 'deductions_payable', 'credit', t.other),
        jsonb_build_object('key', 'salaries_payable', 'credit', t.net)
      ));
  end if;

  -- Each person with an account hears their payslip is ready.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select p.user_id, r.school_id, 'payslip_ready',
         'Your payslip for ' || to_char(r.period, 'FMMonth YYYY') || ' is ready',
         'Net pay ' || case coalesce(s.currency, 'NGN') when 'NGN' then '₦' when 'USD' then '$' when 'GBP' then '£' else s.currency || ' ' end
           || to_char(p.net, 'FM999,999,999,990.00'),
         '/Payslips'
    from classroom.payslips p
    join classroom.schools s on s.id = p.school_id
   where p.run_id = r.id and p.user_id is not null;

  return r;
end;
$fn$;

grant execute on function classroom.payroll_approve(uuid) to authenticated;

notify pgrst, 'reload schema';
