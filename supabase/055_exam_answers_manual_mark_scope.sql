-- =============================================================================
-- A tutor may only hand-mark short-answer questions
--
-- Reported: a teacher's grading screen let them re-score multiple-choice and
-- true/false questions after submission. Those are already auto-graded at
-- submit_exam_attempt() (supabase/003_exams.sql), comparing the student's
-- selected option against the correct one the tutor set while building the
-- exam — there is nothing left for a human to mark, and nothing should be
-- able to override that comparison after the fact.
--
-- The UI fix hides the input for those rows. This is the matching database
-- guard: the fastest way to bypass a hidden UI control is to hit the same
-- Supabase table update directly, so the RLS policy itself now checks the
-- question's kind, not just course-management authority. submit_exam_attempt()
-- runs SECURITY DEFINER and is unaffected — it never goes through this
-- policy, only a client's own UPDATE call does.
-- =============================================================================

drop policy if exists "course managers mark answers" on classroom.exam_answers;
create policy "course managers mark answers"
  on classroom.exam_answers for update to authenticated
  using (exists (
    select 1 from classroom.exam_attempts t
    join classroom.exams e on e.id = t.exam_id
    where t.id = attempt_id and classroom.can_manage_course(e.course_id)
  ))
  with check (exists (
    select 1 from classroom.exam_attempts t
    join classroom.exams e on e.id = t.exam_id
    join classroom.exam_questions q on q.id = exam_answers.question_id
    where t.id = attempt_id
      and classroom.can_manage_course(e.course_id)
      and q.kind = 'short_answer'
  ));

notify pgrst, 'reload schema';
