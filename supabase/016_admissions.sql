-- =============================================================================
-- Phase 03 — Admissions
--
-- An applicant is not a student. They arrive from outside, with no account,
-- and only become a student if the school admits them. So:
--
--   * the application form is public — a parent with no login can submit one
--     and track it afterwards with a reference and their email address;
--   * every change of status is written to an append-only log, because "who
--     rejected my child, and when" is a question schools get asked;
--   * the status track is a real state machine enforced in the database, not
--     a text column any code path can set to anything;
--   * a student account and a class placement are only created at the very
--     last step, when the offer has actually been accepted.
--
-- Run after 015. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Status track

     submitted ─→ screening ─→ offered ─→ accepted ─→ enrolled
         │            │           │          │
         └────────────┴───────────┴──────────┴──→ rejected / withdrawn
                                  └──→ declined   (the family said no)
   --------------------------------------------------------------------------- */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_status') then
    create type classroom.application_status as enum (
      'submitted',   -- received, nobody has looked yet
      'screening',   -- being assessed
      'offered',     -- a place has been offered
      'accepted',    -- the family accepted the offer
      'enrolled',    -- now a student, with an account and a class
      'declined',    -- the family turned the offer down
      'rejected',    -- the school said no
      'withdrawn'    -- pulled out before a decision
    );
  end if;
end $$;

/* ---------------------------------------------------------------------------
   Whether a session is taking applications at all
   --------------------------------------------------------------------------- */
alter table classroom.sessions
  add column if not exists applications_open boolean not null default false;

/* ---------------------------------------------------------------------------
   Applications
   --------------------------------------------------------------------------- */
create table if not exists classroom.applications (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references classroom.schools (id) on delete cascade,
  session_id         uuid references classroom.sessions (id) on delete set null,

  -- Human-readable and quotable over the phone: JNC/2026/0007
  reference          text not null,
  seq                int  not null,

  -- The applicant
  first_name         text not null,
  surname            text not null,
  middle_name        text,
  date_of_birth      date,
  gender             text,
  applying_for_level int,
  previous_school    text,

  -- Whoever is applying on their behalf
  guardian_name      text not null,
  guardian_email     text not null,
  guardian_phone     text,
  guardian_relation  text,
  address            text,

  -- Anything the family wants to add, and links to documents they hold
  notes              text,
  document_links     text,

  status             classroom.application_status not null default 'submitted',
  offer_expires_at   timestamptz,
  decided_by         uuid references classroom.profiles (id) on delete set null,
  decided_at         timestamptz,

  -- Filled in only at enrolment
  student_id         uuid references classroom.profiles (id) on delete set null,
  class_id           uuid references classroom.classes (id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (school_id, reference),
  unique (school_id, session_id, seq)
);

create index if not exists applications_school_status_idx
  on classroom.applications (school_id, status, created_at desc);
create index if not exists applications_guardian_email_idx
  on classroom.applications (lower(guardian_email));

/* ---------------------------------------------------------------------------
   Documents the school holds for an application
   --------------------------------------------------------------------------- */
create table if not exists classroom.application_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references classroom.applications (id) on delete cascade,
  kind           text not null default 'other',
  file_path      text not null,
  file_name      text,
  file_size      bigint,
  mime_type      text,
  uploaded_by    uuid references classroom.profiles (id) on delete set null,
  uploaded_at    timestamptz not null default now()
);

create index if not exists application_documents_app_idx
  on classroom.application_documents (application_id);

/* ---------------------------------------------------------------------------
   The audit trail. No update or delete policy exists for anyone, so the
   history of a decision cannot be rewritten after the fact.
   --------------------------------------------------------------------------- */
create table if not exists classroom.application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references classroom.applications (id) on delete cascade,
  status_from    classroom.application_status,
  status_to      classroom.application_status,
  actor_id       uuid references classroom.profiles (id) on delete set null,
  actor_label    text,
  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists application_events_app_idx
  on classroom.application_events (application_id, created_at);

/* =============================================================================
   Submitting an application — from outside, with no account
   ============================================================================= */
create or replace function classroom.submit_application(
  target_slug        text,
  first_name         text,
  surname            text,
  guardian_name      text,
  guardian_email     text,
  middle_name        text default null,
  date_of_birth      date default null,
  gender             text default null,
  applying_for_level int  default null,
  previous_school    text default null,
  guardian_phone     text default null,
  guardian_relation  text default null,
  address            text default null,
  notes              text default null,
  document_links     text default null
)
returns table (reference text, school_name text)
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  school   classroom.schools;
  sess     classroom.sessions;
  next_seq int;
  ref      text;
  new_id   uuid;
  prefix   text;
begin
  select * into school from classroom.schools
  where slug = lower(btrim(target_slug)) and is_active;

  if school is null then
    raise exception 'No school at %', target_slug;
  end if;

  if btrim(coalesce(first_name, '')) = ''
     or btrim(coalesce(surname, '')) = ''
     or btrim(coalesce(guardian_name, '')) = ''
     or btrim(coalesce(guardian_email, '')) = '' then
    raise exception 'The applicant name, guardian name and guardian email are all required';
  end if;

  -- Applications belong to whichever session is taking them; failing that,
  -- the current one. A school with neither is not accepting applications.
  select * into sess from classroom.sessions
  where school_id = school.id and applications_open
  order by starts_on desc nulls last
  limit 1;

  if sess is null then
    select * into sess from classroom.sessions
    where school_id = school.id and is_current
    limit 1;
  end if;

  if sess is null then
    raise exception '% is not accepting applications at the moment', school.name;
  end if;

  -- Lock the school's rows for this session so two simultaneous submissions
  -- cannot be handed the same number.
  select coalesce(max(a.seq), 0) + 1 into next_seq
  from classroom.applications a
  where a.school_id = school.id and a.session_id = sess.id
  for update;

  -- Initials of the school, so a reference is recognisable on a phone call.
  select string_agg(left(word, 1), '')
  into prefix
  from (
    select regexp_split_to_table(upper(school.name), '\s+') as word
  ) parts
  where word ~ '^[A-Z]';

  ref := format('%s/%s/%s',
                coalesce(nullif(left(prefix, 4), ''), 'APP'),
                coalesce(nullif(regexp_replace(sess.name, '\D', '', 'g'), ''), to_char(now(), 'YYYY')),
                lpad(next_seq::text, 4, '0'));

  insert into classroom.applications (
    school_id, session_id, reference, seq,
    first_name, surname, middle_name, date_of_birth, gender,
    applying_for_level, previous_school,
    guardian_name, guardian_email, guardian_phone, guardian_relation,
    address, notes, document_links
  ) values (
    school.id, sess.id, ref, next_seq,
    btrim(first_name), btrim(surname), nullif(btrim(coalesce(middle_name,'')), ''),
    date_of_birth, nullif(btrim(coalesce(gender,'')), ''),
    applying_for_level, nullif(btrim(coalesce(previous_school,'')), ''),
    btrim(guardian_name), lower(btrim(guardian_email)),
    nullif(btrim(coalesce(guardian_phone,'')), ''),
    nullif(btrim(coalesce(guardian_relation,'')), ''),
    nullif(btrim(coalesce(address,'')), ''),
    nullif(btrim(coalesce(notes,'')), ''),
    nullif(btrim(coalesce(document_links,'')), '')
  )
  returning id into new_id;

  insert into classroom.application_events (application_id, status_to, actor_label, note)
  values (new_id, 'submitted', btrim(guardian_name), 'Application submitted online');

  -- Tell the people who have to act on it.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select m.user_id, school.id, 'application_submitted',
         format('New application: %s %s', btrim(first_name), btrim(surname)),
         format('Reference %s · applying for %s', ref, coalesce(applying_for_level::text, 'unspecified')),
         format('/Admissions/%s', new_id)
  from classroom.school_members m
  where m.school_id = school.id
    and m.is_active
    and m.role in ('owner', 'admin', 'admissions');

  return query select ref, school.name;
end;
$$;

-- Deliberately open: this is the public application form.
grant execute on function classroom.submit_application(
  text, text, text, text, text, text, date, text, int, text, text, text, text, text, text
) to anon, authenticated;

/* =============================================================================
   Tracking an application without an account

   Requires both the reference and the guardian's email, so a guessed
   reference alone reveals nothing.
   ============================================================================= */
create or replace function classroom.track_application(
  target_reference text,
  target_email     text
)
returns table (
  reference   text,
  status      classroom.application_status,
  applicant   text,
  school_name text,
  session_name text,
  submitted_at timestamptz,
  decided_at  timestamptz,
  offer_expires_at timestamptz
)
language sql
stable
security definer
set search_path = classroom, public
as $$
  select
    a.reference,
    a.status,
    btrim(a.first_name || ' ' || a.surname),
    s.name,
    sess.name,
    a.created_at,
    a.decided_at,
    a.offer_expires_at
  from classroom.applications a
  join classroom.schools s on s.id = a.school_id
  left join classroom.sessions sess on sess.id = a.session_id
  where upper(btrim(a.reference)) = upper(btrim(target_reference))
    and lower(a.guardian_email) = lower(btrim(target_email));
$$;

grant execute on function classroom.track_application(text, text) to anon, authenticated;

/* =============================================================================
   Moving an application along

   The legal transitions live here rather than in the interface, so no code
   path can put an application into a state it should not reach.
   ============================================================================= */
create or replace function classroom.decide_application(
  target_application uuid,
  new_status classroom.application_status,
  note text default null,
  offer_expires timestamptz default null
)
returns classroom.applications
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  app     classroom.applications;
  allowed classroom.application_status[];
  who     text;
begin
  select * into app from classroom.applications where id = target_application;
  if app is null then
    raise exception 'No such application';
  end if;

  if not classroom.has_role_in(
       app.school_id,
       array['owner','admin','admissions']::classroom.member_role[]
     ) then
    raise exception 'Only admissions staff can decide an application';
  end if;

  allowed := case app.status
    when 'submitted' then array['screening','offered','rejected','withdrawn']
    when 'screening' then array['offered','rejected','withdrawn']
    when 'offered'   then array['accepted','declined','rejected','withdrawn']
    when 'accepted'  then array['enrolled','withdrawn']
    -- A rejected or withdrawn application can be reopened, because schools
    -- change their minds and a family can appeal.
    when 'rejected'  then array['screening']
    when 'withdrawn' then array['screening']
    when 'declined'  then array['offered']
    else array[]::classroom.application_status[]
  end::classroom.application_status[];

  if new_status = app.status then
    return app;
  end if;

  if not (new_status = any(allowed)) then
    raise exception 'An application that is % cannot become %', app.status, new_status;
  end if;

  -- Enrolment is not a plain status change: it needs an account and a class,
  -- so it goes through enrol_applicant().
  if new_status = 'enrolled' then
    raise exception 'Use enrol_applicant() to enrol — a student account and class are required';
  end if;

  select coalesce(nullif(btrim(first_name || ' ' || surname), ''), email)
  into who from classroom.profiles where id = auth.uid();

  update classroom.applications
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now(),
      offer_expires_at = case
        when new_status = 'offered' then coalesce(offer_expires, now() + interval '14 days')
        else offer_expires_at
      end
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values (target_application, app.status, new_status, auth.uid(), who, note);

  -- Keep the family informed if they happen to hold an account here.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select p.id, app.school_id, 'application_' || new_status::text,
         format('%s: application %s', app.reference, new_status),
         format('%s %s', app.first_name, app.surname),
         '/Apply/Status'
  from classroom.profiles p
  where lower(p.email) = lower(app.guardian_email);

  return app;
end;
$$;

grant execute on function classroom.decide_application(
  uuid, classroom.application_status, text, timestamptz
) to authenticated;

/* =============================================================================
   Enrolment — the only step that creates a student

   The account itself is made by the interface (it needs the auth API), so
   this takes an existing profile and binds the three things together:
   application, student, class.
   ============================================================================= */
create or replace function classroom.enrol_applicant(
  target_application uuid,
  target_student uuid,
  target_class uuid default null
)
returns classroom.applications
language plpgsql
security definer
set search_path = classroom, public
as $$
declare
  app classroom.applications;
  cls classroom.classes;
  who text;
begin
  select * into app from classroom.applications where id = target_application;
  if app is null then
    raise exception 'No such application';
  end if;

  if not classroom.has_role_in(
       app.school_id,
       array['owner','admin','admissions']::classroom.member_role[]
     ) then
    raise exception 'Only admissions staff can enrol an applicant';
  end if;

  if app.status <> 'accepted' then
    raise exception 'Only an accepted application can be enrolled — this one is %', app.status;
  end if;

  if not exists (select 1 from classroom.profiles where id = target_student) then
    raise exception 'That student account does not exist';
  end if;

  if target_class is not null then
    select * into cls from classroom.classes where id = target_class;
    if cls is null or cls.school_id <> app.school_id then
      raise exception 'That class belongs to a different school';
    end if;
  end if;

  -- Make sure they are a member of the school, as a student.
  insert into classroom.school_members (school_id, user_id, role)
  values (app.school_id, target_student, 'student')
  on conflict (school_id, user_id) do nothing;

  if target_class is not null then
    insert into classroom.class_students (class_id, student_id)
    values (target_class, target_student)
    on conflict (class_id, student_id) do nothing;
  end if;

  select coalesce(nullif(btrim(first_name || ' ' || surname), ''), email)
  into who from classroom.profiles where id = auth.uid();

  update classroom.applications
  set status = 'enrolled',
      student_id = target_student,
      class_id = target_class,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now()
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values (
    target_application, 'accepted', 'enrolled', auth.uid(), who,
    case when cls.name is null then 'Enrolled' else format('Enrolled into %s', cls.name) end
  );

  return app;
end;
$$;

grant execute on function classroom.enrol_applicant(uuid, uuid, uuid) to authenticated;

/* =============================================================================
   What the admissions queue needs, in one call
   ============================================================================= */
create or replace function classroom.admissions_summary(target_school uuid)
returns table (status classroom.application_status, count int)
language sql
stable
security definer
set search_path = classroom, public
as $$
  select a.status, count(*)::int
  from classroom.applications a
  where a.school_id = target_school
    and classroom.has_role_in(
          target_school,
          array['owner','admin','admissions']::classroom.member_role[]
        )
  group by a.status;
$$;

grant execute on function classroom.admissions_summary(uuid) to authenticated;

/* =============================================================================
   Row level security
   ============================================================================= */
alter table classroom.applications          enable row level security;
alter table classroom.application_documents enable row level security;
alter table classroom.application_events    enable row level security;

-- Applications are staff-only to read directly. The public reaches them
-- solely through submit_application() and track_application().
drop policy if exists "admissions staff read applications" on classroom.applications;
create policy "admissions staff read applications"
  on classroom.applications for select to authenticated
  using (
    classroom.has_role_in(
      school_id,
      array['owner','admin','admissions']::classroom.member_role[]
    )
    -- The applicant, once they have an account here.
    or student_id = auth.uid()
    or lower(guardian_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "admissions staff update applications" on classroom.applications;
create policy "admissions staff update applications"
  on classroom.applications for update to authenticated
  using (classroom.has_role_in(school_id, array['owner','admin','admissions']::classroom.member_role[]))
  with check (classroom.has_role_in(school_id, array['owner','admin','admissions']::classroom.member_role[]));

drop policy if exists "admissions staff delete applications" on classroom.applications;
create policy "admissions staff delete applications"
  on classroom.applications for delete to authenticated
  using (classroom.is_school_admin(school_id));

-- Documents follow their application.
drop policy if exists "read documents of readable applications" on classroom.application_documents;
create policy "read documents of readable applications"
  on classroom.application_documents for select to authenticated
  using (exists (
    select 1 from classroom.applications a
    where a.id = application_id
      and (
        classroom.has_role_in(a.school_id, array['owner','admin','admissions']::classroom.member_role[])
        or lower(a.guardian_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  ));

drop policy if exists "admissions staff manage documents" on classroom.application_documents;
create policy "admissions staff manage documents"
  on classroom.application_documents for all to authenticated
  using (exists (
    select 1 from classroom.applications a
    where a.id = application_id
      and classroom.has_role_in(a.school_id, array['owner','admin','admissions']::classroom.member_role[])
  ))
  with check (exists (
    select 1 from classroom.applications a
    where a.id = application_id
      and classroom.has_role_in(a.school_id, array['owner','admin','admissions']::classroom.member_role[])
  ));

-- The log is readable but never writable from outside the functions above,
-- and has no update or delete policy at all.
drop policy if exists "read events of readable applications" on classroom.application_events;
create policy "read events of readable applications"
  on classroom.application_events for select to authenticated
  using (exists (
    select 1 from classroom.applications a
    where a.id = application_id
      and (
        classroom.has_role_in(a.school_id, array['owner','admin','admissions']::classroom.member_role[])
        or lower(a.guardian_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  ));

/* =============================================================================
   Storage for admission documents

   Reuses the existing bucket under admissions/<school_id>/<application_id>/.
   The course policies cast the first path segment to a uuid, which throws on
   a path like "admissions/..." — and an error in any policy fails the whole
   statement, not just that policy. try_uuid() makes the cast safe.
   ============================================================================= */
create or replace function classroom.try_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception
  when others then return null;
end;
$$;

grant execute on function classroom.try_uuid(text) to anon, authenticated;

do $storage$
begin
  if not exists (select 1 from storage.buckets where id = 'course-materials') then
    raise notice 'Bucket course-materials not found — admission document upload will not work until it exists.';
    return;
  end if;

  -- Re-create the course policies with a cast that cannot throw.
  drop policy if exists "course managers upload files" on storage.objects;
  create policy "course managers upload files"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'course-materials'
      and classroom.can_manage_course(
            classroom.try_uuid((storage.foldername(name))[1])
          )
    );

  drop policy if exists "course managers delete files" on storage.objects;
  create policy "course managers delete files"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'course-materials'
      and classroom.can_manage_course(
            classroom.try_uuid((storage.foldername(name))[1])
          )
    );

  drop policy if exists "admissions staff upload documents" on storage.objects;
  create policy "admissions staff upload documents"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'course-materials'
      and (storage.foldername(name))[1] = 'admissions'
      and classroom.has_role_in(
            classroom.try_uuid((storage.foldername(name))[2]),
            array['owner','admin','admissions']::classroom.member_role[]
          )
    );

  drop policy if exists "admissions staff delete documents" on storage.objects;
  create policy "admissions staff delete documents"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'course-materials'
      and (storage.foldername(name))[1] = 'admissions'
      and classroom.has_role_in(
            classroom.try_uuid((storage.foldername(name))[2]),
            array['owner','admin','admissions']::classroom.member_role[]
          )
    );
exception
  when insufficient_privilege then
    raise notice 'Storage policies are dashboard-managed on this project; admission document upload needs them added by hand.';
end $storage$;

grant select, insert, update, delete on all tables in schema classroom to authenticated;

notify pgrst, 'reload schema';
