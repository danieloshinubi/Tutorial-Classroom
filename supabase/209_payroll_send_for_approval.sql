-- Payroll: the bursary prepares it and sends it to the proprietor for approval.
--
--   draft      the bursary prepares and recalculates it
--   submitted  sent for approval: the approvers (payroll_settings.approver_roles,
--              the owner by default) are notified, and nothing can be
--              recalculated or deleted until it is approved or sent back
--   approved   unchanged from 197: payslips released, books posted
--   paid       unchanged
--
-- The approver can send it back with a note (back to draft, the preparer is
-- notified); the bursary can recall it before it is approved. An approver who
-- prepares payroll themselves may still approve straight from draft.

alter table classroom.payroll_runs
  add column if not exists submitted_by uuid references auth.users (id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists returned_note text,
  add column if not exists returned_at timestamptz;

alter table classroom.payroll_runs drop constraint if exists payroll_runs_status_check;
alter table classroom.payroll_runs
  add constraint payroll_runs_status_check check (status in ('draft', 'submitted', 'approved', 'paid'));

-- Who approves payroll at this school, by name, for messages.
create or replace function classroom.payroll_approver_label(target_school uuid)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(
    (select array_to_string(array(select initcap(x::text) from unnest(cfg.approver_roles) x), ' or ')
       from classroom.payroll_settings cfg where cfg.school_id = target_school),
    'Owner');
$fn$;

create or replace function classroom.payroll_submit(target_run uuid)
returns classroom.payroll_runs
language plpgsql security definer set search_path = classroom, public as $fn$
declare
  r   classroom.payroll_runs;
  cfg classroom.payroll_settings;
  who text;
  slips int;
  total numeric;
  cur text;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  if not classroom.can_do_payroll(r.school_id) then raise exception 'Not allowed'; end if;
  if r.status = 'submitted' then raise exception 'This payroll has already been sent for approval.'; end if;
  if r.status <> 'draft' then raise exception 'This payroll is already %.', r.status; end if;
  select count(*), coalesce(sum(net), 0) into slips, total from classroom.payslips where run_id = r.id;
  if slips = 0 then raise exception 'There are no payslips in this payroll.'; end if;
  select * into cfg from classroom.payroll_settings where school_id = r.school_id;

  update classroom.payroll_runs
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
         returned_note = null, returned_at = null, updated_at = now()
   where id = r.id returning * into r;

  select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''), 'The bursary')
    into who from classroom.profiles p where p.id = auth.uid();
  select case coalesce(s.currency, 'NGN') when 'NGN' then '₦' when 'USD' then '$' when 'GBP' then '£' else s.currency || ' ' end
    into cur from classroom.schools s where s.id = r.school_id;

  -- Everyone who may approve hears about it, except whoever sent it.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct m.user_id, r.school_id, 'payroll_submitted',
         'Payroll for ' || to_char(r.period, 'FMMonth YYYY') || ' is waiting for your approval',
         coalesce(who, 'The bursary') || ' sent it: ' || slips || ' payslip' || case when slips = 1 then '' else 's' end
           || ', net pay ' || cur || to_char(total, 'FM999,999,999,990.00') || '.',
         '/Payroll'
    from classroom.school_members m
   where m.school_id = r.school_id and m.is_active
     and m.role = any(coalesce(cfg.approver_roles, array['owner']::classroom.member_role[]))
     and m.user_id <> auth.uid();

  return r;
end;
$fn$;

-- The bursary takes it back before it is approved, to change something.
create or replace function classroom.payroll_recall(target_run uuid)
returns classroom.payroll_runs
language plpgsql security definer set search_path = classroom, public as $fn$
declare r classroom.payroll_runs;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  if not classroom.can_do_payroll(r.school_id) then raise exception 'Not allowed'; end if;
  if r.status <> 'submitted' then raise exception 'Only a payroll waiting for approval can be taken back.'; end if;
  update classroom.payroll_runs set status = 'draft', updated_at = now() where id = r.id returning * into r;
  return r;
end;
$fn$;

-- The approver sends it back to the bursary, saying why.
drop function if exists classroom.payroll_return(uuid, text);
create or replace function classroom.payroll_return(target_run uuid, reason text)
returns classroom.payroll_runs
language plpgsql security definer set search_path = classroom, public as $fn$
declare
  r   classroom.payroll_runs;
  cfg classroom.payroll_settings;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  select * into cfg from classroom.payroll_settings where school_id = r.school_id;
  if not classroom.has_role_in(r.school_id, cfg.approver_roles) then
    raise exception 'Only % can send payroll back at this school.', classroom.payroll_approver_label(r.school_id);
  end if;
  if r.status <> 'submitted' then raise exception 'Only a payroll waiting for approval can be sent back.'; end if;
  if btrim(coalesce(reason, '')) = '' then raise exception 'Say what needs changing.'; end if;

  update classroom.payroll_runs
     set status = 'draft', returned_note = btrim(reason), returned_at = now(), updated_at = now()
   where id = r.id returning * into r;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select u, r.school_id, 'payroll_returned',
         'Payroll for ' || to_char(r.period, 'FMMonth YYYY') || ' was sent back',
         btrim(reason), '/Payroll'
    from (select distinct unnest(array[r.submitted_by, r.prepared_by]) u) x
   where u is not null and u <> auth.uid();

  return r;
end;
$fn$;

grant execute on function classroom.payroll_submit(uuid), classroom.payroll_recall(uuid), classroom.payroll_return(uuid, text) to authenticated;

-- Approve: from "sent for approval", or straight from draft when the approver
-- prepared it. Otherwise the live 199 definition, with the preparer told.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'payroll_approve';
  if position($q$if r.status <> 'draft' then raise exception 'This payroll is already %.', r.status; end if;$q$ in def) = 0 then
    raise exception 'payroll_approve has changed; update 209';
  end if;
  def := replace(def,
    $q$if r.status <> 'draft' then raise exception 'This payroll is already %.', r.status; end if;$q$,
    $q$if r.status not in ('draft', 'submitted') then raise exception 'This payroll is already %.', r.status; end if;$q$);
  def := replace(def,
    $q$  -- Each person with an account hears their payslip is ready.$q$,
    $q$  -- Whoever sent it for approval hears it went through.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select u, r.school_id, 'payroll_approved',
         'Payroll for ' || to_char(r.period, 'FMMonth YYYY') || ' was approved',
         'Payslips have been released to staff.', '/Payroll'
    from (select distinct unnest(array[r.submitted_by, r.prepared_by]) u) x
   where u is not null and u <> auth.uid();

  -- Each person with an account hears their payslip is ready.$q$);
  execute def;

  -- Prepare, recalculate and delete: draft only, with the right reason.
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'payroll_prepare';
  def := replace(def,
    $q$raise exception 'Payroll for % has already been approved.', to_char(month_start, 'FMMonth YYYY');$q$,
    $q$if r.status = 'submitted' then
      raise exception 'Payroll for % is waiting for approval. Take it back first to change it.', to_char(month_start, 'FMMonth YYYY');
    end if;
    raise exception 'Payroll for % has already been approved.', to_char(month_start, 'FMMonth YYYY');$q$);
  execute def;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'payroll_refresh_run';
  def := replace(def,
    $q$if r.status <> 'draft' then raise exception 'This payroll has been approved; it can no longer be recalculated.'; end if;$q$,
    $q$if r.status = 'submitted' then raise exception 'This payroll is waiting for approval. Take it back first to recalculate it.'; end if;
  if r.status <> 'draft' then raise exception 'This payroll has been approved; it can no longer be recalculated.'; end if;$q$);
  execute def;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'payroll_delete_draft';
  def := replace(def,
    $q$if r.status <> 'draft' then raise exception 'An approved payroll cannot be deleted.'; end if;$q$,
    $q$if r.status = 'submitted' then raise exception 'This payroll is waiting for approval. Take it back first to delete it.'; end if;
  if r.status <> 'draft' then raise exception 'An approved payroll cannot be deleted.'; end if;$q$);
  execute def;
end $$;

notify pgrst, 'reload schema';
