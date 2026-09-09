-- =============================================================================
-- What a parent may see about their child, short of results
--
-- Two questions a parent asks that the platform could not answer:
--
--   which courses is my child taking — and which did they take before?
--   who teaches them?
--
-- Both are answered here, and deliberately WITHOUT scores. There is no mark,
-- no percentage and no grade in either function: those belong to the results
-- workflow, which a school releases when it is ready (see 024). What comes
-- back is engagement — is the work going in, is it going in on time, are they
-- taking part, when were they last active. A parent is entitled to know
-- whether their child is turning up to the work without the school having
-- been forced to publish marks early.
--
-- Access is classroom.can_view_student(), the same guard student_report()
-- already uses: the child themselves, their guardians, a teacher of theirs,
-- or whoever runs the school. A parent cannot reach another family's child by
-- editing an id in the address bar.
-- =============================================================================

create or replace function classroom.child_courses(target_student uuid)
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
    and classroom.can_view_student(target_student)
  -- This session first, then most recent session, then by code.
  order by coalesce(s.is_current, false) desc, s.starts_on desc nulls last, c.code;
$fn$;

-- Everyone who teaches, or has taught, this child — with which courses and
-- whether it is happening now. A parent wanting to raise something about
-- their child should not have to guess who to ask.
create or replace function classroom.child_teachers(target_student uuid)
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
    and classroom.can_view_student(target_student)
  group by t.id, t.first_name, t.surname, t.username, t.email, t.avatar_url
  order by bool_or(coalesce(s.is_current, false)) desc, 2;
$fn$;

grant execute on function classroom.child_courses(uuid)  to authenticated;
grant execute on function classroom.child_teachers(uuid) to authenticated;

notify pgrst, 'reload schema';
