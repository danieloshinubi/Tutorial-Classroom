-- =============================================================================
-- Admissions engine — Phase 4 schema
--
-- Read docs/admissions-architecture.md §2/§4/§7 before changing anything here.
--
-- Clearance and original-document verification — the step between "accepted
-- the offer and paid the acceptance fee" and "promoted to student" (Phase 5,
-- not built here). Same pattern as every prior phase: RLS enabled, no
-- client-facing UPDATE policy on state columns, every write goes through a
-- SECURITY DEFINER function in 064.
--
-- applications.clearance_state already exists (040_admissions_engine.sql) —
-- like offer_state before Phase 3, nothing has ever written to it. 064 fixes
-- that the same way 050 fixed offer_state.
-- =============================================================================


/* -------------------------------------------------------------------------- */
/* 1. The configurable list of clearance steps a school runs                  */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.clearance_departments (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  name        text not null,
  position    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, name)
);

create index if not exists clearance_departments_school_idx
  on classroom.clearance_departments (school_id, position);

alter table classroom.clearance_departments enable row level security;

-- Anyone who can see admissions activity needs the list to make sense of a
-- checklist; only administration decides what the list actually contains.
drop policy if exists "admissions staff read clearance departments" on classroom.clearance_departments;
create policy "admissions staff read clearance departments"
  on classroom.clearance_departments for select to authenticated
  using (classroom.can_do_admissions(school_id));

drop policy if exists "administrators manage clearance departments" on classroom.clearance_departments;
create policy "administrators manage clearance departments"
  on classroom.clearance_departments for all to authenticated
  using (classroom.has_role_in(school_id, array['owner','admin','principal']::classroom.member_role[]))
  with check (classroom.has_role_in(school_id, array['owner','admin','principal']::classroom.member_role[]));

grant select, insert, update, delete on classroom.clearance_departments to authenticated;


/* -------------------------------------------------------------------------- */
/* 2. One checklist row per department per application                       */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.clearance_checklists (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references classroom.applications (id) on delete cascade,
  department_id  uuid not null references classroom.clearance_departments (id) on delete cascade,
  status         text not null default 'pending'
    check (status in ('pending','in_progress','cleared','rejected','waived')),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (application_id, department_id)
);

create index if not exists clearance_checklists_app_idx
  on classroom.clearance_checklists (application_id, status);

alter table classroom.clearance_checklists enable row level security;

-- The applicant watches their own clearance progress department by
-- department, same transparency Phase 2 gives them over screening/documents.
drop policy if exists "read own or staff clearance checklist" on classroom.clearance_checklists;
create policy "read own or staff clearance checklist"
  on classroom.clearance_checklists for select to authenticated
  using (
    classroom.is_applicant_for(application_id)
    or exists (
      select 1 from classroom.applications a
      where a.id = application_id and classroom.can_do_admissions(a.school_id)
    )
  );

-- No direct write policy. State changes only via set_clearance_status() in 064.
grant select on classroom.clearance_checklists to authenticated;


/* -------------------------------------------------------------------------- */
/* 3. Physical-original sightings — distinct from the digital uploads         */
/*    Phase 2 already tracks (applicant_documents/application_documents).    */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.original_verifications (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references classroom.applications (id) on delete cascade,
  document_kind  text not null,
  seen_by        uuid references auth.users (id) on delete set null,
  seen_at        timestamptz not null default now(),
  remarks        text
);

create index if not exists original_verifications_app_idx
  on classroom.original_verifications (application_id, seen_at desc);

alter table classroom.original_verifications enable row level security;

drop policy if exists "read own or staff original verifications" on classroom.original_verifications;
create policy "read own or staff original verifications"
  on classroom.original_verifications for select to authenticated
  using (
    classroom.is_applicant_for(application_id)
    or exists (
      select 1 from classroom.applications a
      where a.id = application_id and classroom.can_do_admissions(a.school_id)
    )
  );

-- No direct write policy. Only via record_original_verification() in 064.
grant select on classroom.original_verifications to authenticated;


notify pgrst, 'reload schema';
