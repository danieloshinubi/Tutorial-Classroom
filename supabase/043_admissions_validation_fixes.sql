-- =============================================================================
-- Admissions validation pass — fixes
--
-- Four real issues found during the validation before Phase 2:
--
--   1. invoices.student_id NOT NULL prevented the application-fee invoice
--      from being generated at all (an applicant is not yet a student).
--   2. The invoice/payment RLS scoped on student_id/guardian only, so an
--      applicant could not read their own application-fee invoice or
--      declare a manual payment on it.
--   3. is_my_invoice() only recognised student/guardian ownership.
--   4. application_workflow_steps referenced enum values not yet in the
--      classroom.application_status type; the migration 042 adds those
--      so 043 can reference them without failing.
--
-- Every fix is additive. No data lost.
-- =============================================================================


/* 1. Fee invoice can now be issued without a student. -------------------- */

-- Historic term-fee invoices remain untouched — they all have student_id
-- set already. The check keeps the invariant so a plain term_fee row still
-- has to name a student.
alter table classroom.invoices
  alter column student_id drop not null;

do $$
begin
  alter table classroom.invoices
    add constraint invoices_student_or_purpose
    check (
      student_id is not null
      or purpose in ('application_fee', 'other')
    );
exception when duplicate_object then null;
end $$;


/* 2. is_my_invoice() recognises the applicant as owning their fee invoice */

create or replace function classroom.is_my_invoice(target_invoice uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.invoices i
    where i.id = target_invoice
      and (
        -- Regular case: the student themselves, or their guardian.
        i.student_id = auth.uid()
        or exists (
          select 1 from classroom.guardian_students g
          where g.student_id = i.student_id and g.guardian_id = auth.uid()
        )
        -- Application-fee case: the applicant on that application, matched
        -- through applicant_accounts.user_id since applicants are not yet
        -- members of the school.
        or (
          i.application_id is not null and exists (
            select 1
            from classroom.applications a
            join classroom.applicant_accounts ac on ac.id = a.applicant_id
            where a.id = i.application_id
              and ac.user_id = auth.uid()
          )
        )
      )
  );
$fn$;

grant execute on function classroom.is_my_invoice(uuid) to authenticated;


/* 3. Extend the invoice SELECT policy so the applicant can also see their
      fee row. Existing families read policy kept intact; new policy sits
      alongside so nothing existing breaks. -------------------------------- */

drop policy if exists "applicants read their fee invoice" on classroom.invoices;
create policy "applicants read their fee invoice"
  on classroom.invoices for select to authenticated
  using (
    application_id is not null
    and exists (
      select 1
      from classroom.applications a
      join classroom.applicant_accounts ac on ac.id = a.applicant_id
      where a.id = invoices.application_id
        and ac.user_id = auth.uid()
    )
  );


/* 4. Fix application_workflow_steps: reference the enum values that now
      exist, and clean up the acceptance_fee logic which had a stale
      condition (the fee could show as 'done' before it was ever issued). */

create or replace function classroom.application_workflow_steps(
  target_application uuid
) returns table (
  step_key   text,
  step_label text,
  state      text
) language plpgsql stable security definer
set search_path = classroom, public
as $fn$
declare
  app classroom.applications;
  cfg jsonb;
  fee_on boolean;
  acc_on boolean;
  need_interview boolean;
  need_referees  boolean;
  need_next_of_kin boolean;
begin
  select * into app from classroom.applications where id = target_application;
  if not found then
    return;
  end if;
  cfg := classroom.effective_admission_config(app.school_id, app.session_id);

  fee_on           := coalesce((cfg->>'application_fee_enabled')::boolean, false);
  acc_on           := coalesce((cfg->>'acceptance_fee_enabled')::boolean, false);
  need_interview   := coalesce((cfg->>'require_interview')::boolean, false);
  need_referees    := coalesce((cfg->>'require_referees')::boolean, false);
  need_next_of_kin := coalesce((cfg->>'require_next_of_kin')::boolean, true);

  return query
  with base(idx, k, l, done, active) as (
    values
      (1,  'account',        'Applicant account',
            true, false),
      (2,  'programme',      'Programme selected',
            app.programme_id is not null,
            app.programme_id is null),
      (3,  'fee_invoice',    'Application fee invoice',
            fee_on and app.payment_state <> 'not_required',
            false),
      (4,  'fee_paid',       'Application fee paid',
            app.payment_state = 'verified',
            app.payment_state in ('unpaid','processing','rejected')),
      (5,  'form_personal',  'Personal information',
            app.personal_info is not null,
            app.payment_state in ('verified','not_required') and app.personal_info is null),
      (6,  'form_education', 'Education history',
            app.education_history is not null,
            app.personal_info is not null and app.education_history is null),
      (7,  'form_exams',     'Examination results',
            app.exam_results is not null,
            app.education_history is not null and app.exam_results is null),
      (8,  'form_nok',       'Next of kin',
            app.next_of_kin is not null,
            app.exam_results is not null and app.next_of_kin is null),
      (9,  'form_referees',  'Referees',
            app.referees is not null,
            app.next_of_kin is not null and app.referees is null),
      (10, 'documents',      'Documents',
            app.documents_state = 'complete',
            app.documents_state in ('pending','partial','rejected')),
      (11, 'submit',         'Submit application',
            app.form_state in ('submitted','resubmitted'),
            app.form_state in ('ready_to_submit','in_progress')),
      (12, 'review',         'Under review',
            app.status in ('screening'::classroom.application_status,
                           'under_review'::classroom.application_status,
                           'document_review'::classroom.application_status),
            app.form_state in ('submitted','resubmitted')
              and app.status not in ('offered'::classroom.application_status,
                                     'accepted'::classroom.application_status,
                                     'enrolled'::classroom.application_status,
                                     'rejected'::classroom.application_status,
                                     'declined'::classroom.application_status,
                                     'withdrawn'::classroom.application_status)),
      (13, 'action',         'Action required',
            false,
            app.form_state = 'action_required'),
      (14, 'interview',      'Interview',
            app.status = 'interview_completed'::classroom.application_status,
            app.status = 'interview_required'::classroom.application_status),
      (15, 'decision',       'Admission decision',
            app.status in ('offered'::classroom.application_status,
                           'accepted'::classroom.application_status,
                           'enrolled'::classroom.application_status,
                           'rejected'::classroom.application_status,
                           'declined'::classroom.application_status),
            false),
      (16, 'offer',          'Offer accepted',
            app.offer_state = 'accepted',
            app.offer_state = 'issued'),
      -- The acceptance-fee row: only shown when acceptance_fee is enabled.
      -- Done only when the offer has been accepted AND payment is verified;
      -- current when the offer is accepted but payment is not yet in.
      (17, 'acceptance_fee', 'Acceptance fee',
            acc_on and app.offer_state = 'accepted' and app.payment_state = 'verified',
            acc_on and app.offer_state = 'accepted' and app.payment_state <> 'verified'),
      (18, 'clearance',      'Clearance',
            app.clearance_state = 'cleared',
            app.clearance_state = 'in_progress'),
      (19, 'registration',   'Registration',
            app.registration_state = 'completed',
            app.clearance_state = 'cleared' and app.registration_state <> 'completed')
  )
  select k, l,
         case
           when done   then 'done'
           when active then 'current'
           else 'pending'
         end
  from base
  where
    (k not in ('fee_invoice','fee_paid') or fee_on)
    and (k <> 'form_nok'       or need_next_of_kin)
    and (k <> 'form_referees'  or need_referees)
    and (k <> 'interview'      or need_interview)
    and (k <> 'acceptance_fee' or acc_on)
    and (k <> 'action'         or app.form_state = 'action_required')
  order by idx;
end;
$fn$;

grant execute on function classroom.application_workflow_steps(uuid) to authenticated;


notify pgrst, 'reload schema';
