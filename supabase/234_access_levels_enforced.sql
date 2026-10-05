-- Can edit, View only and No access do what they say in every module, not
-- only the money and admissions ones (230). Each module's own permission
-- check now asks the person's setting first, and falls back to their role
-- only when nothing is set:
--
--   timetable   can_manage_timetable   'edit' sets it; 'read'/'none' cannot
--   attendance  can_mark_attendance    'edit' marks any class; 'read'/'none' none
--   teach       can_manage_course,     'read'/'none' change no course and
--               course creation        create none
--   school      is_school_admin        'edit' has the administrator's
--                                      powers; 'read'/'none' do not
--   tickets     is_ticket_staff,       'edit' works every ticket, 'read' sees
--               can_access_ticket      them without changing, 'none' neither
--
-- School admin keeps 232's rules, now counting View only as losing it too:
-- nobody takes it from themselves, and one owner or admin always keeps it.

-- Timetable ---------------------------------------------------------------------------
create or replace function classroom.can_manage_timetable(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(classroom.module_level(target_school, 'timetable', array['owner', 'admin', 'principal']::classroom.member_role[]) = 'edit', false);
$fn$;

-- Attendance --------------------------------------------------------------------------
create or replace function classroom.can_mark_attendance(target_class uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (
    select 1 from classroom.classes c
     where c.id = target_class
       and case classroom.module_override(c.school_id, 'attendance')
             when 'edit' then true
             when 'read' then false
             when 'none' then false
             else (
               c.form_teacher_id = (select auth.uid())
               or exists (select 1 from classroom.class_subjects cs where cs.class_id = c.id and cs.teacher_id = (select auth.uid()))
               or classroom.has_role_in(c.school_id, array['owner', 'admin', 'principal']::classroom.member_role[]))
           end);
$fn$;

-- Courses (Teach) ---------------------------------------------------------------------
create or replace function classroom.can_manage_course(target_course uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (
    select 1 from classroom.courses c
     where c.id = target_course
       and coalesce(classroom.module_override(c.school_id, 'teach'), '') not in ('read', 'none')
       and (c.owner_id = (select auth.uid())
            or classroom.is_school_admin(c.school_id)
            or classroom.has_role_in(c.school_id, array['principal']::classroom.member_role[])));
$fn$;

drop policy if exists "staff create courses in their school" on classroom.courses;
create policy "staff create courses in their school" on classroom.courses
  for insert to authenticated
  with check (
    coalesce(classroom.module_override(school_id, 'teach'), '') not in ('read', 'none')
    and (classroom.is_school_admin(school_id)
         or ((classroom.is_school_staff(school_id) or classroom.module_override(school_id, 'teach') = 'edit')
             and owner_id = (select auth.uid()))));

-- School admin ------------------------------------------------------------------------
create or replace function classroom.is_school_admin(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select case classroom.module_override(target_school, 'school')
           when 'edit' then true
           when 'read' then false
           when 'none' then false
           else classroom.has_role_in(target_school, array['owner', 'admin']::classroom.member_role[])
         end;
$fn$;

create or replace function classroom.school_admin_access_guard()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if new.module <> 'school' or new.level not in ('none', 'read') then
    return new;
  end if;
  if new.user_id = (select auth.uid()) then
    raise exception 'You cannot limit your own School admin access.';
  end if;
  if not exists (
    select 1 from classroom.school_members m
     where m.school_id = new.school_id and m.is_active and m.granted_via is null
       and m.role in ('owner', 'admin')
       and m.user_id <> new.user_id
       and not exists (select 1 from classroom.member_module_access g
                        where g.school_id = m.school_id and g.user_id = m.user_id
                          and g.module = 'school' and g.level in ('none', 'read'))
  ) then
    raise exception 'At least one owner or admin has to keep full School admin, so the school can still manage access.';
  end if;
  return new;
end;
$fn$;

-- Tickets -----------------------------------------------------------------------------
create or replace function classroom.is_ticket_staff(target_school uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select case classroom.module_override(target_school, 'tickets')
           when 'edit' then true
           when 'read' then true
           when 'none' then false
           else classroom.has_role_in(target_school,
                  array['owner', 'admin', 'principal', 'bursar', 'admissions', 'teacher']::classroom.member_role[])
         end;
$fn$;

create or replace function classroom.can_access_ticket(target_ticket uuid)
returns boolean language plpgsql stable security definer set search_path = classroom, public as $fn$
declare
  t classroom.tickets;
  setting text;
begin
  select * into t from classroom.tickets where id = target_ticket;
  if not found then
    return false;
  end if;

  -- The person's own setting first: none sees nothing; given access sees
  -- every ticket at the school.
  setting := classroom.module_override(t.school_id, 'tickets');
  if setting = 'none' then
    return false;
  end if;
  if setting in ('read', 'edit') then
    return true;
  end if;

  if classroom.has_role_in(t.school_id, array['owner','admin']::classroom.member_role[]) then
    return true;
  end if;
  if not classroom.is_ticket_staff(t.school_id) then
    return false;
  end if;
  if t.group_id is null then
    return false; -- untriaged; only owner/admin until it's routed
  end if;
  return exists (
    select 1 from classroom.ticket_groups tg
    where tg.id = t.group_id
      and tg.role is not null
      and classroom.has_role_in(t.school_id, array[tg.role])
  );
end;
$fn$;

-- Working a ticket (as opposed to seeing it) also needs more than View only.
create or replace function classroom.can_work_ticket(target_ticket uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select classroom.can_access_ticket(target_ticket)
     and coalesce(classroom.module_override((select school_id from classroom.tickets where id = target_ticket), 'tickets'), '') <> 'read';
$fn$;
grant execute on function classroom.can_work_ticket(uuid) to authenticated;

drop policy if exists "ticket staff manage tickets" on classroom.tickets;
drop policy if exists "ticket staff see tickets" on classroom.tickets;
drop policy if exists "ticket staff work tickets" on classroom.tickets;
drop policy if exists "ticket staff update tickets" on classroom.tickets;
drop policy if exists "ticket staff delete tickets" on classroom.tickets;
create policy "ticket staff see tickets" on classroom.tickets
  for select to authenticated using (classroom.can_access_ticket(id));
create policy "ticket staff work tickets" on classroom.tickets
  for insert to authenticated with check (classroom.is_ticket_staff(school_id)
    and coalesce(classroom.module_override(school_id, 'tickets'), '') <> 'read');
create policy "ticket staff update tickets" on classroom.tickets
  for update to authenticated using (classroom.can_work_ticket(id)) with check (classroom.can_work_ticket(id));
create policy "ticket staff delete tickets" on classroom.tickets
  for delete to authenticated using (classroom.can_work_ticket(id));

-- Replying to or updating a ticket is working it: View only cannot.
do $do$
declare f record; d text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'classroom' and p.proname in ('update_ticket', 'add_ticket_message') loop
    d := pg_get_functiondef(f.oid);
    if position('classroom.can_access_ticket(' in d) > 0 then
      execute replace(d, 'classroom.can_access_ticket(', 'classroom.can_work_ticket(');
    end if;
  end loop;
end
$do$;

notify pgrst, 'reload schema';
