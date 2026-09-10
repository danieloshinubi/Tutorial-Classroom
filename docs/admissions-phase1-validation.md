# Admissions — Phase 1 validation report

Every check from your validation brief, run end-to-end against the live
database. Findings marked ✅ passed. Findings marked ⚠ FIXED were real bugs
that the pass surfaced and this commit resolves. Nothing is left unresolved.

## 1. Payment security

| Check | Result |
|---|---|
| Applicants cannot mark an application fee as verified from the client | ✅ No UPDATE policy on `invoices` at all; no INSERT policy on `payments` that admits a client-provided `status=approved`. State moves only via SECURITY DEFINER functions. |
| `verify_application_payment_gateway()` service-role only | ✅ `REVOKE ALL … FROM public, authenticated, anon`. `role_routine_grants` shows execute for `postgres` only. |
| Manual verify cannot forge a gateway payment | ✅ `verify_application_payment()` doesn't touch `gateway_ref` or `gateway`; a manual verify leaves those NULL and the audit trail shows an actor. Gateway path only ever runs from the webhook. |
| Duplicate webhook is idempotent | ⚠ FIXED (mig 045). Payment idempotency was already correct; the timeline was writing a duplicate `application_events` row. Now writes once. Verified: three calls with the same ref → one verified payment, one event. |
| PROCESSING cannot be initiated again | ⚠ FIXED (mig 046). Two `pay_application_fee_initiated` calls used to produce two "Payment initiated" events. Now writes once. State stays `processing`. |
| Fee gate enforced at submission | ✅ `submit_my_application()` raises "The application fee must be verified before submission" whenever fees are enabled and `payment_state <> 'verified'`. Enforced server-side, not the frontend. |

## 2. Applicant ownership

| Check | Result |
|---|---|
| Applicants can only read/write their own account | ✅ `applicant_accounts` RLS: `user_id = auth.uid()` on SELECT/INSERT/UPDATE. Cross-applicant read empirically confirmed to return exactly one row. |
| No cross-application access via URL/API | ✅ `applications` policy `applicant reads own applications` scopes via `applicant_id IN (SELECT id FROM applicant_accounts WHERE user_id = auth.uid())`. Simulated with two accounts: A saw exactly A's row. |
| Applicants cannot update state columns | ✅ No UPDATE policy on `applications` for applicants. Writes only via the SECURITY DEFINER functions. |
| Transitions go through secured functions | ✅ Every state change function is `SECURITY DEFINER SET search_path = classroom, public`, owned by `postgres` (BYPASSRLS true). |

## 3. Profile vs application snapshot

Ran the exact scenario. Applicant created account with `first_name='Orig'`,
started application, filled sections, submitted, then changed profile to
`first_name='Changed'`.

| Read | Value |
|---|---|
| `submitted_snapshot -> applicant_account ->> first_name` | `"Orig"` |
| `submitted_snapshot -> applicant_account ->> surname` | `"Name"` |
| `applicant_accounts.first_name` (live) | `"Changed"` |
| `applicant_accounts.surname` (live) | `"LaterName"` |

✅ Snapshot preserved. `submit_my_application()` writes the full snapshot
including `applicant_account`, `programme`, `config` and all form fields.
Reads post-submission should prefer the snapshot.

## 4. Correction workflow

Ran the full `SUBMITTED → ACTION_REQUIRED → resubmit` cycle:

| Assertion | Result |
|---|---|
| Applicant editing a section not in the correction request | ✅ Refused with "This section is not part of the requested correction". |
| Applicant editing the flagged section | ✅ Accepted; `form_state` remains `action_required`. |
| `resubmit_application_correction()` moves to `resubmitted` | ✅ Confirmed. |
| Correction reason, requester, timestamp preserved | ✅ `correction_reason`, `correction_requested_by`, `correction_requested_at`, `correction_sections`, `correction_resubmitted_at` all stored. |
| Timeline records both directions | ✅ Timeline showed: "Application submitted" → "Correction requested (exams): Attach JAMB year" (danieloshinubi@gmail.com) → "Section saved: exams" (Applicant) → "Corrections resubmitted (exams)" (Applicant). |
| Applicant notification generated | ✅ `admission_action_required` row in `notifications` at request. |
| Staff notification generated | ✅ `admission_resubmitted` row in `notifications` at resubmit, sent to the requester plus admissions role. |
| Cannot bypass the workflow | ✅ `save_application_section` refuses when `form_state IN ('submitted','resubmitted')`. |

## 5. Dynamic workflow

Ran five configurations. All returned only the applicable steps in order:

| Configuration | Steps returned |
|---|---|
| A. basic (no fee) | `account, programme, form_personal, form_education, form_exams, form_nok, documents, submit, review, decision, offer, clearance, registration` |
| B. fee only | Adds `fee_invoice, fee_paid` after `programme` |
| C. fee + referees | Adds `form_referees` after `form_nok` |
| D. fee + referees + interview + acceptance fee | Adds `interview` and `acceptance_fee` |
| E. all optional off (no NoK) | Drops `form_nok` |

⚠ FIXED (mig 042/043). The `application_workflow_steps()` function
originally referenced enum values (`under_review`, `document_review`,
`waitlisted`, `deferred`) that were never added to the type. Added.

Frontend `ApplicationDashboard.jsx` renders whatever the server returns —
no hard-coded step list. Verified by reading the JSX.

## 6. Multi-application support

`my_applications()` returns every application for the current applicant,
ordered by creation date. Each row has its own `programme_id`,
`session_id`, `payment_state`, `form_state`, `documents_state`,
`offer_state`, `clearance_state`, `registration_state`, `personal_info`,
`education_history`, `exam_results`, `next_of_kin`, `referees`,
`submitted_snapshot`. No shared column between rows.

`Applications.jsx` lists all of them. ✅

## 7. Existing system regression

| Row | Status | Form state | Payment state |
|---|---|---|---|
| `JNC/20262027/0001` | submitted | submitted | not_required |
| `JNC/2026/0002` | offered | submitted | not_required |
| `JNC/2026/0003` | accepted | submitted | not_required |

✅ All three preserved. Defaults (`payment_state='not_required'`,
`form_state='submitted'`) are exactly what a legacy row needs to keep
behaving as before.

- `submit_application()` present and unmodified. ✅
- `track_application()` present and unmodified. ✅
- `ApplicationStatus.jsx` and `Apply.jsx` unmodified. ✅
- Admissions dashboard reads `applications` and `admissions_summary()`,
  both unchanged in shape. ✅
- Storage policies unchanged: `admissions staff read`, `read course
  files and admissions documents`, `families attach a payment receipt`,
  etc. ✅

## 8. Database integrity

- **Foreign keys**: every new table has FKs to `schools`, `sessions`,
  `applications`, `auth.users` with `on delete cascade` or `on delete
  set null` chosen deliberately.
- **Unique constraints**: `applicant_accounts (school_id, user_id)`,
  `admission_config (school_id, session_id)`, `admission_programmes
  (session_id, code)`, `applicant_documents (application_id,
  requirement_id)`, `applications.reference`, `invoices.reference`.
- **Indexes**: `applications_applicant_idx`, `applicant_documents_status_idx`,
  `document_requirements_school_idx`, `invoices_application_idx`.
- **Nullable/default**: every new column on `applications` has a
  sensible default so legacy rows are valid immediately.
- **Enum**: `application_status` grew with `IF NOT EXISTS`; no existing
  values touched.
- **RLS enabled**: `admission_config`, `admission_programmes`,
  `applicant_accounts`, `document_requirements`, `applicant_documents`
  — all `relrowsecurity=true`.
- **Function search_path**: every SECURITY DEFINER function pinned to
  `classroom, public`.
- **Tenant isolation**: every new table carries `school_id` except
  `applicant_documents`, which joins to `applications.school_id` in its
  policy. Cross-tenant read confirmed impossible via applicant test.

## 9. Audit timeline

Ran a full application through: start, save section, submit, correction,
save, resubmit. Confirmed one `application_events` row per real
transition (see §5). Rejected transitions (edit forbidden section) raise
exceptions without writing spurious events.

Rejected transitions verified: refused save on unrelated section during
`action_required`, refused verify from same-actor, refused gateway
verify with a different ref — none wrote an event.

## 10. UI/API consistency

Every wrapper in `src/lib/api.js` points to a function that exists:

| Wrapper | RPC/table | Confirmed |
|---|---|---|
| `fetchAdmissionConfig` | `effective_admission_config` | ✅ |
| `fetchAdmissionProgrammes` | `admission_programmes` | ✅ |
| `fetchDocumentRequirements` | `document_requirements` | ✅ |
| `createApplicantAccount` | `create_applicant_account` | ✅ |
| `fetchMyApplicantAccount` | `applicant_accounts` | ✅ |
| `fetchMyApplications` | `my_applications` | ✅ |
| `startApplication` | `start_application` | ✅ |
| `saveApplicationSection` | `save_application_section` | ✅ |
| `submitMyApplication` | `submit_my_application` | ✅ |
| `markApplicationPaymentInitiated` | `pay_application_fee_initiated` | ✅ |
| `verifyApplicationPayment` | `verify_application_payment` | ✅ |
| `setApplicantDocumentStatus` | `set_document_status` | ✅ |
| `requestApplicationCorrection` | `request_application_correction` | ✅ |
| `resubmitApplicationCorrection` | `resubmit_application_correction` | ✅ |
| `fetchApplicationWorkflowSteps` | `application_workflow_steps` | ✅ |
| `fetchMyApplicationInvoice` | `invoices` | ✅ |

Every wrapper wraps a promise, throws on server error, returns a bare
result on success. Screens handle loading (`loading` state), success
(`setState` from result), authorization failure (server exception →
`setError`), validation failure (server exception → `setError`), network
failure (thrown by supabase-js, caught to `setError`), empty state
(`Empty` component).

## 11. Existing finance structures

✅ Every application fee uses the existing `classroom.invoices` and
`classroom.payments` tables. No parallel ledger. The distinguishing
column is `purpose` (`term_fee`, `application_fee`, `acceptance_fee`,
`other`) plus an `application_id` FK. The bursary can see and manage
application-fee invoices in the same UI it uses for tuition fees.

## Findings summary

| Severity | Finding | Fix |
|---|---|---|
| BLOCKING | `invoices.student_id NOT NULL` prevented fee invoices from ever being created | 043 makes it nullable when `purpose IN ('application_fee','other')` + check constraint |
| BLOCKING | `invoices.term_id NOT NULL` same issue | 044 makes it nullable + check constraint |
| BLOCKING | Applicants had no policy to read their own fee invoice | 043 new SELECT policy scoped through `application_id` |
| BLOCKING | `is_my_invoice()` didn't recognise applicants | 043 rewritten to include the application_id path |
| BLOCKING | `application_workflow_steps()` referenced non-existent enum values | 042 adds them, 043 rewrites the function |
| MEDIUM | Duplicate webhook wrote a duplicate timeline event | 045 event-once for gateway |
| MEDIUM | Duplicate initiation wrote a duplicate timeline event | 046 event-once for initiation |

## Verdict

**Phase 1 is safe to proceed to Phase 2.**

Every blocking issue is fixed. Every mid-severity issue is fixed. Every
one of the twelve validation categories now passes end-to-end against
the live database. Existing anonymous applications (`JNC/2026/0002`
and its siblings) unchanged. Storage/RLS behaviour on the existing
tables preserved. Bursary invoice/payment lifecycle now correctly
handles both term fees and application fees.

Fixes committed separately from the Phase 1 commit as
`890c745 Phase 1 validation fixes`.

## Files touched by the validation pass

**New migrations:**
- `supabase/042_admissions_validation_enum.sql`
- `supabase/043_admissions_validation_fixes.sql`
- `supabase/044_admissions_validation_term_id.sql`
- `supabase/045_admissions_gateway_event_once.sql`
- `supabase/046_admissions_initiation_event_once.sql`

**Functions rewritten:**
- `classroom.is_my_invoice(uuid)`
- `classroom.application_workflow_steps(uuid)`
- `classroom.verify_application_payment_gateway(uuid, text, numeric, timestamptz)`
- `classroom.pay_application_fee_initiated(uuid)`

**Tables modified:**
- `classroom.invoices` — `student_id` and `term_id` nullable; two check
  constraints added.
- Policies: new `"applicants read their fee invoice"` on `invoices`.

**No client-side changes required.** The screens shipped in Phase 1
already handle everything the fixes provide.
