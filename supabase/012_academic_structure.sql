-- =============================================================================
-- Phase 02 — the academic calendar and structure
--
-- A school runs sessions made of terms. Within a session, pupils sit in
-- classes; a class is taught subjects, each by a teacher. Fees, results and
-- attendance are all reported per term, so the calendar has to exist before
-- any of them can.
--
-- The classroom module is untouched: `courses` keeps working exactly as it
-- does. A course can optionally be attached to a class-subject, which is how
-- the two halves will meet later without breaking anything today.
--
-- Run after 011. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Sessions and terms
   --------------------------------------------------------------------------- */
create table if not exists classroom.sessions (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  name       text not null,                       -- "2025/2026"
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists classroom.terms (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  session_id uuid not null references classroom.sessions (id) on delete cascade,
  name       text not null,                       -- "First Term"
  position   int not null default 1,
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, name)
);

create index if not exists terms_session_idx on classroom.terms (session_id, position);

-- Exactly one current session per school, and one current term per school.
-- Enforced with partial unique indexes so the database keeps the invariant
-- rather than trusting every code path to remember it.
create unique index if not exists sessions_one_current
  on classroom.sessions (school_id) where is_current;
create unique index if not exists terms_one_current
  on classroom.terms (school_id) where is_current;

/* ---------------------------------------------------------------------------
   Classes — a real roster, not just a level.
   "JSS 2" is a level; "JSS 2B" is a class with pupils and a form teacher.
   --------------------------------------------------------------------------- */
create table if not exists classroom.classes (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references classroom.schools (id) on delete cascade,
  session_id      uuid references classroom.sessions (id) on delete cascade,
  level_year      int not null,
  name            text not null,                  -- "JSS 2B"
  form_teacher_id uuid references classroom.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (school_id, session_id, name),
  foreign key (school_id, level_year)
    references classroom.levels (school_id, year) on delete cascade
);

create index if not exists classes_school_idx on classroom.classes (school_id, level_year);

create table if not exists classroom.class_students (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references classroom.classes (id) on delete cascade,
  student_id uuid not null references classroom.profiles (id) on delete cascade,
  added_at   timestamptz not null default now(),
  -- A pupil sits in one class at a time.
  unique (class_id, student_id)
);

create index if not exists class_students_student_idx
  on classroom.class_students (student_id);

/* ---------------------------------------------------------------------------
   Subjects, and who teaches them to whom
   --------------------------------------------------------------------------- */
create table if not exists classroom.subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  code       text,                                -- "MTH"
  name       text not null,                       -- "Mathematics"
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists classroom.class_subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  class_id   uuid not null references classroom.classes (id) on delete cascade,
  subject_id uuid not null references classroom.subjects (id) on delete cascade,
  teacher_id uuid references classroom.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, subject_id)
);

create index if not exists class_subjects_teacher_idx
  on classroom.class_subjects (teacher_id);

-- The bridge to the existing classroom. Optional and nullable: courses carry
-- on working untouched, and a school that wants a course to belong to a
-- class-subject can say so.
alter table classroom.courses
  add column if not exists class_subject_id uuid
    references classroom.class_subjects (id) on delete set null;

/* ---------------------------------------------------------------------------
   Row level security — read within your school, write if you run it
   --------------------------------------------------------------------------- */
alter table classroom.sessions       enable row level security;
alter table classroom.terms          enable row level security;
alter table classroom.classes        enable row level security;
alter table classroom.class_students enable row level security;
alter table classroom.subjects       enable row level security;
alter table classroom.class_subjects enable row level security;

do $policies$
declare
  t text;
begin
  foreach t in array array['sessions','terms','classes','subjects','class_subjects']
  loop
    execute format(
      'drop policy if exists "read %1$s in your school" on classroom.%1$s', t);
    execute format(
      'create policy "read %1$s in your school" on classroom.%1$s for select
         to authenticated using (classroom.is_member_of(school_id))', t);

    execute format(
      'drop policy if exists "admins manage %1$s" on classroom.%1$s', t);
    execute format(
      'create policy "admins manage %1$s" on classroom.%1$s for all
         to authenticated
         using (classroom.is_school_admin(school_id))
         with check (classroom.is_school_admin(school_id))', t);
  end loop;
end $policies$;

-- class_students has no school_id of its own; it inherits through the class.
drop policy if exists "read class rosters in your school" on classroom.class_students;
create policy "read class rosters in your school"
  on classroom.class_students for select to authenticated
  using (exists (
    select 1 from classroom.classes c
    where c.id = class_id and classroom.is_member_of(c.school_id)
  ));

drop policy if exists "admins manage class rosters" on classroom.class_students;
create policy "admins manage class rosters"
  on classroom.class_students for all to authenticated
  using (exists (
    select 1 from classroom.classes c
    where c.id = class_id and classroom.is_school_admin(c.school_id)
  ))
  with check (exists (
    select 1 from classroom.classes c
    where c.id = class_id and classroom.is_school_admin(c.school_id)
  ));

/* ---------------------------------------------------------------------------
   Switching the current session or term — one statement, so the school is
   never briefly left with two current terms or none.
   --------------------------------------------------------------------------- */
create or replace function classroom.set_current_term(target_term uuid)
returns classroom.terms
language plpgsql security definer
set search_path = classroom, public as $$
declare
  row_ classroom.terms;
begin
  select * into row_ from classroom.terms where id = target_term;
  if row_ is null then
    raise exception 'No such term';
  end if;
  if not classroom.is_school_admin(row_.school_id) then
    raise exception 'Only a school administrator can change the term';
  end if;

  update classroom.terms set is_current = false
  where school_id = row_.school_id and is_current;

  update classroom.sessions set is_current = false
  where school_id = row_.school_id and is_current;

  update classroom.terms set is_current = true where id = target_term
  returning * into row_;

  update classroom.sessions set is_current = true where id = row_.session_id;

  return row_;
end;
$$;

grant execute on function classroom.set_current_term(uuid) to authenticated;

/* ---------------------------------------------------------------------------
   What a teacher teaches, and who is in it.
   --------------------------------------------------------------------------- */
create or replace function classroom.my_teaching(target_school uuid)
returns table (
  class_subject_id uuid,
  class_id         uuid,
  class_name       text,
  subject_name     text,
  level_year       int,
  students         int
)
language sql stable security definer
set search_path = classroom, public as $$
  select
    cs.id, c.id, c.name, s.name, c.level_year,
    (select count(*)::int from classroom.class_students x where x.class_id = c.id)
  from classroom.class_subjects cs
  join classroom.classes c on c.id = cs.class_id
  join classroom.subjects s on s.id = cs.subject_id
  where cs.school_id = target_school
    and (cs.teacher_id = auth.uid() or classroom.is_school_admin(target_school))
  order by c.level_year, c.name, s.name;
$$;

grant execute on function classroom.my_teaching(uuid) to authenticated;

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
