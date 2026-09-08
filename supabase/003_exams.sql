-- =============================================================================
-- Exams and tests
--
-- Tutors author an exam with questions; students sit it in the app; multiple
-- choice and true/false are marked automatically, short answers are marked by
-- the tutor afterwards.
--
-- Run this after schema.sql. Safe to re-run.
-- =============================================================================

drop table if exists classroom.exam_answers cascade;
drop table if exists classroom.exam_attempts cascade;
drop table if exists classroom.exam_options cascade;
drop table if exists classroom.exam_questions cascade;
drop table if exists classroom.exams cascade;
drop type  if exists classroom.question_kind cascade;

create type classroom.question_kind as enum ('multiple_choice', 'true_false', 'short_answer');

-- -----------------------------------------------------------------------------
-- exams
-- -----------------------------------------------------------------------------
create table classroom.exams (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references classroom.courses (id) on delete cascade,
  title          text not null,
  instructions   text,
  -- Null means untimed. Otherwise the countdown starts when the student opens it.
  duration_mins  int,
  opens_at       timestamptz,
  closes_at      timestamptz,
  -- Students only ever see published exams.
  published      boolean not null default false,
  -- Whether the score and correct answers are revealed straight after submitting.
  show_results   boolean not null default true,
  created_by     uuid references classroom.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index exams_course_idx on classroom.exams (course_id, created_at desc);

-- -----------------------------------------------------------------------------
-- questions and their options
-- -----------------------------------------------------------------------------
create table classroom.exam_questions (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references classroom.exams (id) on delete cascade,
  kind       classroom.question_kind not null default 'multiple_choice',
  prompt     text not null,
  points     int not null default 1,
  position   int not null default 0,
  -- Used to mark short answers automatically when it is filled in; the tutor
  -- can still override the mark by hand.
  answer_key text
);

create index exam_questions_exam_idx on classroom.exam_questions (exam_id, position);

create table classroom.exam_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references classroom.exam_questions (id) on delete cascade,
  body        text not null,
  is_correct  boolean not null default false,
  position    int not null default 0
);

create index exam_options_question_idx on classroom.exam_options (question_id, position);

-- -----------------------------------------------------------------------------
-- attempts and answers
-- -----------------------------------------------------------------------------
create table classroom.exam_attempts (
  id            uuid primary key default gen_random_uuid(),
  exam_id       uuid not null references classroom.exams (id) on delete cascade,
  user_id       uuid not null references classroom.profiles (id) on delete cascade,
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  -- Auto-marked portion, filled in on submit.
  auto_score    int,
  -- Final mark including any hand-marked short answers.
  total_score   int,
  max_score     int,
  graded_at     timestamptz,
  -- One sitting per student per exam.
  unique (exam_id, user_id)
);

create index exam_attempts_exam_idx on classroom.exam_attempts (exam_id);

create table classroom.exam_answers (
  id                 uuid primary key default gen_random_uuid(),
  attempt_id         uuid not null references classroom.exam_attempts (id) on delete cascade,
  question_id        uuid not null references classroom.exam_questions (id) on delete cascade,
  selected_option_id uuid references classroom.exam_options (id) on delete set null,
  answer_text        text,
  awarded_points     int,
  unique (attempt_id, question_id)
);

create index exam_answers_attempt_idx on classroom.exam_answers (attempt_id);

-- =============================================================================
-- Marking
--
-- Runs as the exam's owner rather than the student, so it can read
-- exam_options.is_correct — which students must never be able to select.
-- =============================================================================
create or replace function classroom.submit_exam_attempt(target_attempt uuid)
returns classroom.exam_attempts
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  attempt classroom.exam_attempts;
  auto    int := 0;
  total   int := 0;
begin
  select * into attempt from classroom.exam_attempts where id = target_attempt;

  if attempt is null then
    raise exception 'No such attempt';
  end if;
  if attempt.user_id <> auth.uid() then
    raise exception 'That attempt belongs to someone else';
  end if;
  if attempt.submitted_at is not null then
    raise exception 'This attempt has already been submitted';
  end if;

  -- Mark everything that can be marked without a human.
  update classroom.exam_answers a
  set awarded_points = case
        when q.kind in ('multiple_choice', 'true_false') then
          case when exists (
            select 1 from classroom.exam_options o
            where o.id = a.selected_option_id and o.is_correct
          ) then q.points else 0 end
        when q.kind = 'short_answer' and q.answer_key is not null then
          case when lower(btrim(coalesce(a.answer_text, ''))) = lower(btrim(q.answer_key))
               then q.points else 0 end
        else null  -- left for the tutor to mark
      end
  from classroom.exam_questions q
  where a.question_id = q.id and a.attempt_id = target_attempt;

  select coalesce(sum(a.awarded_points), 0) into auto
  from classroom.exam_answers a where a.attempt_id = target_attempt;

  select coalesce(sum(q.points), 0) into total
  from classroom.exam_questions q where q.exam_id = attempt.exam_id;

  update classroom.exam_attempts
  set submitted_at = now(),
      auto_score = auto,
      total_score = auto,
      max_score = total
  where id = target_attempt
  returning * into attempt;

  return attempt;
end;
$$;

-- Recompute the total after a tutor marks short answers by hand.
create or replace function classroom.recalculate_attempt(target_attempt uuid)
returns classroom.exam_attempts
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  attempt classroom.exam_attempts;
  total   int;
begin
  select * into attempt from classroom.exam_attempts where id = target_attempt;
  if attempt is null then
    raise exception 'No such attempt';
  end if;

  if not exists (
    select 1 from classroom.exams e
    where e.id = attempt.exam_id and classroom.can_manage_course(e.course_id)
  ) then
    raise exception 'You do not manage this exam';
  end if;

  select coalesce(sum(awarded_points), 0) into total
  from classroom.exam_answers where attempt_id = target_attempt;

  update classroom.exam_attempts
  set total_score = total, graded_at = now()
  where id = target_attempt
  returning * into attempt;

  return attempt;
end;
$$;

grant execute on function
  classroom.submit_exam_attempt(uuid),
  classroom.recalculate_attempt(uuid)
to authenticated;

-- =============================================================================
-- Row level security
-- =============================================================================
alter table classroom.exams          enable row level security;
alter table classroom.exam_questions enable row level security;
alter table classroom.exam_options   enable row level security;
alter table classroom.exam_attempts  enable row level security;
alter table classroom.exam_answers   enable row level security;

-- exams: students see published ones; the course's staff see everything.
create policy "read published exams, or all if you manage the course"
  on classroom.exams for select to authenticated
  using (published or classroom.can_manage_course(course_id));

create policy "course managers create exams"
  on classroom.exams for insert to authenticated
  with check (classroom.can_manage_course(course_id));

create policy "course managers update exams"
  on classroom.exams for update to authenticated
  using (classroom.can_manage_course(course_id))
  with check (classroom.can_manage_course(course_id));

create policy "course managers delete exams"
  on classroom.exams for delete to authenticated
  using (classroom.can_manage_course(course_id));

-- questions follow their exam.
create policy "read questions of readable exams"
  on classroom.exam_questions for select to authenticated
  using (exists (
    select 1 from classroom.exams e
    where e.id = exam_id and (e.published or classroom.can_manage_course(e.course_id))
  ));

create policy "course managers write questions"
  on classroom.exam_questions for all to authenticated
  using (exists (
    select 1 from classroom.exams e
    where e.id = exam_id and classroom.can_manage_course(e.course_id)
  ))
  with check (exists (
    select 1 from classroom.exams e
    where e.id = exam_id and classroom.can_manage_course(e.course_id)
  ));

-- options: readable by anyone who can read the question. `is_correct` is a
-- column on this table, so the client must never select it — the app asks only
-- for id/body/position, and marking happens inside submit_exam_attempt().
create policy "read options of readable questions"
  on classroom.exam_options for select to authenticated
  using (exists (
    select 1 from classroom.exam_questions q
    join classroom.exams e on e.id = q.exam_id
    where q.id = question_id and (e.published or classroom.can_manage_course(e.course_id))
  ));

create policy "course managers write options"
  on classroom.exam_options for all to authenticated
  using (exists (
    select 1 from classroom.exam_questions q
    join classroom.exams e on e.id = q.exam_id
    where q.id = question_id and classroom.can_manage_course(e.course_id)
  ))
  with check (exists (
    select 1 from classroom.exam_questions q
    join classroom.exams e on e.id = q.exam_id
    where q.id = question_id and classroom.can_manage_course(e.course_id)
  ));

-- attempts: your own, or every attempt if you run the course.
create policy "read own attempts, managers read all"
  on classroom.exam_attempts for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from classroom.exams e
      where e.id = exam_id and classroom.can_manage_course(e.course_id)
    )
  );

create policy "students start their own attempt"
  on classroom.exam_attempts for insert to authenticated
  with check (auth.uid() = user_id);

create policy "course managers update attempts"
  on classroom.exam_attempts for update to authenticated
  using (exists (
    select 1 from classroom.exams e
    where e.id = exam_id and classroom.can_manage_course(e.course_id)
  ))
  with check (exists (
    select 1 from classroom.exams e
    where e.id = exam_id and classroom.can_manage_course(e.course_id)
  ));

-- answers: a student may write only while their attempt is still open.
create policy "read own answers, managers read all"
  on classroom.exam_answers for select to authenticated
  using (exists (
    select 1 from classroom.exam_attempts t
    left join classroom.exams e on e.id = t.exam_id
    where t.id = attempt_id
      and (t.user_id = auth.uid() or classroom.can_manage_course(e.course_id))
  ));

create policy "students answer their own open attempt"
  on classroom.exam_answers for insert to authenticated
  with check (exists (
    select 1 from classroom.exam_attempts t
    where t.id = attempt_id and t.user_id = auth.uid() and t.submitted_at is null
  ));

create policy "students change answers before submitting"
  on classroom.exam_answers for update to authenticated
  using (exists (
    select 1 from classroom.exam_attempts t
    where t.id = attempt_id and t.user_id = auth.uid() and t.submitted_at is null
  ))
  with check (exists (
    select 1 from classroom.exam_attempts t
    where t.id = attempt_id and t.user_id = auth.uid() and t.submitted_at is null
  ));

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
    where t.id = attempt_id and classroom.can_manage_course(e.course_id)
  ));

-- =============================================================================
-- Grants (a custom schema gets none by default)
-- =============================================================================
grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
