-- =============================================================================
-- Guardians and student reports
--
-- An administrator links a parent to their children. The report itself is
-- computed in Postgres so a parent can never fetch another child's rows: the
-- function checks who is asking before it returns anything.
--
-- Run after 009. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Who may see a child's report
   --------------------------------------------------------------------------- */
create table if not exists classroom.guardian_students (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  guardian_id  uuid not null references classroom.profiles (id) on delete cascade,
  student_id   uuid not null references classroom.profiles (id) on delete cascade,
  relationship text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (guardian_id, student_id),
  -- A guardian is not their own child.
  check (guardian_id <> student_id)
);

create index if not exists guardian_students_guardian_idx
  on classroom.guardian_students (guardian_id);
create index if not exists guardian_students_student_idx
  on classroom.guardian_students (student_id);

alter table classroom.guardian_students enable row level security;

drop policy if exists "guardians and staff read links" on classroom.guardian_students;
create policy "guardians and staff read links"
  on classroom.guardian_students for select to authenticated
  using (
    guardian_id = auth.uid()
    or student_id = auth.uid()
    or classroom.is_school_staff(school_id)
  );

drop policy if exists "school admins manage links" on classroom.guardian_students;
create policy "school admins manage links"
  on classroom.guardian_students for all to authenticated
  using (classroom.is_school_admin(school_id))
  with check (classroom.is_school_admin(school_id));

/* ---------------------------------------------------------------------------
   The access rule, in one place.

   A report is visible to the student, their guardians, any teacher whose
   course they are enrolled in, and the school's administrators.
   --------------------------------------------------------------------------- */
create or replace function classroom.can_view_student(target_student uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select
    target_student = auth.uid()
    or exists (
      select 1 from classroom.guardian_students g
      where g.student_id = target_student and g.guardian_id = auth.uid()
    )
    or exists (
      select 1
      from classroom.enrollments e
      join classroom.courses c on c.id = e.course_id
      where e.user_id = target_student
        and e.status = 'approved'
        and (c.owner_id = auth.uid() or classroom.is_school_admin(c.school_id))
    )
    or exists (
      select 1 from classroom.school_members m
      where m.user_id = target_student
        and classroom.is_school_admin(m.school_id)
    );
$$;

grant execute on function classroom.can_view_student(uuid) to authenticated;

/* ---------------------------------------------------------------------------
   The report

   One row per course the student is enrolled in, with everything the
   analysis needs. Computed here rather than in the browser so that a parent
   cannot simply ask for a different student's rows.
   --------------------------------------------------------------------------- */
create or replace function classroom.student_report(target_student uuid)
returns table (
  course_id          uuid,
  course_code        text,
  course_title       text,
  level_year         int,
  assignments_set    int,
  assignments_done   int,
  assignments_ontime int,
  assignments_graded int,
  points_earned      int,
  points_possible    int,
  exams_sat          int,
  exam_score         int,
  exam_max           int,
  messages_sent      int,
  last_activity      timestamptz
)
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
$$;

grant execute on function classroom.student_report(uuid) to authenticated;

/* ---------------------------------------------------------------------------
   Individual marks, for the trend line and the detail table.
   --------------------------------------------------------------------------- */
create or replace function classroom.student_marks(target_student uuid)
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
  ) m
  where classroom.can_view_student(target_student)
  order by m.happened_at;
$$;

grant execute on function classroom.student_marks(uuid) to authenticated;

/* ---------------------------------------------------------------------------
   Who can I write a report about? Students of a course I teach, my own
   children, or everyone if I run the school.
   --------------------------------------------------------------------------- */
create or replace function classroom.reportable_students(target_school uuid)
returns table (
  student_id uuid,
  first_name text,
  surname    text,
  email      text,
  avatar_url text
)
language sql stable security definer
set search_path = classroom, public as $$
  select distinct p.id, p.first_name, p.surname, p.email, p.avatar_url
  from classroom.profiles p
  join classroom.school_members m
    on m.user_id = p.id and m.school_id = target_school and m.is_active
  where m.role = 'student'
    and (
      classroom.is_school_admin(target_school)
      or exists (
        select 1 from classroom.guardian_students g
        where g.student_id = p.id and g.guardian_id = auth.uid()
      )
      or exists (
        select 1
        from classroom.enrollments e
        join classroom.courses c on c.id = e.course_id
        where e.user_id = p.id and e.status = 'approved' and c.owner_id = auth.uid()
      )
    )
  order by p.first_name, p.surname;
$$;

grant execute on function classroom.reportable_students(uuid) to authenticated;

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
