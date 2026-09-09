-- =============================================================================
-- Course access, stream comments, and activity notifications
--
-- Four things:
--
--   1. Being a member of the school was enough to read and write a course's
--      content. It should not be — until a tutor approves you, you should see
--      that the course exists and nothing else.
--   2. A composite IS NOT NULL check was wrong in two functions. In Postgres
--      `row IS NOT NULL` is false when ANY field is null, so a pending
--      enrolment (decided_at null) read as "not found" and the function fell
--      through to an insert that then hit the unique key.
--   3. Stream posts get comments.
--   4. Anyone approved on a course is told when something is added to it, and
--      reminded about work that is due — unless they have already handed it in.
-- =============================================================================

/* =============================================================================
   1 — Who may actually use a course
   ============================================================================= */

-- Approved on the course, or running it. This is the line between "can see the
-- course exists" and "can take part in it".
create or replace function classroom.is_enrolled_in(target_course uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $$
  select target_course is not null and (
    exists (
      select 1 from classroom.enrollments e
      where e.course_id = target_course
        and e.user_id = auth.uid()
        and e.status = 'approved'
    )
    or classroom.can_manage_course(target_course)
  );
$$;

grant execute on function classroom.is_enrolled_in(uuid) to authenticated;

-- Materials, assignments and the class stream are all course content.
drop policy if exists "materials are readable within the school" on classroom.materials;
create policy "materials are readable by course members"
  on classroom.materials for select to authenticated
  using (classroom.is_enrolled_in(course_id));

drop policy if exists "assignments are readable within the school" on classroom.assignments;
create policy "assignments are readable by course members"
  on classroom.assignments for select to authenticated
  using (classroom.is_enrolled_in(course_id));

drop policy if exists "messages are readable within the school" on classroom.messages;
create policy "messages are readable by course members"
  on classroom.messages for select to authenticated
  using (classroom.is_enrolled_in(course_id));

-- Posting to the stream needs a place on the course, not just a login.
drop policy if exists "users post their own messages" on classroom.messages;
create policy "course members post their own messages"
  on classroom.messages for insert to authenticated
  with check (auth.uid() = user_id and classroom.is_enrolled_in(course_id));

-- An exam is only visible to someone on the course.
drop policy if exists "read published exams within the school" on classroom.exams;
drop policy if exists "read published exams, or all if you manage the course" on classroom.exams;
create policy "read published exams as a course member"
  on classroom.exams for select to authenticated
  using (
    (published and classroom.is_enrolled_in(course_id))
    or classroom.can_manage_course(course_id)
  );

-- And sitting one requires the same. Without this a student who had merely
-- asked to join could open a paper and answer it.
create or replace function classroom.start_exam_attempt(target_exam uuid)
returns classroom.exam_attempts
language plpgsql security definer
set search_path = classroom, public as $$
declare
  exam    classroom.exams;
  attempt classroom.exam_attempts;
begin
  select * into exam from classroom.exams where id = target_exam;

  if exam is null or not exam.published then
    raise exception 'That exam is not available';
  end if;
  if not classroom.is_enrolled_in(exam.course_id) then
    raise exception 'You are not a member of this course yet';
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

  -- FOUND rather than `attempt is not null`: a composite is only IS NOT NULL
  -- when every field is, and an unsubmitted attempt has nulls in it.
  if found then
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

/* =============================================================================
   2 — The composite IS NOT NULL bug
   ============================================================================= */
create or replace function classroom.request_enrollment(
  target_course uuid,
  note text default null
)
returns classroom.enrollments
language plpgsql security definer
set search_path = classroom, public as $$
declare
  course  classroom.courses;
  row_    classroom.enrollments;
  existing boolean;
  who     text;
begin
  select * into course from classroom.courses where id = target_course;
  if not found then
    raise exception 'No such course';
  end if;
  if not classroom.is_member_of(course.school_id) then
    raise exception 'That course belongs to another school';
  end if;
  if course.archived then
    raise exception 'That course is archived';
  end if;
  -- Whoever runs the course is already in it.
  if classroom.can_manage_course(target_course) then
    raise exception 'You run this course — you do not need to join it';
  end if;

  select * into row_ from classroom.enrollments
  where course_id = target_course and user_id = auth.uid();
  existing := found;

  if existing then
    if row_.status = 'declined' then
      update classroom.enrollments
      set status = 'pending', requested_at = now(),
          decided_at = null, decided_by = null, message = note
      where course_id = target_course and user_id = auth.uid()
      returning * into row_;
    else
      -- Already asked, or already in. Hand back what they have.
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
      course.owner_id, course.school_id, target_course,
      'enrollment_request',
      format('%s asked to join %s', who, course.code),
      note,
      format('/Courses/%s', course.code)
    );
  end if;

  return row_;
end;
$$;

create or replace function classroom.join_school(target_slug text)
returns classroom.school_members
language plpgsql security definer
set search_path = classroom, public as $$
declare
  school classroom.schools;
  row_   classroom.school_members;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into school from classroom.schools where slug = target_slug;
  if not found then
    raise exception 'No school at %', target_slug;
  end if;
  if not school.is_active then
    raise exception 'That school is not active';
  end if;

  select * into row_ from classroom.school_members
  where school_id = school.id and user_id = auth.uid();
  if found then
    return row_;
  end if;

  if not school.allow_self_signup then
    raise exception 'This school adds its members by invitation only';
  end if;

  insert into classroom.school_members (school_id, user_id, role)
  values (school.id, auth.uid(), 'student')
  returning * into row_;

  return row_;
end;
$$;

/* =============================================================================
   3 — Comments under a stream post
   ============================================================================= */
create table if not exists classroom.message_comments (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references classroom.messages (id) on delete cascade,
  user_id    uuid not null references classroom.profiles (id) on delete cascade,
  body       text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists message_comments_message_idx
  on classroom.message_comments (message_id, created_at);

alter table classroom.message_comments enable row level security;

do $pub$
begin
  alter publication supabase_realtime add table classroom.message_comments;
exception when duplicate_object then null;
end $pub$;

drop policy if exists "course members read comments" on classroom.message_comments;
create policy "course members read comments"
  on classroom.message_comments for select to authenticated
  using (exists (
    select 1 from classroom.messages m
    where m.id = message_id and classroom.is_enrolled_in(m.course_id)
  ));

drop policy if exists "course members comment" on classroom.message_comments;
create policy "course members comment"
  on classroom.message_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from classroom.messages m
      where m.id = message_id and classroom.is_enrolled_in(m.course_id)
    )
  );

drop policy if exists "authors edit their comments" on classroom.message_comments;
create policy "authors edit their comments"
  on classroom.message_comments for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "authors and managers delete comments" on classroom.message_comments;
create policy "authors and managers delete comments"
  on classroom.message_comments for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from classroom.messages m
      where m.id = message_id and classroom.can_manage_course(m.course_id)
    )
  );

/* =============================================================================
   4 — Telling people what happened

   One helper, used by a trigger on each thing that gets added to a course.
   The person who did it is never notified about their own action.
   ============================================================================= */
create or replace function classroom.notify_course(
  target_course uuid,
  kind text,
  title text,
  body text,
  link text,
  exclude_user uuid default null
)
returns void
language plpgsql security definer
set search_path = classroom, public as $$
declare
  course classroom.courses;
begin
  select * into course from classroom.courses where id = target_course;
  if not found then
    return;
  end if;

  insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
  select who.user_id, course.school_id, target_course, kind, title, body, link
  from (
    -- Everyone with a place on the course...
    select e.user_id from classroom.enrollments e
    where e.course_id = target_course and e.status = 'approved'
    union
    -- ...plus whoever runs it.
    select course.owner_id where course.owner_id is not null
  ) who
  where who.user_id is distinct from coalesce(exclude_user, '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;

/* Material added ----------------------------------------------------------- */
create or replace function classroom.on_material_added()
returns trigger language plpgsql security definer
set search_path = classroom, public as $$
declare
  code text;
begin
  select c.code into code from classroom.courses c where c.id = new.course_id;
  perform classroom.notify_course(
    new.course_id, 'material_added',
    format('New material in %s', code),
    new.title,
    format('/Courses/%s', code),
    new.created_by
  );
  return new;
end;
$$;

drop trigger if exists material_added on classroom.materials;
create trigger material_added after insert on classroom.materials
  for each row execute function classroom.on_material_added();

/* Assignment set ----------------------------------------------------------- */
create or replace function classroom.on_assignment_added()
returns trigger language plpgsql security definer
set search_path = classroom, public as $$
declare
  code text;
begin
  select c.code into code from classroom.courses c where c.id = new.course_id;
  perform classroom.notify_course(
    new.course_id, 'assignment_added',
    format('New assignment in %s', code),
    case
      when new.due_at is null then new.title
      else format('%s — due %s', new.title, to_char(new.due_at, 'DD Mon at HH24:MI'))
    end,
    format('/Assignments/%s', new.id),
    new.created_by
  );
  return new;
end;
$$;

drop trigger if exists assignment_added on classroom.assignments;
create trigger assignment_added after insert on classroom.assignments
  for each row execute function classroom.on_assignment_added();

/* Exam published ----------------------------------------------------------- */
create or replace function classroom.on_exam_published()
returns trigger language plpgsql security definer
set search_path = classroom, public as $$
declare
  code text;
begin
  -- Only when it actually becomes visible to students, not on every edit.
  if new.published and (old is null or not old.published) then
    select c.code into code from classroom.courses c where c.id = new.course_id;
    perform classroom.notify_course(
      new.course_id, 'exam_published',
      format('New exam in %s', code),
      case
        when new.closes_at is null then new.title
        else format('%s — closes %s', new.title, to_char(new.closes_at, 'DD Mon at HH24:MI'))
      end,
      format('/Exams/%s', new.id),
      new.created_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists exam_published on classroom.exams;
create trigger exam_published after insert or update of published on classroom.exams
  for each row execute function classroom.on_exam_published();

/* Something said on the stream --------------------------------------------- */
create or replace function classroom.on_message_posted()
returns trigger language plpgsql security definer
set search_path = classroom, public as $$
declare
  code text;
  who  text;
begin
  select c.code into code from classroom.courses c where c.id = new.course_id;
  select coalesce(nullif(btrim(first_name || ' ' || surname), ''), username, email, 'Someone')
  into who from classroom.profiles where id = new.user_id;

  perform classroom.notify_course(
    new.course_id, 'stream_post',
    format('%s posted in %s', who, code),
    left(new.body, 140),
    format('/Courses/%s', code),
    new.user_id
  );
  return new;
end;
$$;

drop trigger if exists message_posted on classroom.messages;
create trigger message_posted after insert on classroom.messages
  for each row execute function classroom.on_message_posted();

/* A comment on a post ------------------------------------------------------ */
create or replace function classroom.on_comment_posted()
returns trigger language plpgsql security definer
set search_path = classroom, public as $$
declare
  msg  classroom.messages;
  code text;
  who  text;
begin
  select * into msg from classroom.messages where id = new.message_id;
  select c.code into code from classroom.courses c where c.id = msg.course_id;
  select coalesce(nullif(btrim(first_name || ' ' || surname), ''), username, email, 'Someone')
  into who from classroom.profiles where id = new.user_id;

  -- The author of the post hears about it directly; everyone else on the
  -- course would be buried under replies, so they are left alone.
  if msg.user_id is distinct from new.user_id then
    insert into classroom.notifications (user_id, school_id, course_id, kind, title, body, link)
    select msg.user_id, c.school_id, msg.course_id, 'comment_posted',
           format('%s replied to your post in %s', who, code),
           left(new.body, 140),
           format('/Courses/%s', code)
    from classroom.courses c where c.id = msg.course_id;
  end if;

  return new;
end;
$$;

drop trigger if exists comment_posted on classroom.message_comments;
create trigger comment_posted after insert on classroom.message_comments
  for each row execute function classroom.on_comment_posted();

/* =============================================================================
   Due-soon and overdue reminders

   Only for people who have not handed the work in — telling someone their
   submitted assignment is overdue is worse than saying nothing. The unique
   index makes each reminder land at most once per person per assignment.
   ============================================================================= */
alter table classroom.notifications
  add column if not exists ref_id uuid;

drop index if exists classroom.notifications_once;
create unique index notifications_once
  on classroom.notifications (user_id, kind, ref_id)
  where ref_id is not null;

create or replace function classroom.generate_due_reminders()
returns int
language plpgsql security definer
set search_path = classroom, public as $$
declare
  made int := 0;
begin
  -- Due within a day, not yet submitted.
  insert into classroom.notifications
    (user_id, school_id, course_id, kind, title, body, link, ref_id)
  select e.user_id, c.school_id, c.id, 'assignment_due_soon',
         format('%s is due soon', a.title),
         format('%s · due %s', c.code, to_char(a.due_at, 'DD Mon at HH24:MI')),
         format('/Assignments/%s', a.id),
         a.id
  from classroom.assignments a
  join classroom.courses c on c.id = a.course_id
  join classroom.enrollments e on e.course_id = c.id and e.status = 'approved'
  where a.due_at is not null
    and a.due_at between now() and now() + interval '24 hours'
    and not exists (
      select 1 from classroom.submissions s
      where s.assignment_id = a.id and s.user_id = e.user_id
    )
  on conflict do nothing;

  made := made + coalesce((select count(*) from classroom.notifications
                           where kind = 'assignment_due_soon'
                             and created_at > now() - interval '5 seconds'), 0);

  -- Past due, still nothing handed in.
  insert into classroom.notifications
    (user_id, school_id, course_id, kind, title, body, link, ref_id)
  select e.user_id, c.school_id, c.id, 'assignment_overdue',
         format('%s is overdue', a.title),
         format('%s · was due %s', c.code, to_char(a.due_at, 'DD Mon at HH24:MI')),
         format('/Assignments/%s', a.id),
         a.id
  from classroom.assignments a
  join classroom.courses c on c.id = a.course_id
  join classroom.enrollments e on e.course_id = c.id and e.status = 'approved'
  where a.due_at is not null
    and a.due_at < now()
    and a.due_at > now() - interval '14 days'
    and not exists (
      select 1 from classroom.submissions s
      where s.assignment_id = a.id and s.user_id = e.user_id
    )
  on conflict do nothing;

  return made;
end;
$$;

grant execute on function classroom.generate_due_reminders() to authenticated;

-- Run it on a schedule where pg_cron is available; the app also calls it when
-- a student opens their dashboard, so reminders arrive either way.
do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('schoolivio-due-reminders')
  where exists (select 1 from cron.job where jobname = 'schoolivio-due-reminders');
  perform cron.schedule(
    'schoolivio-due-reminders',
    '0 * * * *',
    $job$select classroom.generate_due_reminders()$job$
  );
  raise notice 'Due reminders scheduled hourly with pg_cron.';
exception
  when others then
    raise notice 'pg_cron unavailable (%); reminders will be generated when a student opens their dashboard.', sqlerrm;
end $cron$;

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
