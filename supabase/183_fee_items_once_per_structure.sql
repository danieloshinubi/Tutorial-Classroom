-- A charge appears on a fee structure once.
--
-- Found in testing: picking Tuition in "Add a line" on a structure that
-- already had it added a second Tuition line, and the total went from
-- ₦212,000 to ₦362,000 without a word. Every invoice raised from it would
-- have overcharged each family ₦150,000. The page now leaves charges already
-- on the structure out of the list; this makes the database refuse the
-- duplicate however it arrives.
--
-- Two rules, because a line can be a duplicate two ways:
--   * by name, ignoring case and spacing — covers a charge typed by hand
--     ("tuition" beside "Tuition") as well as one picked from the catalogue,
--     whose line takes the catalogue's label. It also protects
--     raise_invoice(), which picks a structure's optional lines BY NAME: two
--     lines of the same name would be switched on and off together.
--   * by catalogue charge — the same saved charge twice even if its label was
--     renamed in Fees setup in between.
--
-- Checked before writing this: no structure in any school had a duplicate,
-- so both apply cleanly to existing data.

create unique index if not exists fee_items_name_once_per_structure
  on classroom.fee_items (structure_id, lower(btrim(name)));

create unique index if not exists fee_items_charge_once_per_structure
  on classroom.fee_items (structure_id, catalogue_id)
  where catalogue_id is not null;
