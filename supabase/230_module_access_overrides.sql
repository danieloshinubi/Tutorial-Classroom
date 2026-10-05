-- A person's access to a module can now be set whatever their role, not
-- only added to (208). For a module their role includes, the school can
-- narrow it to View only or switch it off (No access); for one it does not,
-- it can still open it as View only or Can edit. A principal who should not
-- see the Bursary, say, no longer sees it.
--
--   member_module_access.level   now 'none' | 'read' | 'edit', for any
--                                module, not only the six grantable ones.
--   module_override              the caller's own setting, 'none' included.
--   module_access                unchanged meaning: 'read' | 'edit' | null
--                                ('none' is never returned as access).
--   can_do_* / can_view_*        a setting wins over the role: 'none' shuts
--                                the module, 'read' makes it view only.
--
-- The owner (proprietor) is never restricted. The app hides restricted
-- modules from the menu and their pages; the database enforces it for the
-- money and admissions modules, where the records are.

alter table classroom.member_module_access drop constraint if exists member_module_access_module_check;
alter table classroom.member_module_access add constraint member_module_access_module_check
  check (module ~ '^[a-z_]{2,40}$');
alter table classroom.member_module_access drop constraint if exists member_module_access_level_check;
alter table classroom.member_module_access add constraint member_module_access_level_check
  check (level in ('none', 'read', 'edit'));
alter table classroom.member_module_access drop constraint if exists member_module_access_auditlog_read;
alter table classroom.member_module_access add constraint member_module_access_auditlog_read
  check (module <> 'auditlog' or level in ('none', 'read'));

-- Never on the proprietor.
create or replace function classroom.member_module_access_guard()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if exists (select 1 from classroom.school_members m
              where m.school_id = new.school_id and m.user_id = new.user_id and m.role = 'owner') then
    raise exception 'The proprietor always has full access; it cannot be limited.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists member_module_access_guard on classroom.member_module_access;
create trigger member_module_access_guard before insert or update on classroom.member_module_access
  for each row execute function classroom.member_module_access_guard();

-- The caller's own setting for a module, 'none' included.
create or replace function classroom.module_override(target_school uuid, target_module text)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select g.level
  from classroom.member_module_access g
  where g.school_id = target_school
    and g.user_id = (select auth.uid())
    and g.module = target_module
    and exists (
      select 1 from classroom.school_members m
      where m.school_id = g.school_id and m.user_id = g.user_id and m.is_active
        and m.role not in ('student', 'parent')
    )
  limit 1;
$fn$;
grant execute on function classroom.module_override(uuid, text) to authenticated;

-- Access as before: 'read' | 'edit' | null. 'none' is not access.
create or replace function classroom.module_access(target_school uuid, target_module text)
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select nullif(classroom.module_override(target_school, target_module), 'none');
$fn$;

-- Role, then the person's own setting on top of it.
create or replace function classroom.module_level(target_school uuid, target_module text, role_list classroom.member_role[])
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select case
    when classroom.has_role_in(target_school, array['owner']::classroom.member_role[]) and 'owner' = any (role_list) then 'edit'
    else coalesce(
      classroom.module_override(target_school, target_module),
      case when classroom.has_role_in(target_school, role_list) then 'edit' end)
  end;
$fn$;
grant execute on function classroom.module_level(uuid, text, classroom.member_role[]) to authenticated;

create or replace function classroom.can_do_bursary(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'bursary', array['owner', 'admin', 'bursar']::classroom.member_role[]) = 'edit', false);
$fn$;
create or replace function classroom.can_do_store(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'store', array['owner', 'admin', 'bursar']::classroom.member_role[]) = 'edit', false);
$fn$;
create or replace function classroom.can_do_accounts(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'accounts', array['owner', 'admin', 'bursar']::classroom.member_role[]) = 'edit', false);
$fn$;
create or replace function classroom.can_do_payroll(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'payroll', array['owner', 'admin', 'bursar']::classroom.member_role[]) = 'edit', false);
$fn$;
create or replace function classroom.can_do_admissions(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'admissions', array['owner', 'admin', 'principal', 'admissions']::classroom.member_role[]) = 'edit', false);
$fn$;

create or replace function classroom.can_view_bursary(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'bursary', array['owner', 'admin', 'bursar']::classroom.member_role[]) in ('read', 'edit'), false);
$fn$;
create or replace function classroom.can_view_store(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'store', array['owner', 'admin', 'bursar']::classroom.member_role[]) in ('read', 'edit'), false);
$fn$;
create or replace function classroom.can_view_accounts(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'accounts', array['owner', 'admin', 'bursar']::classroom.member_role[]) in ('read', 'edit'), false);
$fn$;
create or replace function classroom.can_view_payroll(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'payroll', array['owner', 'admin', 'bursar']::classroom.member_role[]) in ('read', 'edit'), false);
$fn$;
create or replace function classroom.can_view_admissions(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'admissions', array['owner', 'admin', 'principal', 'admissions']::classroom.member_role[]) in ('read', 'edit'), false);
$fn$;

notify pgrst, 'reload schema';
