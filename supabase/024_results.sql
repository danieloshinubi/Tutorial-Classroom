-- =============================================================================
-- Term results, with release enforced in the database
--
-- A result passes through four hands and must not skip one:
--
--   draft      the teacher is still entering marks. Nobody else's business.
--   submitted  handed to the principal. The teacher can no longer change it.
--   approved   the principal accepts the marks. Still not visible to families.
--   released   the school has published it. NOW a student and their parents
--              may read it, and nobody may change it.
--
-- plus one the workflow cannot do without:
--
--   returned   the principal sent it back. The teacher may edit again.
--
-- Two rules carry the whole design:
--
--   1. There is no UPDATE policy on result_sheets. None. A status cannot be
--      changed by any statement a client can send -- only by the functions
--      below, which check the actor's role and the transition. A leaked
--      result cannot be caused by a mistaken .update() in the app.
--
--   2. A student or parent's SELECT policy requires status = 'released'.
--      Not "the UI hides it". Not "the query filters it". The row is not
--      visible to them until the school releases it, so no query, no export
--      and no page written later can reach it early.
-- =============================================================================

create type classroom.result_status as enum
  ('draft', 'submitted', 'approved', 'released', 'returned');

/* -----------------------------------------------------------------------------
   The sheet: one course, one term. The teacher's unit of work and the
   principal's unit of approval.
   -------------------------------------------------------------------------- */
create table classroom.result_sheets (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  course_id    uuid not null references classroom.courses (id) on delete cascade,
  term_id      uuid not null references classroom.terms (id)   on delete cascade,
  status       classroom.result_status not null default 'draft',

  -- How the marks are split. Schools differ, so the sheet carries its own.
  ca_max       int not null default 40 check (ca_max between 0 and 100),
  exam_max     int not null default 60 check (exam_max between 0 and 100),

  created_by   uuid references classroom.profiles (id) on delete set null,
  submitted_by uuid references classroom.profiles (id) on delete set null,
  submitted_at timestamptz,
  approved_by  uuid references classroom.profiles (id) on delete set null,
  approved_at  timestamptz,
  released_by  uuid references classroom.profiles (id) on delete set null,
  released_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint result_sheets_once unique (course_id, term_id),
  constraint result_sheets_total check (ca_max + exam_max > 0)
);

create index result_sheets_school_idx on classroom.result_sheets (school_id, status);
create index result_sheets_term_idx   on classroom.result_sheets (term_id);

/* -----------------------------------------------------------------------------
   One student's marks on one sheet.
   -------------------------------------------------------------------------- */
create table classroom.result_entries (
  id          uuid primary key default gen_random_uuid(),
  sheet_id    uuid not null references classroom.result_sheets (id) on delete cascade,
  student_id  uuid not null references classroom.profiles (id) on delete cascade,

  ca_score    numeric(5,2) check (ca_score   >= 0),
  exam_score  numeric(5,2) check (exam_score >= 0),
  total       numeric(6,2) generated always as
                (coalesce(ca_score, 0) + coalesce(exam_score, 0)) stored,
  remark      text,

  updated_by  uuid references classroom.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),

  constraint result_entries_once unique (sheet_id, student_id)
);

create index result_entries_student_idx on classroom.result_entries (student_id);

/* -----------------------------------------------------------------------------
   Who moved it, when, and why. Append-only: there is no update or delete
   policy on this table for anybody, so the trail cannot be tidied up after
   an argument starts.
   -------------------------------------------------------------------------- */
create table classroom.result_events (
  id          uuid primary key default gen_random_uuid(),
  sheet_id    uuid not null references classroom.result_sheets (id) on delete cascade,
  status_from classroom.result_status,
  status_to   classroom.result_status not null,
  actor_id    uuid references classroom.profiles (id) on delete set null,
  actor_label text,
  note        text,
  created_at  timestamptz not null default now()
);

create index result_events_sheet_idx on classroom.result_events (sheet_id, created_at);

/* =============================================================================
   Helpers
   ============================================================================= */

-- The grading band. A default that suits Nigerian secondary practice; a
-- school that grades differently changes this one function.
create or replace function classroom.grade_for(pct numeric)
returns text language sql immutable as $fn$
  select case
    when pct is null then null
    when pct >= 70 then 'A'
    when pct >= 60 then 'B'
    when pct >= 50 then 'C'
    when pct >= 45 then 'D'
    when pct >= 40 then 'E'
    else 'F'
  end;
$fn$;

-- Is the viewer a guardian of this student?
create or replace function classroom.is_guardian_of(target_student uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $fn$
  select exists (
    select 1 from classroom.guardian_students g
    where g.student_id = target_student
      and g.guardian_id = auth.uid()
  );
$fn$;

-- Whoever may approve or release. Deliberately NOT the teacher.
create or replace function classroom.can_release_results(target_school uuid)
returns boolean language sql stable security definer
set search_path = classroom, public as $fn$
  select classroom.has_role_in(
    target_school,
    array['owner', 'admin', 'principal']::classroom.member_role[]
  );
$fn$;

create or replace function classroom.actor_label()
returns text language sql stable security definer
set search_path = classroom, public as $fn$
  select coalesce(nullif(btrim(p.first_name || ' ' || p.surname), ''), p.username, p.email)
  from classroom.profiles p where p.id = auth.uid();
$fn$;

/* =============================================================================
   Row level security

   Read access, by who is asking:

     the course's teacher    every state, their own sheets
     owner/admin/principal   every state, their school's sheets
     the student             released only, their own marks
     a parent                released only, their children's marks

   Write access to marks: the teacher, and only while the sheet is a draft or
   has been returned to them. Nobody else, ever -- an administrator who wants
   a mark changed sends the sheet back to the teacher, which is recorded.
   ============================================================================= */
alter table classroom.result_sheets  enable row level security;
alter table classroom.result_entries enable row level security;
alter table classroom.result_events  enable row level security;

/* --- sheets --------------------------------------------------------------- */

create policy "staff read result sheets"
  on classroom.result_sheets for select to authenticated
  using (
    classroom.can_manage_course(course_id)
    or classroom.can_release_results(school_id)
  );

-- A family sees the sheet only so the app can say which term and course a
-- released result belongs to. Released only.
create policy "families read released sheets"
  on classroom.result_sheets for select to authenticated
  using (
    status = 'released'
    and exists (
      select 1 from classroom.result_entries e
      where e.sheet_id = result_sheets.id
        and (e.student_id = auth.uid() or classroom.is_guardian_of(e.student_id))
    )
  );

-- Only the teacher of the course opens a sheet, and only ever as a draft.
create policy "teachers open a draft sheet"
  on classroom.result_sheets for insert to authenticated
  with check (
    classroom.can_manage_course(course_id)
    and status = 'draft'
    and school_id = (select c.school_id from classroom.courses c where c.id = course_id)
  );

-- Deliberately no UPDATE policy. Every status change goes through the
-- functions below, so there is no statement a client can send that moves a
-- sheet towards released.

-- A draft opened by mistake can be discarded; anything submitted is a record
-- and stays.
create policy "teachers discard a draft sheet"
  on classroom.result_sheets for delete to authenticated
  using (classroom.can_manage_course(course_id) and status = 'draft');

/* --- entries -------------------------------------------------------------- */

create policy "staff read result entries"
  on classroom.result_entries for select to authenticated
  using (
    exists (
      select 1 from classroom.result_sheets s
      where s.id = result_entries.sheet_id
        and (classroom.can_manage_course(s.course_id)
             or classroom.can_release_results(s.school_id))
    )
  );

-- The rule the whole feature exists for.
create policy "students read their released results"
  on classroom.result_entries for select to authenticated
  using (
    student_id = auth.uid()
    and exists (
      select 1 from classroom.result_sheets s
      where s.id = result_entries.sheet_id and s.status = 'released'
    )
  );

create policy "guardians read released results"
  on classroom.result_entries for select to authenticated
  using (
    classroom.is_guardian_of(student_id)
    and exists (
      select 1 from classroom.result_sheets s
      where s.id = result_entries.sheet_id and s.status = 'released'
    )
  );

create policy "teachers enter marks while editable"
  on classroom.result_entries for insert to authenticated
  with check (
    exists (
      select 1 from classroom.result_sheets s
      where s.id = result_entries.sheet_id
        and classroom.can_manage_course(s.course_id)
        and s.status in ('draft', 'returned')
    )
  );

create policy "teachers correct marks while editable"
  on classroom.result_entries for update to authenticated
  using (
    exists (
      select 1 from classroom.result_sheets s
      where s.id = result_entries.sheet_id
        and classroom.can_manage_course(s.course_id)
        and s.status in ('draft', 'returned')
    )
  )
  with check (
    exists (
      select 1 from classroom.result_sheets s
      where s.id = result_entries.sheet_id
        and classroom.can_manage_course(s.course_id)
        and s.status in ('draft', 'returned')
    )
  );

create policy "teachers remove marks while editable"
  on classroom.result_entries for delete to authenticated
  using (
    exists (
      select 1 from classroom.result_sheets s
      where s.id = result_entries.sheet_id
        and classroom.can_manage_course(s.course_id)
        and s.status in ('draft', 'returned')
    )
  );

/* --- events --------------------------------------------------------------- */

create policy "staff read the result trail"
  on classroom.result_events for select to authenticated
  using (
    exists (
      select 1 from classroom.result_sheets s
      where s.id = result_events.sheet_id
        and (classroom.can_manage_course(s.course_id)
             or classroom.can_release_results(s.school_id))
    )
  );

-- No insert, update or delete policy: the trail is written by the transition
-- functions, which run as the owner. Nothing a client sends can touch it.

grant select, insert, update, delete on classroom.result_sheets  to authenticated;
grant select, insert, update, delete on classroom.result_entries to authenticated;
grant select on classroom.result_events to authenticated;

/* =============================================================================
   The state machine

   Every one of these is the only route between two states, and each records
   who did it before returning.
   ============================================================================= */

-- Opens the sheet and fills it with the course's approved students, so the
-- teacher is given a register to mark rather than a blank page.
create or replace function classroom.open_result_sheet(
  target_course uuid,
  target_term   uuid,
  ca_max        int default 40,
  exam_max      int default 60
)
returns classroom.result_sheets
language plpgsql security definer
set search_path = classroom, public as $fn$
declare
  course classroom.courses;
  sheet  classroom.result_sheets;
begin
  select * into course from classroom.courses where id = target_course;
  if not found then
    raise exception 'No such course';
  end if;

  if not classroom.can_manage_course(target_course) then
    raise exception 'Only the teacher of this course can open its result sheet';
  end if;

  select * into sheet from classroom.result_sheets
  where course_id = target_course and term_id = target_term;
  if found then
    return sheet;
  end if;

  insert into classroom.result_sheets
    (school_id, course_id, term_id, ca_max, exam_max, created_by)
  values (course.school_id, target_course, target_term, ca_max, exam_max, auth.uid())
  returning * into sheet;

  insert into classroom.result_entries (sheet_id, student_id, updated_by)
  select sheet.id, e.user_id, auth.uid()
  from classroom.enrollments e
  where e.course_id = target_course and e.status = 'approved';

  insert into classroom.result_events (sheet_id, status_to, actor_id, actor_label, note)
  values (sheet.id, 'draft', auth.uid(), classroom.actor_label(), 'Sheet opened');

  return sheet;
end;
$fn$;

-- The teacher hands the sheet over. After this they cannot change a mark.
create or replace function classroom.submit_result_sheet(
  target_sheet uuid,
  note         text default null
)
returns classroom.result_sheets
language plpgsql security definer
set search_path = classroom, public as $fn$
declare
  sheet  classroom.result_sheets;
  was    classroom.result_status;
  blanks int;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet;
  if not found then
    raise exception 'No such result sheet';
  end if;

  if not classroom.can_manage_course(sheet.course_id) then
    raise exception 'Only the teacher of this course can submit its results';
  end if;

  if sheet.status not in ('draft', 'returned') then
    raise exception 'A sheet that is % cannot be submitted', sheet.status;
  end if;

  -- Half a sheet is worse than none: the principal would be approving gaps.
  select count(*) into blanks from classroom.result_entries
  where sheet_id = target_sheet and ca_score is null and exam_score is null;

  if blanks > 0 then
    raise exception '% student(s) have no marks yet', blanks;
  end if;

  was := sheet.status;

  update classroom.result_sheets
  set status = 'submitted', submitted_by = auth.uid(),
      submitted_at = now(), updated_at = now()
  where id = target_sheet
  returning * into sheet;

  insert into classroom.result_events
    (sheet_id, status_from, status_to, actor_id, actor_label, note)
  values (target_sheet, was, 'submitted', auth.uid(), classroom.actor_label(), note);

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select m.user_id, sheet.school_id, 'results_submitted',
         format('Results to approve: %s', c.code),
         format('Submitted by %s', classroom.actor_label()),
         format('/Results/%s', sheet.id)
  from classroom.school_members m, classroom.courses c
  where c.id = sheet.course_id
    and m.school_id = sheet.school_id and m.is_active
    and m.role in ('owner', 'admin', 'principal');

  return sheet;
end;
$fn$;

-- The principal accepts the marks. Still not visible to a single parent.
create or replace function classroom.approve_result_sheet(
  target_sheet uuid,
  note         text default null
)
returns classroom.result_sheets
language plpgsql security definer
set search_path = classroom, public as $fn$
declare
  sheet classroom.result_sheets;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet;
  if not found then
    raise exception 'No such result sheet';
  end if;

  if not classroom.can_release_results(sheet.school_id) then
    raise exception 'Only the principal or an administrator can approve results';
  end if;

  if sheet.status <> 'submitted' then
    raise exception 'A sheet that is % cannot be approved', sheet.status;
  end if;

  -- Whoever entered the marks does not get to approve them.
  if sheet.submitted_by = auth.uid() then
    raise exception 'You submitted these results, so somebody else must approve them';
  end if;

  update classroom.result_sheets
  set status = 'approved', approved_by = auth.uid(),
      approved_at = now(), updated_at = now()
  where id = target_sheet
  returning * into sheet;

  insert into classroom.result_events
    (sheet_id, status_from, status_to, actor_id, actor_label, note)
  values (target_sheet, 'submitted', 'approved', auth.uid(), classroom.actor_label(), note);

  return sheet;
end;
$fn$;

-- Back to the teacher, with a reason. Required, because "fix it" is not
-- something anybody can act on three weeks later.
create or replace function classroom.return_result_sheet(
  target_sheet uuid,
  note         text
)
returns classroom.result_sheets
language plpgsql security definer
set search_path = classroom, public as $fn$
declare
  sheet classroom.result_sheets;
  was   classroom.result_status;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet;
  if not found then
    raise exception 'No such result sheet';
  end if;

  if not classroom.can_release_results(sheet.school_id) then
    raise exception 'Only the principal or an administrator can return results';
  end if;

  if btrim(coalesce(note, '')) = '' then
    raise exception 'Say why it is going back -- the teacher has to act on it';
  end if;

  if sheet.status not in ('submitted', 'approved') then
    raise exception 'A sheet that is % cannot be returned', sheet.status;
  end if;

  was := sheet.status;

  update classroom.result_sheets
  set status = 'returned', updated_at = now()
  where id = target_sheet
  returning * into sheet;

  insert into classroom.result_events
    (sheet_id, status_from, status_to, actor_id, actor_label, note)
  values (target_sheet, was, 'returned', auth.uid(), classroom.actor_label(), note);

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select c.owner_id, sheet.school_id, 'results_returned',
         format('Results sent back: %s', c.code), note,
         format('/Results/%s', sheet.id)
  from classroom.courses c
  where c.id = sheet.course_id and c.owner_id is not null;

  return sheet;
end;
$fn$;

-- The one that lets a family read anything. From approved only -- there is no
-- path here from draft or submitted.
create or replace function classroom.release_result_sheet(
  target_sheet uuid,
  note         text default null
)
returns classroom.result_sheets
language plpgsql security definer
set search_path = classroom, public as $fn$
declare
  sheet classroom.result_sheets;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet;
  if not found then
    raise exception 'No such result sheet';
  end if;

  if not classroom.can_release_results(sheet.school_id) then
    raise exception 'Only the principal or an administrator can release results';
  end if;

  if sheet.status <> 'approved' then
    raise exception 'Results must be approved before they can be released -- this sheet is %', sheet.status;
  end if;

  update classroom.result_sheets
  set status = 'released', released_by = auth.uid(),
      released_at = now(), updated_at = now()
  where id = target_sheet
  returning * into sheet;

  insert into classroom.result_events
    (sheet_id, status_from, status_to, actor_id, actor_label, note)
  values (target_sheet, 'approved', 'released', auth.uid(), classroom.actor_label(), note);

  -- Tell the students, and every guardian attached to them.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select distinct people.recipient, sheet.school_id, 'results_released',
         format('%s results published', c.code),
         format('%s -- %s', t.name, coalesce(c.title, c.code)),
         '/Reports'
  from classroom.result_entries e
  join classroom.courses c on c.id = sheet.course_id
  join classroom.terms   t on t.id = sheet.term_id
  cross join lateral (
    select e.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g
    where g.student_id = e.student_id
  ) people
  where e.sheet_id = target_sheet
    and people.recipient is not null;

  return sheet;
end;
$fn$;

-- Releasing the wrong sheet happens. Pulling it back is itself an event, and
-- it does not pretend the families never saw it.
create or replace function classroom.unrelease_result_sheet(
  target_sheet uuid,
  note         text
)
returns classroom.result_sheets
language plpgsql security definer
set search_path = classroom, public as $fn$
declare
  sheet classroom.result_sheets;
begin
  select * into sheet from classroom.result_sheets where id = target_sheet;
  if not found then
    raise exception 'No such result sheet';
  end if;

  if not classroom.can_release_results(sheet.school_id) then
    raise exception 'Only the principal or an administrator can withdraw results';
  end if;

  if btrim(coalesce(note, '')) = '' then
    raise exception 'Say why the results are being withdrawn';
  end if;

  if sheet.status <> 'released' then
    raise exception 'This sheet is %, so there is nothing to withdraw', sheet.status;
  end if;

  update classroom.result_sheets
  set status = 'approved', released_by = null,
      released_at = null, updated_at = now()
  where id = target_sheet
  returning * into sheet;

  insert into classroom.result_events
    (sheet_id, status_from, status_to, actor_id, actor_label, note)
  values (target_sheet, 'released', 'approved', auth.uid(), classroom.actor_label(), note);

  return sheet;
end;
$fn$;

grant execute on function classroom.open_result_sheet(uuid, uuid, int, int) to authenticated;
grant execute on function classroom.submit_result_sheet(uuid, text)         to authenticated;
grant execute on function classroom.approve_result_sheet(uuid, text)        to authenticated;
grant execute on function classroom.return_result_sheet(uuid, text)         to authenticated;
grant execute on function classroom.release_result_sheet(uuid, text)        to authenticated;
grant execute on function classroom.unrelease_result_sheet(uuid, text)      to authenticated;
grant execute on function classroom.grade_for(numeric)                      to authenticated;
grant execute on function classroom.is_guardian_of(uuid)                    to authenticated;
grant execute on function classroom.can_release_results(uuid)               to authenticated;
grant execute on function classroom.actor_label()                           to authenticated;

/* =============================================================================
   What a result slip looks like to whoever is reading it.

   security_invoker means the policies above apply to this view exactly as
   they apply to the tables -- a parent selecting from it gets their children's
   released results and nothing else.
   ============================================================================= */
create view classroom.result_slips with (security_invoker = true) as
select
  e.id            as entry_id,
  s.id            as sheet_id,
  s.status,
  s.school_id,
  s.released_at,
  e.student_id,
  c.id            as course_id,
  c.code          as course_code,
  c.title         as course_title,
  t.id            as term_id,
  t.name          as term_name,
  sess.name       as session_name,
  s.ca_max,
  s.exam_max,
  e.ca_score,
  e.exam_score,
  e.total,
  round(e.total * 100.0 / nullif(s.ca_max + s.exam_max, 0), 1) as percentage,
  classroom.grade_for(round(e.total * 100.0 / nullif(s.ca_max + s.exam_max, 0), 1)) as grade,
  e.remark
from classroom.result_entries e
join classroom.result_sheets  s on s.id = e.sheet_id
join classroom.courses        c on c.id = s.course_id
join classroom.terms          t on t.id = s.term_id
left join classroom.sessions  sess on sess.id = t.session_id;

grant select on classroom.result_slips to authenticated;

notify pgrst, 'reload schema';
