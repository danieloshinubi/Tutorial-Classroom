# Admissions — architecture plan

**Read before every Admissions migration.** This is the shared reference so
each phase lands consistent with the previous ones. Ordered exactly the way
the brief asks for.

## 1 — Existing schema and components that can be reused

Kept verbatim; the rest of the system points at these names.

- **`classroom.applications`** — the row a family fills in today. Every column
  we already collect (name, DOB, guardian, guardian contact, applying-for
  level, previous school, notes, `document_links`, `status`, `offer_expires_at`,
  `decided_by`, `decided_at`, `student_id`, `class_id`, `reference`, `seq`,
  `updated_at`) still means the same thing.
- **`classroom.application_documents`** — the uploaded files. `kind` is a free
  text tag; we extend the meaning of `kind` rather than adding a second table.
- **`classroom.application_events`** — append-only audit trail. **This becomes
  the "Application Timeline" verbatim.** No new events table.
- **`classroom.sessions`** — one row per academic session per school, with
  `applications_open` and `is_current`. This is the "Admission Session"
  entity. We add `admission_config_id` rather than duplicating.
- **`classroom.levels`** — school-defined class or department name (JSS 1,
  Computer Science, Cybersecurity). Acts as the coarse programme grouping
  when the school hasn't opted into faculty/programme structure.
- **`classroom.schools`** — the tenant. Carries `plan`, `currency`, `timezone`.
- **`classroom.school_members`** — the roles used everywhere in RLS. We add
  no new roles; `admissions` covers admissions officer, `bursar` covers
  finance officer, `admin/owner/principal` cover registrar/manager.
- **`classroom.invoices` and `classroom.payments`** — the bursary already
  has a full invoice → payment → verification flow, with `status`, `method`,
  `gateway`, `gateway_ref`, `decided_by`, `decided_at`, `proof_path`. The
  Application Fee and Acceptance Fee become invoices in exactly this shape,
  distinguished by a new `purpose` column and by an `application_id` FK.
  Nothing about tuition/other-fees changes.
- **`classroom.fee_structures`** — the template a bursar defines per class per
  term. Reused via a new `purpose` column (`term_fee` today; `application_fee`
  and `acceptance_fee` added).
- **`classroom.notifications`** — the in-portal inbox. Every admissions event
  keeps writing here.
- **Storage bucket `course-materials`** — already carries an `admissions/…`
  prefix with an RLS policy scoped to admissions staff. Extended by adding
  an `applicants/<applicant_id>/…` prefix scoped to the applicant themselves
  plus admissions staff.
- **API surface** in `src/lib/api.js`: `submit_application`,
  `track_application`, `decide_application`, `enrol_applicant`,
  `admissions_summary`. All kept. `submit_application` becomes one of two
  submission paths (the anonymous fallback); the accounted path calls a new
  `submit_my_application`.
- **UI**: `Apply.jsx`, `ApplicationStatus.jsx`, `Admissions.jsx`,
  `ApplicationDetail.jsx`, `AdmissionLetter.jsx`. All kept. The staff
  screens extend rather than rebuild; the applicant screens grow siblings
  (`ApplicantPortal.jsx`, `ApplicationForm.jsx`) so the anonymous flow stays.

## 2 — New entities, tables and columns

New tables live under `classroom.` alongside the rest.

- **`admission_config`** — one row per session (or school-default). Holds
  every configurable requirement so no assumption is baked into code:
  `id`, `school_id`, `session_id` (nullable → school default),
  `application_fee_enabled`, `application_fee_amount`, `currency`,
  `payment_verification` (`manual`/`automatic`/`gateway`),
  `form_locked_until_paid`, `acceptance_fee_enabled`,
  `acceptance_fee_amount`, `require_jamb`, `require_matric`,
  `require_interview`, `require_referees`, `require_next_of_kin`,
  `academic_hierarchy` (`flat`/`faculty_department`/`department_only`),
  `use_applicant_accounts`, `allow_anonymous_apply`, `created_at`,
  `updated_at`. Missing row means the sensible defaults hard-coded in a
  helper function.
- **`admission_programmes`** — the catalogue. `id`, `school_id`,
  `session_id`, `name`, `code`, `faculty` (nullable text — a college can
  leave it blank), `department` (nullable), `study_mode` (`full_time`,
  `part_time`, `distance`), `entry_requirements` (jsonb — free-form so a
  school can add subjects/grades), `capacity`, `is_active`, `created_at`,
  `updated_at`. `code` unique per session.
- **`applicant_accounts`** — the applicant's login-owned identity, distinct
  from a student account. `id`, `school_id`, `user_id` (FK to `auth.users`,
  unique per school), `email`, `phone`, `first_name`, `middle_name`,
  `surname`, `date_of_birth`, `nationality`, `created_at`. One person can
  have one applicant account per tenant and hold many applications through
  it. Kept separate from the `profiles` row because an applicant isn't
  yet a `member` — see §5.
- **`document_requirements`** — configurable list of documents per config,
  optionally narrowed by programme or applicant category. `id`, `config_id`,
  `programme_id` (nullable), `applicant_category` (nullable text, e.g.
  "undergraduate", "postgraduate"), `kind` (short code), `label`
  (human name), `required` boolean, `position`, `notes`. Replaces the
  hard-coded list in `Apply.jsx`.
- **`applicant_documents`** — per-application document row with its own
  status machine, separate from the file-upload record in
  `application_documents`. `id`, `application_id`, `requirement_id`
  (nullable — a school can accept an unsolicited extra), `document_id` (FK
  to `application_documents`, the actual file), `status`
  (`not_uploaded`/`uploaded`/`under_review`/`verified`/`rejected`/
  `resubmission_required`/`waived`), `decided_by`, `decided_at`,
  `decision_note`, `created_at`, `updated_at`. This table is what the staff
  queue and the applicant's "Action Required" list read from.
- **`application_reviews`** — one row per assessment pass. `id`,
  `application_id`, `reviewer_id`, `assigned_at`, `assigned_by`,
  `verdict` (`recommend_admit`/`recommend_reject`/`recommend_waitlist`/
  `needs_more_info`), `notes`, `academic_score`, `interview_score`,
  `total_score`, `completed_at`.
- **`application_interviews`** — `id`, `application_id`, `scheduled_at`,
  `location`, `link`, `interviewer_id`, `outcome`
  (`scheduled`/`completed`/`missed`/`cancelled`), `score`, `notes`.
- **`admission_offers`** — offers become a first-class object.
  `id`, `application_id`, `programme_id` (nullable), `class_id`,
  `letter_path` (storage key for the PDF), `status`
  (`not_issued`/`issued`/`viewed`/`accepted`/`declined`/`expired`),
  `issued_by`, `issued_at`, `expires_at`, `accepted_at`,
  `declined_at`, `decline_reason`, `conditions` (text).
- **`clearance_departments`** — configurable list of clearance steps per
  school (Admissions, Registry, Bursary, Medical, Department, ICT,
  Student Affairs). `id`, `school_id`, `name`, `position`, `is_active`.
- **`clearance_checklists`** — one row per department per application.
  `id`, `application_id`, `department_id`, `status`
  (`pending`/`in_progress`/`cleared`/`rejected`/`waived`), `decided_by`,
  `decided_at`, `decision_note`.
- **`original_verifications`** — physical-original sightings distinct from
  digital uploads. `id`, `application_id`, `document_kind`, `seen_by`,
  `seen_at`, `remarks`.
- **`student_registrations`** — where an applicant becomes a student.
  `id`, `application_id` (unique), `student_id`, `matric_number`
  (nullable), `class_id`, `registered_by`, `registered_at`.

**Column additions to existing tables** (safe, additive):

- `applications`: `applicant_id uuid` (nullable, FK), `programme_id uuid`
  (nullable), `payment_state text` (`not_required`/`unpaid`/`processing`/
  `verified`/`waived`) default `not_required`, `form_state text`
  (`draft`/`in_progress`/`ready_to_submit`/`submitted`) default `draft`,
  `documents_state text` (`pending`/`complete`) default `pending`,
  `offer_state text` (`not_issued`/`issued`/`accepted`/`declined`/
  `expired`) default `not_issued`, `clearance_state text`
  (`not_started`/`in_progress`/`cleared`/`rejected`) default `not_started`,
  `registration_state text` (`not_started`/`completed`) default
  `not_started`, `personal_info jsonb`, `education_history jsonb`,
  `exam_results jsonb`, `next_of_kin jsonb`, `referees jsonb`,
  `declaration_accepted_at timestamptz`, `submitted_at timestamptz`.
- `invoices`: `purpose text` (`term_fee`/`application_fee`/
  `acceptance_fee`/`other`) default `term_fee`, `application_id uuid`
  nullable FK.
- `fee_structures`: `purpose text` default `term_fee`.

The `applications.status` enum keeps its existing values and gains
`draft`, `in_progress`, `under_review`, `document_review`,
`interview_required`, `interview_completed`, `waitlisted`, `deferred`. It
stops trying to represent everything — from Phase 1 onwards read
`payment_state`/`form_state`/`documents_state`/`offer_state`/
`clearance_state`/`registration_state` independently.

## 3 — Existing functions that need modification

Two functions extend; nothing is removed.

- **`submit_application()`** — kept for the anonymous public path (a family
  with no account). Behaviour unchanged, but it now writes `form_state =
  'submitted'`, `payment_state = 'not_required'`, and the row shows up in
  the same staff queues.
- **`decide_application()`** — extended to write the appropriate parallel
  state alongside `applications.status` so the timeline reflects reality:
  moving to `offered` also sets `offer_state = 'issued'` and creates an
  `admission_offers` row; moving to `accepted` sets `offer_state =
  'accepted'`; moving to `enrolled` runs `enrol_applicant()` and writes
  `registration_state = 'completed'`. Every branch inserts an
  `application_events` row exactly as it does today.

## 4 — New server-side functions

Every state transition is a `SECURITY DEFINER` function with the guards
from §7. Nothing on the client can move state directly — the only writes
allowed on `applications.*_state` and on the state tables come from these.

- `create_applicant_account(email, phone, first_name, middle_name,
  surname, date_of_birth)` — called after `auth.signUp`. Writes
  `applicant_accounts`, adds an `applicant`-scoped RLS check (not a
  member role — see §5).
- `start_application(session_id, programme_id)` — creates the row in
  `draft`, links to the applicant, consults `admission_config` to decide
  whether a fee invoice is required, generates the invoice if so.
- `pay_application_fee_initiated(application_id, method)` — records that
  a payment attempt is in flight; sets `payment_state = 'processing'` so
  the applicant is not asked to pay again on a slow gateway.
- `verify_application_payment(payment_id, note)` — finance officer only;
  sets the payment to `verified` and the application's `payment_state`
  to `verified`. Guarded against the person who submitted it.
- `save_application_section(application_id, section, payload)` —
  writes `personal_info`, `education_history`, `exam_results`,
  `next_of_kin`, or `referees` (whichever `section` names), sets
  `form_state` to `in_progress`.
- `submit_my_application(application_id, declaration_accepted)` — the
  accounted submission call. Runs every pre-submission guard from §7,
  then flips `form_state = 'submitted'` and `applications.status =
  'submitted'`.
- `set_document_status(applicant_document_id, new_status, note)` —
  moves one document through the status machine. Applicant may only move
  `not_uploaded → uploaded` and `rejected → uploaded`; staff may move
  the rest.
- `assign_review(application_id, reviewer_id)` — assignment.
- `record_review(application_id, verdict, scores, notes)` — writes an
  `application_reviews` row.
- `schedule_interview(application_id, when, where, interviewer_id)` and
  `record_interview_outcome(id, outcome, score, notes)`.
- `issue_offer(application_id, expires_at, conditions)` — creates the
  offer row and the PDF placeholder, sets `offer_state = 'issued'`.
- `accept_offer(offer_id)` / `decline_offer(offer_id, reason)` — the
  applicant's own action; generates the acceptance-fee invoice when
  accepting.
- `verify_acceptance_payment(payment_id, note)`.
- `set_clearance_status(checklist_id, new_status, note)`.
- `record_original_verification(application_id, kind, remarks)`.
- `promote_applicant_to_student(application_id, matric_number)` — creates
  the `student_registrations` row, promotes the applicant to a student
  `school_members` entry, sets `registration_state = 'completed'`.

Every function ends with `insert into application_events (...)` so the
timeline reflects it.

## 5 — RLS and security implications

- **Applicant tenancy.** An applicant needs to read and write their own
  application before they are a `school_member`. Rather than pretend
  they're a member with role `applicant`, a `SECURITY DEFINER` helper
  `is_applicant_for(school_id, application_id)` reads
  `applicant_accounts` and returns true when `applicant_accounts.user_id
  = auth.uid()` and the application belongs to that applicant. Every
  applicant-facing policy uses that helper.
- **Anonymous submission stays.** `submit_application()` continues to
  run under the anon role via a SECURITY DEFINER path; no policy change
  needed.
- **Staff.** Existing "admissions staff manage documents",
  "admissions staff read/update applications" continue to cover
  admissions officer. Finance-officer verification is scoped through the
  existing `bursar` role using a new helper `can_verify_admission_payment`.
  Registrar/manager actions (issue offer, promote to student) require
  `owner`/`admin`/`principal`.
- **Storage.** A new `applicants/<applicant_id>/…` prefix is added to the
  read policy so applicants read their own files. Writes for that prefix
  require `is_applicant_for()`.
- **No table gets an UPDATE policy on its state columns.** Client writes
  go through the SECURITY DEFINER functions in §4. State cannot move by
  `.update({ status: … })`.

## 6 — Payment workflow

Application Fee and Acceptance Fee are ordinary invoices in
`classroom.invoices`, distinguished by `purpose` and linked to the
application by `application_id`:

```
Financial obligation
  ↓
Invoice generated                 -- start_application / accept_offer
  ↓
Applicant initiates payment       -- pay_application_fee_initiated
  ↓
Payment row inserted (`pending`)
  ↓
Gateway (Paystack) OR manual proof upload
  ↓
Payment marked `processing`       -- pay_application_fee_initiated
  ↓
Verification (webhook auto, or finance officer manual)
                                  -- verify_application_payment
  ↓
Payment `verified` + application.payment_state `verified`
  ↓
Receipt available
  ↓
Downstream state unlocks          -- application form / clearance
```

The applicant is never forced to pay again while a payment is
`processing`. Duplicate initiation is refused with a helpful error.
Every state change writes an `application_events` row.

## 7 — State transitions and guards

Each `_state` column has its own machine; the guards below run inside
the SECURITY DEFINER functions so they can never be bypassed by a
client:

- **submit_my_application:** requires `payment_state IN (verified,
  not_required, waived)` AND all `required` sections filled AND all
  `required` documents `verified` OR `waived` AND `declaration_accepted_at
  IS NOT NULL`.
- **decide_application → offered:** requires
  `applications.status = 'under_review'` AND every configured screening
  requirement satisfied.
- **accept_offer:** requires `offer_state = 'issued'` AND the offer is
  not expired.
- **verify_acceptance_payment:** requires `offer_state = 'accepted'`.
- **enter_clearance (implicit at first clearance status change):**
  requires `offer_state = 'accepted'` AND
  `payment_state = 'verified'` on the acceptance-fee invoice
  (`purpose = 'acceptance_fee'`).
- **promote_applicant_to_student:** requires `clearance_state =
  'cleared'` AND all mandatory clearance items `cleared` OR `waived`.

Every function checks role permission first, then the state guard,
then commits. Failure raises `raise exception` with a message
suitable for direct display.

## 8 — Migration strategy

1. **All migrations additive.** No column is dropped or renamed in
   Phase 1. Existing rows keep working with sensible defaults —
   any application submitted before Phase 1 has `payment_state =
   'not_required'` and `form_state = 'submitted'`.
2. **Enum grows, never shrinks.** New `application_status` values are
   appended so existing rows remain valid.
3. **Existing tests keep passing.** `submit_application()`'s signature
   is unchanged; `Apply.jsx` continues to work; the tenant demo
   application `JNC/2026/0002` is untouched.
4. **New `admission_config` row is created lazily.** A helper
   `effective_admission_config(school_id, session_id)` returns the
   session's row if present, else the school default, else a
   hard-coded default. That means every existing school works without
   a data migration and every new capability is opt-in.
5. **File numbering.** Phase 1 is `039_admissions_engine.sql`. Because
   two `037_*` files already exist in the ledger, Phase 1 starts at
   039 and each subsequent phase gets one file.

## 9 — Phase 1 implementation scope

Everything the accounted vertical slice needs, and nothing more:

- Migration `039_admissions_engine.sql` — every table and column in
  §2, functions `create_applicant_account`, `start_application`,
  `pay_application_fee_initiated`, `verify_application_payment`,
  `save_application_section`, `submit_my_application`,
  `set_document_status`, and the `is_applicant_for` helper. RLS
  policies for the new tables and the storage prefix. Extension of
  the `application_status` enum with `draft`, `in_progress`. No
  removal of anything.
- `src/lib/api.js` — wrappers for each function.
- `src/Pages/Admissions/ApplyStart.jsx` — the account/programme
  starting page for the accounted flow.
- `src/Pages/Admissions/ApplicantHome.jsx` — the applicant's
  dashboard with the twelve-step progress tracker.
- `src/Pages/Admissions/ApplicationForm.jsx` — sectioned form
  (personal, education, exams, next of kin, documents, declaration).
  Uses `save_application_section` per section; nothing is lost on
  navigation.
- `src/Pages/Admissions/ApplicationFeePayment.jsx` — invoice
  presentation, Pay-online button routing through the existing
  Paystack flow, and proof-upload fallback. Progress state honours
  `processing`.
- `src/Pages/Admissions/DocumentsPanel.jsx` — one row per requirement,
  status pill, upload/replace, "Action required" call-out when
  `resubmission_required`.
- Staff-side, one small addition: an "Awaiting payment" filter on
  `Admissions.jsx` and a "Verify payment" action on
  `ApplicationDetail.jsx` for the bursar/admissions role.
- `Apply.jsx` and `ApplicationStatus.jsx` — untouched. They stay as the
  anonymous fallback, still working, still linked from the sign-in
  screen.
- New tests around `submit_my_application` guards.

Everything else — screening/document verification/interview/decision
(Phase 2), offers/acceptance/acceptance-fee (Phase 3),
clearance/original-verification (Phase 4), student promotion/matric
(Phase 5) — is designed against §2/§4/§7 but not built yet.

## 10 — Anything that could break existing applications

Reviewed each change against the running system:

- `submit_application()` signature and behaviour unchanged. The public
  `Apply.jsx` form continues to work; `JNC/2026/0002` is unaffected.
- The staff `Admissions.jsx` dashboard reads from `applications` and
  `admissions_summary()`. Both still work — the new columns are
  additive and default-populated. The dashboard gains the new
  filters but doesn't lose any.
- `decide_application()` continues to accept the same argument list.
  Extensions run *after* the existing INSERT into
  `application_events`, so the timeline picks up new events too.
- The `applications.status` enum grows; the existing `applications`
  RLS policies don't depend on specific values, so no policy
  breakage.
- Storage bucket policies remain in place; the new applicant prefix
  is added by an additional policy, not by editing the existing one.
- The bursary's `invoices` and `payments` tables get one new column
  each (`purpose`, `application_id`), both nullable with defaults, so
  every existing invoice keeps working.
- No cross-tenant leak: every new table carries `school_id` and RLS
  scopes it.

If any of that is wrong for an existing tenant we haven't seen,
`admission_config` is entirely opt-in and the rest of the columns
default to values that make the system behave exactly as it does
today.
