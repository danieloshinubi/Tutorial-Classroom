-- School admin can now be switched off for a person too, like any module
-- (230, 231), with two rules so a school can never lock itself out of the
-- page where access is changed:
--
--   1. nobody can switch off their own School admin access;
--   2. at least one active owner or admin always keeps it.
--
-- School admin is either kept (with the role) or off: 'none' is the only
-- setting it takes.

alter table classroom.member_module_access drop constraint if exists member_module_access_school_none;
alter table classroom.member_module_access add constraint member_module_access_school_none
  check (module <> 'school' or level = 'none');

create or replace function classroom.school_admin_access_guard()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if new.module <> 'school' or new.level <> 'none' then
    return new;
  end if;
  if new.user_id = (select auth.uid()) then
    raise exception 'You cannot switch off your own School admin access.';
  end if;
  if not exists (
    select 1 from classroom.school_members m
     where m.school_id = new.school_id and m.is_active and m.granted_via is null
       and m.role in ('owner', 'admin')
       and m.user_id <> new.user_id
       and not exists (select 1 from classroom.member_module_access g
                        where g.school_id = m.school_id and g.user_id = m.user_id
                          and g.module = 'school' and g.level = 'none')
  ) then
    raise exception 'At least one owner or admin has to keep School admin, so the school can still manage access.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists school_admin_access_guard on classroom.member_module_access;
create trigger school_admin_access_guard before insert or update on classroom.member_module_access
  for each row execute function classroom.school_admin_access_guard();

notify pgrst, 'reload schema';
