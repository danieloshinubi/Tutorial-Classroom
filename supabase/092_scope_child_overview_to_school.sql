-- =============================================================================
-- Scope child_courses()/child_teachers() to a single school
--
-- Neither function filtered by school_id at all — a child enrolled at two
-- schools had both schools' courses/teachers merged into the parent's
-- "My children" overview on whichever tenant they were viewing. Same class
-- of gap as student_report()/student_marks() (090), fixed the same way: add
-- a target_school parameter and filter the courses join by it.
-- =============================================================================

drop function if exists classroom.child_courses(uuid);

create or replace function classroom.child_courses(target_student uuid, target_school uuid)
returns table (
  course_id        uuid,
  course_code      text,
  course_title     text,
  session_id       uuid,
  session_name     text,
  is_current       boolean,
  teacher_id       uuid,
  teacher_name     text,
  joined_at        timestamptz,
  assignments_set  int,
  assignments_done int,
  assignments_late int,
  turn_in_pct      numeric,
  on_time_pct      numeric,
  posts            int,
  exams_sat        int,
  last_active      timestamptz
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    c.id,
    c.code,
    c.title,
    c.session_id,
    s.name,
    coalesce(s.is_current, false),
    c.owner_id,
    coalesce(nullif(btrim(t.first_name || ' ' || t.surname), ''), t.username, t.email),
    en.decided_at,

    counts.set_count,
    counts.done_count,
    counts.late_count,

    -- Percentages rather than raw pairs, because "12 of 14" is the thing a
    -- parent reads and then has to work out anyway.
    case when counts.set_count = 0 then null
         else round(counts.done_count * 100.0 / counts.set_count, 0) end,
    case when counts.done_count = 0 then null
         else round((counts.done_count - counts.late_count) * 100.0 / counts.done_count, 0) end,

    counts.posts,
    counts.exams,
    counts.last_active

  from classroom.enrollments en
  join classroom.courses c on c.id = en.course_id
  left join classroom.sessions s on s.id = c.session_id
  left join classroom.profiles t on t.id = c.owner_id
  cross join lateral (
    select
      (select count(*)::int from classroom.assignments a where a.course_id = c.id)
        as set_count,
      (select count(*)::int from classroom.submissions sub
        join classroom.assignments a on a.id = sub.assignment_id
        where a.course_id = c.id and sub.user_id = target_student)
        as done_count,
      (select count(*)::int from classroom.submissions sub
        join classroom.assignments a on a.id = sub.assignment_id
        where a.course_id = c.id and sub.user_id = target_student
          and a.due_at is not null and sub.submitted_at > a.due_at)
        as late_count,
      (select count(*)::int from classroom.messages m
        where m.course_id = c.id and m.user_id = target_student)
        as posts,
      (select count(*)::int from classroom.exam_attempts at
        join classroom.exams e on e.id = at.exam_id
        where e.course_id = c.id and at.user_id = target_student
          and at.submitted_at is not null)
        as exams,
      greatest(
        (select max(sub.submitted_at) from classroom.submissions sub
          join classroom.assignments a on a.id = sub.assignment_id
          where a.course_id = c.id and sub.user_id = target_student),
        (select max(m.created_at) from classroom.messages m
          where m.course_id = c.id and m.user_id = target_student),
        (select max(at.submitted_at) from classroom.exam_attempts at
          join classroom.exams e on e.id = at.exam_id
          where e.course_id = c.id and at.user_id = target_student)
      ) as last_active
  ) counts
  where en.user_id = target_student
    and en.status = 'approved'
    and c.school_id = target_school
    and classroom.can_view_student(target_student)
  -- This session first, then most recent session, then by code.
  order by coalesce(s.is_current, false) desc, s.starts_on desc nulls last, c.code;
$fn$;

drop function if exists classroom.child_teachers(uuid);

create or replace function classroom.child_teachers(target_student uuid, target_school uuid)
returns table (
  teacher_id   uuid,
  teacher_name text,
  email        text,
  avatar_url   text,
  courses      text,
  teaching_now boolean,
  courses_count int
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    t.id,
    coalesce(nullif(btrim(t.first_name || ' ' || t.surname), ''), t.username, t.email),
    t.email,
    t.avatar_url,
    string_agg(distinct c.code, ', ' order by c.code),
    bool_or(coalesce(s.is_current, false)),
    count(distinct c.id)::int
  from classroom.enrollments en
  join classroom.courses c on c.id = en.course_id
  join classroom.profiles t on t.id = c.owner_id
  left join classroom.sessions s on s.id = c.session_id
  where en.user_id = target_student
    and en.status = 'approved'
    and c.school_id = target_school
    and classroom.can_view_student(target_student)
  group by t.id, t.first_name, t.surname, t.username, t.email, t.avatar_url
  order by bool_or(coalesce(s.is_current, false)) desc, 2;
$fn$;

grant execute on function classroom.child_courses(uuid, uuid)  to authenticated;
grant execute on function classroom.child_teachers(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
