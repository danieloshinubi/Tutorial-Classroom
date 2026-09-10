-- =============================================================================
-- Admissions engine — Phase 2 schema
--
-- Read docs/admissions-phase2-architecture.md before changing anything here.
--
-- Screening, review, interview, decision — represented as independent state
-- machines on applications, mirrored by their own operational tables. Every
-- table has RLS enabled and no client-facing UPDATE policy on state columns.
-- Every state change goes through a SECURITY DEFINER function in 048.
-- =============================================================================


/* -------------------------------------------------------------------------- */
/* 1. New parallel state columns on applications                              */
/* -------------------------------------------------------------------------- */

alter table classroom.applications
  add column if not exists screening_state text not null default 'not_started'
    check (screening_state in ('not_started','in_progress','passed','failed','correction_required')),
  add column if not exists review_state text not null default 'not_started'
    check (review_state in ('not_started','assigned','in_progress','completed')),
  add column if not exists interview_state text not null default 'not_required'
    check (interview_state in ('not_required','scheduled','completed','no_show','rescheduled','cancelled')),
  add column if not exists decision_state text not null default 'pending'
    check (decision_state in ('pending','admit','reject','waitlist','defer')),
  add column if not exists assigned_reviewer_id uuid references auth.users (id) on delete set null,
  add column if not exists screening_completed_at timestamptz,
  add column if not exists review_completed_at    timestamptz,
  add column if not exists final_decided_by       uuid references auth.users (id) on delete set null,
  add column if not exists final_decided_at       timestamptz,
  add column if not exists final_decision_note    text;

create index if not exists applications_reviewer_idx  on classroom.applications (assigned_reviewer_id);
create index if not exists applications_screening_idx on classroom.applications (school_id, screening_state);
create index if not exists applications_review_idx    on classroom.applications (school_id, review_state);
create index if not exists applications_decision_idx  on classroom.applications (school_id, decision_state);


/* -------------------------------------------------------------------------- */
/* 2. Screening requirement templates                                         */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.screening_requirements (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references classroom.schools (id) on delete cascade,
  session_id     uuid references classroom.sessions (id) on delete cascade,
  programme_id   uuid references classroom.admission_programmes (id) on delete cascade,
  kind           text not null,
  label          text not null,
  is_required    boolean not null default true,
  position       int not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists screening_requirements_school_idx
  on classroom.screening_requirements (school_id, session_id);

alter table classroom.screening_requirements enable row level security;

drop policy if exists "read screening requirements" on classroom.screening_requirements;
create policy "read screening requirements"
  on classroom.screening_requirements for select to authenticated
  using (
    classroom.can_do_admissions(school_id)
  );

drop policy if exists "admins manage screening requirements" on classroom.screening_requirements;
create policy "admins manage screening requirements"
  on classroom.screening_requirements for all to authenticated
  using (classroom.has_role_in(
    school_id, array['owner','admin','principal']::classroom.member_role[]
  ))
  with check (classroom.has_role_in(
    school_id, array['owner','admin','principal']::classroom.member_role[]
  ));

grant select, insert, update, delete on classroom.screening_requirements to authenticated;


/* -------------------------------------------------------------------------- */
/* 3. Per-application screening items                                         */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.application_screening_items (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references classroom.applications (id) on delete cascade,
  requirement_id  uuid references classroom.screening_requirements (id) on delete set null,
  kind            text not null,
  label           text not null,
  is_required     boolean not null default true,
  status          text not null default 'pending'
    check (status in ('pending','passed','failed','waived','correction_required')),
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (application_id, kind)
);

create index if not exists application_screening_items_app_idx
  on classroom.application_screening_items (application_id, status);

alter table classroom.application_screening_items enable row level security;

drop policy if exists "staff read screening items" on classroom.application_screening_items;
create policy "staff read screening items"
  on classroom.application_screening_items for select to authenticated
  using (
    exists (
      select 1 from classroom.applications a
      where a.id = application_id
        and classroom.can_do_admissions(a.school_id)
    )
  );

-- No direct write policy. State changes only via SECURITY DEFINER functions.
grant select on classroom.application_screening_items to authenticated;


/* -------------------------------------------------------------------------- */
/* 4. Reviews                                                                 */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.application_reviews (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references classroom.applications (id) on delete cascade,
  reviewer_id       uuid not null references auth.users (id) on delete cascade,
  assigned_by       uuid references auth.users (id) on delete set null,
  assigned_at       timestamptz not null default now(),
  recommendation    text
    check (recommendation is null or recommendation in
      ('recommend_admit','recommend_reject','recommend_waitlist','recommend_correction','recommend_defer')),
  notes             text,
  academic_score    numeric(6,2),
  interview_score   numeric(6,2),
  total_score       numeric(6,2),
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Only one active (uncompleted) review per application.
create unique index if not exists application_reviews_one_active
  on classroom.application_reviews (application_id) where completed_at is null;
create index if not exists application_reviews_reviewer_idx
  on classroom.application_reviews (reviewer_id, completed_at);
create index if not exists application_reviews_app_idx
  on classroom.application_reviews (application_id, completed_at);

alter table classroom.application_reviews enable row level security;

drop policy if exists "staff read reviews" on classroom.application_reviews;
create policy "staff read reviews"
  on classroom.application_reviews for select to authenticated
  using (
    exists (
      select 1 from classroom.applications a
      where a.id = application_id
        and classroom.can_do_admissions(a.school_id)
    )
  );

grant select on classroom.application_reviews to authenticated;


/* -------------------------------------------------------------------------- */
/* 5. Interviews                                                              */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.application_interviews (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references classroom.applications (id) on delete cascade,
  scheduled_at      timestamptz not null,
  location          text,
  meeting_link      text,
  interviewer_id    uuid references auth.users (id) on delete set null,
  status            text not null default 'scheduled'
    check (status in ('scheduled','completed','no_show','rescheduled','cancelled')),
  outcome           text
    check (outcome is null or outcome in ('pass','fail','inconclusive')),
  notes             text,
  scheduled_by      uuid references auth.users (id) on delete set null,
  decided_by        uuid references auth.users (id) on delete set null,
  decided_at        timestamptz,
  cancellation_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists application_interviews_app_idx
  on classroom.application_interviews (application_id, scheduled_at desc);
create index if not exists application_interviews_interviewer_idx
  on classroom.application_interviews (interviewer_id, scheduled_at);

alter table classroom.application_interviews enable row level security;

-- Applicant may READ their own interview so the applicant dashboard can
-- show the schedule. No write policy, no state manipulation from client.
drop policy if exists "read own interview" on classroom.application_interviews;
create policy "read own interview"
  on classroom.application_interviews for select to authenticated
  using (
    classroom.is_applicant_for(application_id)
    or exists (
      select 1 from classroom.applications a
      where a.id = application_id
        and classroom.can_do_admissions(a.school_id)
    )
  );

grant select on classroom.application_interviews to authenticated;


/* -------------------------------------------------------------------------- */
/* 6. Applicant reads of their own review — deliberately none.                */
/*    Review notes and reviewer identity are staff-internal.                  */
/* -------------------------------------------------------------------------- */


notify pgrst, 'reload schema';
