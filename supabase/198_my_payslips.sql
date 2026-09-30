-- A person's own released payslips with the month and school they belong to.
-- Staff cannot read payroll_runs or schools' payroll (197), so the month has
-- to come from here rather than a join in the page.
create or replace function classroom.my_payslips()
returns jsonb
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
           'period', r.period, 'run_status', r.status, 'paid_on', r.paid_on,
           'school_name', s.name, 'school_logo', s.logo_url)
         order by r.period desc), '[]'::jsonb)
    from classroom.payslips p
    join classroom.payroll_runs r on r.id = p.run_id and r.status in ('approved', 'paid')
    join classroom.schools s on s.id = p.school_id
   where p.user_id = auth.uid();
$fn$;

grant execute on function classroom.my_payslips() to authenticated;

notify pgrst, 'reload schema';
