-- Closed applications no longer sit in the work queues.
--
-- The documents and screening buckets tested only their own flags
-- (documents_state, screening_state) and form_state. An application that was
-- enrolled, withdrawn, rejected or declined while one of those flags was still
-- "pending" or "not_started" therefore stayed in "Documents to verify" and
-- "Screening" permanently. Seen on Jane-Nath: enrolled and withdrawn
-- applicants listed as documents to verify, and the same eight people repeated
-- under Screening, so the queues overstated the work and buried the real items.
--
-- A closed application has no documents to verify and nobody to screen, so
-- every staff work queue now skips them. Two exceptions, both deliberate:
--   * payment — money marked "processing" is real money in flight whatever
--     happened to the application; a withdrawn applicant's payment still has
--     to be confirmed or refunded, so it stays visible until that is done.
--   * clearance — already limited to status 'accepted', unchanged.
--
-- Nothing is hidden from the school: every application, open or closed, is
-- still in the All applications roster. Same signature and columns as before,
-- so the page reading this needs no change to keep working.

create or replace function classroom.admissions_queues(target_school uuid)
returns table (
  bucket text,
  application_id uuid,
  reference text,
  applicant text,
  status classroom.application_status,
  form_state text,
  payment_state text,
  documents_state text,
  screening_state text,
  review_state text,
  interview_state text,
  submitted_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  with base as (
    select a.*,
      trim(a.first_name || ' ' || a.surname) as applicant,
      a.status in (
        'enrolled'::classroom.application_status,
        'declined'::classroom.application_status,
        'rejected'::classroom.application_status,
        'withdrawn'::classroom.application_status
      ) as is_closed
    from classroom.applications a
    where a.school_id = target_school
      and classroom.can_do_admissions(target_school)
  )
  select 'payment' as bucket, id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where payment_state = 'processing'
  union all
  select 'documents', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed
    and documents_state in ('pending','partial','rejected') and form_state in ('submitted','resubmitted')
  union all
  select 'screening', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed
    and screening_state in ('not_started','in_progress','failed','correction_required') and form_state in ('submitted','resubmitted')
  union all
  select 'action', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed
    and form_state = 'action_required'
  union all
  select 'review', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed
    and review_state in ('assigned','in_progress')
  union all
  select 'interview', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed
    and interview_state = 'scheduled'
  union all
  select 'decision', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed
    and review_state = 'completed' and decision_state = 'pending'
  union all
  select 'clearance', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where status = 'accepted'::classroom.application_status
    and clearance_state in ('not_started','in_progress','pending_action','rejected');
$fn$;
