-- Co-teachers: more than one teacher runs a course, with the same rights as
-- the one who created it (2026-10-14).
--
-- A course was run by its creator (owner_id) alone, besides admins and the
-- principal; any other teacher who joined was a pupil in it, so a teacher
-- taking over (or sharing) a class could not post, mark or approve anything.
-- Now a course's teachers are: its lead (owner_id), the co-teachers added to
-- it, and, for a course that belongs to a class's subject, that subject's
-- teacher. Every one of them can do everything the lead can: the same
-- can_manage_course every policy already uses. They get the course's
-- notices and join requests, see its pupils' reports, and appear on Teach.
--
-- The lead or an admin adds and removes co-teachers (People tab); a
-- co-teacher can be made the lead (a hand-over), the old lead staying on as
-- a co-teacher.

create table if not exists classroom.course_teachers (
  course_id  uuid not null references classroom.courses (id) on delete cascade,
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  added_by   uuid references classroom.profiles (id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (course_id, user_id)
);
create index if not exists course_teachers_user_idx on classroom.course_teachers (user_id);
alter table classroom.course_teachers enable row level security;
drop policy if exists "members see a course's teachers" on classroom.course_teachers;
create policy "members see a course's teachers" on classroom.course_teachers for select to authenticated
  using (exists (select 1 from classroom.courses c where c.id = course_teachers.course_id and classroom.is_member_of(c.school_id)));
grant select on classroom.course_teachers to authenticated;
-- No insert/update/delete policy: only add_course_teacher / remove_course_teacher.

-- Everyone who teaches a course.
create or replace function classroom.course_teacher_ids(target_course uuid)
returns setof uuid language sql stable security definer set search_path = classroom, public as $fn$
  select c.owner_id from classroom.courses c where c.id = target_course and c.owner_id is not null
  union
  select ct.user_id from classroom.course_teachers ct where ct.course_id = target_course
  union
  select cs.teacher_id from classroom.courses c join classroom.class_subjects cs on cs.id = c.class_subject_id
   where c.id = target_course and cs.teacher_id is not null;
$fn$;
grant execute on function classroom.course_teacher_ids(uuid) to authenticated;

create or replace function classroom.is_course_teacher(target_course uuid, who uuid)
returns boolean language sql stable security definer set search_path = classroom, public as $fn$
  select who is not null and exists (select 1 from classroom.course_teacher_ids(target_course) t where t = who);
$fn$;
grant execute on function classroom.is_course_teacher(uuid, uuid) to authenticated;

do $do$
declare d text;
begin
  -- The one rights check every policy uses.
  d := pg_get_functiondef('classroom.can_manage_course(uuid)'::regprocedure);
  d := replace(d, $a$(c.owner_id = (select auth.uid())$a$, $b$(classroom.is_course_teacher(c.id, (select auth.uid()))$b$);
  if position('is_course_teacher(c.id' in d) = 0 then raise exception 'can_manage_course patch did not apply'; end if;
  execute d;

  -- Seeing a pupil's report, and the list of pupils one may report on.
  d := pg_get_functiondef('classroom.can_view_student(uuid)'::regprocedure);
  d := replace(d, $a$(c.owner_id = auth.uid() or classroom.is_school_admin(c.school_id))$a$, $b$(classroom.is_course_teacher(c.id, auth.uid()) or classroom.is_school_admin(c.school_id))$b$);
  if position('is_course_teacher(c.id' in d) = 0 then raise exception 'can_view_student patch did not apply'; end if;
  execute d;

  d := pg_get_functiondef('classroom.reportable_students(uuid)'::regprocedure);
  d := replace(d, $a$c.owner_id = auth.uid()$a$, $b$classroom.is_course_teacher(c.id, auth.uid())$b$);
  if position('is_course_teacher(c.id' in d) = 0 then raise exception 'reportable_students patch did not apply'; end if;
  execute d;

  -- A course's notices reach all its teachers.
  d := pg_get_functiondef('classroom.notify_course(uuid,text,text,text,text,uuid)'::regprocedure);
  d := replace(d, $a$select course.owner_id where course.owner_id is not null$a$, $b$select t from classroom.course_teacher_ids(target_course) t$b$);
  if position('course_teacher_ids(target_course)' in d) = 0 then raise exception 'notify_course patch did not apply'; end if;
  execute d;

  -- So do join requests.
  d := pg_get_functiondef('classroom.request_enrollment(uuid,text)'::regprocedure);
  d := replace(d, $a$  if row_.status = 'pending' and course.owner_id is not null then$a$, $b$  if row_.status = 'pending' then$b$);
  d := replace(d, $a$    insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
    values (
      course.owner_id, course.school_id, target_course,
      'enrollment_request',
      format('%s asked to join %s', who, course.code),
      note,
      format('/Courses/%s?tab=people', course.code)
    );$a$, $b$    insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
    select t, course.school_id, target_course,
      'enrollment_request',
      format('%s asked to join %s', who, course.code),
      note,
      format('/Courses/%s?tab=people', course.code)
      from classroom.course_teacher_ids(target_course) t;$b$);
  if position('course_teacher_ids(target_course) t;' in d) = 0 then raise exception 'request_enrollment patch did not apply'; end if;
  execute d;

  -- The menu dot for join requests.
  d := pg_get_functiondef('classroom.module_attention(uuid)'::regprocedure);
  d := replace(d, $a$(c.owner_id = me or (c.owner_id is null and classroom.is_school_admin(target_school)))$a$,
                  $b$(classroom.is_course_teacher(c.id, me) or (c.owner_id is null and classroom.is_school_admin(target_school)))$b$);
  if position('is_course_teacher(c.id, me)' in d) = 0 then raise exception 'module_attention patch did not apply'; end if;
  execute d;
end;
$do$;

-- A course's results go back to all its teachers (supabase/258).
create or replace function classroom.result_sheet_teachers(sheet classroom.result_sheets)
returns setof uuid language sql stable security definer set search_path = classroom, public as $fn$
  select t from classroom.course_teacher_ids(sheet.course_id) t where sheet.course_id is not null
  union
  select cs.teacher_id from classroom.class_subjects cs where cs.id = sheet.class_subject_id and cs.teacher_id is not null
  union
  select c.form_teacher_id from classroom.class_subjects cs join classroom.classes c on c.id = cs.class_id
   where cs.id = sheet.class_subject_id and cs.teacher_id is null and c.form_teacher_id is not null;
$fn$;

/* --- adding, removing, handing over --------------------------------------- */
create or replace function classroom.add_course_teacher(target_course uuid, target_user uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare c classroom.courses;
begin
  select * into c from classroom.courses where id = target_course;
  if not found then raise exception 'No such course'; end if;
  if not classroom.can_manage_course(target_course) then raise exception 'Only a teacher of this course can add a teacher to it'; end if;
  if not exists (select 1 from classroom.school_members m where m.school_id = c.school_id and m.user_id = target_user and m.is_active
                  and m.role in ('teacher', 'principal', 'admin', 'owner')) then
    raise exception 'Only a member of staff who teaches can be a teacher of a course';
  end if;
  if classroom.is_course_teacher(target_course, target_user) then return; end if;
  insert into classroom.course_teachers (course_id, user_id, added_by) values (target_course, target_user, auth.uid())
  on conflict do nothing;
  -- A teacher is not also a pupil of the course.
  delete from classroom.enrollments where course_id = target_course and user_id = target_user;
  insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
  values (target_user, c.school_id, target_course, 'course_teacher_added',
          format('You now teach %s', c.code),
          format('%s added you as a teacher of %s. You can do everything its lead teacher can.', coalesce(classroom.actor_label(), 'Someone'), coalesce(c.title, c.code)),
          format('/Courses/%s', c.code));
end;
$fn$;
revoke all on function classroom.add_course_teacher(uuid, uuid) from public, anon;
grant execute on function classroom.add_course_teacher(uuid, uuid) to authenticated;

create or replace function classroom.remove_course_teacher(target_course uuid, target_user uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare c classroom.courses;
begin
  select * into c from classroom.courses where id = target_course;
  if not found then raise exception 'No such course'; end if;
  if not classroom.can_manage_course(target_course) then raise exception 'Only a teacher of this course can change its teachers'; end if;
  if c.owner_id = target_user then raise exception 'Make someone else the lead teacher first'; end if;
  delete from classroom.course_teachers where course_id = target_course and user_id = target_user;
end;
$fn$;
revoke all on function classroom.remove_course_teacher(uuid, uuid) from public, anon;
grant execute on function classroom.remove_course_teacher(uuid, uuid) to authenticated;

-- The hand-over: a co-teacher becomes the lead; the old lead stays a co-teacher.
create or replace function classroom.make_course_lead(target_course uuid, target_user uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare c classroom.courses;
begin
  select * into c from classroom.courses where id = target_course for update;
  if not found then raise exception 'No such course'; end if;
  if not classroom.can_manage_course(target_course) then raise exception 'Only a teacher of this course can change its lead'; end if;
  if not exists (select 1 from classroom.course_teachers where course_id = target_course and user_id = target_user) then
    raise exception 'Add them as a teacher of the course first';
  end if;
  if c.owner_id is not null then
    insert into classroom.course_teachers (course_id, user_id, added_by) values (target_course, c.owner_id, auth.uid()) on conflict do nothing;
  end if;
  delete from classroom.course_teachers where course_id = target_course and user_id = target_user;
  update classroom.courses set owner_id = target_user where id = target_course;
end;
$fn$;
revoke all on function classroom.make_course_lead(uuid, uuid) from public, anon;
grant execute on function classroom.make_course_lead(uuid, uuid) to authenticated;

-- What the course page asks: may I run this course, and who teaches it.
create or replace function classroom.course_staff(target_course uuid)
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  select jsonb_build_object(
    'can_manage', classroom.can_manage_course(target_course),
    'teachers', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, 'surname', p.surname, 'username', p.username, 'email', p.email, 'avatar_url', p.avatar_url,
                                          'lead', p.id = c.owner_id,
                                          'via_subject', p.id <> coalesce(c.owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                                        and not exists (select 1 from classroom.course_teachers ct where ct.course_id = c.id and ct.user_id = p.id))
                       order by (p.id = c.owner_id) desc, p.first_name)
        from classroom.profiles p
       where p.id in (select classroom.course_teacher_ids(target_course))), '[]'::jsonb))
  from classroom.courses c
  where c.id = target_course and classroom.is_member_of(c.school_id);
$fn$;
revoke all on function classroom.course_staff(uuid) from public, anon;
grant execute on function classroom.course_staff(uuid) to authenticated;

-- The courses someone teaches, for Teach and the dashboard.
create or replace function classroom.my_taught_course_ids(target_school uuid)
returns setof uuid language sql stable security definer set search_path = classroom, public as $fn$
  select c.id from classroom.courses c
   where c.school_id = target_school and classroom.is_course_teacher(c.id, (select auth.uid()));
$fn$;
revoke all on function classroom.my_taught_course_ids(uuid) from public, anon;
grant execute on function classroom.my_taught_course_ids(uuid) to authenticated;

notify pgrst, 'reload schema';
