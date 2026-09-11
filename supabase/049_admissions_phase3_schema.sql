-- =============================================================================
-- Admissions engine — Phase 3 schema
--
-- Read docs/admissions-architecture.md before changing anything here.
--
-- Offers become a first-class object. applications.offer_state already
-- exists (added in 040) but nothing has ever written to it — decide_application
-- moves status to 'offered' without touching it, so every applicant's
-- progress tracker has been stuck showing "Offer accepted" as not-started
-- regardless of reality. 050 fixes the write side; this migration adds the
-- table that write lands in.
--
-- Same pattern as every Phase 2 table: RLS enabled, no client-facing
-- UPDATE/INSERT policy. Every state change goes through a SECURITY DEFINER
-- function in 050.
-- =============================================================================


/* -------------------------------------------------------------------------- */
/* 1. Widen the two fee-invoice check constraints to admit acceptance_fee     */
/*    Both were added during Phase 1 validation (043/044) for application_fee */
/*    only. acceptance_fee has been a valid `purpose` value since 040, but an */
/*    acceptance-fee invoice — student_id and term_id both null, same as an   */
/*    application-fee invoice — would be refused by either constraint today.  */
/* -------------------------------------------------------------------------- */

alter table classroom.invoices
  drop constraint if exists invoices_student_or_purpose;
alter table classroom.invoices
  add constraint invoices_student_or_purpose
  check (
    student_id is not null
    or purpose in ('application_fee', 'acceptance_fee', 'other')
  );

alter table classroom.invoices
  drop constraint if exists invoices_term_or_purpose;
alter table classroom.invoices
  add constraint invoices_term_or_purpose
  check (
    term_id is not null
    or purpose in ('application_fee', 'acceptance_fee', 'other')
  );


/* -------------------------------------------------------------------------- */
/* 2. Offers                                                                  */
/* -------------------------------------------------------------------------- */

create table if not exists classroom.admission_offers (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references classroom.applications (id) on delete cascade,
  programme_id    uuid references classroom.admission_programmes (id) on delete set null,
  class_id        uuid references classroom.classes (id) on delete set null,
  letter_path     text,
  status          text not null default 'issued'
    check (status in ('issued','accepted','declined','expired')),
  conditions      text,
  issued_by       uuid references auth.users (id) on delete set null,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz,
  accepted_at     timestamptz,
  declined_at     timestamptz,
  decline_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- At most one live offer per application at a time. Freed again the moment
-- that offer is accepted/declined/expired, so a later re-offer (the state
-- machine allows declined -> offered, waitlisted -> offered, etc.) can issue
-- a fresh row without colliding with the old one.
create unique index if not exists admission_offers_one_active
  on classroom.admission_offers (application_id) where status = 'issued';
create index if not exists admission_offers_app_idx
  on classroom.admission_offers (application_id, issued_at desc);

alter table classroom.admission_offers enable row level security;

drop policy if exists "read own or staff offer" on classroom.admission_offers;
create policy "read own or staff offer"
  on classroom.admission_offers for select to authenticated
  using (
    classroom.is_applicant_for(application_id)
    or exists (
      select 1 from classroom.applications a
      where a.id = application_id
        and classroom.can_do_admissions(a.school_id)
    )
  );

-- No direct write policy. State changes only via SECURITY DEFINER functions
-- in 050 (decide_application, accept_offer, decline_offer).
grant select on classroom.admission_offers to authenticated;


notify pgrst, 'reload schema';
