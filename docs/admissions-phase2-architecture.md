# Admissions Phase 2 — architecture

Built on top of the validated Phase 1 architecture. Nothing from Phase 1 is
redesigned. This document sits alongside `admissions-architecture.md`.

## What exists that we reuse

- `applications`, `applicant_accounts`, `application_events`,
  `applicant_documents`, `application_documents`.
- `admission_config`, `admission_programmes`, `document_requirements`.
- Functions: `is_applicant_for`, `has_role_in`, `can_do_admissions`,
  `application_workflow_steps`, `request_application_correction`,
  `resubmit_application_correction`, `set_document_status`,
  `decide_application` (extended, not replaced), `enrol_applicant`.
- Correction request/resubmit already implemented — Phase 2 UI hooks
  into the existing functions.
- Notifications infrastructure — every Phase 2 transition writes to
  `classroom.notifications`.

## New entities

### Screening

- **`screening_requirements`** — school- or programme-scoped checklist
  templates. `id, school_id, session_id (nullable), programme_id
  (nullable), kind, label, is_required, position, created_at,
  updated_at`. Same shape as `document_requirements`.
- **`application_screening_items`** — one row per application per
  requirement, plus optional ad-hoc items. Statuses
  `pending / passed / failed / waived / correction_required` with
  decision audit fields.

### Review

- **`application_reviews`** — one row per assignment.
  `id, application_id, reviewer_id, assigned_by, assigned_at,
  recommendation (recommend_admit / recommend_reject /
  recommend_waitlist / recommend_correction / recommend_defer / null),
  notes, academic_score, interview_score, completed_at, updated_at`.

A single active review is enforced by a partial unique index on
`(application_id) where completed_at IS NULL`.

### Interview

- **`application_interviews`** — `id, application_id, scheduled_at,
  location, meeting_link, interviewer_id, status (scheduled / completed
  / no_show / rescheduled / cancelled), outcome (pass / fail /
  inconclusive / null), notes, decided_by, decided_at, created_at,
  updated_at`.

## New columns on `applications`

All additive with sensible defaults so legacy rows behave unchanged:

- `screening_state text` default `not_started`
  (`not_started / in_progress / passed / failed / correction_required`)
- `review_state text` default `not_started`
  (`not_started / assigned / in_progress / completed`)
- `interview_state text` default `not_required`
  (`not_required / scheduled / completed / no_show / rescheduled /
  cancelled`)
- `decision_state text` default `pending`
  (`pending / admit / reject / waitlist / defer`)
- `assigned_reviewer_id uuid` — nullable, references `auth.users`
- `screening_completed_at timestamptz`
- `review_completed_at timestamptz`

`applications.status` remains the top-level lifecycle; the new
per-domain columns give the operational surface without collapsing
concerns.

## Role separation

Uses existing `school_members.role`:

- **Screening / document verification / correction request / review
  assignment / scheduling interviews / recording interview outcomes** —
  `admissions`, plus `owner / admin / principal` (via existing
  `can_do_admissions`).
- **Review / recommendation** — the applicant's assigned reviewer.
  Anyone with `admissions` (or higher) can be assigned. The function
  refuses recording a review from a user other than the assigned
  reviewer.
- **Final admission decision** — `owner / admin / principal` only.
  A new helper `can_finalise_admission(school)` gates the extended
  `decide_application()`. Admissions officers can screen and
  recommend, but the final decision is a proprietor-level act.

No new roles added.

## Functions

All `SECURITY DEFINER SET search_path = classroom, public`. All write
an `application_events` row on real transitions only.

- **Screening**
  - `configure_screening_item(school, session, programme, kind, label,
    required, position)`
  - `create_application_screening_items(application_id)` — instantiates
    from config on first screening action
  - `set_screening_item_status(item_id, status, note)`
  - `complete_screening(application_id, note)` — checks every required
    item passed/waived, sets `screening_state='passed'`, moves
    `applications.status` to `screening` if it was `submitted`.

- **Documents (staff)**
  - `verify_document(applicant_document_id, note)` — sets to `verified`
  - `reject_document(applicant_document_id, reason)` — sets to
    `rejected` (mandatory reason)
  - `waive_document(applicant_document_id, reason)` — sets to `waived`
  - `set_document_status` from Phase 1 still exists and is the raw
    escape hatch.

- **Review**
  - `assign_review(application_id, reviewer_id)` — admissions/admin.
    Refuses assignment while `review_state='completed'` unless the
    caller is admin/owner/principal (re-review).
  - `record_review(application_id, recommendation, notes, academic_score,
    interview_score)` — reviewer only.

- **Interview**
  - `schedule_interview(application_id, when, location, link,
    interviewer_id)` — admissions/admin.
  - `reschedule_interview(interview_id, when)` — records the old row as
    `rescheduled` and inserts a new `scheduled` row.
  - `cancel_interview(interview_id, reason)`.
  - `record_interview_outcome(interview_id, status, outcome, notes)`.

- **Final decision** — `decide_application` extended:
  - Refuses if `can_finalise_admission(school)` returns false.
  - Guards for offered: `payment_state IN (verified, not_required)` AND
    every required screening item `passed`/`waived` AND every required
    document `verified`/`waived` AND (interview required implies
    outcome exists) AND `form_state = 'submitted' OR 'resubmitted'`.
  - Records `decision_state` alongside `status`.

## RLS

- Every new table has RLS enabled.
- Staff-only tables (`application_reviews`, `application_screening_items`,
  `application_interviews`) — SELECT scoped through
  `can_do_admissions(application.school_id)`. No applicant-side read.
- `screening_requirements` — read by admissions staff; write by
  admin/principal only.
- No client-facing UPDATE policies on state columns — every change
  routes through the SECURITY DEFINER functions above.

## Timeline

Every function writes to `application_events` on real transitions.
Rejected/failed calls raise `raise exception` and write nothing.

## Notifications

Existing `classroom.notifications` — no new table.

Fires on:
- `document_rejected` → applicant
- `document_correction_required` → applicant
- `interview_scheduled` / `interview_rescheduled` → applicant
- `application_decision` → applicant (via existing pattern)
- `application_resubmitted` → assigned reviewer, admissions role
- `review_assigned` → the assigned reviewer
- `review_completed` → owner/admin/principal (decision queue)

## What Phase 2 explicitly does NOT do

- No acceptance-fee invoicing. Phase 3.
- No offer PDF generation (existing `AdmissionLetter.jsx` remains what
  the school uses for now).
- No clearance workflow. Phase 4.
- No promotion to student / matric number. Phase 5.

## Applicant experience

Nothing in Phase 2 requires the applicant JSX to change beyond what
Phase 1 already renders. `application_workflow_steps()` already returns
review and decision steps — Phase 2 just makes those steps move.
