-- Exam and grading integrity, from the security review (2026-10-15).
--
-- 1. The answer key (exam_options.is_correct, exam_questions.answer_key)
--    could be read by any pupil straight from the database: only the app
--    chose not to ask for it. Those two columns are now not readable at all
--    by signed-in users; a teacher who manages the course gets them from
--    exam_answer_keys().
-- 2. A pupil sees a paper's questions only once they have started their own
--    attempt at it (staff who manage the course always). The start screen's
--    "N questions" comes from exam_question_count().
-- 3. Auto-marking only credits an option that belongs to that question, and
--    only counts answers to that exam's questions. mark_attempt can no
--    longer be called from the browser (anyone could force-submit someone
--    else's paper with it); it runs only inside submit / violation handling,
--    and now locks the attempt so a double submit marks once.
-- 4. A pupil's answer must be to a question of their attempt's exam, with an
--    option of that question, and they cannot set their own points.
-- 5. A pupil's assignment submission: only to a course they are on, stamped
--    with the real time, and never with a grade, feedback or grader.

/* ------------------------------------------------------- 1. answer key */

revoke select on classroom.exam_options from authenticated, anon;
grant select (id, question_id, body, position) on classroom.exam_options to authenticated;
revoke select on classroom.exam_questions from authenticated, anon;
grant select (id, exam_id, kind, prompt, points, position, image_path) on classroom.exam_questions to authenticated;

-- The key for one exam, for staff who manage its course.
create or replace function classroom.exam_answer_keys(target_exam uuid)
returns table (question_id uuid, answer_key text, option_id uuid, is_correct boolean)
language sql stable security definer set search_path = classroom, public as $fn$
  select q.id, q.answer_key, o.id, o.is_correct
    from classroom.exams e
    join classroom.exam_questions q on q.exam_id = e.id
    left join classroom.exam_options o on o.question_id = q.id
   where e.id = target_exam and classroom.can_manage_course(e.course_id);
$fn$;
revoke execute on function classroom.exam_answer_keys(uuid) from public, anon;
grant execute on function classroom.exam_answer_keys(uuid) to authenticated;

/* ------------------------------------------- 2. questions after starting */

drop policy if exists "read questions of readable exams" on classroom.exam_questions;
create policy "read questions of readable exams" on classroom.exam_questions for select to authenticated
  using (exists (select 1 from classroom.exams e
                  where e.id = exam_questions.exam_id
                    and (classroom.can_manage_course(e.course_id)
                         or (e.published and exists (select 1 from classroom.exam_attempts t
                                                      where t.exam_id = e.id and t.user_id = (select auth.uid()))))));

drop policy if exists "read options of readable questions" on classroom.exam_options;
create policy "read options of readable questions" on classroom.exam_options for select to authenticated
  using (exists (select 1 from classroom.exam_questions q join classroom.exams e on e.id = q.exam_id
                  where q.id = exam_options.question_id
                    and (classroom.can_manage_course(e.course_id)
                         or (e.published and exists (select 1 from classroom.exam_attempts t
                                                      where t.exam_id = e.id and t.user_id = (select auth.uid()))))));

-- How many questions a paper has, for its start screen.
create or replace function classroom.exam_question_count(target_exam uuid)
returns int language sql stable security definer set search_path = classroom, public as $fn$
  select count(q.*)::int
    from classroom.exams e join classroom.exam_questions q on q.exam_id = e.id
   where e.id = target_exam
     and (classroom.can_manage_course(e.course_id) or (e.published and classroom.is_enrolled_in(e.course_id)));
$fn$;
revoke execute on function classroom.exam_question_count(uuid) from public, anon;
grant execute on function classroom.exam_question_count(uuid) to authenticated;

/* ------------------------------------------------------- 3. marking */

do $do$
declare d text;
begin
  d := pg_get_functiondef('classroom.mark_attempt(uuid,boolean)'::regprocedure);
  d := replace(d, chr(13), '');  -- its body was saved with Windows line endings
  -- Lock the attempt: a submit racing the timer's auto-submit marks once.
  d := replace(d, 'select * into attempt from classroom.exam_attempts where id = target_attempt;',
                  'select * into attempt from classroom.exam_attempts where id = target_attempt for update;');
  -- Only an option of this very question earns its marks.
  d := replace(d, 'where o.id = a.selected_option_id and o.is_correct',
                  'where o.id = a.selected_option_id and o.question_id = q.id and o.is_correct');
  -- Only answers to this exam's questions count.
  d := replace(d, '  from classroom.exam_questions q
  where a.question_id = q.id and a.attempt_id = target_attempt;',
                  '  from classroom.exam_questions q
  where a.question_id = q.id and a.attempt_id = target_attempt and q.exam_id = attempt.exam_id;');
  d := replace(d, '  select coalesce(sum(a.awarded_points), 0) into auto
  from classroom.exam_answers a where a.attempt_id = target_attempt;',
                  '  select coalesce(sum(a.awarded_points), 0) into auto
  from classroom.exam_answers a join classroom.exam_questions q on q.id = a.question_id
  where a.attempt_id = target_attempt and q.exam_id = attempt.exam_id;');
  if position('for update' in d) = 0 or position('o.question_id = q.id' in d) = 0
     or position('q.exam_id = attempt.exam_id;' in d) = 0
     or (length(d) - length(replace(d, 'q.exam_id = attempt.exam_id', ''))) / length('q.exam_id = attempt.exam_id') < 2 then
    raise exception 'mark_attempt patch did not apply';
  end if;
  execute d;
end;
$do$;
revoke execute on function classroom.mark_attempt(uuid, boolean) from public, anon, authenticated;

/* ---------------------------------------------------- 4. answers guard */

create or replace function classroom.exam_answers_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
declare
  exam_of_attempt uuid;
  course uuid;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  select t.exam_id, e.course_id into exam_of_attempt, course
    from classroom.exam_attempts t join classroom.exams e on e.id = t.exam_id
   where t.id = new.attempt_id;
  -- Staff marking (they may only touch points on written answers, per the
  -- marking policy) are not pupils answering.
  if classroom.can_manage_course(course) then return new; end if;
  if not exists (select 1 from classroom.exam_questions q where q.id = new.question_id and q.exam_id = exam_of_attempt) then
    raise exception 'That question is not on this paper.';
  end if;
  if new.selected_option_id is not null
     and not exists (select 1 from classroom.exam_options o where o.id = new.selected_option_id and o.question_id = new.question_id) then
    raise exception 'That option is not one of this question''s.';
  end if;
  -- Points are the marker's, never the pupil's.
  if tg_op = 'INSERT' then
    new.awarded_points := null;
  else
    new.awarded_points := old.awarded_points;
    new.attempt_id := old.attempt_id;
    new.question_id := old.question_id;
  end if;
  return new;
end;
$fn$;
drop trigger if exists exam_answers_guard on classroom.exam_answers;
create trigger exam_answers_guard before insert or update on classroom.exam_answers
  for each row execute function classroom.exam_answers_guard();

/* ------------------------------------------------ 5. submissions guard */

create or replace function classroom.submissions_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
declare course uuid;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if classroom.can_manage_assignment(new.assignment_id) then return new; end if;
  select a.course_id into course from classroom.assignments a where a.id = new.assignment_id;
  if course is null or not classroom.is_enrolled_in(course) then
    raise exception 'You can only hand in work for a course you are on.';
  end if;
  if tg_op = 'UPDATE' then
    new.assignment_id := old.assignment_id;
    new.user_id := old.user_id;
  end if;
  -- Handed in now, and not marked: grading is the teacher's.
  new.submitted_at := now();
  new.grade := null;
  new.feedback := null;
  new.graded_by := null;
  new.graded_at := null;
  return new;
end;
$fn$;
drop trigger if exists submissions_guard on classroom.submissions;
create trigger submissions_guard before insert or update on classroom.submissions
  for each row execute function classroom.submissions_guard();

notify pgrst, 'reload schema';
