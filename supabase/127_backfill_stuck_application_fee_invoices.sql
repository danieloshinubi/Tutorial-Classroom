-- =============================================================================
-- One-off data repair, not a behaviour change (125 already fixed the
-- behaviour going forward).
--
-- Three real Jane-Nath College applications — JNC/2028/0002, JNC/2028/0004,
-- JNC/2028/0005 — came in through the anonymous /Apply form before 125
-- existed, were later claimed, and their application_fee invoice rows were
-- created moments ago by hand (matching, but outside, this migration
-- sequence) with zero line items and payment_state still 'not_required'.
-- Left as-is, each invoice reads as already-settled (an invoice with no
-- line items sums to ₦0 and looks paid) while payment_state never flips to
-- 'unpaid', so the applicant never sees a fee prompt at all — the exact
-- half-finished state this migration completes.
--
-- Deliberately scoped to only these three, all still at status='submitted'
-- (no decision made, no offer extended, nobody enrolled) — every other
-- application this school or any other has in the same stuck shape was
-- left alone on purpose: retroactively billing an application the school
-- already offered, accepted, or enrolled for a fee it was never asked to
-- pay is a different, bigger call than backfilling one still sitting in
-- the applicant's own hands.
-- =============================================================================

insert into classroom.invoice_items (invoice_id, name, amount, position)
select i.id, 'Application fee', 5000, 0
from classroom.invoices i
where i.reference in ('JNC/2028/0002-AF', 'JNC/2028/0004-AF', 'JNC/2028/0005-AF')
  and not exists (select 1 from classroom.invoice_items ii where ii.invoice_id = i.id);

update classroom.applications
set payment_state = 'unpaid', updated_at = now()
where reference in ('JNC/2028/0002', 'JNC/2028/0004', 'JNC/2028/0005')
  and payment_state = 'not_required'
  and exists (
    select 1 from classroom.invoices i
    where i.application_id = classroom.applications.id and i.purpose = 'application_fee'
  );
