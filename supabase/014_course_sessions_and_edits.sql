-- =============================================================================
-- Courses belong to a session, and published work can be edited
--
-- Three changes:
--   1. A course carries the academic session it is taught in, so the same
--      course can run in 2023/2024 and again in 2029/2030 as separate things.
--   2. Courses no longer need a class level. They are addressed by code alone
--      (/Courses/AZ-900), so the level is optional context rather than part of
--      a course's identity.
--   3. Chat messages can be edited by their author, the way materials and
--      assignments already could — nobody should have to delete and repost to
--      fix a typo.
--
-- Run after 013. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   1 & 2 — session on a course, level no longer required
   --------------------------------------------------------------------------- */
alter table classroom.courses
  add column if not exists session_id uuid references classroom.sessions (id) on delete set null;

alter table classroom.courses alter column level_year drop not null;

create index if not exists courses_session_idx on classroom.courses (session_id);

-- A code is unique within a school *per session*: the same course taught in a
-- later year is a different row, with its own materials, exams and marks.
-- COALESCE gives sessionless courses a single shared bucket, since NULLs would
-- otherwise all count as distinct and let duplicates through.
do $codes$
begin
  if exists (select 1 from pg_constraint where conname = 'courses_school_code_key') then
    alter table classroom.courses drop constraint courses_school_code_key;
  end if;
end $codes$;

drop index if exists classroom.courses_school_code_session_key;
create unique index courses_school_code_session_key
  on classroom.courses (
    school_id,
    code,
    coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

/* ---------------------------------------------------------------------------
   3 — editing what you published
   --------------------------------------------------------------------------- */
alter table classroom.messages
  add column if not exists edited_at timestamptz;

drop policy if exists "authors edit their own messages" on classroom.messages;
create policy "authors edit their own messages"
  on classroom.messages for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Materials and assignments already had update policies for course managers;
-- they simply had no way to reach them in the interface.

/* ---------------------------------------------------------------------------
   Links in notifications drop the level segment along with the routes.
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
      format('/Courses/%s', course.code)
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
    format('/Courses/%s', course.code)
  );

  return row_;
end;
$$;

-- Existing notifications keep working rather than pointing at a dead route.
update classroom.notifications
set link = regexp_replace(link, '^/Levels/[^/]+/Courses/', '/Courses/')
where link like '/Levels/%/Courses/%';

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
