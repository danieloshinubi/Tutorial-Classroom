-- =============================================================================
-- Scope student_report()/student_marks() to a single school
--
-- Both functions join enrollments/submissions/exam_attempts up to courses and
-- return every matching row for the student, with no school_id filter at all.
-- can_view_student() (010_reports.sql) is not tenant-aware either — any of
-- its OR-branches (self, guardian, course owner/admin, or admin of ANY school
-- the student belongs to) can grant access regardless of which school is
-- asking. So a student enrolled at two schools had their marks/report from
-- BOTH schools returned to whichever tenant's Report page called this,
-- exactly the class of cross-tenant leak found in fetchCoursesOwnedBy et al.
--
-- The fix: both functions gain a target_school parameter and an
-- and c.school_id = target_school filter. That's sufficient on its own to
-- stop the leak — even though can_view_student()'s permission check stays
-- coarse, the join itself now can't return rows outside target_school.
-- Signature changes, so each old single-argument function is dropped first.
-- =============================================================================

drop function if exists classroom.student_report(uuid);

create or replace function classroom.student_report(target_student uuid, target_school uuid)
returns table(course_id uuid, course_code text, course_title text, level_year integer, assignments_set integer, assignments_done integer, assignments_ontime integer, assignments_graded integer, points_earned integer, points_possible integer, exams_sat integer, exam_score integer, exam_max integer, messages_sent integer, reactions_given integer, last_activity timestamp with time zone)
language sql stable security definer
set search_path = classroom, public as $$
  select
    c.id,
    c.code,
    c.title,
    c.level_year,

    (select count(*)::int from classroom.assignments a
      where a.course_id = c.id),

    (select count(*)::int from classroom.submissions s
      join classroom.assignments a on a.id = s.assignment_id
      where a.course_id = c.id and s.user_id = target_student),

    (select count(*)::int from classroom.submissions s
      join classroom.assignments a on a.id = s.assignment_id
      where a.course_id = c.id and s.user_id = target_student
        and (a.due_at is null or s.submitted_at <= a.due_at)),

    (select count(*)::int from classroom.submissions s
      join classroom.assignments a on a.id = s.assignment_id
      where a.course_id = c.id and s.user_id = target_student
        and s.grade is not null),

    (select coalesce(sum(s.grade), 0)::int from classroom.submissions s
      join classroom.assignments a on a.id = s.assignment_id
      where a.course_id = c.id and s.user_id = target_student
        and s.grade is not null),

    -- Only assignments this student was actually marked on count toward the
    -- denominator, so an ungraded pile does not read as a low score.
    (select coalesce(sum(a.points), 0)::int from classroom.submissions s
      join classroom.assignments a on a.id = s.assignment_id
      where a.course_id = c.id and s.user_id = target_student
        and s.grade is not null),

    (select count(*)::int from classroom.exam_attempts t
      join classroom.exams e on e.id = t.exam_id
      where e.course_id = c.id and t.user_id = target_student
        and t.submitted_at is not null),

    (select coalesce(sum(t.total_score), 0)::int from classroom.exam_attempts t
      join classroom.exams e on e.id = t.exam_id
      where e.course_id = c.id and t.user_id = target_student
        and t.submitted_at is not null),

    (select coalesce(sum(t.max_score), 0)::int from classroom.exam_attempts t
      join classroom.exams e on e.id = t.exam_id
      where e.course_id = c.id and t.user_id = target_student
        and t.submitted_at is not null),

    (select count(*)::int from classroom.messages m
      where m.course_id = c.id and m.user_id = target_student),

    -- Reactions this student gave on that course's stream. Counted, not
    -- weighted: analysis.js decides what a reaction is worth next to a
    -- written comment.
    (select count(*)::int
       from classroom.message_reactions r
       join classroom.messages m2 on m2.id = r.message_id
      where m2.course_id = c.id and r.user_id = target_student),

    greatest(
      (select max(s.submitted_at) from classroom.submissions s
        join classroom.assignments a on a.id = s.assignment_id
        where a.course_id = c.id and s.user_id = target_student),
      (select max(m.created_at) from classroom.messages m
        where m.course_id = c.id and m.user_id = target_student),
      (select max(t.submitted_at) from classroom.exam_attempts t
        join classroom.exams e on e.id = t.exam_id
        where e.course_id = c.id and t.user_id = target_student)
    )

  from classroom.enrollments en
  join classroom.courses c on c.id = en.course_id
  where en.user_id = target_student
    and en.status = 'approved'
    and c.school_id = target_school
    and classroom.can_view_student(target_student)
  order by c.code;
$$;

grant execute on function classroom.student_report(uuid, uuid) to authenticated;

drop function if exists classroom.student_marks(uuid);

create or replace function classroom.student_marks(target_student uuid, target_school uuid)
returns table (
  kind        text,
  course_code text,
  title       text,
  scored      int,
  out_of      int,
  happened_at timestamptz,
  late        boolean
)
language sql stable security definer
set search_path = classroom, public as $$
  select m.kind, m.course_code, m.title, m.scored, m.out_of, m.happened_at, m.late
  from (
    select
      'assignment'::text as kind,
      c.code             as course_code,
      a.title            as title,
      s.grade            as scored,
      a.points           as out_of,
      s.submitted_at     as happened_at,
      (a.due_at is not null and s.submitted_at > a.due_at) as late
    from classroom.submissions s
    join classroom.assignments a on a.id = s.assignment_id
    join classroom.courses c on c.id = a.course_id
    where s.user_id = target_student
      and s.grade is not null
      and c.school_id = target_school

    union all

    select
      'exam'::text,
      c.code,
      e.title,
      t.total_score,
      t.max_score,
      t.submitted_at,
      coalesce(t.submitted_late, false)
    from classroom.exam_attempts t
    join classroom.exams e on e.id = t.exam_id
    join classroom.courses c on c.id = e.course_id
    where t.user_id = target_student
      and t.submitted_at is not null
      and c.school_id = target_school
  ) m
  where classroom.can_view_student(target_student)
  order by m.happened_at;
$$;

grant execute on function classroom.student_marks(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
