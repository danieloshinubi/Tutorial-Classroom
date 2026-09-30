-- Two figures the admissions workspace and the bursary showed wrongly.
--
-- 1. Admissions queues (048/064). An application that has already been
--    offered a place, or has accepted one, stayed in "Documents to verify",
--    "Screening" and the other working queues, because only closed
--    applications (enrolled, declined, rejected, withdrawn) were left out.
--    Once the school has decided, the work those queues track is behind
--    it; an accepted application's remaining work is clearance, which has
--    its own queue. Documents and screening stay parallel checks
--    (docs/admissions-phase2-architecture.md), so an undecided application
--    can still sit in both until each is done.
--
-- 2. Bursary "Still owed" (collection_summary). It added up every issued
--    bill's balance, and an overpaid bill's balance is negative, so one
--    family's overpayment (₦801,666 in testing) was netted off other
--    families' debts. Now each child's bills are netted against each other
--    only, and a child in credit adds nothing, which is exactly the figure
--    the debtors list adds up to.
create or replace function classroom.admissions_queues(target_school uuid)
returns table(bucket text, application_id uuid, reference text, applicant text, status classroom.application_status, form_state text, payment_state text, documents_state text, screening_state text, review_state text, interview_state text, submitted_at timestamp with time zone, updated_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'classroom', 'public'
as $function$
  with base as (
    select a.*,
      trim(a.first_name || ' ' || a.surname) as applicant,
      a.status in (
        'enrolled'::classroom.application_status,
        'declined'::classroom.application_status,
        'rejected'::classroom.application_status,
        'withdrawn'::classroom.application_status
      ) as is_closed,
      a.status in (
        'offered'::classroom.application_status,
        'accepted'::classroom.application_status
      ) as is_decided
    from classroom.applications a
    where a.school_id = target_school
      and classroom.can_do_admissions(target_school)
  )
  select 'payment' as bucket, id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where payment_state = 'processing'
  union all
  select 'documents', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed and not is_decided
    and documents_state in ('pending','partial','rejected') and form_state in ('submitted','resubmitted')
  union all
  select 'screening', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed and not is_decided
    and screening_state in ('not_started','in_progress','failed','correction_required') and form_state in ('submitted','resubmitted')
  union all
  select 'action', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed and not is_decided
    and form_state = 'action_required'
  union all
  select 'review', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed and not is_decided
    and review_state in ('assigned','in_progress')
  union all
  select 'interview', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed and not is_decided
    and interview_state = 'scheduled'
  union all
  select 'decision', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where not is_closed and not is_decided
    and review_state = 'completed' and decision_state = 'pending'
  union all
  select 'clearance', id, reference, applicant, status, form_state, payment_state, documents_state, screening_state, review_state, interview_state, submitted_at, updated_at
  from base where status = 'accepted'::classroom.application_status
    and clearance_state in ('not_started','in_progress','pending_action','rejected');
$function$;

create or replace function classroom.collection_summary(target_school uuid, target_term uuid default null::uuid)
returns table(invoiced numeric, collected numeric, outstanding numeric, awaiting numeric, collection_rate numeric, invoices integer, settled integer, debtors integer)
language sql
stable
security definer
set search_path to 'classroom', 'public'
as $function$
  select
    coalesce(sum(b.payable), 0),
    coalesce(sum(b.paid), 0),
    -- Per child: a credit on one of a child's bills counts against that
    -- child's other bills (as the debtors list does), never another family's.
    (select coalesce(sum(greatest(owing, 0)), 0)
       from (select sum(b2.balance) as owing
               from classroom.invoice_balances b2
              where b2.school_id = target_school
                and b2.status = 'issued'
                and (target_term is null or b2.term_id = target_term)
              group by coalesce(b2.student_id, b2.invoice_id)) per_child),
    coalesce(sum(b.awaiting_approval), 0),
    case
      when coalesce(sum(b.payable), 0) = 0 then null
      else round(coalesce(sum(b.paid), 0) * 100.0 / sum(b.payable), 1)
    end,
    count(*)::int,
    count(*) filter (where b.balance <= 0)::int,
    count(*) filter (where b.balance > 0)::int
  from classroom.invoice_balances b
  where b.school_id = target_school
    and b.status = 'issued'
    and (target_term is null or b.term_id = target_term)
    and classroom.can_do_bursary(target_school);
$function$;
