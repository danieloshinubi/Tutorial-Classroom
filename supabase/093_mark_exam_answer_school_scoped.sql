-- =============================================================================
-- Scope hand-marking a short-answer exam answer to the current school
--
-- markAnswer() went straight to `update classroom.exam_answers ... eq("id", id)`,
-- relying only on the existing RLS policy (055_exam_answers_manual_mark_scope.sql)
-- which checks classroom.can_manage_course(e.course_id) — correctly checking
-- THAT answer's actual owning school, but with no way to also require it be
-- the tenant currently open in the browser. An owner/admin/principal of more
-- than one school (a common setup — see 090/091/092's own fixes) could mark
-- an answer belonging to a DIFFERENT one of their schools while believing
-- they were grading the current tenant's paper, if a stale id ever reached
-- the client (a race, a copy-pasted link, a bug elsewhere in the UI).
--
-- exam_answers has no school_id of its own, and PostgREST can't filter an
-- UPDATE's row set through an embedded join — so the school + manager +
-- question-kind checks all move into a security-definer RPC instead, the
-- same pattern already used here for submit_exam_attempt/recalculate_attempt.
-- =============================================================================

create or replace function classroom.mark_exam_answer(
  target_answer uuid,
  target_school uuid,
  points        int
)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  course_school uuid;
  course_id_v   uuid;
  q_kind        classroom.question_kind;
begin
  select c.school_id, c.id, q.kind
    into course_school, course_id_v, q_kind
  from classroom.exam_answers a
  join classroom.exam_attempts t on t.id = a.attempt_id
  join classroom.exams e on e.id = t.exam_id
  join classroom.courses c on c.id = e.course_id
  join classroom.exam_questions q on q.id = a.question_id
  where a.id = target_answer;

  if course_school is null then
    raise exception 'No such answer';
  end if;

  if course_school <> target_school then
    raise exception 'That answer does not belong to the current school';
  end if;

  if not classroom.can_manage_course(course_id_v) then
    raise exception 'Only the course manager can mark this answer';
  end if;

  if q_kind <> 'short_answer' then
    raise exception 'Only short-answer questions can be hand-marked';
  end if;

  update classroom.exam_answers set awarded_points = points where id = target_answer;
end;
$fn$;

grant execute on function classroom.mark_exam_answer(uuid, uuid, int) to authenticated;

notify pgrst, 'reload schema';
