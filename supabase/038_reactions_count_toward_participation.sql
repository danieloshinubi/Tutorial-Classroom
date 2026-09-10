-- =============================================================================
-- Count reactions toward participation
--
-- student_report() reported messages_sent and nothing else for taking part,
-- so a student who read every post and reacted to half of them scored the
-- same as one who never opened the course. reactions_given is added beside
-- it — counted here, weighted in src/lib/analysis.js, which is where the rest
-- of the scoring lives.
--
-- The signature gains a column, so the function has to be dropped rather than
-- replaced. The body below is the deployed one with the new column added and
-- nothing else touched.
-- =============================================================================

drop function if exists classroom.student_report(uuid);

CREATE OR REPLACE FUNCTION classroom.student_report(target_student uuid)
 RETURNS TABLE(course_id uuid, course_code text, course_title text, level_year integer, assignments_set integer, assignments_done integer, assignments_ontime integer, assignments_graded integer, points_earned integer, points_possible integer, exams_sat integer, exam_score integer, exam_max integer, messages_sent integer, reactions_given integer, last_activity timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'classroom', 'public'
AS $function$
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
    and classroom.can_view_student(target_student)
  order by c.code;
$function$
;

grant execute on function classroom.student_report(uuid) to authenticated;

notify pgrst, 'reload schema';
