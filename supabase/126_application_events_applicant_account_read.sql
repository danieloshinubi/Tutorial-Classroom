-- =============================================================================
-- "read events of readable applications" (027_principal_authority_and_
-- platform_boundary.sql) predates claim_application()/applicant_accounts
-- (104_admissions_claim_and_document_prep.sql) — it only ever recognised an
-- applicant by matching auth.jwt()->>'email' against the application's own
-- guardian_email. claim_application()'s own form explicitly invites a
-- different account email ("Doesn't have to be the same email you applied
-- with"), so any applicant who takes it up on that — exactly the anonymous-
-- then-claimed path 125 just fixed the fee side of — could never read their
-- own application's timeline: RLS silently returned zero rows, no error,
-- just "Nothing recorded yet" forever. Same fix pattern is_my_invoice() and
-- may_touch_payment_proof() already use elsewhere for this exact gap.
-- =============================================================================

drop policy if exists "read events of readable applications" on classroom.application_events;
create policy "read events of readable applications"
  on classroom.application_events for select to authenticated
  using (
    exists (
      select 1 from classroom.applications a
      where a.id = application_events.application_id
        and (
          classroom.can_do_admissions(a.school_id)
          or lower(a.guardian_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          or exists (
            select 1 from classroom.applicant_accounts ac
            where ac.id = a.applicant_id and ac.user_id = auth.uid()
          )
        )
    )
  );
