-- =============================================================================
-- Admissions engine — Phase 1
--
-- Read docs/admissions-architecture.md for the whole shape. Phase 1 lands:
--   applicant accounts, programme catalogue, admission configuration,
--   document requirements per config, per-application document status,
--   fee invoice for the application, the accounted submission path.
--
-- Every state transition is a SECURITY DEFINER function. No client can move
-- an application forward by updating a column directly — the *_state columns
-- have no UPDATE policy on them. Guards live in the functions where they
-- cannot be bypassed by editing the page in the console.
--
-- Every migration in this feature is additive. The existing anonymous
-- submit_application() path stays exactly as it is; the accounted path is a
-- sibling. Applications submitted before this migration continue to work,
-- with sensible defaults on the new columns.
-- =============================================================================


-- 1. Enum extension. Existing values kept; new draft/in_progress values added
--    so the accounted flow has a place to sit before it becomes 'submitted'.

alter type classroom.application_status add value if not exists 'draft';
alter type classroom.application_status add value if not exists 'in_progress';
