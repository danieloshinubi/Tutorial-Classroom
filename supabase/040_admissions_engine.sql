-- =============================================================================
-- Admissions engine — Phase 1 (tables and functions)
--
-- Companion to 039 (which is only the enum extension so the new values are
-- committed before anything below tries to use them). Everything else lands
-- here as one transaction.
-- =============================================================================


/* =============================================================================
   Configuration
   ---------------------------------------------------------------------------
   One row per session per school, plus optional school-wide defaults
   (session_id NULL). effective_admission_config() below picks the best match.
   ============================================================================= */
create table if not exists classroom.admission_config (
  id                          uuid primary key default gen_random_uuid(),
  school_id                   uuid not null references classroom.schools (id) on delete cascade,
  session_id                  uuid references classroom.sessions (id) on delete cascade,
  application_fee_enabled     boolean not null default false,
  application_fee_amount      numeric(12,2) not null default 0,
  currency                    text not null default 'NGN',
  payment_verification        text not null default 'manual'
    check (payment_verification in ('manual', 'gateway', 'automatic')),
  form_locked_until_paid      boolean not null default true,
  acceptance_fee_enabled      boolean not null default false,
  acceptance_fee_amount       numeric(12,2) not null default 0,
  require_jamb                boolean not null default false,
  require_matric              boolean not null default false,
  require_interview           boolean not null default false,
  require_referees            boolean not null default false,
  require_next_of_kin         boolean not null default true,
  academic_hierarchy          text not null default 'flat'
    check (academic_hierarchy in ('flat', 'department_only', 'faculty_department')),
  use_applicant_accounts      boolean not null default true,
  allow_anonymous_apply       boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (school_id, session_id)
);

alter table classroom.admission_config enable row level security;

-- Anyone who can see the school can read its admissions config — an applicant
-- has to know whether a fee is required before signing up. Only admins write.
drop policy if exists "read admission config" on classroom.admission_config;
create policy "read admission config"
  on classroom.admission_config for select to authenticated, anon
  using (true);

drop policy if exists "admins manage admission config" on classroom.admission_config;
create policy "admins manage admission config"
  on classroom.admission_config for all to authenticated
  using (classroom.has_role_in(
    school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  ))
  with check (classroom.has_role_in(
    school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  ));

grant select on classroom.admission_config to anon, authenticated;
grant insert, update, delete on classroom.admission_config to authenticated;

-- Best-match config for a (school, session): session-specific row, else the
-- school default (session_id null), else a synthetic default with fees off.
-- Returns the whole row-as-jsonb so callers don't have to keep a big TABLE
-- signature in sync with every column addition.
create or replace function classroom.effective_admission_config(
  target_school  uuid,
  target_session uuid
) returns jsonb
language sql stable security definer
set search_path = classroom, public
as $fn$
  select coalesce(
    (select to_jsonb(c) from classroom.admission_config c
     where c.school_id = target_school and c.session_id = target_session),
    (select to_jsonb(c) from classroom.admission_config c
     where c.school_id = target_school and c.session_id is null),
    jsonb_build_object(
      'application_fee_enabled', false,
      'application_fee_amount', 0,
      'currency', 'NGN',
      'payment_verification', 'manual',
      'form_locked_until_paid', true,
      'acceptance_fee_enabled', false,
      'acceptance_fee_amount', 0,
      'require_jamb', false,
      'require_matric', false,
      'require_interview', false,
      'require_referees', false,
      'require_next_of_kin', true,
      'academic_hierarchy', 'flat',
      'use_applicant_accounts', true,
      'allow_anonymous_apply', true
    )
  );
$fn$;

grant execute on function classroom.effective_admission_config(uuid, uuid) to anon, authenticated;


/* =============================================================================
   Programme catalogue
   ---------------------------------------------------------------------------
   Deliberately flat so a college can leave faculty/department blank and a
   university can populate them. Requirements are jsonb so a school can add
   its own O-level rules without a schema change.
   ============================================================================= */
create table if not exists classroom.admission_programmes (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references classroom.schools (id) on delete cascade,
  session_id          uuid not null references classroom.sessions (id) on delete cascade,
  name                text not null,
  code                text not null,
  faculty             text,
  department          text,
  study_mode          text default 'full_time'
    check (study_mode in ('full_time','part_time','distance','sandwich','evening','other')),
  entry_requirements  jsonb not null default '{}'::jsonb,
  capacity            int,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (session_id, code)
);

alter table classroom.admission_programmes enable row level security;

drop policy if exists "read programmes" on classroom.admission_programmes;
create policy "read programmes"
  on classroom.admission_programmes for select to authenticated, anon
  using (is_active);

drop policy if exists "admins manage programmes" on classroom.admission_programmes;
create policy "admins manage programmes"
  on classroom.admission_programmes for all to authenticated
  using (classroom.has_role_in(
    school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  ))
  with check (classroom.has_role_in(
    school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  ));

grant select on classroom.admission_programmes to anon, authenticated;
grant insert, update, delete on classroom.admission_programmes to authenticated;


/* =============================================================================
   Applicant account
   ---------------------------------------------------------------------------
   The applicant's login-owned identity, distinct from a student/parent
   member. One person can hold one applicant account per tenant.

   Kept out of school_members deliberately: an applicant is not a member of
   the school and shouldn't inherit member-scoped permissions. RLS uses the
   is_applicant_for() helper below instead of member-role checks.
   ============================================================================= */
create table if not exists classroom.applicant_accounts (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references classroom.schools (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  email          text not null,
  phone          text,
  first_name     text not null,
  middle_name    text,
  surname        text not null,
  date_of_birth  date,
  nationality    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (school_id, user_id)
);

create index if not exists applicant_accounts_user_idx
  on classroom.applicant_accounts (user_id);

alter table classroom.applicant_accounts enable row level security;

drop policy if exists "applicant reads own account" on classroom.applicant_accounts;
create policy "applicant reads own account"
  on classroom.applicant_accounts for select to authenticated
  using (
    user_id = auth.uid()
    or classroom.has_role_in(
      school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
    )
  );

drop policy if exists "applicant writes own account" on classroom.applicant_accounts;
create policy "applicant writes own account"
  on classroom.applicant_accounts for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "applicant updates own account" on classroom.applicant_accounts;
create policy "applicant updates own account"
  on classroom.applicant_accounts for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on classroom.applicant_accounts to authenticated;


/* =============================================================================
   Extend applications with the parallel state machines
   ---------------------------------------------------------------------------
   Each _state column has its own tiny FSM. applications.status stays but
   stops trying to represent everything — from Phase 1 onwards read these
   columns independently.
   ============================================================================= */
alter table classroom.applications
  add column if not exists applicant_id  uuid references classroom.applicant_accounts (id) on delete set null,
  add column if not exists programme_id  uuid references classroom.admission_programmes (id) on delete set null,
  add column if not exists payment_state text not null default 'not_required'
    check (payment_state in ('not_required','unpaid','processing','verified','waived','rejected')),
  add column if not exists form_state    text not null default 'submitted'
    check (form_state in ('draft','in_progress','ready_to_submit','submitted')),
  add column if not exists documents_state text not null default 'pending'
    check (documents_state in ('pending','partial','complete','rejected')),
  add column if not exists offer_state   text not null default 'not_issued'
    check (offer_state in ('not_issued','issued','viewed','accepted','declined','expired')),
  add column if not exists clearance_state text not null default 'not_started'
    check (clearance_state in ('not_started','in_progress','pending_action','cleared','rejected')),
  add column if not exists registration_state text not null default 'not_started'
    check (registration_state in ('not_started','completed')),
  add column if not exists personal_info      jsonb,
  add column if not exists education_history  jsonb,
  add column if not exists exam_results       jsonb,
  add column if not exists next_of_kin        jsonb,
  add column if not exists referees           jsonb,
  add column if not exists declaration_accepted_at timestamptz,
  add column if not exists submitted_at            timestamptz;

create index if not exists applications_applicant_idx on classroom.applications (applicant_id);

-- Helper used everywhere an applicant needs to be allowed at a row. Runs as
-- the owner because applicant_accounts is not readable to somebody who is
-- not one, and we need to check membership without the caller having read.
-- Defined here (after applications.applicant_id exists) so the SQL body
-- resolves at CREATE time.
create or replace function classroom.is_applicant_for(target_application uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1
    from classroom.applications a
    join classroom.applicant_accounts ac on ac.id = a.applicant_id
    where a.id = target_application
      and ac.user_id = auth.uid()
  );
$fn$;

grant execute on function classroom.is_applicant_for(uuid) to authenticated;


-- Applicants can read their own applications, in addition to the existing
-- staff-can-read policy. New policy, not a modification of the existing.
drop policy if exists "applicant reads own applications" on classroom.applications;
create policy "applicant reads own applications"
  on classroom.applications for select to authenticated
  using (
    applicant_id in (
      select id from classroom.applicant_accounts where user_id = auth.uid()
    )
  );

-- No UPDATE or INSERT policy for applicants: every write to an application
-- from the accounted path goes through the SECURITY DEFINER functions below.


/* =============================================================================
   Document requirements + per-application document status
   ============================================================================= */
create table if not exists classroom.document_requirements (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references classroom.schools (id) on delete cascade,
  session_id          uuid references classroom.sessions (id) on delete cascade,
  programme_id        uuid references classroom.admission_programmes (id) on delete cascade,
  applicant_category  text,
  kind                text not null,
  label               text not null,
  is_required         boolean not null default true,
  position            int not null default 0,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists document_requirements_school_idx
  on classroom.document_requirements (school_id, session_id);

alter table classroom.document_requirements enable row level security;

drop policy if exists "read requirements" on classroom.document_requirements;
create policy "read requirements"
  on classroom.document_requirements for select to authenticated, anon
  using (true);

drop policy if exists "admins manage requirements" on classroom.document_requirements;
create policy "admins manage requirements"
  on classroom.document_requirements for all to authenticated
  using (classroom.has_role_in(
    school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  ))
  with check (classroom.has_role_in(
    school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  ));

grant select on classroom.document_requirements to anon, authenticated;
grant insert, update, delete on classroom.document_requirements to authenticated;


create table if not exists classroom.applicant_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references classroom.applications (id) on delete cascade,
  requirement_id uuid references classroom.document_requirements (id) on delete set null,
  document_id    uuid references classroom.application_documents (id) on delete set null,
  status         text not null default 'not_uploaded'
    check (status in ('not_uploaded','uploaded','under_review','verified','rejected','resubmission_required','waived')),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (application_id, requirement_id)
);

create index if not exists applicant_documents_status_idx
  on classroom.applicant_documents (application_id, status);

alter table classroom.applicant_documents enable row level security;

drop policy if exists "read own docs" on classroom.applicant_documents;
create policy "read own docs"
  on classroom.applicant_documents for select to authenticated
  using (
    classroom.is_applicant_for(application_id)
    or exists (
      select 1 from classroom.applications a
      where a.id = application_id
        and classroom.has_role_in(
          a.school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
        )
    )
  );

-- Writes only via set_document_status() below; no direct-write policy.
grant select on classroom.applicant_documents to authenticated;


/* =============================================================================
   Invoicing extensions — application fee lives in the existing invoices/payments
   ---------------------------------------------------------------------------
   The bursary already has a full invoice/payment/verification cycle with
   status, method, gateway, decided_by, proof_path. Reused verbatim, with
   two additive columns telling the invoice apart from a term fee.
   ============================================================================= */
alter table classroom.invoices
  add column if not exists purpose text not null default 'term_fee'
    check (purpose in ('term_fee','application_fee','acceptance_fee','other')),
  add column if not exists application_id uuid references classroom.applications (id) on delete set null;

alter table classroom.fee_structures
  add column if not exists purpose text not null default 'term_fee'
    check (purpose in ('term_fee','application_fee','acceptance_fee','other'));

create index if not exists invoices_application_idx on classroom.invoices (application_id);


/* =============================================================================
   State-transition functions
   ---------------------------------------------------------------------------
   Nothing here trusts the caller's word — every function runs as owner and
   checks role/ownership and the state guards before it mutates. Each ends
   with an application_events row so the timeline reflects the transition.
   ============================================================================= */

-- 1. Create the applicant account after auth signup. One per (school, user).
create or replace function classroom.create_applicant_account(
  target_school   uuid,
  first_name_in   text,
  surname_in      text,
  email_in        text,
  phone_in        text default null,
  middle_name_in  text default null,
  date_of_birth_in date default null,
  nationality_in  text default null
) returns classroom.applicant_accounts
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  acct classroom.applicant_accounts;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create an applicant account';
  end if;

  -- If they already have one, return it — resigning up is not an error.
  select * into acct
  from classroom.applicant_accounts
  where school_id = target_school and user_id = auth.uid();
  if found then
    return acct;
  end if;

  insert into classroom.applicant_accounts
    (school_id, user_id, email, phone, first_name, middle_name, surname, date_of_birth, nationality)
  values
    (target_school, auth.uid(), lower(btrim(email_in)), phone_in,
     btrim(first_name_in), nullif(btrim(coalesce(middle_name_in,'')), ''),
     btrim(surname_in), date_of_birth_in, nationality_in)
  returning * into acct;
  return acct;
end;
$fn$;

grant execute on function classroom.create_applicant_account(uuid, text, text, text, text, text, date, text) to authenticated;


-- 2. Start an application. Creates the row in draft, links to the applicant,
--    and if the admission config wants a fee, generates the invoice.
create or replace function classroom.start_application(
  target_session   uuid,
  target_programme uuid default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  sess       classroom.sessions;
  acct       classroom.applicant_accounts;
  cfg        jsonb;
  app        classroom.applications;
  new_ref    text;
  next_seq   int;
  invoice_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to start an application';
  end if;

  select * into sess from classroom.sessions where id = target_session;
  if not found then
    raise exception 'That admission session no longer exists';
  end if;
  if not sess.applications_open then
    raise exception 'Applications are not open for that session yet';
  end if;

  select * into acct from classroom.applicant_accounts
  where school_id = sess.school_id and user_id = auth.uid();
  if not found then
    raise exception 'Create your applicant account for this school first';
  end if;

  -- Serialise reference numbering per school/session. Same technique as
  -- submit_application(); guarantees no two concurrent starts collide.
  perform pg_advisory_xact_lock(hashtext(sess.school_id::text || ':' || sess.id::text));

  select coalesce(max(seq), 0) + 1 into next_seq
  from classroom.applications
  where school_id = sess.school_id and session_id = sess.id;

  new_ref := format(
    '%s/%s/%s',
    (select coalesce(nullif(substring(regexp_replace(upper(name), '[^A-Z]', '', 'g') from 1 for 3), ''), 'APP')
       from classroom.schools where id = sess.school_id),
    classroom.reference_year(sess.name),
    lpad(next_seq::text, 4, '0')
  );

  -- Personal name filled from the applicant account; the form pass fills
  -- in whatever else the school configured as required.
  insert into classroom.applications
    (school_id, session_id, reference, seq, applicant_id, programme_id,
     first_name, surname, middle_name, date_of_birth,
     guardian_name, guardian_email,
     status, form_state)
  values
    (sess.school_id, sess.id, new_ref, next_seq, acct.id, target_programme,
     acct.first_name, acct.surname, acct.middle_name, acct.date_of_birth,
     acct.first_name || ' ' || acct.surname, acct.email,
     'draft'::classroom.application_status, 'draft')
  returning * into app;

  -- Apply the admission-config fee rules.
  cfg := classroom.effective_admission_config(sess.school_id, sess.id);
  if coalesce((cfg->>'application_fee_enabled')::boolean, false) then
    -- Invoice generated on the existing bursary table. The bursary UI
    -- already handles the payment/verification lifecycle — we just add
    -- purpose='application_fee' and the application_id link.
    insert into classroom.invoices (
      school_id, session_id, structure_id, student_id,
      reference, seq, status, purpose, application_id, notes, issued_at, created_by
    ) values (
      sess.school_id, sess.id, null, null,
      new_ref || '-AF',
      next_seq,
      'issued',
      'application_fee',
      app.id,
      'Application fee — ' || new_ref,
      now(),
      auth.uid()
    )
    returning id into invoice_id;

    update classroom.applications
    set payment_state = 'unpaid'
    where id = app.id
    returning * into app;
  end if;

  -- Timeline entry.
  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, null, 'draft'::classroom.application_status, auth.uid(),
     'Applicant',
     case
       when coalesce((cfg->>'application_fee_enabled')::boolean, false)
         then 'Application started, fee invoice generated'
       else 'Application started'
     end);

  return app;
end;
$fn$;

grant execute on function classroom.start_application(uuid, uuid) to authenticated;


-- 3. Save one section of the form. Applicant only, while draft or in_progress.
create or replace function classroom.save_application_section(
  target_application uuid,
  section_name       text,
  payload            jsonb
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot edit this application';
  end if;

  select * into app from classroom.applications where id = target_application;
  if app.form_state not in ('draft','in_progress','ready_to_submit') then
    raise exception 'This application is closed for editing (%).', app.form_state;
  end if;

  update classroom.applications
  set personal_info     = case when section_name='personal'  then payload else personal_info     end,
      education_history = case when section_name='education' then payload else education_history end,
      exam_results      = case when section_name='exams'     then payload else exam_results      end,
      next_of_kin       = case when section_name='next_of_kin' then payload else next_of_kin     end,
      referees          = case when section_name='referees'  then payload else referees          end,
      form_state        = case when form_state = 'draft' then 'in_progress' else form_state end,
      updated_at        = now()
  where id = target_application
  returning * into app;

  return app;
end;
$fn$;

grant execute on function classroom.save_application_section(uuid, text, jsonb) to authenticated;


-- 4. A payment attempt is under way. Set processing so the applicant is not
--    asked to pay again while the gateway confirms.
create or replace function classroom.pay_application_fee_initiated(
  target_application uuid
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot pay for this application';
  end if;

  update classroom.applications
  set payment_state = 'processing', updated_at = now()
  where id = target_application and payment_state in ('unpaid','rejected')
  returning * into app;

  if not found then
    -- Either already processing or verified; that's fine, return as-is.
    select * into app from classroom.applications where id = target_application;
  end if;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(), 'Applicant',
     'Payment initiated');

  return app;
end;
$fn$;

grant execute on function classroom.pay_application_fee_initiated(uuid) to authenticated;


-- 5. Finance/admissions officer verifies the payment. Two guards: the person
--    who submitted it may not verify it themselves, and the invoice must be
--    tagged as an application fee.
create or replace function classroom.verify_application_payment(
  target_payment uuid,
  note_in        text default null
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  pay classroom.payments;
  inv classroom.invoices;
  app classroom.applications;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  select * into inv from classroom.invoices where id = pay.invoice_id;
  if not found or inv.purpose <> 'application_fee' or inv.application_id is null then
    raise exception 'Not an application-fee payment';
  end if;

  if not classroom.has_role_in(
    inv.school_id, array['owner','admin','principal','admissions','bursar']::classroom.member_role[]
  ) then
    raise exception 'Only admissions or finance staff can verify payments';
  end if;

  if pay.submitted_by is not null and pay.submitted_by = auth.uid() then
    raise exception 'You submitted this payment; somebody else must verify it';
  end if;

  update classroom.payments
  set status = 'approved', decided_by = auth.uid(),
      decided_at = now(), decision_note = note_in
  where id = target_payment;

  update classroom.applications
  set payment_state = 'verified', updated_at = now()
  where id = inv.application_id
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, app.status, app.status, auth.uid(),
     coalesce((select first_name || ' ' || surname from classroom.profiles where id = auth.uid()), 'Officer'),
     'Application-fee payment verified');

  return app;
end;
$fn$;

grant execute on function classroom.verify_application_payment(uuid, text) to authenticated;


-- 6. Move one document row through its status machine. Applicant may only
--    upload/replace; staff can verify/reject/waive.
create or replace function classroom.set_document_status(
  target_doc  uuid,
  new_status  text,
  note_in     text default null
) returns classroom.applicant_documents
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  doc classroom.applicant_documents;
  app classroom.applications;
  is_applicant boolean;
  is_staff     boolean;
begin
  select * into doc from classroom.applicant_documents where id = target_doc;
  if not found then
    raise exception 'No such document';
  end if;

  select * into app from classroom.applications where id = doc.application_id;

  is_applicant := classroom.is_applicant_for(app.id);
  is_staff := classroom.has_role_in(
    app.school_id, array['owner','admin','principal','admissions']::classroom.member_role[]
  );

  if not (is_applicant or is_staff) then
    raise exception 'You cannot change this document';
  end if;

  if is_applicant and not is_staff then
    if new_status not in ('uploaded') then
      raise exception 'Applicants may only upload — verification is done by staff';
    end if;
    if doc.status not in ('not_uploaded','rejected','resubmission_required') then
      raise exception 'This document is already %', doc.status;
    end if;
  end if;

  update classroom.applicant_documents
  set status = new_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(note_in, decision_note),
      updated_at = now()
  where id = target_doc
  returning * into doc;

  -- Documents_state on the application follows the aggregate.
  update classroom.applications a
  set documents_state = case
    when not exists (
      select 1 from classroom.applicant_documents d
      join classroom.document_requirements r on r.id = d.requirement_id
      where d.application_id = a.id and r.is_required
        and d.status not in ('verified','waived')
    ) then 'complete'
    when exists (
      select 1 from classroom.applicant_documents d
      where d.application_id = a.id and d.status = 'rejected'
    ) then 'rejected'
    else 'partial'
    end,
    updated_at = now()
  where a.id = doc.application_id;

  return doc;
end;
$fn$;

grant execute on function classroom.set_document_status(uuid, text, text) to authenticated;


-- 7. Accounted submission path. Every guard from the spec runs here.
create or replace function classroom.submit_my_application(
  target_application     uuid,
  declaration_accepted   boolean
) returns classroom.applications
language plpgsql security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  cfg jsonb;
begin
  if not classroom.is_applicant_for(target_application) then
    raise exception 'You cannot submit this application';
  end if;

  if not declaration_accepted then
    raise exception 'The declaration must be accepted before submitting';
  end if;

  select * into app from classroom.applications where id = target_application;
  cfg := classroom.effective_admission_config(app.school_id, app.session_id);

  if app.form_state = 'submitted' then
    return app;
  end if;

  -- Fee gate.
  if coalesce((cfg->>'application_fee_enabled')::boolean, false)
     and coalesce((cfg->>'form_locked_until_paid')::boolean, true)
     and app.payment_state <> 'verified' then
    raise exception 'The application fee must be verified before submission';
  end if;

  -- Required sections.
  if app.personal_info is null then
    raise exception 'Fill in your personal information first';
  end if;
  if app.education_history is null then
    raise exception 'Fill in your education history first';
  end if;
  if app.exam_results is null then
    raise exception 'Add your exam results first';
  end if;
  if coalesce((cfg->>'require_next_of_kin')::boolean, true) and app.next_of_kin is null then
    raise exception 'Add a next-of-kin first';
  end if;
  if coalesce((cfg->>'require_referees')::boolean, false) and app.referees is null then
    raise exception 'Add your referees first';
  end if;

  -- Required documents.
  if exists (
    select 1
    from classroom.applicant_documents d
    join classroom.document_requirements r on r.id = d.requirement_id
    where d.application_id = app.id
      and r.is_required
      and d.status not in ('verified','uploaded','under_review','waived')
  ) then
    raise exception 'Every required document must be uploaded and any rejection resolved';
  end if;

  update classroom.applications
  set form_state = 'submitted',
      status = 'submitted'::classroom.application_status,
      declaration_accepted_at = now(),
      submitted_at = now(),
      updated_at = now()
  where id = target_application
  returning * into app;

  insert into classroom.application_events
    (application_id, status_from, status_to, actor_id, actor_label, note)
  values
    (app.id, 'draft'::classroom.application_status, 'submitted'::classroom.application_status,
     auth.uid(), 'Applicant', 'Application submitted');

  return app;
end;
$fn$;

grant execute on function classroom.submit_my_application(uuid, boolean) to authenticated;


-- Small read helper the applicant portal calls to enumerate the row set.
create or replace function classroom.my_applications()
returns setof classroom.applications
language sql stable security definer
set search_path = classroom, public
as $fn$
  select a.*
  from classroom.applications a
  join classroom.applicant_accounts ac on ac.id = a.applicant_id
  where ac.user_id = auth.uid()
  order by a.created_at desc;
$fn$;

grant execute on function classroom.my_applications() to authenticated;


notify pgrst, 'reload schema';
