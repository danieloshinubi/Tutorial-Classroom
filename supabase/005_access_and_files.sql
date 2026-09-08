-- =============================================================================
-- Join requests, notifications, and uploaded course files
--
-- Run after 004_exam_security.sql. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Enrollment becomes a request that a tutor approves.
   --------------------------------------------------------------------------- */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'enrollment_status') then
    create type classroom.enrollment_status as enum ('pending', 'approved', 'declined');
  end if;
end $$;

alter table classroom.enrollments
  add column if not exists status       classroom.enrollment_status not null default 'pending',
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists decided_at   timestamptz,
  add column if not exists decided_by   uuid references classroom.profiles (id) on delete set null,
  add column if not exists message      text;

-- Anyone already enrolled keeps their place — this migration must not lock
-- existing students out of courses they are already in.
update classroom.enrollments set status = 'approved', decided_at = now()
where status = 'pending' and created_at < now() - interval '1 second';

-- Per course: 'approval' means the tutor lets people in, 'open' means anyone
-- signed in may join. The seeded catalogue has no tutor to approve anything,
-- so it stays open; courses a tutor creates default to approval.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'join_policy') then
    create type classroom.join_policy as enum ('open', 'approval');
  end if;
end $$;

alter table classroom.courses
  add column if not exists join_policy classroom.join_policy not null default 'approval';

update classroom.courses set join_policy = 'open' where owner_id is null;

create index if not exists enrollments_status_idx
  on classroom.enrollments (course_id, status);

/* ---------------------------------------------------------------------------
   Notifications
   --------------------------------------------------------------------------- */
create table if not exists classroom.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  course_id  uuid references classroom.courses (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on classroom.notifications (user_id, read_at, created_at desc);

alter table classroom.notifications enable row level security;

drop policy if exists "users read their own notifications" on classroom.notifications;
create policy "users read their own notifications"
  on classroom.notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users update their own notifications" on classroom.notifications;
create policy "users update their own notifications"
  on classroom.notifications for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete their own notifications" on classroom.notifications;
create policy "users delete their own notifications"
  on classroom.notifications for delete to authenticated
  using (auth.uid() = user_id);

-- Rows are written by triggers running as definer, never by the client.
-- Guarded: re-running the script must not fail on an already-published table.
do $pub$
begin
  alter publication supabase_realtime add table classroom.notifications;
exception
  when duplicate_object then null;
end $pub$;

/* ---------------------------------------------------------------------------
   Requesting a place, and the tutor's decision
   --------------------------------------------------------------------------- */
create or replace function classroom.request_enrollment(
  target_course uuid,
  note text default null
)
returns classroom.enrollments
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  course classroom.courses;
  row_   classroom.enrollments;
  who    text;
begin
  select * into course from classroom.courses where id = target_course;
  if course is null then
    raise exception 'No such course';
  end if;
  if course.archived then
    raise exception 'That course is archived';
  end if;

  select * into row_ from classroom.enrollments
  where course_id = target_course and user_id = auth.uid();

  -- Asking again after a decline re-opens the request rather than erroring.
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

    insert into classroom.notifications (user_id, course_id, kind, title, body, link)
    values (
      course.owner_id,
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
language plpgsql
security definer
set search_path = classroom, public
as $$
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

  insert into classroom.notifications (user_id, course_id, kind, title, link)
  values (
    target_user,
    target_course,
    case when approve then 'enrollment_approved' else 'enrollment_declined' end,
    format('Your request to join %s was %s', course.code,
           case when approve then 'approved' else 'declined' end),
    format('/Levels/%s/Courses/%s', course.level_year, course.code)
  );

  return row_;
end;
$$;

grant execute on function
  classroom.request_enrollment(uuid, text),
  classroom.decide_enrollment(uuid, uuid, boolean)
to authenticated;

/* ---------------------------------------------------------------------------
   Enrollment policies. Rows are created through request_enrollment() only.
   --------------------------------------------------------------------------- */
drop policy if exists "users enroll themselves; staff enroll others" on classroom.enrollments;

drop policy if exists "read own enrollments, or the roster of a course you manage"
  on classroom.enrollments;
create policy "read own enrollments, or the roster of a course you manage"
  on classroom.enrollments for select to authenticated
  using (auth.uid() = user_id or classroom.can_manage_course(course_id));

drop policy if exists "users unenroll themselves; staff remove others" on classroom.enrollments;
create policy "users unenroll themselves; staff remove others"
  on classroom.enrollments for delete to authenticated
  using (auth.uid() = user_id or classroom.can_manage_course(course_id));

/* ---------------------------------------------------------------------------
   Columns for uploaded files. The bucket itself lives in 006_storage.sql,
   because the storage schema is owned by supabase_storage_admin and cannot be
   changed from here.
   --------------------------------------------------------------------------- */
alter table classroom.materials
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text;

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
