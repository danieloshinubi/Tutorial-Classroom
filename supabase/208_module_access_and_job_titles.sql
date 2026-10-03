-- Extra module access per person, and job titles (School admin → People).
--
-- A role decides what someone does by default: a bursar runs the Bursary, a
-- teacher does not. A school sometimes needs one person to reach a module
-- their role does not cover — a principal who should see the debtors list,
-- a vice principal who helps with admissions. The school's owner or admin
-- can now grant that, per module, as VIEW ONLY or EDIT.
--
-- Enforced here, not just in the menu:
--   * Edit: the module's own helper (can_do_bursary, can_do_payroll,
--     can_do_admissions, and the new can_do_store / can_do_accounts) now
--     also says yes for an edit grant, so every function and policy that
--     already checked it lets the grantee through.
--   * View only: new can_view_* helpers say yes for either level. Every
--     read policy and read-only function of those modules is switched to
--     them; write paths keep the can_do_* helpers, so a view-only grantee is
--     refused any change.
--   * Store and Accounts used to share can_do_bursary. They get their own
--     helpers so access to one does not open the others.
--   * Audit log: view only.
--
-- Only owners and admins can grant, change or remove access, the same people
-- who already manage membership ("school admins manage membership", 007).

-- ---------------------------------------------------------------- job title
alter table classroom.school_members add column if not exists job_title text;
alter table classroom.school_members drop constraint if exists school_members_job_title_length;
alter table classroom.school_members
  add constraint school_members_job_title_length check (job_title is null or char_length(job_title) <= 80);

-- ---------------------------------------------------------------- grants
create table if not exists classroom.member_module_access (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  module text not null check (module in ('bursary', 'store', 'accounts', 'payroll', 'admissions', 'auditlog')),
  level text not null check (level in ('read', 'edit')),
  granted_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id, module),
  constraint member_module_access_auditlog_read check (module <> 'auditlog' or level = 'read')
);

alter table classroom.member_module_access enable row level security;

drop policy if exists "people read their own module access" on classroom.member_module_access;
create policy "people read their own module access"
  on classroom.member_module_access for select to authenticated
  using (user_id = auth.uid() or classroom.is_school_admin(school_id));

drop policy if exists "school admins manage module access" on classroom.member_module_access;
create policy "school admins manage module access"
  on classroom.member_module_access for all to authenticated
  using (classroom.is_school_admin(school_id))
  with check (
    classroom.is_school_admin(school_id)
    and exists (select 1 from classroom.school_members m where m.school_id = member_module_access.school_id and m.user_id = member_module_access.user_id)
  );

grant select, insert, update, delete on classroom.member_module_access to authenticated;

-- The caller's access to a module at a school: 'edit', 'read' or null.
-- Only while they are an active member there.
create or replace function classroom.module_access(target_school uuid, target_module text)
returns text
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select g.level
  from classroom.member_module_access g
  where g.school_id = target_school
    and g.user_id = auth.uid()
    and g.module = target_module
    and exists (
      select 1 from classroom.school_members m
      where m.school_id = g.school_id and m.user_id = g.user_id and m.is_active
    )
  limit 1;
$fn$;
grant execute on function classroom.module_access(uuid, text) to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function classroom.can_do_bursary(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.has_role_in(target_school, array['owner', 'admin', 'bursar']::classroom.member_role[])
      or coalesce(classroom.module_access(target_school, 'bursary') = 'edit', false);
$fn$;

create or replace function classroom.can_do_store(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.has_role_in(target_school, array['owner', 'admin', 'bursar']::classroom.member_role[])
      or coalesce(classroom.module_access(target_school, 'store') = 'edit', false);
$fn$;

create or replace function classroom.can_do_accounts(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.has_role_in(target_school, array['owner', 'admin', 'bursar']::classroom.member_role[])
      or coalesce(classroom.module_access(target_school, 'accounts') = 'edit', false);
$fn$;

create or replace function classroom.can_do_payroll(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.has_role_in(target_school, array['owner', 'admin', 'bursar']::classroom.member_role[])
      or coalesce(classroom.module_access(target_school, 'payroll') = 'edit', false);
$fn$;

create or replace function classroom.can_do_admissions(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.has_role_in(target_school, array['owner', 'admin', 'principal', 'admissions']::classroom.member_role[])
      or coalesce(classroom.module_access(target_school, 'admissions') = 'edit', false);
$fn$;

create or replace function classroom.can_view_bursary(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.can_do_bursary(target_school) or classroom.module_access(target_school, 'bursary') is not null;
$fn$;
create or replace function classroom.can_view_store(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.can_do_store(target_school) or classroom.module_access(target_school, 'store') is not null;
$fn$;
create or replace function classroom.can_view_accounts(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.can_do_accounts(target_school) or classroom.module_access(target_school, 'accounts') is not null;
$fn$;
create or replace function classroom.can_view_payroll(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.can_do_payroll(target_school) or classroom.module_access(target_school, 'payroll') is not null;
$fn$;
create or replace function classroom.can_view_admissions(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.can_do_admissions(target_school) or classroom.module_access(target_school, 'admissions') is not null;
$fn$;

grant execute on function
  classroom.can_do_store(uuid), classroom.can_do_accounts(uuid),
  classroom.can_view_bursary(uuid), classroom.can_view_store(uuid), classroom.can_view_accounts(uuid),
  classroom.can_view_payroll(uuid), classroom.can_view_admissions(uuid)
to authenticated;

-- ---------------------------------------------------------------- functions
-- Store and Accounts functions move onto their own helpers; read-only
-- functions move onto the view helpers. Each body is the live definition with
-- only the helper name swapped.
do $$
declare
  r record;
  def text;
begin
  for r in
    select p.oid, p.proname, m.from_name, m.to_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'classroom'
    join (values
      -- store: writes, then the read
      ('adjust_store_stock', 'can_do_bursary(', 'can_do_store('),
      ('record_store_sale', 'can_do_bursary(', 'can_do_store('),
      ('restock_store_product', 'can_do_bursary(', 'can_do_store('),
      ('void_store_sale', 'can_do_bursary(', 'can_do_store('),
      ('store_profit', 'can_do_bursary(', 'can_view_store('),
      -- accounts: writes
      ('accounting_backfill', 'can_do_bursary(', 'can_do_accounts('),
      ('accounting_setup', 'can_do_bursary(', 'can_do_accounts('),
      ('post_manual_journal', 'can_do_bursary(', 'can_do_accounts('),
      ('reverse_journal', 'can_do_bursary(', 'can_do_accounts('),
      ('save_account', 'can_do_bursary(', 'can_do_accounts('),
      ('save_opening_balances', 'can_do_bursary(', 'can_do_accounts('),
      -- bursary: reads
      ('debtors', 'can_do_bursary(', 'can_view_bursary('),
      ('collection_summary', 'can_do_bursary(', 'can_view_bursary('),
      ('invoice_applicant_name', 'can_do_bursary(', 'can_view_bursary('),
      ('preview_discount', 'can_do_bursary(', 'can_view_bursary('),
      -- admissions: reads
      ('admissions_queues', 'can_do_admissions(', 'can_view_admissions('),
      ('admissions_summary', 'can_do_admissions(', 'can_view_admissions('),
      ('application_workspace', 'can_do_admissions(', 'can_view_admissions(')
    ) as m(fn, from_name, to_name) on m.fn = p.proname
  loop
    def := pg_get_functiondef(r.oid);
    if position(r.from_name in def) = 0 then
      raise exception 'Expected % in %', r.from_name, r.proname;
    end if;
    execute replace(def, r.from_name, r.to_name);
  end loop;
end $$;

-- ---------------------------------------------------------------- policies
-- Store and accounting tables move onto their own helpers. Then every read
-- policy of the five modules uses the view helper: SELECT policies are
-- changed in place, and each ALL policy gets a twin SELECT policy for
-- viewers (its own expression stays the edit check for writes).
do $$
declare
  r record;
  q text;
  c text;
  sub text;
  helpers text[] := array['bursary', 'store', 'accounts', 'payroll', 'admissions'];
  h text;
  view_q text;
begin
  for r in
    select pol.tablename, pol.policyname, pol.cmd, pol.qual, pol.with_check
    from pg_policies pol
    where pol.schemaname = 'classroom'
      and (coalesce(pol.qual, '') ~ 'can_do_(bursary|payroll|admissions)\('
        or coalesce(pol.with_check, '') ~ 'can_do_(bursary|payroll|admissions)\(')
  loop
    q := r.qual;
    c := r.with_check;
    sub := case
      when r.tablename like 'store\_%' then 'store'
      when r.tablename in ('accounting_settings', 'chart_of_accounts', 'journal_entries', 'journal_lines') then 'accounts'
      else null
    end;
    if sub is not null then
      q := replace(q, 'can_do_bursary(', 'can_do_' || sub || '(');
      c := replace(c, 'can_do_bursary(', 'can_do_' || sub || '(');
    end if;

    view_q := q;
    if view_q is not null then
      foreach h in array helpers loop
        view_q := replace(view_q, 'can_do_' || h || '(', 'can_view_' || h || '(');
      end loop;
    end if;

    if r.cmd = 'SELECT' then
      execute format('alter policy %I on classroom.%I using (%s)', r.policyname, r.tablename, view_q);
    else
      if q is distinct from r.qual and q is not null then
        execute format('alter policy %I on classroom.%I using (%s)', r.policyname, r.tablename, q);
      end if;
      if c is distinct from r.with_check and c is not null then
        execute format('alter policy %I on classroom.%I with check (%s)', r.policyname, r.tablename, c);
      end if;
      if r.cmd = 'ALL' and view_q is not null then
        execute format('drop policy if exists %I on classroom.%I', left(r.policyname || ' (view access)', 63), r.tablename);
        execute format('create policy %I on classroom.%I for select to authenticated using (%s)',
          left(r.policyname || ' (view access)', 63), r.tablename, view_q);
      end if;
    end if;
  end loop;
end $$;

-- Admissions documents in storage: viewers may open them, not upload or delete.
do $$
declare
  q text;
begin
  select qual into q from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'read course files and admissions documents';
  if q is null then raise exception 'storage read policy not found'; end if;
  execute format('alter policy %I on storage.objects using (%s)',
    'read course files and admissions documents', replace(q, 'can_do_admissions(', 'can_view_admissions('));
end $$;

-- Audit log: view only.
alter policy "administrators read their school's audit log" on classroom.audit_log
  using (
    classroom.has_role_in(school_id, array['owner', 'admin']::classroom.member_role[])
    or classroom.module_access(school_id, 'auditlog') is not null
  );

notify pgrst, 'reload schema';
