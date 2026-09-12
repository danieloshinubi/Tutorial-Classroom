-- =============================================================================
-- Admissions engine — Phase 5: student promotion / matric registration
--
-- The last step after Phase 4 clearance: turning an accepted, cleared
-- applicant into a formally registered student with a permanent
-- registration ("matric") number — not just a school_members row.
--
-- Supersede, not coexist: classroom.enrol_applicant() (016_admissions.sql)
-- did the school_members/class_students/applications part of this with no
-- registration record and no clearance awareness at all. Two ways to finish
-- an admission is exactly the split-brain this project spent the last
-- session cleaning up (the legacy Admissions.jsx vs AdmissionsWorkspace.jsx
-- pages) — so this replaces it outright rather than sitting beside it.
-- Confirmed by a full-repo grep before writing this: the only caller is
-- AdmissionsWorkspace.jsx's own EnrolForm, updated in the same change.
-- =============================================================================


/* =============================================================================
   1. classroom.student_registrations — the permanent record
   ---------------------------------------------------------------------------
   One row per (school, student): a matric number is issued once and kept
   for the student's whole time at the school, independent of which class
   they sit in this term (class_students already tracks that) or whether
   they're still active (status here tracks standing, not login access —
   school_members.is_active is a separate, narrower "can they sign in" flag).
   ============================================================================= */
create table if not exists classroom.student_registrations (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references classroom.schools (id) on delete cascade,
  student_id          uuid not null references classroom.profiles (id) on delete cascade,
  -- Provenance. Nullable: a school importing an existing roster has no
  -- application to point to, and losing the application later must not
  -- take a live registration record down with it.
  application_id      uuid references classroom.applications (id) on delete set null,
  session_id          uuid references classroom.sessions (id) on delete set null,
  class_id            uuid references classroom.classes (id) on delete set null,
  registration_number  text not null,
  status              text not null default 'active'
    check (status in ('active','withdrawn','graduated','transferred')),
  registered_by       uuid references auth.users (id) on delete set null,
  registered_at        timestamptz not null default now(),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- One registration per student per school — re-admission after a
  -- withdrawal updates this same row (status back to 'active'), it does not
  -- mint a second number. One number per school, obviously.
  unique (school_id, student_id),
  unique (school_id, registration_number)
);

create index if not exists student_registrations_student_idx
  on classroom.student_registrations (student_id);
create index if not exists student_registrations_application_idx
  on classroom.student_registrations (application_id);

alter table classroom.student_registrations enable row level security;

drop policy if exists "read own or staff registration" on classroom.student_registrations;
create policy "read own or staff registration"
  on classroom.student_registrations for select to authenticated
  using (
    student_id = auth.uid()
    or classroom.has_role_in(school_id, array['owner','admin','principal','admissions']::classroom.member_role[])
  );

-- Same trust level School administration already extends to staff over
-- clearance_departments/screening_requirements/document_requirements: full
-- table access once role-gated, not an RPC-restricted subset of columns.
-- Registration_number/student_id/application_id are set once at creation by
-- promote_applicant_to_student() and have no reason to change afterward in
-- the ordinary run of things; status/notes/class_id are the fields this
-- policy exists for (marking someone withdrawn, graduated, transferred).
drop policy if exists "staff manage registrations" on classroom.student_registrations;
create policy "staff manage registrations"
  on classroom.student_registrations for update to authenticated
  using (classroom.has_role_in(school_id, array['owner','admin','principal','admissions']::classroom.member_role[]))
  with check (classroom.has_role_in(school_id, array['owner','admin','principal','admissions']::classroom.member_role[]));

grant select, update on classroom.student_registrations to authenticated;
-- No insert/delete grant at all — only promote_applicant_to_student() (below)
-- creates a registration, and a matric number is never deleted.


/* =============================================================================
   2. promote_applicant_to_student — supersedes enrol_applicant()
   ---------------------------------------------------------------------------
   Does everything enrol_applicant() did (school_members, class_students,
   applications.status → 'enrolled') plus the part that never existed: a
   permanent registration number, and a hard clearance gate — Phase 4 built
   clearance specifically so a school could require every department to sign
   off before someone becomes a student; enrol_applicant() never checked it.
   A school with zero clearance departments configured already resolves to
   'cleared' automatically (recompute_clearance_state, 064), so this changes
   nothing for a school that never set clearance up.
   ============================================================================= */
create or replace function classroom.promote_applicant_to_student(
  target_application uuid,
  target_student      uuid,
  target_class         uuid default null
) returns classroom.student_registrations
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  app       classroom.applications;
  cls       classroom.classes;
  sess      classroom.sessions;
  who       text;
  next_seq  int;
  prefix    text;
  reg_number text;
  reg       classroom.student_registrations;
begin
  select * into app from classroom.applications where id = target_application;
  if app is null then
    raise exception 'No such application';
  end if;

  if not classroom.has_role_in(
       app.school_id,
       array['owner','admin','admissions']::classroom.member_role[]
     ) then
    raise exception 'Only admissions staff can register a student';
  end if;

  if app.status <> 'accepted' then
    raise exception 'Only an accepted application can be registered — this one is %', app.status;
  end if;

  if app.clearance_state <> 'cleared' then
    raise exception 'Clearance must be complete before registering this student (currently %)', app.clearance_state;
  end if;

  if not exists (select 1 from classroom.profiles where id = target_student) then
    raise exception 'That student account does not exist';
  end if;

  if exists (
    select 1 from classroom.student_registrations
    where school_id = app.school_id and student_id = target_student
  ) then
    raise exception 'This person is already registered at this school';
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

  -- Registration number: <school initials>/STU/<admission year>/<seq>,
  -- sequenced per (school, session) — the same technique
  -- submit_application() (019_reference_year.sql) already uses for the
  -- application reference itself, so the pair reads as matched:
  -- JNC/2026/0001 admitted, JNC/STU/2026/0001 registered.
  select * into sess from classroom.sessions where id = app.session_id;

  perform pg_advisory_xact_lock(
    hashtext(app.school_id::text || ':' || coalesce(app.session_id::text, '') || ':student_registrations')
  );

  select coalesce(max(substring(sr.registration_number from '(\d+)$')::int), 0) + 1
    into next_seq
    from classroom.student_registrations sr
    where sr.school_id = app.school_id
      and sr.session_id is not distinct from app.session_id;

  select string_agg(left(word, 1), '')
    into prefix
    from (
      select regexp_split_to_table(upper(s.name), '[^A-Z0-9]+') as word
      from classroom.schools s where s.id = app.school_id
    ) parts
    where word <> '';

  reg_number := format('%s/STU/%s/%s',
                        coalesce(nullif(left(prefix, 4), ''), 'STU'),
                        classroom.reference_year(sess.name),
                        lpad(next_seq::text, 4, '0'));

  insert into classroom.student_registrations
    (school_id, student_id, application_id, session_id, class_id, registration_number, registered_by)
  values
    (app.school_id, target_student, app.id, app.session_id, target_class, reg_number, auth.uid())
  returning * into reg;

  select coalesce(nullif(btrim(first_name || ' ' || surname), ''), email)
    into who from classroom.profiles where id = auth.uid();

  update classroom.applications
  set status = 'enrolled',
      student_id = target_student,
      class_id = target_class,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now()
  where id = target_application;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values (
    target_application, 'accepted', 'enrolled', auth.uid(), who,
    format('Registered as %s%s', reg_number, case when cls.name is null then '' else format(' — %s', cls.name) end)
  );

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  values (
    target_student, app.school_id, 'student_registered',
    'You are registered!',
    format('Your registration number is %s.', reg_number),
    '/Profile'
  );

  return reg;
end;
$fn$;

grant execute on function classroom.promote_applicant_to_student(uuid, uuid, uuid) to authenticated;

-- Superseded. Confirmed (full-repo grep, this change) the only caller left
-- is the frontend EnrolForm, updated in the same commit to call
-- promote_applicant_to_student() instead — so nothing is left depending on
-- this signature.
drop function if exists classroom.enrol_applicant(uuid, uuid, uuid);


/* =============================================================================
   3. decide_application — point its own guidance at the new function name
   ---------------------------------------------------------------------------
   Every prior edit of this function (016, 021, 027, 048, 050) carried the
   same guard forward unchanged: `new_status = 'enrolled'` is refused with a
   message naming enrol_applicant(). Everything below is the deployed 050
   body verbatim; only that one message string changes. Same signature, same
   return type — no DROP needed.
   ============================================================================= */
create or replace function classroom.decide_application(
  target_application uuid,
  new_status         classroom.application_status,
  note               text default null,
  offer_expires      timestamptz default null,
  conditions_in      text default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app     classroom.applications;
  allowed classroom.application_status[];
  was     classroom.application_status;
  who     text;
  cfg     jsonb;
  new_decision_state text;
  resolved_expiry timestamptz;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    raise exception 'No such application';
  end if;

  -- Backwards-compatible transitions that don't require finaliser rights.
  -- These are the workflow moves an admissions officer already makes today:
  --   submitted → screening, screening → screening (no-op), withdrawn, etc.
  -- Everything that lands as an offer/rejection/waitlist/defer is a
  -- finaliser-only act.
  if new_status in ('offered','rejected','waitlisted','deferred','declined','accepted','enrolled') then
    if not classroom.can_finalise_admission(app.school_id) then
      raise exception 'Only owner/admin/principal can make the final admission decision';
    end if;
  else
    if not classroom.can_do_admissions(app.school_id) then
      raise exception 'Only admissions staff can move this application';
    end if;
  end if;

  was := app.status;

  allowed := case was
    when 'submitted'  then array['screening','under_review','offered','rejected','waitlisted','deferred','withdrawn']::classroom.application_status[]
    when 'screening'  then array['under_review','offered','rejected','waitlisted','deferred','withdrawn']::classroom.application_status[]
    when 'under_review' then array['offered','rejected','waitlisted','deferred','withdrawn']::classroom.application_status[]
    when 'waitlisted' then array['offered','rejected','withdrawn']::classroom.application_status[]
    when 'deferred'   then array['screening','under_review','offered','rejected','withdrawn']::classroom.application_status[]
    when 'offered'    then array['accepted','declined','rejected','withdrawn']::classroom.application_status[]
    when 'accepted'   then array['enrolled','withdrawn']::classroom.application_status[]
    when 'rejected'   then array['screening']::classroom.application_status[]
    when 'withdrawn'  then array['screening']::classroom.application_status[]
    when 'declined'   then array['offered']::classroom.application_status[]
    else array[]::classroom.application_status[]
  end;

  if new_status = was then
    return app;
  end if;

  if not (new_status = any(allowed)) then
    raise exception 'An application that is % cannot become %', was, new_status;
  end if;

  if new_status = 'enrolled' then
    raise exception 'Use promote_applicant_to_student() to register — a student account and clearance are required';
  end if;

  -- Finaliser guards. Applied for offered/rejected/waitlisted/deferred, not
  -- for intermediate moves. Every check reads from config so a school that
  -- has disabled a step (no fee, no interview, no screening) does not have
  -- to satisfy it.
  if new_status in ('offered','rejected','waitlisted','deferred') then
    cfg := classroom.effective_admission_config(app.school_id, app.session_id);

    -- Form must be in.
    if app.form_state not in ('submitted','resubmitted') then
      raise exception 'The application has not been submitted (form_state=%)', app.form_state;
    end if;

    -- No open corrections.
    if app.form_state = 'action_required' then
      raise exception 'There is an open correction request — resolve it first';
    end if;

    -- Fee.
    if coalesce((cfg->>'application_fee_enabled')::boolean, false)
       and app.payment_state <> 'verified' then
      raise exception 'The application fee is not verified yet';
    end if;

    -- Documents. Every required requirement must be verified or waived.
    if exists (
      select 1
      from classroom.applicant_documents d
      join classroom.document_requirements r on r.id = d.requirement_id
      where d.application_id = app.id
        and r.is_required
        and d.status not in ('verified','waived')
    ) then
      raise exception 'Every required document must be verified before this decision';
    end if;

    -- Screening. If any screening items were configured, every required one
    -- must be passed or waived. Schools with no screening_requirements
    -- rows for this session/programme skip this check.
    if exists (
      select 1 from classroom.screening_requirements r
      where r.school_id = app.school_id
        and (r.session_id is null   or r.session_id   = app.session_id)
        and (r.programme_id is null or r.programme_id = app.programme_id)
    ) then
      if exists (
        select 1 from classroom.application_screening_items i
        where i.application_id = app.id and i.is_required
          and i.status not in ('passed','waived')
      ) or not exists (
        select 1 from classroom.application_screening_items i
        where i.application_id = app.id
      ) then
        raise exception 'Screening must be complete before this decision';
      end if;
    end if;

    -- Interview if the config requires one.
    if coalesce((cfg->>'require_interview')::boolean, false) then
      if not exists (
        select 1 from classroom.application_interviews i
        where i.application_id = app.id and i.status = 'completed'
      ) then
        raise exception 'An interview must be completed before this decision';
      end if;
    end if;
  end if;

  who := classroom.admissions_actor_label();

  new_decision_state := case new_status
    when 'offered'    then 'admit'
    when 'rejected'   then 'reject'
    when 'waitlisted' then 'waitlist'
    when 'deferred'   then 'defer'
    else app.decision_state
  end;

  resolved_expiry := case
    when new_status = 'offered' then coalesce(offer_expires, now() + interval '14 days')
    else app.offer_expires_at
  end;

  update classroom.applications
  set status = new_status,
      decision_state = new_decision_state,
      decided_by = auth.uid(),
      decided_at = now(),
      updated_at = now(),
      final_decided_by = case
        when new_status in ('offered','rejected','waitlisted','deferred') then auth.uid()
        else final_decided_by
      end,
      final_decided_at = case
        when new_status in ('offered','rejected','waitlisted','deferred') then now()
        else final_decided_at
      end,
      final_decision_note = case
        when new_status in ('offered','rejected','waitlisted','deferred') then note
        else final_decision_note
      end,
      offer_expires_at = resolved_expiry,
      offer_state = case
        when new_status = 'offered' then 'issued'
        when was = 'offered' and new_status in ('rejected','withdrawn') then 'expired'
        else offer_state
      end
  where id = target_application
  returning * into app;

  if new_status = 'offered' then
    update classroom.admission_offers
    set status = 'expired', updated_at = now()
    where application_id = app.id and status = 'issued';

    insert into classroom.admission_offers
      (application_id, programme_id, status, conditions, issued_by, issued_at, expires_at)
    values
      (app.id, app.programme_id, 'issued', conditions_in, auth.uid(), now(), resolved_expiry);
  elsif was = 'offered' and new_status in ('rejected','withdrawn') then
    update classroom.admission_offers
    set status = 'expired', updated_at = now()
    where application_id = app.id and status = 'issued';
  end if;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values (target_application, was, new_status, auth.uid(), who, note);

  -- Notify the applicant. Reuses the existing 'application_<status>' scheme
  -- so the mailer/notification templates already downstream still work.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select ac.user_id, app.school_id, 'application_' || new_status::text,
         format('%s: application %s', app.reference, new_status),
         coalesce(note, format('%s %s', app.first_name, app.surname)),
         format('/Applications/%s', app.id)
  from classroom.applicant_accounts ac
  where ac.id = app.applicant_id;

  -- Legacy anonymous applicants still notified by email match, same as
  -- before. Kept so the existing anonymous flow keeps behaving.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select p.id, app.school_id, 'application_' || new_status::text,
         format('%s: application %s', app.reference, new_status),
         format('%s %s', app.first_name, app.surname),
         '/Apply/Status'
  from classroom.profiles p
  where app.applicant_id is null
    and lower(p.email) = lower(app.guardian_email);

  return app;
end;
$fn$;

grant execute on function classroom.decide_application(uuid, classroom.application_status, text, timestamptz, text) to authenticated;


notify pgrst, 'reload schema';
