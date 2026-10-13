-- Payroll: net pay shown while a staff member's pay is being set (2026-10-13).
--
-- The staff form showed gross only; net pay (after PAYE, pension, NHF and
-- the person's own deductions) appeared only once a payroll run was
-- prepared. Now the form shows the full breakdown as the figures are typed,
-- and the staff list shows net beside gross.
--
-- One calculation, not two: payroll_compute's body becomes
-- payroll_compute_row, which works on a staff row (saved or not), and
-- payroll_compute(id, month) loads the row and calls it, exactly as before.
-- payroll_preview hands payroll_compute_row the figures on screen; it is for
-- whoever may see the school's payroll, like the payroll itself.

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.payroll_compute(uuid,date)'::regprocedure);
  d := replace(d, 'classroom.payroll_compute(target_staff uuid, period_in date)', 'classroom.payroll_compute_row(st classroom.payroll_staff, period_in date)');
  d := replace(d, E'  st   classroom.payroll_staff;\n', '');
  d := replace(d, E'  select * into st from classroom.payroll_staff where id = target_staff;\n  if not found then raise exception ''No such staff member''; end if;\n', '');
  if position('payroll_compute_row(st classroom.payroll_staff' in d) = 0 or position('into st from' in d) > 0 or position(E'st   classroom.payroll_staff;' in d) > 0 then
    raise exception 'payroll_compute split did not apply';
  end if;
  execute d;
end;
$do$;
revoke all on function classroom.payroll_compute_row(classroom.payroll_staff, date) from public, anon, authenticated;

create or replace function classroom.payroll_compute(target_staff uuid, period_in date)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare st classroom.payroll_staff;
begin
  select * into st from classroom.payroll_staff where id = target_staff;
  if not found then raise exception 'No such staff member'; end if;
  return classroom.payroll_compute_row(st, period_in);
end;
$fn$;
revoke all on function classroom.payroll_compute(uuid, date) from public, anon, authenticated;

-- A whole month's pay for the figures on screen: the saved record (if any)
-- with the form's values over it. Joining and leaving dates are left out, so
-- it shows a full month.
create or replace function classroom.payroll_preview(target_school uuid, target_staff uuid, figures jsonb)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare st classroom.payroll_staff;
begin
  if not classroom.can_view_payroll(target_school) then raise exception 'Only payroll staff can see pay.'; end if;
  if target_staff is not null then
    select * into st from classroom.payroll_staff where id = target_staff and school_id = target_school;
    if not found then raise exception 'No such staff member'; end if;
  else
    st.school_id := target_school;
    st.pension_applies := true;
    st.nhf_applies := false;
  end if;
  st := jsonb_populate_record(st, coalesce(figures, '{}'::jsonb) - 'id' - 'school_id');
  st.start_date := null;
  st.end_date := null;
  st.basic := coalesce(st.basic, 0);
  st.housing := coalesce(st.housing, 0);
  st.transport := coalesce(st.transport, 0);
  st.annual_rent := coalesce(st.annual_rent, 0);
  st.other_allowances := coalesce(st.other_allowances, '[]'::jsonb);
  return classroom.payroll_compute_row(st, date_trunc('month', now())::date);
end;
$fn$;
revoke all on function classroom.payroll_preview(uuid, uuid, jsonb) from public, anon;
grant execute on function classroom.payroll_preview(uuid, uuid, jsonb) to authenticated;

-- Gross and net for every staff member, for the staff list.
create or replace function classroom.payroll_staff_pay(target_school uuid)
returns table (staff_id uuid, gross numeric, net numeric) language plpgsql stable security definer set search_path = classroom, public as $fn$
declare st classroom.payroll_staff; r jsonb;
begin
  if not classroom.can_view_payroll(target_school) then raise exception 'Only payroll staff can see pay.'; end if;
  if not exists (select 1 from classroom.payroll_settings where school_id = target_school) then return; end if;
  for st in select * from classroom.payroll_staff where school_id = target_school loop
    st.start_date := null;
    st.end_date := null;
    r := classroom.payroll_compute_row(st, date_trunc('month', now())::date);
    staff_id := st.id;
    gross := (r ->> 'gross')::numeric;
    net := (r ->> 'net')::numeric;
    return next;
  end loop;
end;
$fn$;
revoke all on function classroom.payroll_staff_pay(uuid) from public, anon;
grant execute on function classroom.payroll_staff_pay(uuid) to authenticated;

notify pgrst, 'reload schema';
