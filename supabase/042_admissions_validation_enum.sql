-- =============================================================================
-- Admissions validation pass — enum extension
--
-- Kept alone so the new values commit before anything below in 043 uses
-- them. ADD VALUE cannot share a transaction with a query that already
-- references the new value.
--
-- Found during validation: application_workflow_steps() references
-- application_status values that were never added to the enum
-- (under_review, document_review, waitlisted, deferred).
-- =============================================================================

alter type classroom.application_status add value if not exists 'under_review';
alter type classroom.application_status add value if not exists 'document_review';
alter type classroom.application_status add value if not exists 'interview_required';
alter type classroom.application_status add value if not exists 'interview_completed';
alter type classroom.application_status add value if not exists 'waitlisted';
alter type classroom.application_status add value if not exists 'deferred';
