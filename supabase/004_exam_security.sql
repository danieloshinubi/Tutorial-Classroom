-- =============================================================================
-- Exam integrity / proctoring
--
-- Two layers:
--   1. The browser blocks copy, paste, tab-switching and so on. Those are
--      deterrents — a student with devtools can disable any of them.
--   2. Postgres enforces the rules that actually matter: the deadline, the
--      single attempt, disqualification, and an append-only audit log. None of
--      that can be bypassed by tampering with the client.
--
-- Run after 003_exams.sql. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Per-exam proctoring settings, so a low-stakes quiz can be relaxed and a
   real paper can be locked down.
   --------------------------------------------------------------------------- */
alter table classroom.exams
  add column if not exists require_fullscreen  boolean not null default true,
  add column if not exists block_copy_paste    boolean not null default true,
  add column if not exists shuffle_questions   boolean not null default true,
  add column if not exists shuffle_options     boolean not null default true,
  -- How many warnings before the paper is taken away. 0 = never disqualify.
  add column if not exists max_violations      int     not null default 3,
  -- Seconds of leeway added to the deadline so a slow network cannot cost marks.
  add column if not exists grace_seconds       int     not null default 15;

/* ---------------------------------------------------------------------------
   Attempt state for the invigilator.
   --------------------------------------------------------------------------- */
alter table classroom.exam_attempts
  add column if not exists violations          int     not null default 0,
  add column if not exists disqualified        boolean not null default false,
  add column if not exists disqualified_reason text,
  add column if not exists auto_submitted      boolean not null default false,
  add column if not exists submitted_late      boolean not null default false;

/* ---------------------------------------------------------------------------
   Append-only audit trail. Students may insert their own events and read them
   back, but there is deliberately no UPDATE or DELETE policy for anyone — not
   even a tutor — so the log cannot be rewritten after the fact.
   --------------------------------------------------------------------------- */
create table if not exists classroom.exam_events (
  id         uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references classroom.exam_attempts (id) on delete cascade,
  kind       text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index if not exists exam_events_attempt_idx
  on classroom.exam_events (attempt_id, created_at);

alter table classroom.exam_events enable row level security;

/* ---------------------------------------------------------------------------
   When is this attempt's paper due?
   Whichever comes first: the personal timer, or the exam's closing time.
   --------------------------------------------------------------------------- */
create or replace function classroom.attempt_deadline(target_attempt uuid)
returns timestamptz
language sql
stable
security definer
set search_path = classroom, public
as $$
  select least(
    case when e.duration_mins is null then null
         else t.started_at + make_interval(mins => e.duration_mins)
                           + make_interval(secs => e.grace_seconds)
    end,
    case when e.closes_at is null then null
         else e.closes_at + make_interval(secs => e.grace_seconds)
    end
  )
  from classroom.exam_attempts t
  join classroom.exams e on e.id = t.exam_id
  where t.id = target_attempt;
$$;

-- True while the student is still allowed to write to this paper.
create or replace function classroom.attempt_is_open(target_attempt uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $$
  select exists (
    select 1
    from classroom.exam_attempts t
    where t.id = target_attempt
      and t.user_id = auth.uid()
      and t.submitted_at is null
      and t.disqualified = false
      and (
        classroom.attempt_deadline(target_attempt) is null
        or now() <= classroom.attempt_deadline(target_attempt)
      )
  );
$$;

/* ---------------------------------------------------------------------------
   Record a proctoring violation. The client reports what it saw; the server
   decides what it costs. Returns the updated attempt so the UI can react.
   --------------------------------------------------------------------------- */
create or replace function classroom.record_exam_violation(
  target_attempt uuid,
  violation_kind text,
  violation_detail text default null
)
returns classroom.exam_attempts
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  attempt classroom.exam_attempts;
  limit_n int;
begin
  select * into attempt from classroom.exam_attempts where id = target_attempt;

  if attempt is null then
    raise exception 'No such attempt';
  end if;
  if attempt.user_id <> auth.uid() then
    raise exception 'That attempt belongs to someone else';
  end if;

  -- Always log, even for an already-finished paper: the record matters.
  insert into classroom.exam_events (attempt_id, kind, detail)
  values (target_attempt, violation_kind, violation_detail);

  if attempt.submitted_at is not null then
    return attempt;
  end if;

  update classroom.exam_attempts
  set violations = violations + 1
  where id = target_attempt
  returning * into attempt;

  select max_violations into limit_n
  from classroom.exams where id = attempt.exam_id;

  -- Over the limit: take the paper away and mark whatever was answered.
  if limit_n > 0 and attempt.violations >= limit_n then
    update classroom.exam_attempts
    set disqualified = true,
        disqualified_reason = format(
          'Disqualified after %s proctoring violations (last: %s)',
          attempt.violations, violation_kind
        )
    where id = target_attempt;

    perform classroom.mark_attempt(target_attempt, true);

    select * into attempt from classroom.exam_attempts where id = target_attempt;
  end if;

  return attempt;
end;
$$;

/* ---------------------------------------------------------------------------
   Marking, split out so both a normal submit and a disqualification use the
   same code path.
   --------------------------------------------------------------------------- */
create or replace function classroom.mark_attempt(
  target_attempt uuid,
  forced boolean default false
)
returns classroom.exam_attempts
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  attempt classroom.exam_attempts;
  auto    int := 0;
  total   int := 0;
  late    boolean := false;
begin
  select * into attempt from classroom.exam_attempts where id = target_attempt;
  if attempt is null then
    raise exception 'No such attempt';
  end if;
  if attempt.submitted_at is not null then
    return attempt;
  end if;

  select classroom.attempt_deadline(target_attempt) is not null
     and now() > classroom.attempt_deadline(target_attempt)
  into late;

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
      max_score = total,
      auto_submitted = forced,
      submitted_late = late
  where id = target_attempt
  returning * into attempt;

  return attempt;
end;
$$;

/* ---------------------------------------------------------------------------
   Student-facing submit. Replaces the version in 003_exams.sql.
   --------------------------------------------------------------------------- */
create or replace function classroom.submit_exam_attempt(target_attempt uuid)
returns classroom.exam_attempts
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  attempt classroom.exam_attempts;
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

  insert into classroom.exam_events (attempt_id, kind)
  values (target_attempt, 'submitted');

  return classroom.mark_attempt(target_attempt, false);
end;
$$;

/* ---------------------------------------------------------------------------
   Starting a paper. Doing this server-side stops a student pre-creating an
   attempt, or restarting one to reset the clock.
   --------------------------------------------------------------------------- */
create or replace function classroom.start_exam_attempt(target_exam uuid)
returns classroom.exam_attempts
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  exam    classroom.exams;
  attempt classroom.exam_attempts;
begin
  select * into exam from classroom.exams where id = target_exam;

  if exam is null or not exam.published then
    raise exception 'That exam is not available';
  end if;
  if exam.opens_at is not null and now() < exam.opens_at then
    raise exception 'That exam has not opened yet';
  end if;
  if exam.closes_at is not null and now() > exam.closes_at then
    raise exception 'That exam has closed';
  end if;

  select * into attempt
  from classroom.exam_attempts
  where exam_id = target_exam and user_id = auth.uid();

  -- One sitting only. Returning the existing row means a refresh resumes the
  -- same paper on the same clock rather than starting a new one.
  if attempt is not null then
    return attempt;
  end if;

  insert into classroom.exam_attempts (exam_id, user_id)
  values (target_exam, auth.uid())
  returning * into attempt;

  insert into classroom.exam_events (attempt_id, kind)
  values (attempt.id, 'started');

  return attempt;
end;
$$;

grant execute on function
  classroom.attempt_deadline(uuid),
  classroom.attempt_is_open(uuid),
  classroom.record_exam_violation(uuid, text, text),
  classroom.mark_attempt(uuid, boolean),
  classroom.submit_exam_attempt(uuid),
  classroom.start_exam_attempt(uuid)
to authenticated;

/* ---------------------------------------------------------------------------
   Policies
   --------------------------------------------------------------------------- */

-- Answers may only be written while the paper is genuinely open. This is the
-- rule a tampered client cannot get around: past the deadline, or once
-- disqualified, the database simply refuses the write.
drop policy if exists "students answer their own open attempt" on classroom.exam_answers;
create policy "students answer their own open attempt"
  on classroom.exam_answers for insert to authenticated
  with check (classroom.attempt_is_open(attempt_id));

drop policy if exists "students change answers before submitting" on classroom.exam_answers;
create policy "students change answers before submitting"
  on classroom.exam_answers for update to authenticated
  using (classroom.attempt_is_open(attempt_id))
  with check (classroom.attempt_is_open(attempt_id));

-- A student must not be able to erase an answer they already gave.
drop policy if exists "students withdraw their own submission" on classroom.exam_answers;

-- Attempts are created through start_exam_attempt() only.
drop policy if exists "students start their own attempt" on classroom.exam_attempts;

-- Audit log: insert and read your own, staff read all, nobody edits.
drop policy if exists "read own exam events, managers read all" on classroom.exam_events;
create policy "read own exam events, managers read all"
  on classroom.exam_events for select to authenticated
  using (exists (
    select 1 from classroom.exam_attempts t
    join classroom.exams e on e.id = t.exam_id
    where t.id = attempt_id
      and (t.user_id = auth.uid() or classroom.can_manage_course(e.course_id))
  ));

drop policy if exists "students log their own events" on classroom.exam_events;
create policy "students log their own events"
  on classroom.exam_events for insert to authenticated
  with check (exists (
    select 1 from classroom.exam_attempts t
    where t.id = attempt_id and t.user_id = auth.uid()
  ));

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
