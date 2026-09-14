-- =============================================================================
-- Time & Attendance — one mark per student, per class, per school day
--
-- Deliberately daily, not per-period: nothing in this schema models a
-- timetable or subject periods, only classes and who teaches what within
-- them (class_subjects). Building period-level scheduling first would be a
-- much larger feature in its own right, so this marks a class's roster once
-- a day, the same rhythm a form teacher's own register already runs on.
--
-- Who may mark a class's attendance (settled with the product owner):
--   - that class's form teacher (classes.form_teacher_id)
--   - any teacher assigned to one of that class's subjects (class_subjects)
--   - owner/admin/principal, for the whole school
--
-- Who may read a student's attendance:
--   - owner/admin/principal/teacher — any staff member, not only the
--     marking teacher, the same breadth already given to reading results
--   - the student's own guardian (classroom.is_guardian_of, from 024_results)
--
-- Run after 024 (is_guardian_of, has_role_in already exist) and 012
-- (classes, class_subjects). Safe to re-run.
-- =============================================================================

create table if not exists classroom.attendance_records (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  class_id    uuid not null references classroom.classes (id) on delete cascade,
  student_id  uuid not null references classroom.profiles (id) on delete cascade,
  -- Convenience denormalisation for reporting by term without a date-range
  -- join every time; nullable since a mark can predate/outlive term dates
  -- (a correction, a holiday makeup day) without becoming unrecordable.
  term_id     uuid references classroom.terms (id) on delete set null,
  date        date not null,
  status      text not null check (status in ('present', 'absent', 'late', 'excused')),
  note        text,
  marked_by   uuid references classroom.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One mark per student per class per day; marking again the same day is a
  -- correction (upsert), not a second record.
  unique (class_id, student_id, date)
);

create index if not exists attendance_records_class_date_idx
  on classroom.attendance_records (class_id, date);
create index if not exists attendance_records_student_date_idx
  on classroom.attendance_records (student_id, date);
create index if not exists attendance_records_school_date_idx
  on classroom.attendance_records (school_id, date);

-- marked_by/updated_at come from the server, not whatever the client sends —
-- the same reasoning as actor_id elsewhere in this schema (024_results.sql,
-- application_events): the signed-in caller is authoritative, not a form field.
create or replace function classroom.stamp_attendance_record()
returns trigger
language plpgsql
as $fn$
begin
  new.marked_by = auth.uid();
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists attendance_records_stamp on classroom.attendance_records;
create trigger attendance_records_stamp
  before insert or update on classroom.attendance_records
  for each row execute function classroom.stamp_attendance_record();

-- Whether the signed-in caller may mark (insert/update/delete) attendance
-- for this specific class — form teacher, a subject teacher on that class,
-- or school leadership.
create or replace function classroom.can_mark_attendance(target_class uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.classes c
    where c.id = target_class
      and (
        c.form_teacher_id = auth.uid()
        or exists (
          select 1 from classroom.class_subjects cs
          where cs.class_id = c.id and cs.teacher_id = auth.uid()
        )
        or classroom.has_role_in(
          c.school_id, array['owner', 'admin', 'principal']::classroom.member_role[]
        )
      )
  );
$fn$;

grant execute on function classroom.can_mark_attendance(uuid) to authenticated;

-- Every class the signed-in caller may mark today — drives the class picker
-- on the Mark-attendance screen without the client needing its own copy of
-- the eligibility rule above.
create or replace function classroom.markable_classes(target_school uuid)
returns setof classroom.classes
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select c.*
  from classroom.classes c
  where c.school_id = target_school
    and classroom.can_mark_attendance(c.id)
  order by c.level_year, c.name;
$fn$;

grant execute on function classroom.markable_classes(uuid) to authenticated;

alter table classroom.attendance_records enable row level security;

drop policy if exists "staff mark attendance for their classes" on classroom.attendance_records;
create policy "staff mark attendance for their classes"
  on classroom.attendance_records for all to authenticated
  using (classroom.can_mark_attendance(class_id))
  with check (classroom.can_mark_attendance(class_id) and classroom.is_member_of(school_id));

drop policy if exists "staff read their school's attendance" on classroom.attendance_records;
create policy "staff read their school's attendance"
  on classroom.attendance_records for select to authenticated
  using (
    classroom.has_role_in(
      school_id, array['owner', 'admin', 'principal', 'teacher']::classroom.member_role[]
    )
  );

drop policy if exists "a guardian reads their child's attendance" on classroom.attendance_records;
create policy "a guardian reads their child's attendance"
  on classroom.attendance_records for select to authenticated
  using (classroom.is_guardian_of(student_id));
