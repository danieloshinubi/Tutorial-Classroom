-- Phase 4: Accounts. Double-entry books kept by the events themselves.
--
-- What it is:
--   chart_of_accounts   a school's own accounts, seeded with a starter set a
--                       school can rename and add to. The accounts postings
--                       depend on carry a system_key and cannot be switched
--                       off or change type.
--   journal_entries     one per event (a bill issued, a payment approved, a
--   journal_lines       store sale...) or per manual journal. Every entry
--                       balances: debits equal credits, checked when the
--                       transaction commits. Entries are never edited or
--                       deleted; a correction is a reversing entry, so the
--                       books keep their own audit trail. (The one exception
--                       is the opening balances entry, which is replaced as a
--                       whole while a school is still entering it.)
--   accounting_settings the date the books start from. Events before it are
--                       summed up by the opening balances instead.
--
-- Postings are made by triggers on the tables events happen in, not by
-- editing each function that causes them: a payment alone is approved by
-- four different routes (approve_payment, take_payment, settle_online_payment,
-- and admissions), and a trigger catches all of them. Each posting runs in
-- the same transaction as its event, and each (event, source) is posted at
-- most once (a unique key), so posting again, or catching up with
-- accounting_backfill, can never double-count.
--
-- The rules (accrual basis):
--   bill issued      Dr Fees receivable (net)  Dr Fee discounts (discount)
--                    Cr the income account for its purpose (gross)
--   bill cancelled   the same, reversed, on the day it was cancelled
--   payment approved Dr Bank, or Cash for cash, or Fee discounts for a waiver
--                    Cr Fees receivable
--   store sale       counter sale: Dr Cash/Bank  Cr Store sales
--                    every sale:   Dr Cost of store goods  Cr Store stock
--                    (a sale on the family's bill earns its income through
--                    that bill, when it is issued, so it is not counted twice)
--   store sale void  the sale's entries, reversed
--   restock          Dr Store stock  Cr Bank (or Cash, or Suppliers: a setting)
--   stock count      Dr/Cr Store stock losses against Store stock, at cost
--
-- Payroll (Phase 3) will post Salaries, PAYE and pension through the same
-- acct_post; its accounts are seeded here already.
--
-- Visible to Charismartin only for now, like the Store.

-- ---------------------------------------------------------------- tables --

create table if not exists classroom.accounting_settings (
  school_id uuid primary key references classroom.schools(id) on delete cascade,
  start_date date not null,
  -- Where a store restock's cost is paid from, when the restock does not say.
  restock_paid_from text not null default 'bank'
    check (restock_paid_from in ('bank', 'cash', 'payables')),
  created_by uuid references classroom.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists classroom.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  -- Set on the accounts postings are made to. Unique per school.
  system_key text,
  description text,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chart_code_once unique (school_id, code),
  constraint chart_key_once unique (school_id, system_key)
);

create table if not exists classroom.journal_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools(id) on delete cascade,
  entry_date date not null,
  memo text not null,
  -- invoice | payment | store_sale | store_stock | manual | opening | reversal
  source_type text not null,
  source_id uuid,
  -- issue | cancel | approve | sale | void | restock | adjustment | ...
  source_event text,
  reverses uuid references classroom.journal_entries(id),
  reversed_by uuid references classroom.journal_entries(id),
  created_by uuid references classroom.profiles(id),
  created_at timestamptz not null default now()
);

-- One posting per event per source: the guarantee against double counting.
create unique index if not exists journal_once_per_event
  on classroom.journal_entries (school_id, source_type, source_id, source_event)
  where source_id is not null;
create index if not exists journal_entries_date on classroom.journal_entries (school_id, entry_date);

create table if not exists classroom.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references classroom.journal_entries(id) on delete cascade,
  school_id uuid not null references classroom.schools(id) on delete cascade,
  account_id uuid not null references classroom.chart_of_accounts(id),
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  memo text,
  position int not null default 0,
  constraint journal_line_one_side check (
    debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0))
  )
);
create index if not exists journal_lines_entry on classroom.journal_lines (entry_id);
create index if not exists journal_lines_account on classroom.journal_lines (school_id, account_id);

-- ----------------------------------------------- balance and immutability --

-- Every entry balances, checked once the whole transaction is done (lines go
-- in one at a time, so a row-by-row check would fail on the first line).
create or replace function classroom.journal_entry_balances()
returns trigger
language plpgsql
-- Definer: it must see every line of the entry, whoever caused the posting
-- (row security would hide them from, say, a parent paying online).
security definer
set search_path to 'classroom', 'public'
as $$
declare
  target uuid := coalesce(new.entry_id, old.entry_id);
  dr numeric;
  cr numeric;
  n int;
begin
  if not exists (select 1 from classroom.journal_entries where id = target) then
    return null; -- the entry itself was removed (opening balances replaced)
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into dr, cr, n
  from classroom.journal_lines where entry_id = target;
  if n < 2 then
    raise exception 'A journal entry needs at least two lines';
  end if;
  if dr <> cr then
    raise exception 'Journal entry does not balance: debits % and credits %', dr, cr;
  end if;
  return null;
end;
$$;

drop trigger if exists journal_lines_balance on classroom.journal_lines;
create constraint trigger journal_lines_balance
  after insert or update or delete on classroom.journal_lines
  deferrable initially deferred
  for each row execute function classroom.journal_entry_balances();

-- Posted books are not edited. Only this migration's own functions may, and
-- only for the two things they need: marking an entry as reversed, and
-- replacing the opening balances entry. They set classroom.acct_write.
create or replace function classroom.journal_guard()
returns trigger
language plpgsql
set search_path to 'classroom', 'public'
as $$
begin
  if coalesce(current_setting('classroom.acct_write', true), '') <> 'on' then
    raise exception 'Posted journal entries cannot be changed. Post a reversing entry instead.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists journal_entries_guard on classroom.journal_entries;
create trigger journal_entries_guard
  before update or delete on classroom.journal_entries
  for each row execute function classroom.journal_guard();

drop trigger if exists journal_lines_guard on classroom.journal_lines;
create trigger journal_lines_guard
  before update or delete on classroom.journal_lines
  for each row execute function classroom.journal_guard();

-- System accounts keep their type and stay on: postings depend on them.
create or replace function classroom.chart_guard()
returns trigger
language plpgsql
set search_path to 'classroom', 'public'
as $$
begin
  if old.system_key is not null then
    if new.type <> old.type then
      raise exception '% is used by automatic postings, so its type cannot change', old.name;
    end if;
    if not new.is_active then
      raise exception '% is used by automatic postings, so it cannot be switched off', old.name;
    end if;
    new.system_key := old.system_key;
  end if;
  new.name := classroom.tidy_spaces(new.name);
  new.code := classroom.tidy_spaces(new.code);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists chart_of_accounts_guard on classroom.chart_of_accounts;
create trigger chart_of_accounts_guard
  before update on classroom.chart_of_accounts
  for each row execute function classroom.chart_guard();

-- --------------------------------------------------------------- helpers --

-- The school's own calendar day for a moment in time.
create or replace function classroom.acct_local_date(target_school uuid, at timestamptz)
returns date
language sql
stable
set search_path to 'classroom', 'public'
as $$
  select (at at time zone coalesce((select timezone from classroom.schools where id = target_school), 'Africa/Lagos'))::date;
$$;

-- Are the books open for this school on this day?
create or replace function classroom.acct_enabled(target_school uuid, on_date date)
returns boolean
language sql
stable
set search_path to 'classroom', 'public'
as $$
  select exists (
    select 1 from classroom.accounting_settings s
    where s.school_id = target_school and on_date >= s.start_date
  );
$$;

-- Swap the sides of a set of lines: the reversal of a posting.
create or replace function classroom.acct_swap(lines jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    (l - 'debit' - 'credit')
      || jsonb_build_object('debit', coalesce((l ->> 'credit')::numeric, 0),
                            'credit', coalesce((l ->> 'debit')::numeric, 0))
  ), '[]'::jsonb)
  from jsonb_array_elements(lines) l;
$$;

-- The one place an entry is written. lines: [{key | account_id, debit,
-- credit, memo}], by system key or by account. Lines of zero are dropped; if
-- nothing is left there is nothing to post. Returns the entry, or the one
-- already posted for this (source, event).
create or replace function classroom.acct_post(
  target_school uuid,
  on_date date,
  memo_in text,
  src_type text,
  src_id uuid,
  src_event text,
  post_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  entry uuid;
  line jsonb;
  acct uuid;
  pos int := 0;
  dr numeric;
  cr numeric;
begin
  if not exists (
    select 1 from jsonb_array_elements(post_lines) l
    where coalesce((l ->> 'debit')::numeric, 0) <> 0 or coalesce((l ->> 'credit')::numeric, 0) <> 0
  ) then
    return null;
  end if;

  insert into classroom.journal_entries
    (school_id, entry_date, memo, source_type, source_id, source_event, created_by)
  values (target_school, on_date, memo_in, src_type, src_id, src_event, auth.uid())
  on conflict (school_id, source_type, source_id, source_event) where source_id is not null
  do nothing
  returning id into entry;

  if entry is null then
    select id into entry from classroom.journal_entries j
    where j.school_id = target_school and j.source_type = src_type
      and j.source_id = src_id and j.source_event = src_event;
    return entry;
  end if;

  for line in select * from jsonb_array_elements(post_lines)
  loop
    dr := round(coalesce((line ->> 'debit')::numeric, 0), 2);
    cr := round(coalesce((line ->> 'credit')::numeric, 0), 2);
    continue when dr = 0 and cr = 0;

    if line ? 'account_id' then
      select id into acct from classroom.chart_of_accounts
      where id = (line ->> 'account_id')::uuid and school_id = target_school;
    else
      select id into acct from classroom.chart_of_accounts
      where school_id = target_school and system_key = line ->> 'key';
    end if;
    if acct is null then
      raise exception 'No account % in this school''s chart of accounts', coalesce(line ->> 'key', line ->> 'account_id');
    end if;

    -- A negative amount on one side is a positive one on the other.
    if dr < 0 then cr := cr - dr; dr := 0; end if;
    if cr < 0 then dr := dr - cr; cr := 0; end if;
    -- Both sides on one line: keep the difference.
    if dr > 0 and cr > 0 then
      if dr >= cr then dr := dr - cr; cr := 0; else cr := cr - dr; dr := 0; end if;
      continue when dr = 0 and cr = 0;
    end if;

    pos := pos + 1;
    insert into classroom.journal_lines (entry_id, school_id, account_id, debit, credit, memo, position)
    values (entry, target_school, acct, dr, cr, nullif(btrim(coalesce(line ->> 'memo', '')), ''), pos);
  end loop;

  return entry;
end;
$$;

-- ------------------------------------------------------ the starter chart --

create or replace function classroom.acct_seed_chart(target_school uuid)
returns void
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
begin
  insert into classroom.chart_of_accounts (school_id, code, name, type, system_key, description, position)
  select target_school, a.code, a.name, a.type, a.system_key, a.description, a.pos
  from (values
    ('1010', 'Cash in hand',                    'asset',     'cash',            'Cash payments and counter sales paid in cash.', 10),
    ('1020', 'Bank',                            'asset',     'bank',            'Transfers, POS, cheques and online payments.', 20),
    ('1100', 'Fees receivable',                 'asset',     'receivables',     'What families owe on issued bills.', 30),
    ('1200', 'Store stock',                     'asset',     'inventory',       'Uniforms, books and stationery on hand, at cost.', 40),
    ('1300', 'Prepayments',                     'asset',     null,              null, 50),
    ('1500', 'Land and buildings',              'asset',     null,              null, 60),
    ('1510', 'Furniture and equipment',         'asset',     null,              null, 70),
    ('1520', 'Motor vehicles',                  'asset',     null,              null, 80),
    ('1590', 'Accumulated depreciation',        'asset',     null,              'Reduces the fixed assets above; carries a credit balance.', 90),
    ('2010', 'Suppliers (accounts payable)',    'liability', 'payables',        'What the school owes suppliers.', 110),
    ('2100', 'PAYE payable',                    'liability', 'paye_payable',    'Tax deducted from staff pay, due to the state tax office.', 120),
    ('2110', 'Pension payable',                 'liability', 'pension_payable', 'Employee and employer pension, due to the PFAs.', 130),
    ('2120', 'Withholding tax payable',         'liability', 'wht_payable',     null, 140),
    ('2200', 'Accruals',                        'liability', null,              null, 150),
    ('2300', 'Loans',                           'liability', null,              null, 160),
    ('3010', 'Proprietor''s capital',           'equity',    null,              null, 210),
    ('3020', 'Retained earnings',               'equity',    'retained',        'Surpluses from earlier periods.', 220),
    ('3030', 'Opening balance equity',          'equity',    'opening_equity',  'Balances the opening entry; move it to capital or retained earnings once settled.', 230),
    ('4010', 'Tuition and school fees',         'income',    'income_fees',     'Term bills.', 310),
    ('4020', 'Admission fees',                  'income',    'income_admission','Application and acceptance fees.', 320),
    ('4030', 'Other fees and charges',          'income',    'income_other',    'Extra charges billed on their own.', 330),
    ('4040', 'Store sales',                     'income',    'income_store',    null, 340),
    ('4090', 'Fee discounts and waivers',       'income',    'discounts',       'Reduces fee income; carries a debit balance.', 350),
    ('4900', 'Other income',                    'income',    null,              null, 360),
    ('5010', 'Cost of store goods sold',        'expense',   'cogs',            null, 410),
    ('5020', 'Store stock losses',              'expense',   'stock_loss',      'Damaged, lost or miscounted stock.', 420),
    ('5100', 'Salaries and wages',              'expense',   'salaries',        null, 430),
    ('5110', 'Employer pension contribution',   'expense',   'pension_expense', null, 440),
    ('5200', 'Rent',                            'expense',   null,              null, 450),
    ('5210', 'Electricity, water and diesel',   'expense',   null,              null, 460),
    ('5220', 'Repairs and maintenance',         'expense',   null,              null, 470),
    ('5230', 'Teaching and learning materials', 'expense',   null,              null, 480),
    ('5240', 'Examination fees (WAEC, NECO)',   'expense',   null,              null, 490),
    ('5250', 'Transport',                       'expense',   null,              null, 500),
    ('5260', 'Printing and stationery',         'expense',   null,              null, 510),
    ('5270', 'Bank charges',                    'expense',   'bank_charges',    null, 520),
    ('5280', 'Depreciation',                    'expense',   null,              null, 530),
    ('5900', 'General expenses',                'expense',   null,              null, 590)
  ) as a(code, name, type, system_key, description, pos)
  on conflict do nothing;
end;
$$;

-- ------------------------------------------------------------- postings --

-- The lines for a bill, as issued. Its cancellation is these, swapped.
create or replace function classroom.acct_invoice_lines(target_invoice uuid)
returns jsonb
language sql
stable
set search_path to 'classroom', 'public'
as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'receivables', 'debit', gross - i.discount),
    jsonb_build_object('key', 'discounts', 'debit', i.discount),
    jsonb_build_object('key',
      case coalesce(i.purpose, 'term_fee')
        when 'term_fee' then 'income_fees'
        when 'application_fee' then 'income_admission'
        when 'acceptance_fee' then 'income_admission'
        when 'store' then 'income_store'
        else 'income_other'
      end,
      'credit', gross)
  )
  from classroom.invoices i
  cross join lateral (
    select coalesce(sum(amount), 0) as gross from classroom.invoice_items where invoice_id = i.id
  ) g
  where i.id = target_invoice;
$$;

create or replace function classroom.acct_invoice_label(target_invoice uuid)
returns text
language sql
stable
set search_path to 'classroom', 'public'
as $$
  select concat_ws(' — ',
    'Bill ' || coalesce(i.reference, 'without a reference'),
    coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
      classroom.invoice_applicant_name(i.id)
    ))
  from classroom.invoices i
  left join classroom.profiles p on p.id = i.student_id
  where i.id = target_invoice;
$$;

create or replace function classroom.acct_post_invoice(target_invoice uuid, event text)
returns void
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  inv classroom.invoices;
  on_date date;
  lines jsonb;
begin
  select * into inv from classroom.invoices where id = target_invoice;
  if not found then return; end if;
  on_date := classroom.acct_local_date(inv.school_id,
    case when event = 'issue' then coalesce(inv.issued_at, now()) else coalesce(inv.cancelled_at, now()) end);
  if not classroom.acct_enabled(inv.school_id, on_date) then return; end if;

  lines := classroom.acct_invoice_lines(target_invoice);
  if event = 'cancel' then lines := classroom.acct_swap(lines); end if;

  perform classroom.acct_post(inv.school_id, on_date,
    classroom.acct_invoice_label(target_invoice) || case when event = 'issue' then ' issued' else ' cancelled' end,
    'invoice', target_invoice, event, lines);
end;
$$;

create or replace function classroom.acct_post_payment(target_payment uuid)
returns void
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  pay classroom.payments;
  on_date date;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found or pay.status <> 'approved' then return; end if;
  on_date := coalesce(pay.paid_on, classroom.acct_local_date(pay.school_id, coalesce(pay.decided_at, now())));
  if not classroom.acct_enabled(pay.school_id, on_date) then return; end if;

  perform classroom.acct_post(pay.school_id, on_date,
    concat_ws(' · ',
      case pay.method when 'waiver' then 'Waiver' else 'Payment' end
        || ' on ' || coalesce(classroom.acct_invoice_label(pay.invoice_id), 'a bill'),
      initcap(pay.method::text),
      nullif(btrim(coalesce(pay.reference, '')), '')),
    'payment', target_payment, 'approve',
    jsonb_build_array(
      jsonb_build_object('key',
        case pay.method when 'cash' then 'cash' when 'waiver' then 'discounts' else 'bank' end,
        'debit', pay.amount),
      jsonb_build_object('key', 'receivables', 'credit', pay.amount)
    ));
end;
$$;

-- A store sale as sold. Its void is these, swapped.
create or replace function classroom.acct_store_sale_lines(target_sale uuid)
returns jsonb
language sql
stable
set search_path to 'classroom', 'public'
as $$
  select jsonb_build_array(
    -- A counter sale is paid now; one on the family's bill earns its income
    -- when that bill is issued (acct_post_invoice), so nothing here for it.
    jsonb_build_object('key', case s.payment when 'cash' then 'cash' else 'bank' end,
      'debit', case when s.payment = 'account' then 0 else s.total end),
    jsonb_build_object('key', 'income_store',
      'credit', case when s.payment = 'account' then 0 else s.total end),
    jsonb_build_object('key', 'cogs', 'debit', s.cost_total),
    jsonb_build_object('key', 'inventory', 'credit', s.cost_total)
  )
  from classroom.store_sales s where s.id = target_sale;
$$;

create or replace function classroom.acct_post_store_sale(target_sale uuid, event text)
returns void
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  sale classroom.store_sales;
  on_date date;
  lines jsonb;
begin
  select * into sale from classroom.store_sales where id = target_sale;
  if not found then return; end if;
  on_date := classroom.acct_local_date(sale.school_id,
    case when event = 'sale' then sale.sold_at else coalesce(sale.voided_at, now()) end);
  if not classroom.acct_enabled(sale.school_id, on_date) then return; end if;

  lines := classroom.acct_store_sale_lines(target_sale);
  if event = 'void' then lines := classroom.acct_swap(lines); end if;

  perform classroom.acct_post(sale.school_id, on_date,
    concat_ws(' — ', 'Store sale ' || sale.reference, sale.buyer_name)
      || case when event = 'void' then ' voided' else '' end,
    'store_sale', target_sale, event, lines);
end;
$$;

create or replace function classroom.acct_post_stock_movement(target_movement uuid)
returns void
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  m classroom.store_stock_movements;
  p classroom.store_products;
  on_date date;
  amount numeric;
  paid_from text;
  label text;
begin
  select * into m from classroom.store_stock_movements where id = target_movement;
  if not found or m.kind not in ('restock', 'adjustment') then return; end if;
  on_date := classroom.acct_local_date(m.school_id, m.created_at);
  if not classroom.acct_enabled(m.school_id, on_date) then return; end if;
  select * into p from classroom.store_products where id = m.product_id;
  label := p.name || coalesce(' (' || p.size || ')', '');

  if m.kind = 'restock' then
    amount := m.qty * greatest(coalesce(m.unit_cost, p.cost_price, 0) - coalesce(m.unit_discount, p.trade_discount, 0), 0);
    select restock_paid_from into paid_from from classroom.accounting_settings where school_id = m.school_id;
    perform classroom.acct_post(m.school_id, on_date,
      format('Restock: %s × %s', m.qty, label),
      'store_stock', target_movement, 'restock',
      jsonb_build_array(
        jsonb_build_object('key', 'inventory', 'debit', amount),
        jsonb_build_object('key', coalesce(paid_from, 'bank'), 'credit', amount)
      ));
  else
    amount := abs(m.qty) * coalesce(p.net_cost, 0);
    perform classroom.acct_post(m.school_id, on_date,
      format('Stock count: %s %s %s', label, case when m.qty < 0 then 'down' else 'up' end, abs(m.qty)),
      'store_stock', target_movement, 'adjustment',
      case when m.qty < 0 then
        jsonb_build_array(
          jsonb_build_object('key', 'stock_loss', 'debit', amount),
          jsonb_build_object('key', 'inventory', 'credit', amount))
      else
        jsonb_build_array(
          jsonb_build_object('key', 'inventory', 'debit', amount),
          jsonb_build_object('key', 'stock_loss', 'credit', amount))
      end);
  end if;
end;
$$;

-- ------------------------------------------------------------- triggers --

create or replace function classroom.acct_on_invoice()
returns trigger
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
begin
  if new.status = 'issued' and (tg_op = 'INSERT' or old.status is distinct from 'issued') then
    perform classroom.acct_post_invoice(new.id, 'issue');
  elsif new.status = 'cancelled' and tg_op = 'UPDATE' and old.status = 'issued' then
    perform classroom.acct_post_invoice(new.id, 'cancel');
  end if;
  return null;
end;
$$;

drop trigger if exists invoices_post_to_books on classroom.invoices;
create trigger invoices_post_to_books
  after insert or update of status on classroom.invoices
  for each row execute function classroom.acct_on_invoice();

create or replace function classroom.acct_on_payment()
returns trigger
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    perform classroom.acct_post_payment(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists payments_post_to_books on classroom.payments;
create trigger payments_post_to_books
  after insert or update of status on classroom.payments
  for each row execute function classroom.acct_on_payment();

create or replace function classroom.acct_on_store_sale()
returns trigger
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
begin
  if tg_op = 'INSERT' then
    perform classroom.acct_post_store_sale(new.id, 'sale');
  elsif new.voided_at is not null and old.voided_at is null then
    perform classroom.acct_post_store_sale(new.id, 'void');
  end if;
  return null;
end;
$$;

drop trigger if exists store_sales_post_to_books on classroom.store_sales;
create trigger store_sales_post_to_books
  after insert or update of voided_at on classroom.store_sales
  for each row execute function classroom.acct_on_store_sale();

create or replace function classroom.acct_on_stock_movement()
returns trigger
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
begin
  perform classroom.acct_post_stock_movement(new.id);
  return null;
end;
$$;

drop trigger if exists store_stock_post_to_books on classroom.store_stock_movements;
create trigger store_stock_post_to_books
  after insert on classroom.store_stock_movements
  for each row execute function classroom.acct_on_stock_movement();

-- ------------------------------------------------ catch up since the start --

-- Posts every event since the start date that is not in the books yet. Safe
-- to run any number of times: an event is posted once (journal_once_per_event).
create or replace function classroom.accounting_backfill(target_school uuid)
returns int
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  before_n int;
  after_n int;
  r record;
begin
  if not classroom.can_do_bursary(target_school) then
    raise exception 'Only the bursary can keep the books';
  end if;
  select count(*) into before_n from classroom.journal_entries where school_id = target_school;

  for r in select id, status, issued_at, cancelled_at from classroom.invoices
           where school_id = target_school and issued_at is not null
  loop
    perform classroom.acct_post_invoice(r.id, 'issue');
    if r.status = 'cancelled' then perform classroom.acct_post_invoice(r.id, 'cancel'); end if;
  end loop;

  for r in select id from classroom.payments where school_id = target_school and status = 'approved'
  loop
    perform classroom.acct_post_payment(r.id);
  end loop;

  for r in select id, voided_at from classroom.store_sales where school_id = target_school
  loop
    perform classroom.acct_post_store_sale(r.id, 'sale');
    if r.voided_at is not null then perform classroom.acct_post_store_sale(r.id, 'void'); end if;
  end loop;

  for r in select id from classroom.store_stock_movements
           where school_id = target_school and kind in ('restock', 'adjustment')
  loop
    perform classroom.acct_post_stock_movement(r.id);
  end loop;

  select count(*) into after_n from classroom.journal_entries where school_id = target_school;
  return after_n - before_n;
end;
$$;

-- ---------------------------------------------------- what the page calls --

-- Open the books: the start date, the starter chart, and every event since.
-- The start date can move until anything other than the opening balances has
-- been posted; after that it is fixed, since moving it would drop or re-add
-- events.
create or replace function classroom.accounting_setup(
  target_school uuid,
  start_on date,
  restock_from text default 'bank'
)
returns int
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  cur_settings classroom.accounting_settings;
begin
  if not classroom.can_do_bursary(target_school) then
    raise exception 'Only the bursary can keep the books';
  end if;
  if start_on is null then
    raise exception 'Choose the date the books start from';
  end if;
  if restock_from not in ('bank', 'cash', 'payables') then
    raise exception 'Restocks are paid from bank, cash or suppliers';
  end if;

  select * into cur_settings from classroom.accounting_settings where school_id = target_school;
  if found then
    if cur_settings.start_date <> start_on and exists (
      select 1 from classroom.journal_entries
      where school_id = target_school and source_type <> 'opening'
    ) then
      raise exception 'The books already have entries from %; the start date cannot move now', to_char(cur_settings.start_date, 'FMDD Mon YYYY');
    end if;
    update classroom.accounting_settings
    set start_date = start_on, restock_paid_from = restock_from, updated_at = now()
    where school_id = target_school;
    -- The opening entry is dated on the start date.
    perform set_config('classroom.acct_write', 'on', true);
    update classroom.journal_entries set entry_date = start_on
    where school_id = target_school and source_type = 'opening';
    perform set_config('classroom.acct_write', 'off', true);
  else
    insert into classroom.accounting_settings (school_id, start_date, restock_paid_from, created_by)
    values (target_school, start_on, restock_from, auth.uid());
  end if;

  perform classroom.acct_seed_chart(target_school);
  return classroom.accounting_backfill(target_school);
end;
$$;

-- Add or change an account. System accounts can be renamed and renumbered,
-- not retyped or switched off (chart_guard).
create or replace function classroom.save_account(
  target_school uuid,
  target_account uuid,
  code_in text,
  name_in text,
  type_in text,
  description_in text default null,
  active_in boolean default true
)
returns classroom.chart_of_accounts
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  acct_row classroom.chart_of_accounts;
begin
  if not classroom.can_do_bursary(target_school) then
    raise exception 'Only the bursary can change the chart of accounts';
  end if;
  if btrim(coalesce(code_in, '')) = '' or btrim(coalesce(name_in, '')) = '' then
    raise exception 'An account needs a code and a name';
  end if;
  if exists (select 1 from classroom.chart_of_accounts
             where school_id = target_school and lower(code) = lower(classroom.tidy_spaces(code_in))
               and id is distinct from target_account) then
    raise exception 'Account code % is already in use', classroom.tidy_spaces(code_in);
  end if;

  if target_account is null then
    insert into classroom.chart_of_accounts (school_id, code, name, type, description, is_active, position)
    values (target_school, classroom.tidy_spaces(code_in), classroom.tidy_spaces(name_in), type_in,
            nullif(btrim(coalesce(description_in, '')), ''), coalesce(active_in, true),
            coalesce((select max(position) from classroom.chart_of_accounts where school_id = target_school), 0) + 10)
    returning * into acct_row;
  else
    update classroom.chart_of_accounts
    set code = code_in, name = name_in, type = type_in,
        description = nullif(btrim(coalesce(description_in, '')), ''),
        is_active = coalesce(active_in, true)
    where id = target_account and school_id = target_school
    returning * into acct_row;
    if not found then raise exception 'No such account'; end if;
  end if;
  return acct_row;
end;
$$;

-- A journal typed by hand: rent paid, a loan received, depreciation...
-- lines: [{account_id, debit, credit, memo}]. It must balance, and use live
-- accounts, on or after the start date.
create or replace function classroom.post_manual_journal(
  target_school uuid,
  entry_on date,
  memo_in text,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  settings classroom.accounting_settings;
  dr numeric;
  cr numeric;
  entry uuid;
begin
  if not classroom.can_do_bursary(target_school) then
    raise exception 'Only the bursary can post journals';
  end if;
  select * into settings from classroom.accounting_settings where school_id = target_school;
  if not found then raise exception 'Set up the books first'; end if;
  if entry_on is null or entry_on < settings.start_date then
    raise exception 'A journal must be dated on or after the books'' start date, %', to_char(settings.start_date, 'FMDD Mon YYYY');
  end if;
  if btrim(coalesce(memo_in, '')) = '' then
    raise exception 'Say what the journal is for';
  end if;
  if exists (
    select 1 from jsonb_array_elements(lines) l
    left join classroom.chart_of_accounts a on a.id = (l ->> 'account_id')::uuid and a.school_id = target_school
    where (coalesce((l ->> 'debit')::numeric, 0) > 0 or coalesce((l ->> 'credit')::numeric, 0) > 0)
      and (a.id is null or not a.is_active)
  ) then
    raise exception 'Every line needs one of this school''s accounts that is switched on';
  end if;
  select coalesce(sum(round(coalesce((l ->> 'debit')::numeric, 0), 2)), 0),
         coalesce(sum(round(coalesce((l ->> 'credit')::numeric, 0), 2)), 0)
    into dr, cr
  from jsonb_array_elements(lines) l;
  if dr = 0 then raise exception 'A journal needs amounts'; end if;
  if dr <> cr then
    raise exception 'Debits (%) and credits (%) must be equal', dr, cr;
  end if;

  entry := classroom.acct_post(target_school, entry_on, btrim(memo_in), 'manual', gen_random_uuid(), 'post', lines);
  return entry;
end;
$$;

-- Undo a journal typed by hand, with one that mirrors it. Automatic entries
-- are undone by their own event (cancel the bill, void the sale), so the books
-- and the bursary never disagree.
create or replace function classroom.reverse_journal(target_entry uuid, reason text, entry_on date default null)
returns uuid
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  e classroom.journal_entries;
  settings classroom.accounting_settings;
  lines jsonb;
  on_date date;
  rev uuid;
begin
  select * into e from classroom.journal_entries where id = target_entry;
  if not found then raise exception 'No such journal entry'; end if;
  if not classroom.can_do_bursary(e.school_id) then
    raise exception 'Only the bursary can reverse journals';
  end if;
  if e.source_type <> 'manual' then
    raise exception 'This entry was made by the system. Undo the event itself (cancel the bill, void the sale) and the books follow.';
  end if;
  if e.reversed_by is not null then raise exception 'That journal has already been reversed'; end if;
  if btrim(coalesce(reason, '')) = '' then raise exception 'Say why the journal is being reversed'; end if;
  select * into settings from classroom.accounting_settings where school_id = e.school_id;
  on_date := coalesce(entry_on, classroom.acct_local_date(e.school_id, now()));
  if on_date < settings.start_date then on_date := settings.start_date; end if;

  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit, 'credit', debit, 'memo', memo) order by position)
    into lines from classroom.journal_lines where entry_id = target_entry;

  rev := classroom.acct_post(e.school_id, on_date,
    format('Reversal of "%s": %s', e.memo, btrim(reason)), 'reversal', target_entry, 'reverse', lines);

  perform set_config('classroom.acct_write', 'on', true);
  update classroom.journal_entries set reverses = target_entry where id = rev;
  update classroom.journal_entries set reversed_by = rev where id = target_entry;
  perform set_config('classroom.acct_write', 'off', true);
  return rev;
end;
$$;

-- The school's position on the start date. lines: [{account_id, debit,
-- credit}]. Replaces the whole opening entry each time it is saved; whatever
-- does not balance goes to Opening balance equity, so the entry always does.
create or replace function classroom.save_opening_balances(target_school uuid, lines jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $$
declare
  settings classroom.accounting_settings;
  dr numeric;
  cr numeric;
  entry uuid;
  equity uuid;
begin
  if not classroom.can_do_bursary(target_school) then
    raise exception 'Only the bursary can enter opening balances';
  end if;
  select * into settings from classroom.accounting_settings where school_id = target_school;
  if not found then raise exception 'Set up the books first'; end if;
  select id into equity from classroom.chart_of_accounts where school_id = target_school and system_key = 'opening_equity';

  if exists (
    select 1 from jsonb_array_elements(lines) l
    left join classroom.chart_of_accounts a on a.id = (l ->> 'account_id')::uuid and a.school_id = target_school
    where (coalesce((l ->> 'debit')::numeric, 0) <> 0 or coalesce((l ->> 'credit')::numeric, 0) <> 0) and a.id is null
  ) then
    raise exception 'Every balance needs one of this school''s accounts';
  end if;

  perform set_config('classroom.acct_write', 'on', true);
  delete from classroom.journal_entries where school_id = target_school and source_type = 'opening';
  perform set_config('classroom.acct_write', 'off', true);

  select coalesce(sum(round(coalesce((l ->> 'debit')::numeric, 0), 2)), 0),
         coalesce(sum(round(coalesce((l ->> 'credit')::numeric, 0), 2)), 0)
    into dr, cr
  from jsonb_array_elements(lines) l
  where (l ->> 'account_id')::uuid is distinct from equity;

  entry := classroom.acct_post(target_school, settings.start_date, 'Opening balances', 'opening', target_school, 'open',
    coalesce((select jsonb_agg(l) from jsonb_array_elements(lines) l
              where (l ->> 'account_id')::uuid is distinct from equity), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('account_id', equity,
         'debit', greatest(cr - dr, 0), 'credit', greatest(dr - cr, 0),
         'memo', 'Balances the opening entry')));
  return entry;
end;
$$;

-- ---------------------------------------------------------------- reports --

-- Every account's movement over a period: what it stood at before (opening),
-- debits and credits within, and where it closed. Signed debit-minus-credit;
-- the page turns that into the account's normal side. from_date null = from
-- the beginning; to_date null = to date.
create or replace function classroom.account_balances(target_school uuid, from_date date default null, to_date date default null)
returns table (
  account_id uuid, code text, name text, type text, system_key text, is_active boolean, description text,
  opening numeric, debit numeric, credit numeric, closing numeric
)
language sql
stable
security invoker
set search_path to 'classroom', 'public'
as $$
  select a.id, a.code, a.name, a.type, a.system_key, a.is_active, a.description,
         coalesce(sum(l.debit - l.credit) filter (where from_date is not null and e.entry_date < from_date), 0) as opening,
         coalesce(sum(l.debit) filter (where (from_date is null or e.entry_date >= from_date) and (to_date is null or e.entry_date <= to_date)), 0) as debit,
         coalesce(sum(l.credit) filter (where (from_date is null or e.entry_date >= from_date) and (to_date is null or e.entry_date <= to_date)), 0) as credit,
         coalesce(sum(l.debit - l.credit) filter (where to_date is null or e.entry_date <= to_date), 0) as closing
  from classroom.chart_of_accounts a
  left join classroom.journal_lines l on l.account_id = a.id
  left join classroom.journal_entries e on e.id = l.entry_id
  where a.school_id = target_school
  group by a.id
  order by a.code;
$$;

-- ---------------------------------------------------------------- access --

alter table classroom.accounting_settings enable row level security;
alter table classroom.chart_of_accounts enable row level security;
alter table classroom.journal_entries enable row level security;
alter table classroom.journal_lines enable row level security;

drop policy if exists "bursary reads the books settings" on classroom.accounting_settings;
create policy "bursary reads the books settings" on classroom.accounting_settings
  for select using (classroom.can_do_bursary(school_id));
drop policy if exists "bursary reads the chart" on classroom.chart_of_accounts;
create policy "bursary reads the chart" on classroom.chart_of_accounts
  for select using (classroom.can_do_bursary(school_id));
drop policy if exists "bursary reads journals" on classroom.journal_entries;
create policy "bursary reads journals" on classroom.journal_entries
  for select using (classroom.can_do_bursary(school_id));
drop policy if exists "bursary reads journal lines" on classroom.journal_lines;
create policy "bursary reads journal lines" on classroom.journal_lines
  for select using (classroom.can_do_bursary(school_id));
-- No insert/update/delete policies: every write goes through the functions
-- above, which check the caller and keep the books balanced.

grant select on classroom.accounting_settings, classroom.chart_of_accounts,
  classroom.journal_entries, classroom.journal_lines to authenticated;

-- The internal posting functions are called by triggers and by the
-- functions above, never by a person directly.
revoke execute on function classroom.acct_post(uuid, date, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function classroom.acct_seed_chart(uuid) from public, anon, authenticated;
revoke execute on function classroom.acct_post_invoice(uuid, text) from public, anon, authenticated;
revoke execute on function classroom.acct_post_payment(uuid) from public, anon, authenticated;
revoke execute on function classroom.acct_post_store_sale(uuid, text) from public, anon, authenticated;
revoke execute on function classroom.acct_post_stock_movement(uuid) from public, anon, authenticated;

grant execute on function classroom.accounting_setup(uuid, date, text) to authenticated;
grant execute on function classroom.accounting_backfill(uuid) to authenticated;
grant execute on function classroom.save_account(uuid, uuid, text, text, text, text, boolean) to authenticated;
grant execute on function classroom.post_manual_journal(uuid, date, text, jsonb) to authenticated;
grant execute on function classroom.reverse_journal(uuid, text, date) to authenticated;
grant execute on function classroom.save_opening_balances(uuid, jsonb) to authenticated;
grant execute on function classroom.account_balances(uuid, date, date) to authenticated;

-- Charismartin only, for now: switched off for every other school, the same
-- way the Store was (supabase/182).
update classroom.schools
set disabled_modules = array_append(coalesce(disabled_modules, '{}'), 'accounts')
where slug <> 'charismartin-intl'
  and not ('accounts' = any(coalesce(disabled_modules, '{}')));

notify pgrst, 'reload schema';
