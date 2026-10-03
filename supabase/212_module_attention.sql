-- What is waiting on the signed-in person, per module, for the dot beside a
-- module in the menu (the same dot Chat shows for unread messages).
--
-- Only things this person is the one to act on, and only in modules they can
-- act in, so a dot always means "something here needs you":
--   bursary     payments sent in by families, waiting to be approved
--   payroll     approver: payroll sent for approval;
--               the bursary: payroll sent back to them
--   admissions  new applications not yet looked at, and reviews assigned to me
--   store       items at or below their reorder level
--   reports     principal/owner/admin: result sheets waiting for approval;
--               teacher: their result sheets sent back to them
--   tickets     open requests in my queue that nobody has picked up, or mine
--   support     my own requests waiting on my reply
--   fees        family/student: any school bill still owed on
-- Returns { module: count }, leaving out zeros.
create or replace function classroom.module_attention(target_school uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = classroom, public
as $fn$
declare
  me uuid := auth.uid();
  out jsonb := '{}'::jsonb;
  n int;
  cfg classroom.payroll_settings;
begin
  if me is null or not classroom.is_member_of(target_school) then
    return out;
  end if;

  if classroom.can_do_bursary(target_school) then
    select count(*) into n from classroom.payments
     where school_id = target_school and status = 'submitted';
    if n > 0 then out := out || jsonb_build_object('bursary', n); end if;
  end if;

  select * into cfg from classroom.payroll_settings where school_id = target_school;
  if found then
    n := 0;
    if classroom.has_role_in(target_school, cfg.approver_roles) then
      select count(*) into n from classroom.payroll_runs where school_id = target_school and status = 'submitted';
    elsif classroom.can_do_payroll(target_school) then
      select count(*) into n from classroom.payroll_runs
       where school_id = target_school and status = 'draft' and returned_note is not null;
    end if;
    if n > 0 then out := out || jsonb_build_object('payroll', n); end if;
  end if;

  if classroom.can_do_admissions(target_school) then
    select (select count(*) from classroom.applications
             where school_id = target_school and status = 'submitted')
         + (select count(*) from classroom.application_reviews r
              join classroom.applications a on a.id = r.application_id
             where a.school_id = target_school and r.reviewer_id = me and r.completed_at is null)
      into n;
    if n > 0 then out := out || jsonb_build_object('admissions', n); end if;
  end if;

  if classroom.can_do_store(target_school) then
    select count(*) into n from classroom.store_products
     where school_id = target_school and is_active and reorder_level > 0 and stock_qty <= reorder_level;
    if n > 0 then out := out || jsonb_build_object('store', n); end if;
  end if;

  if classroom.can_release_results(target_school) then
    select count(*) into n from classroom.result_sheets where school_id = target_school and status = 'submitted';
  else
    select count(*) into n from classroom.result_sheets
     where school_id = target_school and status = 'returned' and created_by = me;
  end if;
  if n > 0 then out := out || jsonb_build_object('reports', n); end if;

  if classroom.is_ticket_staff(target_school) then
    select count(*) into n from classroom.tickets t
     where t.school_id = target_school and t.status = 'open'
       and (t.assigned_to = me or (t.assigned_to is null and classroom.can_access_ticket(t.id)));
    if n > 0 then out := out || jsonb_build_object('tickets', n); end if;
  end if;

  select count(*) into n from classroom.tickets
   where school_id = target_school and requester_id = me and status = 'pending';
  if n > 0 then out := out || jsonb_build_object('support', n); end if;

  if classroom.has_role_in(target_school, array['parent', 'student']::classroom.member_role[]) then
    select count(*) into n from classroom.invoice_balances b
     where b.school_id = target_school and b.status = 'issued' and b.balance > 0
       and classroom.is_my_invoice(b.invoice_id);
    if n > 0 then out := out || jsonb_build_object('fees', n); end if;
  end if;

  return out;
end;
$fn$;

revoke execute on function classroom.module_attention(uuid) from public, anon;
grant execute on function classroom.module_attention(uuid) to authenticated;

notify pgrst, 'reload schema';
