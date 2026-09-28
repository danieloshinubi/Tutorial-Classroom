-- Everyone this viewer may report on, with their progress, in one call.
--
-- The Reports page promised "How your students are progressing" and then
-- listed names and email addresses: the figures only existed one student at a
-- time, behind student_report(). Calling that once per student from the page
-- would mean hundreds of requests for a real school, so this returns the whole
-- list at once.
--
-- Two rules keep it honest:
--   * WHO appears is exactly reportable_students(): an administrator sees the
--     school, a parent their children, a tutor the students on their courses.
--     Every student is also passed through can_view_student(), the same gate
--     the student's own report page uses, so this list can never show a
--     figure that opening the student would not.
--   * WHAT each figure means is exactly student_report(): each course row
--     carries the same columns, counted the same way. The page then runs the
--     same analyse() over them that the detail page runs, so the average,
--     hand-in rate and punctuality on the list are, by construction, the
--     numbers the student's report shows. (The average there is the mean of
--     per-course blended scores, which cannot be rebuilt from summed totals —
--     hence per-course rows here rather than one pre-summed row.)
--
-- Written as grouped joins rather than student_report's correlated
-- subqueries: the same arithmetic, but a handful of scans for the whole
-- school instead of fourteen subqueries per course per student.

create or replace function classroom.report_overview(target_school uuid)
returns table (
  student_id   uuid,
  first_name   text,
  surname      text,
  email        text,
  avatar_url   text,
  class_name   text,
  relationship text,
  is_my_child  boolean,
  courses      jsonb
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  with viewer as (
    select r.student_id, r.first_name, r.surname, r.email, r.avatar_url
    from classroom.reportable_students(target_school) r
    where classroom.can_view_student(r.student_id)
  ),
  en as (
    select en.user_id as student_id, c.id as course_id, c.code, c.title, c.level_year
    from classroom.enrollments en
    join classroom.courses c on c.id = en.course_id
    join viewer v on v.student_id = en.user_id
    where en.status = 'approved'
      and c.school_id = target_school
  ),
  aset as (
    select a.course_id, count(*)::int as n
    from classroom.assignments a
    where a.course_id in (select distinct course_id from en)
    group by a.course_id
  ),
  sub as (
    select s.user_id as student_id, a.course_id,
      count(*)::int as done,
      count(*) filter (where a.due_at is null or s.submitted_at <= a.due_at)::int as ontime,
      count(*) filter (where s.grade is not null)::int as graded,
      coalesce(sum(s.grade) filter (where s.grade is not null), 0)::int as earned,
      -- Only work this student was marked on counts toward the denominator,
      -- exactly as in student_report(): an ungraded pile is not a low score.
      coalesce(sum(a.points) filter (where s.grade is not null), 0)::int as possible,
      max(s.submitted_at) as last_at
    from classroom.submissions s
    join classroom.assignments a on a.id = s.assignment_id
    join en on en.course_id = a.course_id and en.student_id = s.user_id
    group by s.user_id, a.course_id
  ),
  ex as (
    select t.user_id as student_id, e.course_id,
      count(*)::int as sat,
      coalesce(sum(t.total_score), 0)::int as score,
      coalesce(sum(t.max_score), 0)::int as max_score,
      max(t.submitted_at) as last_at
    from classroom.exam_attempts t
    join classroom.exams e on e.id = t.exam_id
    join en on en.course_id = e.course_id and en.student_id = t.user_id
    where t.submitted_at is not null
    group by t.user_id, e.course_id
  ),
  msg as (
    select m.user_id as student_id, m.course_id,
      count(*)::int as sent,
      max(m.created_at) as last_at
    from classroom.messages m
    join en on en.course_id = m.course_id and en.student_id = m.user_id
    group by m.user_id, m.course_id
  ),
  rx as (
    select r.user_id as student_id, m2.course_id, count(*)::int as given
    from classroom.message_reactions r
    join classroom.messages m2 on m2.id = r.message_id
    join en on en.course_id = m2.course_id and en.student_id = r.user_id
    group by r.user_id, m2.course_id
  ),
  course_rows as (
    select en.student_id,
      jsonb_agg(
        jsonb_build_object(
          'course_id',          en.course_id,
          'course_code',        en.code,
          'course_title',       en.title,
          'level_year',         en.level_year,
          'assignments_set',    coalesce(aset.n, 0),
          'assignments_done',   coalesce(sub.done, 0),
          'assignments_ontime', coalesce(sub.ontime, 0),
          'assignments_graded', coalesce(sub.graded, 0),
          'points_earned',      coalesce(sub.earned, 0),
          'points_possible',    coalesce(sub.possible, 0),
          'exams_sat',          coalesce(ex.sat, 0),
          'exam_score',         coalesce(ex.score, 0),
          'exam_max',           coalesce(ex.max_score, 0),
          'messages_sent',      coalesce(msg.sent, 0),
          'reactions_given',    coalesce(rx.given, 0),
          'last_activity',      greatest(sub.last_at, msg.last_at, ex.last_at)
        )
        order by en.code
      ) as courses
    from en
    left join aset on aset.course_id = en.course_id
    left join sub  on sub.student_id = en.student_id and sub.course_id = en.course_id
    left join ex   on ex.student_id  = en.student_id and ex.course_id  = en.course_id
    left join msg  on msg.student_id = en.student_id and msg.course_id = en.course_id
    left join rx   on rx.student_id  = en.student_id and rx.course_id  = en.course_id
    group by en.student_id
  ),
  -- The class a student is in now: the current session's class if there is
  -- one, otherwise the most recent. Used to filter the list by class.
  cls as (
    select distinct on (cs.student_id) cs.student_id, cl.name
    from classroom.class_students cs
    join classroom.classes cl on cl.id = cs.class_id and cl.school_id = target_school
    left join classroom.sessions se on se.id = cl.session_id
    where cs.student_id in (select student_id from viewer)
    order by cs.student_id, se.is_current desc nulls last, se.starts_on desc nulls last, cs.added_at desc
  ),
  mine as (
    select g.student_id, g.relationship
    from classroom.guardian_students g
    where g.guardian_id = auth.uid()
      and g.school_id = target_school
  )
  select v.student_id, v.first_name, v.surname, v.email, v.avatar_url,
    cls.name,
    mine.relationship,
    mine.student_id is not null,
    coalesce(cr.courses, '[]'::jsonb)
  from viewer v
  left join course_rows cr on cr.student_id = v.student_id
  left join cls  on cls.student_id  = v.student_id
  left join mine on mine.student_id = v.student_id
  order by v.first_name, v.surname;
$fn$;

grant execute on function classroom.report_overview(uuid) to authenticated;
