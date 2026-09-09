-- =============================================================================
-- Proof that only an approved payment reduces a balance, and that a family
-- cannot approve its own money
--
--   node scripts/sql.js --file supabase/tests/bursary_rls.sql
--
-- Walks a term's fees end to end against the real database as a bursar, a
-- parent, a student, a teacher and an unrelated parent, asserting at each
-- step what each of them can read and do — then ROLLS BACK.
--
-- The rows that matter most:
--   "family reads a DRAFT invoice"        must be 0
--   "balance after the parent declares"   must be unchanged
--   "parent approves their own payment"   must change 0 rows
--   "teacher reads invoices"              must be 0
-- =============================================================================

begin;

create temp table findings (seq serial, check_name text, expected text, actual text);
grant insert, select on findings to authenticated;
grant usage, select on all sequences in schema pg_temp to authenticated;

do $test$
declare
  school   uuid := '04ade535-8126-4a33-88f1-6723ff0e0032';
  bursar   uuid := '752e52c8-ae23-49bb-b81b-608b7dc81ef9';  -- bursar for this test
  princ    uuid := '9736b18d-7112-44fe-9818-1525e04ef81d';  -- Adetayo, principal
  student  uuid := 'c888275e-a277-4f04-85fd-565fb79e6f58';
  parent   uuid := '7420df02-9305-4fd7-bd5d-09aebf9466ff';
  stranger uuid := '1d21bb42-f43e-4443-b323-d064d53daeae';  -- a parent of nobody here
  sess     uuid;
  term     uuid;
  klass    uuid;
  struct   uuid;
  inv      uuid;
  pay      uuid;
  n        int;
  money    numeric;
  txt      text;
begin
  -- ---------- the stage ----------
  select id into sess from classroom.sessions where school_id = school and is_current limit 1;
  if sess is null then
    select id into sess from classroom.sessions where school_id = school limit 1;
  end if;

  insert into classroom.terms (school_id, session_id, name, position, is_current)
  values (school, sess, 'First Term', 1, true) returning id into term;

  insert into classroom.classes (school_id, session_id, level_year, name)
  values (school, sess, 1, 'JSS 1') returning id into klass;

  insert into classroom.class_students (class_id, student_id) values (klass, student);

  insert into classroom.school_members (school_id, user_id, role, is_active)
  values (school, bursar, 'bursar', true)
  on conflict (school_id, user_id) do update set role = 'bursar', is_active = true;

  insert into classroom.guardian_students (school_id, guardian_id, student_id, relationship)
  values (school, parent, student, 'Father') on conflict do nothing;

  -- ---------- the bursar sets the fees ----------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', bursar, 'role', 'authenticated')::text, true);

  insert into classroom.fee_structures (school_id, session_id, term_id, class_id, name, due_on, created_by)
  values (school, sess, term, klass, 'JSS 1 — First Term', current_date + 30, bursar)
  returning id into struct;

  insert into classroom.fee_items (structure_id, name, amount, is_optional, position) values
    (struct, 'Tuition', 150000, false, 1),
    (struct, 'Books',    25000, false, 2),
    (struct, 'Bus',      40000, true,  3);

  insert into findings (check_name, expected, actual) values
    ('bursar sets a fee structure', '3 items',
     (select count(*)::text || ' items' from classroom.fee_items where structure_id = struct));

  -- optional items are left off unless asked for
  select (classroom.raise_invoice(struct, student)).id into inv;

  select payable into money from classroom.invoice_balances where invoice_id = inv;
  insert into findings (check_name, expected, actual) values
    ('invoice excludes the optional bus fare', '175000', money::text);

  -- ---------- a draft is nobody else's business ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.invoices where id = inv;
  insert into findings (check_name, expected, actual) values
    ('family reads a DRAFT invoice', '0 rows', n || ' rows');

  -- ---------- issued ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', bursar, 'role', 'authenticated')::text, true);
  perform classroom.issue_invoice(inv);

  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.invoices where id = inv;
  insert into findings (check_name, expected, actual) values
    ('family reads it once ISSUED', '1 rows', n || ' rows');

  select count(*) into n from classroom.invoice_items where invoice_id = inv;
  insert into findings (check_name, expected, actual) values
    ('family reads the invoice lines', '2 rows', n || ' rows');

  -- ---------- the parent declares a bank transfer ----------
  insert into classroom.payments (school_id, invoice_id, amount, method, reference, submitted_by)
  values (school, inv, 100000, 'transfer', 'GTB/8891', parent)
  returning id into pay;

  select balance into money from classroom.invoice_balances where invoice_id = inv;
  insert into findings (check_name, expected, actual) values
    ('balance after the parent declares', '175000.00 (unchanged)', money::text || ' (unchanged)');

  select awaiting_approval into money from classroom.invoice_balances where invoice_id = inv;
  insert into findings (check_name, expected, actual) values
    ('it shows as awaiting approval', '100000', money::text);

  -- ---------- and cannot approve it themselves ----------
  -- The WITH CHECK on "families fix a waiting declaration" pins status to
  -- 'submitted', so this does not quietly change nothing — Postgres refuses
  -- the row outright, which is the better of the two outcomes.
  begin
    update classroom.payments set status = 'approved' where id = pay;
    get diagnostics n = row_count;
    insert into findings (check_name, expected, actual) values
      ('parent approves their own payment', 'refused', n || ' rows changed');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('parent approves their own payment', 'refused', 'refused: ' || SQLERRM);
  end;

  begin
    perform classroom.approve_payment(pay);
    insert into findings (check_name, expected, actual) values
      ('parent calls approve_payment', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('parent calls approve_payment', 'refused', 'refused: ' || SQLERRM);
  end;

  -- ---------- nor may anyone else read the school's money ----------
  -- A principal signs off results and has no business in the accounts. An
  -- owner or administrator does run the money, so they are not the test.
  perform set_config('request.jwt.claims',
    json_build_object('sub', princ, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.invoices;
  insert into findings (check_name, expected, actual) values
    ('principal reads invoices', '0 rows', n || ' rows');
  select count(*) into n from classroom.payments;
  insert into findings (check_name, expected, actual) values
    ('principal reads payments', '0 rows', n || ' rows');

  perform set_config('request.jwt.claims',
    json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.invoices;
  insert into findings (check_name, expected, actual) values
    ('an unrelated parent reads invoices', '0 rows', n || ' rows');

  -- ---------- the bursar approves ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', bursar, 'role', 'authenticated')::text, true);

  begin
    perform classroom.reject_payment(pay, '   ');
    insert into findings (check_name, expected, actual) values
      ('reject without a reason', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('reject without a reason', 'refused', 'refused: ' || SQLERRM);
  end;

  perform classroom.approve_payment(pay, 'Seen on the statement');

  select balance into money from classroom.invoice_balances where invoice_id = inv;
  insert into findings (check_name, expected, actual) values
    ('balance after the bursar approves', '75000', money::text);

  select standing into txt from classroom.invoice_balances where invoice_id = inv;
  insert into findings (check_name, expected, actual) values
    ('standing', 'part paid', txt);

  -- ---------- approving twice ----------
  begin
    perform classroom.approve_payment(pay);
    insert into findings (check_name, expected, actual) values
      ('approve the same payment twice', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('approve the same payment twice', 'refused', 'refused: ' || SQLERRM);
  end;

  -- ---------- cancelling an invoice money is attached to ----------
  begin
    perform classroom.cancel_invoice(inv, 'Raised in error');
    insert into findings (check_name, expected, actual) values
      ('cancel an invoice with approved money on it', 'refused', 'ALLOWED');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('cancel an invoice with approved money on it', 'refused', 'refused: ' || SQLERRM);
  end;

  -- ---------- the rest at the desk ----------
  perform classroom.take_payment(inv, 75000, 'cash', 'Receipt 214');

  select balance into money from classroom.invoice_balances where invoice_id = inv;
  select standing into txt   from classroom.invoice_balances where invoice_id = inv;
  insert into findings (check_name, expected, actual) values
    ('balance after cash at the desk', '0.00', money::text),
    ('standing once settled', 'paid', txt);

  -- ---------- what the bursar sees in the morning ----------
  select count(*) into n from classroom.debtors(school, term);
  insert into findings (check_name, expected, actual) values
    ('debtors once it is settled', '0 rows', n || ' rows');

  select collection_rate into money from classroom.collection_summary(school, term);
  insert into findings (check_name, expected, actual) values
    ('collection rate', '100.0', money::text);

  -- and with a second, unpaid invoice on the books
  select (classroom.raise_invoice(struct, 'aa1c645f-c1d0-4a90-8cf2-4f9459af1bf7')).id into inv;
  perform classroom.issue_invoice(inv);

  select collection_rate into money from classroom.collection_summary(school, term);
  insert into findings (check_name, expected, actual) values
    ('collection rate with one unpaid', '50.0', money::text);

  select count(*) into n from classroom.debtors(school, term);
  insert into findings (check_name, expected, actual) values
    ('debtors with one unpaid', '1 rows', n || ' rows');

  select balance into money from classroom.debtors(school, term);
  insert into findings (check_name, expected, actual) values
    ('what that debtor owes', '175000', money::text);

  -- ---------- a family sees only their own child ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', parent, 'role', 'authenticated')::text, true);
  select count(*) into n from classroom.invoice_balances
  where not exists (
    select 1 from classroom.guardian_students g
    where g.student_id = invoice_balances.student_id and g.guardian_id = parent
  );
  insert into findings (check_name, expected, actual) values
    ('parent reads a child who is not theirs', '0 rows', n || ' rows');

  -- debtors() is SECURITY DEFINER, so the guard is inside it: without
  -- bursary rights the WHERE eliminates every row.
  begin
    select count(*) into n from classroom.debtors(school, term);
    insert into findings (check_name, expected, actual) values
      ('parent runs the debtors list', '0 rows', n || ' rows');
  exception when others then
    insert into findings (check_name, expected, actual) values
      ('parent runs the debtors list', '0 rows', 'refused: ' || SQLERRM);
  end;

  select coalesce(collection_rate::text, 'null') into txt
  from classroom.collection_summary(school, term);
  insert into findings (check_name, expected, actual) values
    ('parent runs the collection summary', 'null', txt);

  reset role;
end;
$test$;

select check_name, expected, actual,
       case when actual like expected || '%' or actual like 'refused%' then 'PASS' else 'FAIL' end as verdict
from findings order by seq;

rollback;
