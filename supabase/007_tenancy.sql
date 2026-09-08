-- =============================================================================
-- Schoolivio — multi-tenancy foundation
--
-- Every school is a tenant. Tables are shared and keyed by school_id; row
-- level security is what keeps two schools apart, so a query that forgets to
-- filter returns nothing rather than someone else's data.
--
-- Run after 006_storage.sql. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Roles
   A role belongs to a MEMBERSHIP, not to a person: the same human can be a
   parent at one school and a teacher at another.
   --------------------------------------------------------------------------- */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type classroom.member_role as enum (
      'owner',       -- proprietor
      'admin',       -- school administrator / principal
      'bursar',      -- fees and payments
      'admissions',  -- applications and placement
      'teacher',
      'student',
      'parent'
    );
  end if;
end $$;

/* ---------------------------------------------------------------------------
   Tenants
   --------------------------------------------------------------------------- */
create table if not exists classroom.schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- The subdomain: <slug>.schoolivio.com
  slug        text not null unique
              check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and length(slug) between 2 and 40),
  logo_url    text,
  address     text,
  phone       text,
  email       text,
  timezone    text not null default 'Africa/Lagos',
  currency    text not null default 'NGN',
  plan        text not null default 'trial',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists classroom.school_members (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  role       classroom.member_role not null default 'student',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, user_id)
);

create index if not exists school_members_user_idx on classroom.school_members (user_id);
create index if not exists school_members_school_idx on classroom.school_members (school_id, role);

-- The vendor. Deliberately separate from school membership so platform staff
-- are never accidentally inside a customer's tenant.
create table if not exists classroom.platform_admins (
  user_id    uuid primary key references classroom.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

/* ---------------------------------------------------------------------------
   Authorisation helpers

   SECURITY DEFINER so they read past RLS — a policy on school_members that
   queried school_members would recurse forever.
   --------------------------------------------------------------------------- */
create or replace function classroom.is_platform_admin()
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select exists (select 1 from classroom.platform_admins where user_id = auth.uid());
$$;

create or replace function classroom.my_school_ids()
returns setof uuid language sql stable security definer
set search_path = classroom, public as $$
  select school_id from classroom.school_members
  where user_id = auth.uid() and is_active;
$$;

create or replace function classroom.is_member_of(target_school uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select target_school is not null and (
    classroom.is_platform_admin()
    or exists (
      select 1 from classroom.school_members
      where user_id = auth.uid() and school_id = target_school and is_active
    )
  );
$$;

create or replace function classroom.has_role_in(
  target_school uuid,
  roles classroom.member_role[]
)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select target_school is not null and (
    classroom.is_platform_admin()
    or exists (
      select 1 from classroom.school_members
      where user_id = auth.uid()
        and school_id = target_school
        and is_active
        and role = any(roles)
    )
  );
$$;

-- Anyone who runs the school: proprietor or administrator.
create or replace function classroom.is_school_admin(target_school uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select classroom.has_role_in(target_school, array['owner','admin']::classroom.member_role[]);
$$;

-- Anyone who may teach: staff roles.
create or replace function classroom.is_school_staff(target_school uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select classroom.has_role_in(
    target_school,
    array['owner','admin','teacher','bursar','admissions']::classroom.member_role[]
  );
$$;

grant execute on function
  classroom.is_platform_admin(),
  classroom.my_school_ids(),
  classroom.is_member_of(uuid),
  classroom.has_role_in(uuid, classroom.member_role[]),
  classroom.is_school_admin(uuid),
  classroom.is_school_staff(uuid)
to authenticated;

/* ---------------------------------------------------------------------------
   Seed the development tenant, and adopt everything that already exists.
   --------------------------------------------------------------------------- */
insert into classroom.schools (name, slug, email, address)
values (
  'Jane-Nath College',
  'jane-nath',
  'admin@jane-nath.schoolivio.com',
  'Lagos, Nigeria'
)
on conflict (slug) do nothing;

/* ---------------------------------------------------------------------------
   school_id on every tenant-owned table
   --------------------------------------------------------------------------- */
alter table classroom.levels        add column if not exists school_id uuid references classroom.schools (id) on delete cascade;
alter table classroom.courses       add column if not exists school_id uuid references classroom.schools (id) on delete cascade;
alter table classroom.notifications add column if not exists school_id uuid references classroom.schools (id) on delete cascade;

-- Backfill everything that predates tenancy into the development school, then
-- make the column mandatory so nothing can be created outside a tenant again.
do $seed$
declare
  dev uuid;
begin
  select id into dev from classroom.schools where slug = 'jane-nath';

  update classroom.levels        set school_id = dev where school_id is null;
  update classroom.courses       set school_id = dev where school_id is null;
  update classroom.notifications set school_id = dev where school_id is null;

  -- Every existing account becomes a member of the development school, keeping
  -- the role it already had.
  insert into classroom.school_members (school_id, user_id, role)
  select
    dev,
    p.id,
    case p.role
      when 'admin' then 'admin'::classroom.member_role
      when 'tutor' then 'teacher'::classroom.member_role
      else 'student'::classroom.member_role
    end
  from classroom.profiles p
  on conflict (school_id, user_id) do nothing;

  -- Whoever was an admin also becomes platform staff for now, so there is a
  -- way into the vendor console during development.
  insert into classroom.platform_admins (user_id)
  select id from classroom.profiles where role = 'admin'
  on conflict (user_id) do nothing;
end $seed$;

-- levels are keyed (school, year) now rather than year alone, so two schools
-- can both have a "Year 7" without colliding.
do $lvl$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'levels_pkey' and conrelid = 'classroom.levels'::regclass
  ) then
    alter table classroom.levels drop constraint levels_pkey cascade;
  end if;
end $lvl$;

alter table classroom.levels alter column school_id set not null;

do $lvl2$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'levels_school_year_key'
  ) then
    alter table classroom.levels add constraint levels_school_year_key unique (school_id, year);
  end if;
end $lvl2$;

alter table classroom.courses alter column school_id set not null;

-- Course codes are unique within a school, not globally: two schools may both
-- teach MATH101.
do $crs$
begin
  if exists (select 1 from pg_constraint where conname = 'courses_code_key') then
    alter table classroom.courses drop constraint courses_code_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'courses_school_code_key') then
    alter table classroom.courses add constraint courses_school_code_key unique (school_id, code);
  end if;
end $crs$;

create index if not exists courses_school_idx on classroom.courses (school_id);
create index if not exists notifications_school_idx on classroom.notifications (school_id);

/* ---------------------------------------------------------------------------
   Row level security for the new tables
   --------------------------------------------------------------------------- */
alter table classroom.schools         enable row level security;
alter table classroom.school_members  enable row level security;
alter table classroom.platform_admins enable row level security;

drop policy if exists "members read their own school" on classroom.schools;
create policy "members read their own school"
  on classroom.schools for select to authenticated
  using (classroom.is_member_of(id));

drop policy if exists "school admins update their school" on classroom.schools;
create policy "school admins update their school"
  on classroom.schools for update to authenticated
  using (classroom.is_school_admin(id))
  with check (classroom.is_school_admin(id));

drop policy if exists "platform admins create schools" on classroom.schools;
create policy "platform admins create schools"
  on classroom.schools for insert to authenticated
  with check (classroom.is_platform_admin());

drop policy if exists "platform admins delete schools" on classroom.schools;
create policy "platform admins delete schools"
  on classroom.schools for delete to authenticated
  using (classroom.is_platform_admin());

-- Membership is visible to the rest of the school; only admins change it.
drop policy if exists "members read the roster" on classroom.school_members;
create policy "members read the roster"
  on classroom.school_members for select to authenticated
  using (user_id = auth.uid() or classroom.is_member_of(school_id));

drop policy if exists "school admins manage membership" on classroom.school_members;
create policy "school admins manage membership"
  on classroom.school_members for all to authenticated
  using (classroom.is_school_admin(school_id))
  with check (classroom.is_school_admin(school_id));

drop policy if exists "platform admins are readable by themselves" on classroom.platform_admins;
create policy "platform admins are readable by themselves"
  on classroom.platform_admins for select to authenticated
  using (user_id = auth.uid() or classroom.is_platform_admin());

/* ---------------------------------------------------------------------------
   Re-scope the existing policies.

   These were written before tenancy and read `using (true)` — meaning any
   signed-in user could read every row in the table. That is exactly the leak
   multi-tenancy has to close. Behaviour inside a school is unchanged.
   --------------------------------------------------------------------------- */

-- profiles: you can see people you share a school with, and yourself.
drop policy if exists "profiles are readable by signed-in users" on classroom.profiles;
create policy "profiles are readable by people who share a school"
  on classroom.profiles for select to authenticated
  using (
    id = auth.uid()
    or classroom.is_platform_admin()
    or exists (
      select 1
      from classroom.school_members mine
      join classroom.school_members theirs on theirs.school_id = mine.school_id
      where mine.user_id = auth.uid() and mine.is_active
        and theirs.user_id = classroom.profiles.id and theirs.is_active
    )
  );

-- levels and courses
drop policy if exists "levels are readable by signed-in users" on classroom.levels;
create policy "levels are readable within the school"
  on classroom.levels for select to authenticated
  using (classroom.is_member_of(school_id));

drop policy if exists "admins manage levels" on classroom.levels;
create policy "school admins manage levels"
  on classroom.levels for all to authenticated
  using (classroom.is_school_admin(school_id))
  with check (classroom.is_school_admin(school_id));

drop policy if exists "courses are readable by signed-in users" on classroom.courses;
create policy "courses are readable within the school"
  on classroom.courses for select to authenticated
  using (classroom.is_member_of(school_id));

drop policy if exists "tutors create their own courses" on classroom.courses;
create policy "staff create courses in their school"
  on classroom.courses for insert to authenticated
  with check (
    classroom.is_school_admin(school_id)
    or (classroom.is_school_staff(school_id) and owner_id = auth.uid())
  );

-- can_manage_course keeps working: it checks ownership, and admin now means
-- admin *of that school* rather than a global administrator.
create or replace function classroom.can_manage_course(target_course uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select exists (
    select 1 from classroom.courses c
    where c.id = target_course
      and (c.owner_id = auth.uid() or classroom.is_school_admin(c.school_id))
  );
$$;

-- Everything hanging off a course inherits its school through this helper.
create or replace function classroom.course_is_visible(target_course uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select exists (
    select 1 from classroom.courses c
    where c.id = target_course and classroom.is_member_of(c.school_id)
  );
$$;

grant execute on function classroom.course_is_visible(uuid) to authenticated;

drop policy if exists "materials are readable by signed-in users" on classroom.materials;
create policy "materials are readable within the school"
  on classroom.materials for select to authenticated
  using (classroom.course_is_visible(course_id));

drop policy if exists "assignments are readable by signed-in users" on classroom.assignments;
create policy "assignments are readable within the school"
  on classroom.assignments for select to authenticated
  using (classroom.course_is_visible(course_id));

drop policy if exists "messages are readable by signed-in users" on classroom.messages;
create policy "messages are readable within the school"
  on classroom.messages for select to authenticated
  using (classroom.course_is_visible(course_id));

drop policy if exists "read published exams, or all if you manage the course" on classroom.exams;
create policy "read published exams within the school"
  on classroom.exams for select to authenticated
  using (
    (published and classroom.course_is_visible(course_id))
    or classroom.can_manage_course(course_id)
  );

/* ---------------------------------------------------------------------------
   Notifications gain a tenant so a parent at two schools sees them separated.
   --------------------------------------------------------------------------- */
drop policy if exists "users read their own notifications" on classroom.notifications;
create policy "users read their own notifications"
  on classroom.notifications for select to authenticated
  using (auth.uid() = user_id);

/* ---------------------------------------------------------------------------
   New rows must carry the school of the course they belong to.
   --------------------------------------------------------------------------- */
create or replace function classroom.request_enrollment(
  target_course uuid,
  note text default null
)
returns classroom.enrollments
language plpgsql security definer
set search_path = classroom, public as $$
declare
  course classroom.courses;
  row_   classroom.enrollments;
  who    text;
begin
  select * into course from classroom.courses where id = target_course;
  if course is null then
    raise exception 'No such course';
  end if;
  if not classroom.is_member_of(course.school_id) then
    raise exception 'That course belongs to another school';
  end if;
  if course.archived then
    raise exception 'That course is archived';
  end if;

  select * into row_ from classroom.enrollments
  where course_id = target_course and user_id = auth.uid();

  if row_ is not null then
    if row_.status = 'declined' then
      update classroom.enrollments
      set status = 'pending', requested_at = now(),
          decided_at = null, decided_by = null, message = note
      where course_id = target_course and user_id = auth.uid()
      returning * into row_;
    else
      return row_;
    end if;
  else
    insert into classroom.enrollments (user_id, course_id, status, message)
    values (
      auth.uid(),
      target_course,
      case when course.join_policy = 'open' then 'approved'::classroom.enrollment_status
           else 'pending'::classroom.enrollment_status end,
      note
    )
    returning * into row_;
  end if;

  if row_.status = 'pending' and course.owner_id is not null then
    select coalesce(nullif(btrim(first_name || ' ' || surname), ''), username, email, 'A student')
    into who from classroom.profiles where id = auth.uid();

    insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
    values (
      course.owner_id,
      course.school_id,
      target_course,
      'enrollment_request',
      format('%s asked to join %s', who, course.code),
      note,
      format('/Levels/%s/Courses/%s', course.level_year, course.code)
    );
  end if;

  return row_;
end;
$$;

create or replace function classroom.decide_enrollment(
  target_course uuid,
  target_user uuid,
  approve boolean
)
returns classroom.enrollments
language plpgsql security definer
set search_path = classroom, public as $$
declare
  course classroom.courses;
  row_   classroom.enrollments;
begin
  select * into course from classroom.courses where id = target_course;
  if course is null then
    raise exception 'No such course';
  end if;
  if not classroom.can_manage_course(target_course) then
    raise exception 'You do not manage this course';
  end if;

  update classroom.enrollments
  set status = case when approve then 'approved'::classroom.enrollment_status
                    else 'declined'::classroom.enrollment_status end,
      decided_at = now(),
      decided_by = auth.uid()
  where course_id = target_course and user_id = target_user
  returning * into row_;

  if row_ is null then
    raise exception 'No such request';
  end if;

  insert into classroom.notifications (user_id, school_id, course_id, kind, title, link)
  values (
    target_user,
    course.school_id,
    target_course,
    case when approve then 'enrollment_approved' else 'enrollment_declined' end,
    format('Your request to join %s was %s', course.code,
           case when approve then 'approved' else 'declined' end),
    format('/Levels/%s/Courses/%s', course.level_year, course.code)
  );

  return row_;
end;
$$;

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- After running this:
--   select s.name, s.slug, count(m.*) as members
--   from classroom.schools s
--   left join classroom.school_members m on m.school_id = s.id
--   group by s.id, s.name, s.slug;
--
-- Expect one row: Jane-Nath College / jane-nath / 2 members.
-- =============================================================================
