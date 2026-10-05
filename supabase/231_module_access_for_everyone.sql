-- Anyone's module access can be set, the proprietor's included (after 230,
-- which exempted the owner). School admin itself is never in the list, so a
-- school can always get back in to change access again.
drop trigger if exists member_module_access_guard on classroom.member_module_access;
drop function if exists classroom.member_module_access_guard();

create or replace function classroom.module_level(target_school uuid, target_module text, role_list classroom.member_role[])
returns text language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(
    classroom.module_override(target_school, target_module),
    case when classroom.has_role_in(target_school, role_list) then 'edit' end);
$fn$;

notify pgrst, 'reload schema';
