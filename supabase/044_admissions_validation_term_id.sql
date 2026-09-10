-- =============================================================================
-- Admissions validation pass — term_id nullable for fee invoices
--
-- A term-fee invoice belongs to a term; an application-fee invoice does not
-- (an applicant has not enrolled yet, so no term applies). Existing term-fee
-- rows all have a term_id set — the check keeps them that way.
-- =============================================================================

alter table classroom.invoices
  alter column term_id drop not null;

do $$
begin
  alter table classroom.invoices
    add constraint invoices_term_or_purpose
    check (
      term_id is not null
      or purpose in ('application_fee', 'other')
    );
exception when duplicate_object then null;
end $$;
