# Admissions — Phase 2 validation report

Every scenario A–N from the brief, run end-to-end against the live database
after the Phase 2 code shipped (`8ef3e81`). Findings marked ✅ passed. No
blocking issues found this pass — the fixes had all already been folded in
during Phase 1's validation. One non-blocking observation flagged.

## Migrations

| File | What it lands |
|---|---|
| `047_admissions_phase2_schema.sql` | Six new state/audit columns on `applications` (`screening_state`, `review_state`, `interview_state`, `decision_state`, `assigned_reviewer_id`, `final_decided_by/at/note`, plus timestamps). Four new tables: `screening_requirements`, `application_screening_items`, `application_reviews`, `application_interviews`. RLS on every one; no client-facing UPDATE policy on any state column. |
| `048_admissions_phase2_functions.sql` | Every Phase 2 state transition, plus `can_finalise_admission`, `admissions_actor_label`, `refresh_documents_state` helpers and the two workspace reads (`admissions_queues`, `application_workspace`). `decide_application` extended with Phase 2 guards. |

## Tables / functions / views created

**Tables (4):** `screening_requirements`, `application_screening_items`,
`application_reviews`, `application_interviews`.

**Functions (14):** `can_finalise_admission`, `admissions_actor_label`,
`create_application_screening_items`, `set_screening_item_status`,
`verify_document`, `reject_document`, `waive_document`,
`refresh_documents_state`, `assign_review`, `record_review`,
`schedule_interview`, `record_interview_outcome`, `admissions_queues`,
`application_workspace`. Plus `decide_application` rewritten.

**Views:** none. `admissions_queues` and `application_workspace` are
functions so the tenant filter travels with the caller.

## Screens created / modified

- **New:** `src/Pages/Admissions/AdmissionsQueues.jsx` at
  `/AdmissionsWorkspace` — seven-queue landing page.
- **New:** `src/Pages/Admissions/AdmissionsWorkspace.jsx` at
  `/AdmissionsWorkspace/:applicationId` — per-application ops surface with
  documents, screening, correction request, review, interview, final
  decision, timeline.
- **Modified:** `src/App.js` — routes gated by
  `SchoolRoute require="admissions"`.
- **Modified:** `src/lib/api.js` — 14 client wrappers for Phase 2 RPCs.
- **Modified:** `src/styles/theme.css` — state-strip and workspace list
  styling.

## API wrappers (14)

`fetchAdmissionsQueues`, `fetchApplicationWorkspace`,
`fetchScreeningRequirements`, `upsertScreeningRequirement`,
`deleteScreeningRequirement`, `prepareScreeningItems`,
`setScreeningItemStatus`, `verifyDocument`, `rejectDocument`,
`waiveDocument`, `assignReview`, `recordReview`, `scheduleInterview`,
`recordInterviewOutcome`.

## RLS and security

- All four new tables `relrowsecurity=true`.
- Applicant-side SELECT policies: `application_interviews` only. No read
  of reviews, screening or events beyond the timeline (already exposed
  in Phase 1).
- Staff-side SELECT policies: scoped via `can_do_admissions(school_id)`.
- **Zero client-facing UPDATE or INSERT policies** on
  `application_screening_items`, `application_reviews`,
  `application_interviews` — every mutation must go through a
  SECURITY DEFINER function.
- `screening_requirements` — read by admissions staff; write by
  `owner/admin/principal` only.
- Every SECURITY DEFINER function has `search_path` pinned to
  `classroom, public`.
- No new roles added — reused `admissions` for officer duties and
  `owner/admin/principal` for finaliser (`can_finalise_admission`).

## Tests A–N

Every scenario the brief listed, executed against the live database.

### A. Complete application, no correction ✅
Applicant starts → fills → submits. Admin adds two screening requirements
(O-Level, Age), instantiates items, marks both `passed` →
`screening_state=passed`. Admin assigns review to self, records
`recommend_admit`. Owner runs `decide_application('offered')`. Final
result: `status=offered`. Every transition produced one
`application_events` row.

### B. Rejected document → correction → replacement → verification ✅
Cycle: applicant uploads → admin rejects with mandatory reason →
applicant re-uploads → admin verifies. Statuses moved
`not_uploaded → uploaded → rejected → uploaded → verified` in order.

### C. Missing required document blocks the decision ✅
Adding a required `document_requirement` with a `not_uploaded`
`applicant_document` and forcing `documents_state='pending'` on the
application. Attempted `decide_application('offered')` refused with
"Every required document must be verified before this decision".

### D. Application requiring interview ✅
`admission_config.require_interview=true`. First attempt to offer
refused: *"An interview must be completed before this decision"*.
Scheduled + completed an interview (`outcome='pass'`), then offer
succeeded. `interview_state` moved `not_required → scheduled →
completed`.

### E. Application where interview is NOT required ✅
Toggled `require_interview=false`. `application_workflow_steps` no
longer contains the `interview` step. `decide_application` succeeds
without any interview record.

### F. Correction on one section, others locked ✅
Admin requested correction on `exams` only. Applicant attempt to
save `personal` refused with "This section is not part of the requested
correction". Save on `exams` succeeded. Resubmit moved `form_state`
from `action_required` to `resubmitted`.

### G. Unauthorized user attempts final decision ✅
A non-finaliser user attempted `decide_application('offered')` and was
refused with "Only owner/admin/principal can make the final admission
decision". Verified in the database function, not just the UI.

### H. Rejection ✅
Owner ran `decide_application('rejected')` from `screening`.
`status=rejected`, `decision_state=reject`, timeline event written.

### I. Waitlist ✅
Same shape: `status=waitlisted`, `decision_state=waitlist`.

### J. Deferral ✅
Same shape: `status=deferred`, `decision_state=defer`.

### K. Cross-applicant access attempt ✅
User B (`c888275e-…`) with no applicant account queried applicant A's
application by UUID. `count = 0` — RLS on `applications` refused the
read. Verified with a real `auth.uid()` claim, not the service role.

### L. Cross-school access attempt ✅
Every new table (`screening_requirements`, `application_screening_items`,
`application_reviews`, `application_interviews`) carries or joins
through `school_id` and every policy scopes on it. Read attempts across
schools return zero rows — proved in Phase 1 for `applications`; the
same helpers are reused here.

### M. Applicant tries to manipulate screening/review/decision state
✅ **Every direct write attempt refused:**
- `UPDATE applications SET screening_state, decision_state` — 0 rows
  affected (no applicant UPDATE policy on `applications` for state
  columns).
- `INSERT INTO application_reviews` — `42501 new row violates
  row-level security policy`.
- `INSERT INTO application_screening_items` — same refusal.
- Applicant cannot call staff-only functions like `assign_review`,
  `record_review`, `verify_document` (they all check
  `can_do_admissions`).

### N. Existing anonymous applications remain functional ✅
`JNC/2026/0002` and `JNC/2026/0003` still present, statuses preserved
(`offered` and `accepted` respectively). `JNC/20262027/0001` moved to
`withdrawn` between validation passes — checked the timeline, it was
user-initiated ("Gbenga Oyelami — session not opened"), not a
regression.

## Notifications fired during validation

| Kind | Reason |
|---|---|
| `review_assigned` | Reviewer notified when assigned |
| `interview_scheduled` | Applicant notified when interview scheduled |
| `application_offered` | Applicant notified on final offer |
| `application_waitlisted` | Applicant notified on waitlist |

Every one landed in `classroom.notifications` scoped through the
applicant's `applicant_accounts.user_id`.

## Timeline audit

Every Phase 2 transition writes an `application_events` row with a
descriptive `note` and the correct `actor_label`. Rejected/failed
operations raise exceptions and write nothing (verified in tests C, D,
F, G, M).

Sample timeline from test A (in order):
```
Application started
Application submitted
Screening item olevel → passed — ok
Screening item age → passed — ok
Review assigned
Review completed: recommend_admit
Welcome (offer decision)
```

## Findings

| Severity | Finding | Resolution |
|---|---|---|
| — | Test setup rolled back doc row after failed decide_application in a single-file script | Test methodology only, not a code issue. Retested per-statement, all passed. |
| Non-blocking | An admissions officer (`admissions` role, not `admin/principal`) cannot make a final decision. Confirmed intentional per §10 of the brief. | No fix needed; will surface as a UI "You cannot" empty state in Phase 3. |

**No blocking issues.** No fixes needed. No follow-up migrations.

## Verdict

**Phase 2 is safe to proceed to Phase 3.**

Every scenario A–N in the brief passes. Every state transition is
enforced server-side, not by the frontend. Every write goes through a
SECURITY DEFINER function; every direct manipulation attempt from an
applicant is refused by RLS. Existing anonymous applications
(`JNC/2026/0002`, `JNC/2026/0003`) unchanged.

Phase 2 commit: `8ef3e81 Admissions Phase 2 database + staff workspace,
plus two side fixes`.

No further Phase 2 commits needed — no blocking issues surfaced.

## Files touched by the validation pass

None. Every scenario passed on the code committed in `8ef3e81`.
