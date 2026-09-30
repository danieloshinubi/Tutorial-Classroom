-- Marking a payroll paid posts "Dr Salaries payable, Cr Bank" (197). That
-- only makes sense if approving it posted the matching "Cr Salaries payable".
-- A payroll for a month before the books' start date is approved outside the
-- books, so paying it later (after the start date) posted a payment against
-- a liability that was never recorded, and Salaries payable went negative.
-- Found in testing. Paying now posts only when the approval did.
create or replace function classroom.payroll_mark_paid(target_run uuid, paid_on_in date)
returns classroom.payroll_runs
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  r classroom.payroll_runs;
  net_total numeric;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  if not classroom.can_do_payroll(r.school_id) then raise exception 'Not allowed'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved payroll can be marked as paid.'; end if;
  update classroom.payroll_runs
     set status = 'paid', paid_on = coalesce(paid_on_in, current_date), paid_by = auth.uid(), updated_at = now()
   where id = r.id returning * into r;
  if classroom.acct_enabled(r.school_id, r.paid_on)
     and exists (select 1 from classroom.journal_entries
                  where school_id = r.school_id and source_type = 'payroll'
                    and source_id = r.id and source_event = 'approve') then
    select sum(net) into net_total from classroom.payslips where run_id = r.id;
    perform classroom.acct_post(r.school_id, r.paid_on,
      'Salaries paid for ' || to_char(r.period, 'FMMonth YYYY'), 'payroll', r.id, 'paid',
      jsonb_build_array(
        jsonb_build_object('key', 'salaries_payable', 'debit', net_total),
        jsonb_build_object('key', 'bank', 'credit', net_total)));
  end if;
  return r;
end;
$fn$;

grant execute on function classroom.payroll_mark_paid(uuid, date) to authenticated;

notify pgrst, 'reload schema';
