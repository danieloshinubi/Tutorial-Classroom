-- =============================================================================
-- Tutorial Classroom — database schema
-- Run this once in the Supabase SQL Editor.
-- Everything lives in a dedicated `classroom` schema rather than `public`.
--
-- WARNING: the DROP SCHEMA below destroys every classroom table and all the
-- rows in them. Re-running this is a full reset, not a migration — once you
-- have real data, write incremental migrations instead.
-- =============================================================================

create extension if not exists "pgcrypto";

drop schema if exists classroom cascade;
create schema classroom;

grant usage on schema classroom to anon, authenticated;

-- Expose the schema to PostgREST so supabase-js can reach it with
-- `db: { schema: "classroom" }`. Also add it under
-- Settings > Data API > Exposed schemas in the dashboard.
alter role authenticator set pgrst.db_schemas = 'public, storage, graphql_public, classroom';

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type classroom.user_role as enum ('student', 'tutor', 'admin');

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user
-- -----------------------------------------------------------------------------
create table classroom.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  first_name  text not null default '',
  surname     text not null default '',
  username    text unique,
  role        classroom.user_role not null default 'student',
  level_year  int,
  bio         text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Mirror new auth users into profiles. The signup form passes first_name /
-- surname / username / role through auth metadata, so read them from there.
-- 'admin' is deliberately not accepted here — nobody can sign themselves up as
-- an administrator; see the bootstrap note at the bottom of this file.
create function classroom.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
begin
  insert into classroom.profiles (id, email, first_name, surname, username, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'surname', ''),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    case when requested = 'tutor' then 'tutor'::classroom.user_role
         else 'student'::classroom.user_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function classroom.handle_new_user();

-- -----------------------------------------------------------------------------
-- levels / courses
-- -----------------------------------------------------------------------------
create table classroom.levels (
  year  int primary key,
  label text not null
);

create table classroom.courses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  title       text not null default '',
  description text,
  level_year  int not null references classroom.levels (year) on delete cascade,
  -- The tutor who owns this course. Null for the seeded catalogue, which no
  -- individual tutor created.
  owner_id    uuid references classroom.profiles (id) on delete set null,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index courses_level_year_idx on classroom.courses (level_year);
create index courses_owner_idx on classroom.courses (owner_id);

-- -----------------------------------------------------------------------------
-- enrollments
-- -----------------------------------------------------------------------------
create table classroom.enrollments (
  user_id     uuid not null references classroom.profiles (id) on delete cascade,
  course_id   uuid not null references classroom.courses (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index enrollments_course_idx on classroom.enrollments (course_id);

-- -----------------------------------------------------------------------------
-- materials — reading list / resources for a course
-- -----------------------------------------------------------------------------
create table classroom.materials (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references classroom.courses (id) on delete cascade,
  title       text not null,
  description text,
  url         text,
  created_by  uuid references classroom.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index materials_course_idx on classroom.materials (course_id, created_at desc);

-- -----------------------------------------------------------------------------
-- assignments / submissions
-- -----------------------------------------------------------------------------
create table classroom.assignments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references classroom.courses (id) on delete cascade,
  title       text not null,
  description text,
  points      int not null default 100,
  due_at      timestamptz,
  created_by  uuid references classroom.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index assignments_course_due_idx on classroom.assignments (course_id, due_at);

create table classroom.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references classroom.assignments (id) on delete cascade,
  user_id       uuid not null references classroom.profiles (id) on delete cascade,
  body          text,
  url           text,
  submitted_at  timestamptz not null default now(),
  grade         int,
  feedback      text,
  graded_by     uuid references classroom.profiles (id) on delete set null,
  graded_at     timestamptz,
  -- One submission per student per assignment; resubmitting updates the row.
  unique (assignment_id, user_id)
);

create index submissions_assignment_idx on classroom.submissions (assignment_id);

-- -----------------------------------------------------------------------------
-- messages — the class chat
-- -----------------------------------------------------------------------------
create table classroom.messages (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references classroom.courses (id) on delete cascade,
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  body       text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index messages_course_created_idx on classroom.messages (course_id, created_at);

-- Stream new chat messages to connected clients.
alter publication supabase_realtime add table classroom.messages;

-- =============================================================================
-- Authorisation helpers
--
-- All SECURITY DEFINER so they read past row level security. Without that, a
-- policy on `profiles` that itself queries `profiles` recurses forever.
-- =============================================================================
create function classroom.my_role()
returns classroom.user_role
language sql
stable
security definer
set search_path = classroom, public
as $$
  select role from classroom.profiles where id = auth.uid();
$$;

create function classroom.is_admin()
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $$
  select coalesce(classroom.my_role() = 'admin', false);
$$;

create function classroom.is_staff()
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $$
  select coalesce(classroom.my_role() in ('tutor', 'admin'), false);
$$;

-- True when the signed-in user owns the course, or is an admin.
create function classroom.can_manage_course(target_course uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $$
  select classroom.is_admin()
      or exists (
           select 1 from classroom.courses
           where id = target_course and owner_id = auth.uid()
         );
$$;

-- Same question, asked about the course an assignment belongs to.
create function classroom.can_manage_assignment(target_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = classroom, public
as $$
  select exists (
    select 1 from classroom.assignments a
    where a.id = target_assignment
      and classroom.can_manage_course(a.course_id)
  );
$$;

grant execute on function
  classroom.my_role(),
  classroom.is_admin(),
  classroom.is_staff(),
  classroom.can_manage_course(uuid),
  classroom.can_manage_assignment(uuid)
to authenticated;

-- =============================================================================
-- Table privileges
--
-- Supabase grants these automatically on `public`, but a custom schema gets
-- nothing — so without this block every query fails with
-- "permission denied for table ...", even for a signed-in user.
--
-- These are deliberately broad: table-level GRANTs are the coarse gate, and
-- the row level security policies below are what actually decide who may
-- touch which row. `anon` is granted nothing, so you must sign in to read
-- anything at all.
-- =============================================================================
grant select, insert, update, delete on all tables in schema classroom to authenticated;
grant usage, select on all sequences in schema classroom to authenticated;

-- Anything created in this schema later picks the same grants up.
alter default privileges in schema classroom
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema classroom
  grant usage, select on sequences to authenticated;

-- =============================================================================
-- Row level security
-- =============================================================================
alter table classroom.profiles    enable row level security;
alter table classroom.levels      enable row level security;
alter table classroom.courses     enable row level security;
alter table classroom.enrollments enable row level security;
alter table classroom.materials   enable row level security;
alter table classroom.assignments enable row level security;
alter table classroom.submissions enable row level security;
alter table classroom.messages    enable row level security;

-- profiles -------------------------------------------------------------------
-- Readable by any signed-in user (needed to show message authors and the tutor
-- directory), but you may only edit your own row unless you are an admin.
create policy "profiles are readable by signed-in users"
  on classroom.profiles for select
  to authenticated using (true);

create policy "users insert their own profile"
  on classroom.profiles for insert
  to authenticated with check (auth.uid() = id);

create policy "users update their own profile"
  on classroom.profiles for update
  to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "admins update any profile"
  on classroom.profiles for update
  to authenticated using (classroom.is_admin()) with check (classroom.is_admin());

create policy "admins delete profiles"
  on classroom.profiles for delete
  to authenticated using (classroom.is_admin());

-- levels ---------------------------------------------------------------------
create policy "levels are readable by signed-in users"
  on classroom.levels for select to authenticated using (true);

create policy "admins manage levels"
  on classroom.levels for all
  to authenticated using (classroom.is_admin()) with check (classroom.is_admin());

-- courses --------------------------------------------------------------------
create policy "courses are readable by signed-in users"
  on classroom.courses for select
  to authenticated using (true);

-- A tutor may create a course, but only with themselves as the owner.
create policy "tutors create their own courses"
  on classroom.courses for insert
  to authenticated
  with check (
    classroom.is_admin()
    or (classroom.is_staff() and owner_id = auth.uid())
  );

create policy "owners and admins update courses"
  on classroom.courses for update
  to authenticated
  using (classroom.can_manage_course(id))
  with check (classroom.can_manage_course(id));

create policy "owners and admins delete courses"
  on classroom.courses for delete
  to authenticated using (classroom.can_manage_course(id));

-- enrollments ----------------------------------------------------------------
create policy "read own enrollments, or the roster of a course you manage"
  on classroom.enrollments for select
  to authenticated
  using (auth.uid() = user_id or classroom.can_manage_course(course_id));

create policy "users enroll themselves; staff enroll others"
  on classroom.enrollments for insert
  to authenticated
  with check (auth.uid() = user_id or classroom.can_manage_course(course_id));

create policy "users unenroll themselves; staff remove others"
  on classroom.enrollments for delete
  to authenticated
  using (auth.uid() = user_id or classroom.can_manage_course(course_id));

-- materials ------------------------------------------------------------------
create policy "materials are readable by signed-in users"
  on classroom.materials for select
  to authenticated using (true);

create policy "course managers write materials"
  on classroom.materials for insert
  to authenticated with check (classroom.can_manage_course(course_id));

create policy "course managers update materials"
  on classroom.materials for update
  to authenticated
  using (classroom.can_manage_course(course_id))
  with check (classroom.can_manage_course(course_id));

create policy "course managers delete materials"
  on classroom.materials for delete
  to authenticated using (classroom.can_manage_course(course_id));

-- assignments ----------------------------------------------------------------
create policy "assignments are readable by signed-in users"
  on classroom.assignments for select
  to authenticated using (true);

create policy "course managers write assignments"
  on classroom.assignments for insert
  to authenticated with check (classroom.can_manage_course(course_id));

create policy "course managers update assignments"
  on classroom.assignments for update
  to authenticated
  using (classroom.can_manage_course(course_id))
  with check (classroom.can_manage_course(course_id));

create policy "course managers delete assignments"
  on classroom.assignments for delete
  to authenticated using (classroom.can_manage_course(course_id));

-- submissions ----------------------------------------------------------------
-- A student sees only their own work; the course's tutor sees the whole pile.
create policy "students read own submissions, managers read all"
  on classroom.submissions for select
  to authenticated
  using (
    auth.uid() = user_id
    or classroom.can_manage_assignment(assignment_id)
  );

create policy "students submit their own work"
  on classroom.submissions for insert
  to authenticated with check (auth.uid() = user_id);

create policy "students edit their own submission"
  on classroom.submissions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "course managers grade submissions"
  on classroom.submissions for update
  to authenticated
  using (classroom.can_manage_assignment(assignment_id))
  with check (classroom.can_manage_assignment(assignment_id));

create policy "students withdraw their own submission"
  on classroom.submissions for delete
  to authenticated using (auth.uid() = user_id);

-- messages -------------------------------------------------------------------
create policy "messages are readable by signed-in users"
  on classroom.messages for select
  to authenticated using (true);

create policy "users post their own messages"
  on classroom.messages for insert
  to authenticated with check (auth.uid() = user_id);

create policy "authors and course managers delete messages"
  on classroom.messages for delete
  to authenticated
  using (auth.uid() = user_id or classroom.can_manage_course(course_id));

-- =============================================================================
-- No seed data.
--
-- Class levels and courses belong to each school and are created through the
-- app, not shipped in this file. A fresh tenant starts empty and its
-- administrator defines the structure that school actually uses.
-- =============================================================================


notify pgrst, 'reload schema';

-- =============================================================================
-- Bootstrapping the first administrator
--
-- Signup can only ever produce a student or a tutor. To create your first
-- admin, sign up through the app as normal, then run this once with your own
-- address:
--
--   update classroom.profiles set role = 'admin'
--   where email = 'you@example.com';
--
-- From then on that account can promote anyone else from the admin portal.
-- =============================================================================
