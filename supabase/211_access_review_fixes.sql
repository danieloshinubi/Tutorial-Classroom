-- Fixes from a review of 207-210.
--
-- 1. Only the owner can change who approves payroll. payroll_settings is
--    writable by anyone who runs payroll, so a bursar (or anyone given
--    payroll edit access) could make their own role the approver and approve
--    their own payroll, undoing 209's approval step.
-- 2. payroll_compute and payroll_annual_tax are internal: SECURITY DEFINER
--    with no permission check, so anyone could read a staff member's pay by
--    id. Nothing in the app calls them directly.
-- 3. Admissions access granted under People (208) did not reach a few older
--    paths that named the admissions roles directly: applicant accounts and
--    documents, student registrations, registering a pupil, document status
--    and correction requests.
-- 4. Bursary view access can open payment receipts (read only).
-- 5. An approver approves straight from draft only a payroll they prepared
--    themselves; anyone else's must be sent for approval first.
-- 6. Module access: audited like membership, granted_by/updated_at stamped
--    by the database, and only for staff (never a parent or student).
-- 7. Approvers' "waiting for your approval" notice is withdrawn when payroll
--    is taken back, sent back or approved, so it is not left pointing at
--    nothing or doubled when sent again.

-- 1 ------------------------------------------------------------------------
create or replace function classroom.payroll_approvers_guard()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if tg_op = 'UPDATE' and new.approver_roles is distinct from old.approver_roles
     and not classroom.has_role_in(new.school_id, array['owner']::classroom.member_role[]) then
    raise exception 'Only the proprietor can change who approves payroll.';
  end if;
  if tg_op = 'INSERT' and new.approver_roles is distinct from array['owner']::classroom.member_role[]
     and not classroom.has_role_in(new.school_id, array['owner']::classroom.member_role[]) then
    new.approver_roles := array['owner']::classroom.member_role[];
  end if;
  return new;
end;
$fn$;

drop trigger if exists payroll_approvers_guard on classroom.payroll_settings;
create trigger payroll_approvers_guard
  before insert or update on classroom.payroll_settings
  for each row execute function classroom.payroll_approvers_guard();

-- 2 ------------------------------------------------------------------------
revoke execute on function classroom.payroll_compute(uuid, date) from public, anon, authenticated;
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'classroom' and p.proname = 'payroll_annual_tax'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- 3 ------------------------------------------------------------------------
do $$
declare
  role_list text := $q$classroom.has_role_in(school_id, ARRAY['owner'::classroom.member_role, 'admin'::classroom.member_role, 'principal'::classroom.member_role, 'admissions'::classroom.member_role])$q$;
  role_list_a text := $q$classroom.has_role_in(a.school_id, ARRAY['owner'::classroom.member_role, 'admin'::classroom.member_role, 'principal'::classroom.member_role, 'admissions'::classroom.member_role])$q$;
  q text;
  r record;
  def text;
  fixed text;
begin
  select qual into q from pg_policies where schemaname = 'classroom' and tablename = 'applicant_accounts' and policyname = 'applicant reads own account';
  if position(role_list in q) = 0 then raise exception 'applicant_accounts policy changed'; end if;
  execute format('alter policy %I on classroom.applicant_accounts using (%s)', 'applicant reads own account',
    replace(q, role_list, 'classroom.can_view_admissions(school_id)'));

  select qual into q from pg_policies where schemaname = 'classroom' and tablename = 'applicant_documents' and policyname = 'read own docs';
  if position(role_list_a in q) = 0 then raise exception 'applicant_documents policy changed'; end if;
  execute format('alter policy %I on classroom.applicant_documents using (%s)', 'read own docs',
    replace(q, role_list_a, 'classroom.can_view_admissions(a.school_id)'));

  select qual into q from pg_policies where schemaname = 'classroom' and tablename = 'student_registrations' and policyname = 'read own or staff registration';
  if position(role_list in q) = 0 then raise exception 'student_registrations read policy changed'; end if;
  execute format('alter policy %I on classroom.student_registrations using (%s)', 'read own or staff registration',
    replace(q, role_list, 'classroom.can_view_admissions(school_id)'));

  execute format('alter policy %I on classroom.student_registrations using (%s) with check (%s)', 'staff manage registrations',
    'classroom.can_do_admissions(school_id)', 'classroom.can_do_admissions(school_id)');

  -- Functions: the caller's own admissions role check becomes the helper.
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'classroom' and p.proname in ('set_document_status', 'request_application_correction')
  loop
    def := pg_get_functiondef(r.oid);
    fixed := regexp_replace(def,
      $re$classroom\.has_role_in\(\s*([a-z_.]+)\s*,\s*array\[\s*'owner'\s*,\s*'admin'\s*,\s*'principal'\s*,\s*'admissions'\s*\]::classroom\.member_role\[\]\s*\)$re$,
      'classroom.can_do_admissions(\1)', 'gi');
    if fixed = def then raise exception 'No admissions role check found in %', r.proname; end if;
    execute fixed;
  end loop;

  -- Registering a pupil leaves the principal out on purpose; keep that and
  -- let an admissions edit grant through as well.
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'promote_applicant_to_student';
  fixed := regexp_replace(def,
    $re$classroom\.has_role_in\(\s*app\.school_id\s*,\s*array\[\s*'owner'\s*,\s*'admin'\s*,\s*'admissions'\s*\]::classroom\.member_role\[\]\s*\)$re$,
    $rp$(classroom.has_role_in(app.school_id, array['owner','admin','admissions']::classroom.member_role[]) or coalesce(classroom.module_access(app.school_id, 'admissions') = 'edit', false))$rp$, 'gi');
  if fixed = def then raise exception 'No admissions role check found in promote_applicant_to_student'; end if;
  execute fixed;
end $$;

-- 4 ------------------------------------------------------------------------
create or replace function classroom.may_view_payment_proof(path_invoice text)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.may_touch_payment_proof(path_invoice)
      or exists (
        select 1 from classroom.invoices i
        where i.id = classroom.try_uuid(path_invoice) and classroom.can_view_bursary(i.school_id)
      );
$fn$;
grant execute on function classroom.may_view_payment_proof(text) to authenticated;

do $$
declare q text;
begin
  select qual into q from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'read course files and admissions documents';
  if position('classroom.may_touch_payment_proof(' in q) = 0 then raise exception 'storage read policy changed'; end if;
  execute format('alter policy %I on storage.objects using (%s)', 'read course files and admissions documents',
    replace(q, 'classroom.may_touch_payment_proof(', 'classroom.may_view_payment_proof('));
end $$;

-- 5 + 7 ------------------------------------------------------------------
create or replace function classroom.payroll_withdraw_notice(target_run uuid)
returns void language sql security definer set search_path = classroom, public as $fn$
  delete from classroom.notifications n
   using classroom.payroll_runs r
   where r.id = target_run
     and n.school_id = r.school_id
     and n.kind = 'payroll_submitted'
     and n.read_at is null
     and n.title = 'Payroll for ' || to_char(r.period, 'FMMonth YYYY') || ' is waiting for your approval';
$fn$;
revoke execute on function classroom.payroll_withdraw_notice(uuid) from public, anon, authenticated;

do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'payroll_approve';
  if position($q$if r.status not in ('draft', 'submitted') then raise exception 'This payroll is already %.', r.status; end if;$q$ in def) = 0 then
    raise exception 'payroll_approve status check changed';
  end if;
  def := replace(def,
    $q$if r.status not in ('draft', 'submitted') then raise exception 'This payroll is already %.', r.status; end if;$q$,
    $q$if r.status not in ('draft', 'submitted') then raise exception 'This payroll is already %.', r.status; end if;
  if r.status = 'draft' and r.prepared_by is distinct from auth.uid() then
    raise exception 'This payroll has not been sent for approval yet.';
  end if;
  perform classroom.payroll_withdraw_notice(r.id);$q$);
  execute def;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'payroll_recall';
  def := replace(def,
    $q$update classroom.payroll_runs set status = 'draft', updated_at = now() where id = r.id returning * into r;$q$,
    $q$update classroom.payroll_runs set status = 'draft', updated_at = now() where id = r.id returning * into r;
  perform classroom.payroll_withdraw_notice(r.id);$q$);
  execute def;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'classroom' and p.proname = 'payroll_return';
  def := replace(def,
    $q$   where id = r.id returning * into r;

  insert into classroom.notifications$q$,
    $q$   where id = r.id returning * into r;
  perform classroom.payroll_withdraw_notice(r.id);

  insert into classroom.notifications$q$);
  if position('payroll_withdraw_notice' in def) = 0 then raise exception 'payroll_return not patched'; end if;
  execute def;
end $$;

-- 6 ------------------------------------------------------------------------
create or replace function classroom.member_module_access_stamp()
returns trigger language plpgsql as $fn$
begin
  new.granted_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  return new;
end;
$fn$;

drop trigger if exists member_module_access_stamp on classroom.member_module_access;
create trigger member_module_access_stamp
  before insert or update on classroom.member_module_access
  for each row execute function classroom.member_module_access_stamp();

drop trigger if exists audit_trg on classroom.member_module_access;
create trigger audit_trg
  after insert or update or delete on classroom.member_module_access
  for each row execute function classroom.write_audit_log();

drop policy if exists "school admins manage module access" on classroom.member_module_access;
create policy "school admins manage module access"
  on classroom.member_module_access for all to authenticated
  using (classroom.is_school_admin(school_id))
  with check (
    classroom.is_school_admin(school_id)
    and exists (
      select 1 from classroom.school_members m
      where m.school_id = member_module_access.school_id
        and m.user_id = member_module_access.user_id
        and m.role not in ('student', 'parent')
    )
  );

-- A grant counts only while the person holds a staff role there.
create or replace function classroom.module_access(target_school uuid, target_module text)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select g.level
  from classroom.member_module_access g
  where g.school_id = target_school
    and g.user_id = auth.uid()
    and g.module = target_module
    and exists (
      select 1 from classroom.school_members m
      where m.school_id = g.school_id and m.user_id = g.user_id and m.is_active
        and m.role not in ('student', 'parent')
    )
  limit 1;
$fn$;

notify pgrst, 'reload schema';
