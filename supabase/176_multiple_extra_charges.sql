-- =============================================================================
-- 174 let an additional charge sit beside the term fee, but still allowed only
-- ONE per audience per term, because its new indexes keyed on
-- (term_id, purpose, audience). Checked against a real school's fee list, that
-- is too tight: their charges are WAEC, exam materials, dictionaries, PTA,
-- extra coaching and an end-of-session party, several of which land on the same
-- year group in the same term and are collected separately, on different dates.
-- Under 174, SSS 3 could be billed WAEC or the party — not both as their own
-- bills.
--
-- The protection worth keeping is narrower than what was written. A duplicate
-- TERM FEE for one audience is almost always a mistake — a school charges a
-- year group one set of termly fees. A second ADDITIONAL charge is ordinary.
-- So uniqueness now applies per-audience only to term fees, and additional
-- charges are unique by name instead: any number of differently-named charges,
-- but not two called "WAEC".
--
-- Double-billing a student is still impossible either way — that is guarded by
-- invoices_once_per_structure (174), which is about invoices, not templates.
-- =============================================================================

drop index if exists classroom.fee_structures_whole_school;
drop index if exists classroom.fee_structures_per_level;
drop index if exists classroom.fee_structures_per_class;

/* --- term fees: one per audience per term, as before ----------------------- */

create unique index if not exists fee_structures_term_fee_whole_school
  on classroom.fee_structures (term_id)
  where purpose = 'term_fee' and class_id is null and level_year is null;

create unique index if not exists fee_structures_term_fee_level
  on classroom.fee_structures (term_id, level_year)
  where purpose = 'term_fee' and level_year is not null;

create unique index if not exists fee_structures_term_fee_class
  on classroom.fee_structures (term_id, class_id)
  where purpose = 'term_fee' and class_id is not null;

/* --- everything else: unique by name within its audience -------------------
   The coalesce sentinels are load-bearing. NULLs are distinct in a unique
   index, so without them two whole-school charges both named "PTA" (class_id
   and level_year both null) would each be considered unique and both inserted.
   Level years are positive, so -1 is safe; the all-zero uuid is not a real
   class id.                                                                   */

create unique index if not exists fee_structures_extra_named
  on classroom.fee_structures (
    term_id,
    purpose,
    coalesce(level_year, -1),
    coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  )
  where purpose <> 'term_fee';

notify pgrst, 'reload schema';
