-- Timetable: any of the school's subjects can go in a period (2026-10-06).
--
-- The timetable only offered the subjects already given to that class
-- (School admin → Classes & subjects), so a subject just added to the
-- school's list (Further Mathematics) could not be put on JS1A's week.
-- Now every school subject is offered; picking one the class does not have
-- yet gives it to the class (no teacher yet), as whoever may build the
-- timetable: the principal, an owner or an admin. Returns the class's
-- subject row, new or existing.

create or replace function classroom.timetable_class_subject(target_class uuid, target_subject uuid)
returns uuid language plpgsql security definer set search_path = classroom, public as $fn$
declare
  c classroom.classes;
  id_out uuid;
begin
  select * into c from classroom.classes where id = target_class;
  if not found then raise exception 'That class no longer exists.'; end if;
  if not classroom.can_manage_timetable(c.school_id) then
    raise exception 'Only the principal, an owner or an admin can change the timetable';
  end if;
  if not exists (select 1 from classroom.subjects s where s.id = target_subject and s.school_id = c.school_id) then
    raise exception 'That subject is not one of this school''s subjects.';
  end if;
  insert into classroom.class_subjects (school_id, class_id, subject_id)
  values (c.school_id, c.id, target_subject)
  on conflict (class_id, subject_id) do nothing;
  select cs.id into id_out from classroom.class_subjects cs where cs.class_id = c.id and cs.subject_id = target_subject;
  return id_out;
end;
$fn$;
revoke all on function classroom.timetable_class_subject(uuid, uuid) from public, anon;
grant execute on function classroom.timetable_class_subject(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
