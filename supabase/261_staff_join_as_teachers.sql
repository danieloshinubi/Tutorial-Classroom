-- A member of teaching staff in a course is a teacher of it (2026-10-15).
--
-- 260 gave co-teachers the lead's rights, but a teacher who had joined a
-- course the way a pupil does stayed a pupil in it (Teacher1 in BTC-JS2),
-- and had to be added again under Teachers. Now:
--   * staff already in a course as pupils (teacher, principal, admin,
--     owner, and not also a student there) become its co-teachers;
--   * a member of staff asking to join waits for a teacher of the course to
--     approve, even on an open course, so nobody gains a course's rights by
--     joining it; approving them makes them a co-teacher, not a pupil.

-- Teaching staff of a school (and not one of its pupils).
create or replace function classroom.is_teaching_staff(target_school uuid, who uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select exists (select 1 from classroom.school_members m where m.school_id = target_school and m.user_id = who and m.is_active
                  and m.role in ('teacher', 'principal', 'admin', 'owner'))
     and not exists (select 1 from classroom.school_members m where m.school_id = target_school and m.user_id = who and m.is_active
                  and m.role = 'student');
$fn$;
grant execute on function classroom.is_teaching_staff(uuid, uuid) to authenticated;

-- Those already in as pupils.
insert into classroom.course_teachers (course_id, user_id, added_by)
select e.course_id, e.user_id, null
  from classroom.enrollments e join classroom.courses c on c.id = e.course_id
 where e.status = 'approved' and classroom.is_teaching_staff(c.school_id, e.user_id)
   and not classroom.is_course_teacher(c.id, e.user_id)
on conflict do nothing;
delete from classroom.enrollments e using classroom.courses c
 where c.id = e.course_id and e.status = 'approved' and classroom.is_course_teacher(c.id, e.user_id)
   and classroom.is_teaching_staff(c.school_id, e.user_id);

do $do$
declare d text;
begin
  -- Staff always ask, even on an open course.
  d := pg_get_functiondef('classroom.request_enrollment(uuid,text)'::regprocedure);
  d := replace(d, $a$      case when course.join_policy = 'open' then 'approved'::classroom.enrollment_status$a$,
                  $b$      case when course.join_policy = 'open' and not classroom.is_teaching_staff(course.school_id, auth.uid()) then 'approved'::classroom.enrollment_status$b$);
  if position('is_teaching_staff(course.school_id, auth.uid())' in d) = 0 then raise exception 'request_enrollment patch did not apply'; end if;
  execute d;
end;
$do$;

-- Approving a member of staff makes them a co-teacher.
create or replace function classroom.enrollments_staff_become_teachers()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare c classroom.courses;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then return null; end if;
  select * into c from classroom.courses where id = new.course_id;
  if not classroom.is_teaching_staff(c.school_id, new.user_id) then return null; end if;
  insert into classroom.course_teachers (course_id, user_id, added_by) values (new.course_id, new.user_id, new.decided_by)
  on conflict do nothing;
  delete from classroom.enrollments where course_id = new.course_id and user_id = new.user_id;
  insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
  values (new.user_id, c.school_id, c.id, 'course_teacher_added', format('You now teach %s', c.code),
          format('You were added as a teacher of %s. You can do everything its lead teacher can.', coalesce(c.title, c.code)),
          format('/Courses/%s', c.code));
  return null;
end;
$fn$;
drop trigger if exists enrollments_staff_become_teachers on classroom.enrollments;
create trigger enrollments_staff_become_teachers after insert or update of status on classroom.enrollments
  for each row execute function classroom.enrollments_staff_become_teachers();

notify pgrst, 'reload schema';
