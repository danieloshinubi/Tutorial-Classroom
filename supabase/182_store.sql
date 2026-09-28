-- The school store: uniforms, books, notebooks, stationery and casual wear,
-- sold at the counter or added to a family's bill. (Phase 2 of the finance
-- work; see the plan in the Charismartin notes.)
--
-- What it has to answer, from the school's own list: what each item costs
-- the school, what the publisher or supplier knocks off, what it sells for,
-- and so what profit the store makes — per item and per kind of item.
--
-- Shape:
--   store_products          what the store sells, with its prices and stock
--   store_stock_movements   every unit in or out: restock, sale, void, count
--   store_sales             one sale at the counter, to a pupil or walk-in
--   store_sale_items        what was in it, with the prices at that moment
--
-- Stock is only ever changed by the functions below, each in one
-- transaction with the movement that explains it, so the number on the shelf
-- and the history behind it cannot drift apart. A sale records the price and
-- the cost at the moment of sale, so a later price change never rewrites what
-- a past sale made.

/* =============================================================================
   Products
   ============================================================================= */
create table if not exists classroom.store_products (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references classroom.schools (id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  -- A uniform's size, a book's edition or level. Each size is its own row,
  -- because each size has its own stock.
  size            text,
  category        text not null
                  check (category in ('uniform', 'book', 'notebook', 'stationery', 'casual')),
  -- Who the school buys it from. For textbooks, the publisher.
  supplier        text,
  -- What the school pays per unit before any discount, and the discount the
  -- publisher or supplier gives on each unit ("discounts obtained").
  cost_price      numeric(14,2) not null default 0 check (cost_price >= 0),
  trade_discount  numeric(14,2) not null default 0 check (trade_discount >= 0),
  sell_price      numeric(14,2) not null default 0 check (sell_price >= 0),
  -- Worked out, never typed: what the school actually pays, and what it
  -- makes on each unit sold.
  net_cost        numeric(14,2) generated always as (cost_price - trade_discount) stored,
  unit_profit     numeric(14,2) generated always as (sell_price - (cost_price - trade_discount)) stored,
  stock_qty       integer not null default 0 check (stock_qty >= 0),
  -- At or below this, the item is flagged as running low.
  reorder_level   integer not null default 0 check (reorder_level >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint store_products_discount_within_cost check (trade_discount <= cost_price)
);

-- "Cardigan" size 8 and size 10 are two products; "Cardigan" size 8 twice is
-- a mistake. Matched ignoring case and spacing, like the fee catalogue.
create unique index if not exists store_products_once
  on classroom.store_products (school_id, lower(btrim(name)), lower(btrim(coalesce(size, ''))));
create index if not exists store_products_school_idx
  on classroom.store_products (school_id, category, name);

/* =============================================================================
   Sales
   ============================================================================= */
create table if not exists classroom.store_sales (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  reference    text not null,
  seq          integer not null,
  -- Who it was for: a pupil (so it can go on their family's bill), or a
  -- walk-in buyer by name.
  student_id   uuid references classroom.profiles (id) on delete set null,
  buyer_name   text,
  -- How it was paid. "account" means added to the family's bill: an invoice
  -- is raised for it, and the family pays it like any other.
  payment      text not null check (payment in ('cash', 'transfer', 'pos', 'account')),
  invoice_id   uuid references classroom.invoices (id) on delete set null,
  total        numeric(14,2) not null check (total >= 0),
  cost_total   numeric(14,2) not null check (cost_total >= 0),
  note         text,
  sold_by      uuid references classroom.profiles (id) on delete set null,
  sold_at      timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references classroom.profiles (id) on delete set null,
  void_reason  text,
  constraint store_sales_reference_once unique (school_id, reference),
  constraint store_sales_has_buyer check (student_id is not null or btrim(coalesce(buyer_name, '')) <> ''),
  constraint store_sales_account_needs_pupil check (payment <> 'account' or student_id is not null)
);
create index if not exists store_sales_school_idx on classroom.store_sales (school_id, sold_at desc);

create table if not exists classroom.store_sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references classroom.store_sales (id) on delete cascade,
  -- restrict: a product that has been sold keeps its history. Switch it off
  -- instead of deleting it.
  product_id  uuid not null references classroom.store_products (id) on delete restrict,
  -- As it was at the moment of sale.
  name        text not null,
  size        text,
  category    text not null,
  qty         integer not null check (qty > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  unit_cost   numeric(14,2) not null check (unit_cost >= 0)
);
create index if not exists store_sale_items_sale_idx on classroom.store_sale_items (sale_id);
create index if not exists store_sale_items_product_idx on classroom.store_sale_items (product_id);

create table if not exists classroom.store_stock_movements (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references classroom.schools (id) on delete cascade,
  product_id     uuid not null references classroom.store_products (id) on delete restrict,
  kind           text not null check (kind in ('restock', 'sale', 'void', 'adjustment')),
  -- Signed: positive into stock, negative out of it.
  qty            integer not null check (qty <> 0),
  -- A restock's price per unit, as bought.
  unit_cost      numeric(14,2),
  unit_discount  numeric(14,2),
  sale_id        uuid references classroom.store_sales (id) on delete set null,
  note           text,
  created_by     uuid references classroom.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists store_movements_product_idx
  on classroom.store_stock_movements (product_id, created_at desc);

/* =============================================================================
   Stock only moves through the functions
   =============================================================================
   Product details (name, prices, reorder level) are edited directly by the
   bursary, but the stock count is not: a direct edit would leave the shelf
   and the movement history disagreeing. The functions below set a
   transaction-local flag before touching stock_qty; anything else is refused. */
create or replace function classroom.store_products_guard_stock()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(current_setting('classroom.store_stock_write', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' and new.stock_qty <> 0 then
    raise exception 'A new item starts with no stock. Add its opening stock with Restock, so the count has a record behind it.';
  end if;
  if tg_op = 'UPDATE' and new.stock_qty is distinct from old.stock_qty then
    raise exception 'Stock is changed by selling, restocking or a stock count — not by editing the item.';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists store_products_guard_stock on classroom.store_products;
create trigger store_products_guard_stock
  before insert or update on classroom.store_products
  for each row execute function classroom.store_products_guard_stock();

/* =============================================================================
   Row level security — the store belongs to the bursary
   =============================================================================
   Owner, admin and bursar (can_do_bursary), the same people who handle fees.
   Products may be edited directly (the trigger above protects the count).
   Sales, their lines and stock movements have no write policy at all: they
   are written only by the security-definer functions below. A family sees a
   store purchase that was added to their bill through the invoice, as with
   any other bill — never these tables. */
alter table classroom.store_products        enable row level security;
alter table classroom.store_sales           enable row level security;
alter table classroom.store_sale_items      enable row level security;
alter table classroom.store_stock_movements enable row level security;

drop policy if exists "bursary manages store products" on classroom.store_products;
create policy "bursary manages store products" on classroom.store_products
  for all to authenticated
  using (classroom.can_do_bursary(school_id))
  with check (classroom.can_do_bursary(school_id));

drop policy if exists "bursary reads store sales" on classroom.store_sales;
create policy "bursary reads store sales" on classroom.store_sales
  for select to authenticated
  using (classroom.can_do_bursary(school_id));

drop policy if exists "bursary reads store sale lines" on classroom.store_sale_items;
create policy "bursary reads store sale lines" on classroom.store_sale_items
  for select to authenticated
  using (exists (
    select 1 from classroom.store_sales s
    where s.id = sale_id and classroom.can_do_bursary(s.school_id)
  ));

drop policy if exists "bursary reads stock movements" on classroom.store_stock_movements;
create policy "bursary reads stock movements" on classroom.store_stock_movements
  for select to authenticated
  using (classroom.can_do_bursary(school_id));

/* =============================================================================
   A store purchase can be a bill
   ============================================================================= */
alter table classroom.invoices drop constraint if exists invoices_purpose_check;
alter table classroom.invoices add constraint invoices_purpose_check
  check (purpose = any (array['term_fee', 'application_fee', 'acceptance_fee', 'other', 'store']));

/* =============================================================================
   Restock and stock counts
   ============================================================================= */
-- Goods in from the supplier. The price paid becomes the item's cost from now
-- on, so the profit on the next sale reflects what this stock actually cost.
create or replace function classroom.restock_store_product(
  target_product uuid,
  qty integer,
  unit_cost numeric default null,
  unit_discount numeric default null,
  note text default null
)
returns classroom.store_products
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  p classroom.store_products;
begin
  select * into p from classroom.store_products where id = target_product for update;
  if not found then
    raise exception 'No such item';
  end if;
  if not classroom.can_do_bursary(p.school_id) then
    raise exception 'Only the bursary can restock the store';
  end if;
  if qty is null or qty <= 0 then
    raise exception 'How many came in?';
  end if;
  if unit_cost is not null and unit_cost < 0 then
    raise exception 'A cost cannot be negative';
  end if;
  if unit_discount is not null and unit_discount < 0 then
    raise exception 'A discount cannot be negative';
  end if;
  if coalesce(unit_discount, p.trade_discount) > coalesce(unit_cost, p.cost_price) then
    raise exception 'The discount is more than the cost';
  end if;

  perform set_config('classroom.store_stock_write', 'on', true);
  update classroom.store_products
     set stock_qty = stock_qty + qty,
         cost_price = coalesce(unit_cost, cost_price),
         trade_discount = coalesce(unit_discount, trade_discount)
   where id = p.id
  returning * into p;
  perform set_config('classroom.store_stock_write', 'off', true);

  insert into classroom.store_stock_movements
    (school_id, product_id, kind, qty, unit_cost, unit_discount, note, created_by)
  values
    (p.school_id, p.id, 'restock', qty, p.cost_price, p.trade_discount,
     nullif(btrim(coalesce(note, '')), ''), auth.uid());

  return p;
end;
$fn$;

-- A stock count that does not match the shelf: damaged, lost, found. Always
-- with a reason, and never below zero.
create or replace function classroom.adjust_store_stock(
  target_product uuid,
  qty_change integer,
  reason text
)
returns classroom.store_products
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  p classroom.store_products;
begin
  select * into p from classroom.store_products where id = target_product for update;
  if not found then
    raise exception 'No such item';
  end if;
  if not classroom.can_do_bursary(p.school_id) then
    raise exception 'Only the bursary can change the stock';
  end if;
  if qty_change is null or qty_change = 0 then
    raise exception 'By how many?';
  end if;
  if btrim(coalesce(reason, '')) = '' then
    raise exception 'Say why the count changed — damaged, lost, a recount';
  end if;
  if p.stock_qty + qty_change < 0 then
    raise exception 'That would leave % below zero — there are only % in stock', p.name, p.stock_qty;
  end if;

  perform set_config('classroom.store_stock_write', 'on', true);
  update classroom.store_products set stock_qty = stock_qty + qty_change
   where id = p.id returning * into p;
  perform set_config('classroom.store_stock_write', 'off', true);

  insert into classroom.store_stock_movements (school_id, product_id, kind, qty, note, created_by)
  values (p.school_id, p.id, 'adjustment', qty_change, btrim(reason), auth.uid());

  return p;
end;
$fn$;

/* =============================================================================
   A sale
   =============================================================================
   lines: [{"product_id": "...", "qty": 2}, ...]. The same item twice is
   merged. Every item is locked (in id order, so two tills never deadlock)
   before any stock is checked, so two people selling the last cardigan at
   the same moment cannot both succeed.

   payment 'account' raises an invoice for the pupil's family, filed against
   the school's current term, as a DRAFT: it joins the other drafts in the
   Bursary and goes out when the bursar issues it, with the same "issue and
   notify" step as a term's fees. */
create or replace function classroom.record_store_sale(
  target_school uuid,
  buyer_student uuid,
  buyer_name text,
  payment text,
  lines jsonb,
  note text default null
)
returns classroom.store_sales
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  sale      classroom.store_sales;
  inv       classroom.invoices;
  cur_term  classroom.terms;
  line      record;
  p         classroom.store_products;
  school    classroom.schools;
  total     numeric(14,2) := 0;
  cost      numeric(14,2) := 0;
  next_seq  int;
  prefix    text;
  inv_ref   text;
  inv_seq   int;
  the_class uuid;
  pos       int := 0;
  -- The lines with repeats merged. A local value rather than a temporary
  -- table: a temp table in a security-definer function can be pre-created by
  -- the caller under the same name and quietly used in place of ours.
  merged    jsonb;
  label     text;
begin
  if not classroom.can_do_bursary(target_school) then
    raise exception 'Only the bursary can sell from the store';
  end if;

  if payment is null or payment not in ('cash', 'transfer', 'pos', 'account') then
    raise exception 'How was it paid?';
  end if;

  if buyer_student is not null and not exists (
    select 1 from classroom.school_members m
    where m.school_id = target_school and m.user_id = buyer_student and m.is_active
  ) then
    raise exception 'That pupil is not at this school';
  end if;

  if buyer_student is null and btrim(coalesce(buyer_name, '')) = '' then
    raise exception 'Who is it for? Choose a pupil, or type the buyer''s name';
  end if;

  if payment = 'account' and buyer_student is null then
    raise exception 'Only a pupil''s purchase can go on a family''s bill';
  end if;

  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception 'Nothing to sell';
  end if;

  -- Merge repeats and validate quantities before touching anything.
  select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'qty', x.qty))
    into merged
  from (
    select (l ->> 'product_id')::uuid as product_id, sum((l ->> 'qty')::int) as qty
    from jsonb_array_elements(lines) l
    group by (l ->> 'product_id')::uuid
  ) x;

  if exists (
    select 1 from jsonb_to_recordset(merged) as m(product_id uuid, qty int)
    where m.product_id is null or m.qty is null or m.qty <= 0
  ) then
    raise exception 'Every item needs a quantity of at least one';
  end if;

  -- Lock every item, in a fixed order.
  perform 1 from classroom.store_products sp
   where sp.id in (select m.product_id from jsonb_to_recordset(merged) as m(product_id uuid, qty int))
   order by sp.id
   for update;

  for line in select m.product_id, m.qty from jsonb_to_recordset(merged) as m(product_id uuid, qty int) loop
    select * into p from classroom.store_products where id = line.product_id;
    if not found or p.school_id <> target_school then
      raise exception 'One of those items is not in this store';
    end if;
    label := p.name || coalesce(' (' || p.size || ')', '');
    if not p.is_active then
      raise exception '% is switched off and cannot be sold', label;
    end if;
    if p.stock_qty < line.qty then
      raise exception 'Only % left of %', p.stock_qty, label;
    end if;
    total := total + p.sell_price * line.qty;
    cost  := cost + p.net_cost * line.qty;
  end loop;

  -- Number the sale, one school at a time.
  select * into school from classroom.schools where id = target_school;
  perform pg_advisory_xact_lock(hashtext('store_sale:' || target_school::text));
  select coalesce(max(s.seq), 0) + 1 into next_seq from classroom.store_sales s where s.school_id = target_school;
  select string_agg(left(word, 1), '') into prefix
  from (select regexp_split_to_table(upper(school.name), '[^A-Z0-9]+') as word) parts
  where word <> '';

  insert into classroom.store_sales
    (school_id, reference, seq, student_id, buyer_name, payment, total, cost_total, note, sold_by)
  values
    (target_school,
     format('SAL/%s/%s/%s', coalesce(nullif(left(prefix, 4), ''), 'SCH'),
            extract(year from now())::int, lpad(next_seq::text, 4, '0')),
     next_seq, buyer_student, nullif(btrim(coalesce(buyer_name, '')), ''), payment,
     total, cost, nullif(btrim(coalesce(note, '')), ''), auth.uid())
  returning * into sale;

  perform set_config('classroom.store_stock_write', 'on', true);
  for line in
    select m.product_id, m.qty, sp.name, sp.size, sp.category, sp.sell_price, sp.net_cost
    from jsonb_to_recordset(merged) as m(product_id uuid, qty int)
    join classroom.store_products sp on sp.id = m.product_id
    order by sp.category, sp.name, sp.size
  loop
    insert into classroom.store_sale_items (sale_id, product_id, name, size, category, qty, unit_price, unit_cost)
    values (sale.id, line.product_id, line.name, line.size, line.category, line.qty, line.sell_price, line.net_cost);

    update classroom.store_products set stock_qty = stock_qty - line.qty where id = line.product_id;

    insert into classroom.store_stock_movements (school_id, product_id, kind, qty, sale_id, created_by)
    values (target_school, line.product_id, 'sale', -line.qty, sale.id, auth.uid());
  end loop;
  perform set_config('classroom.store_stock_write', 'off', true);

  -- On the family's bill.
  if payment = 'account' then
    select * into cur_term from classroom.terms
     where school_id = target_school and is_current
     limit 1;
    if not found then
      raise exception 'Set the current term under School admin → Calendar before adding a purchase to a family''s bill';
    end if;

    select class_id into the_class from classroom.class_students
     where student_id = buyer_student
       and class_id in (select id from classroom.classes where session_id = cur_term.session_id)
     limit 1;

    select r.reference, r.seq into inv_ref, inv_seq
      from classroom.next_invoice_reference(target_school, cur_term.id) r;

    insert into classroom.invoices
      (school_id, student_id, session_id, term_id, class_id, reference, seq,
       purpose, notes, created_by)
    values
      (target_school, buyer_student, cur_term.session_id, cur_term.id, the_class, inv_ref, inv_seq,
       'store', format('Store sale %s', sale.reference), auth.uid())
    returning * into inv;

    for line in
      select i.name, i.size, i.qty, i.unit_price
      from classroom.store_sale_items i where i.sale_id = sale.id
      order by i.category, i.name, i.size
    loop
      pos := pos + 1;
      insert into classroom.invoice_items (invoice_id, name, amount, position)
      values (
        inv.id,
        line.name
          || coalesce(' (' || line.size || ')', '')
          || case when line.qty > 1 then ' × ' || line.qty else '' end,
        line.unit_price * line.qty,
        pos
      );
    end loop;

    update classroom.store_sales set invoice_id = inv.id where id = sale.id returning * into sale;
  end if;

  return sale;
end;
$fn$;

/* =============================================================================
   Undoing a sale
   =============================================================================
   Everything comes back onto the shelf, and a bill it raised is cancelled.
   If the family has already paid something on that bill, the bill's own rule
   applies (cancel_invoice refuses) and the whole void is refused with it:
   the money has to be dealt with first. */
create or replace function classroom.void_store_sale(target_sale uuid, reason text)
returns classroom.store_sales
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  sale classroom.store_sales;
  item record;
  inv  classroom.invoices;
begin
  select * into sale from classroom.store_sales where id = target_sale for update;
  if not found then
    raise exception 'No such sale';
  end if;
  if not classroom.can_do_bursary(sale.school_id) then
    raise exception 'Only the bursary can void a sale';
  end if;
  if sale.voided_at is not null then
    raise exception 'That sale has already been voided';
  end if;
  if btrim(coalesce(reason, '')) = '' then
    raise exception 'Say why the sale is being voided — it is kept on the record';
  end if;

  if sale.invoice_id is not null then
    select * into inv from classroom.invoices where id = sale.invoice_id;
    if found and inv.status <> 'cancelled' then
      perform classroom.cancel_invoice(inv.id, format('Store sale %s voided: %s', sale.reference, btrim(reason)));
    end if;
  end if;

  perform 1 from classroom.store_products sp
   where sp.id in (select product_id from classroom.store_sale_items where sale_id = sale.id)
   order by sp.id
   for update;

  perform set_config('classroom.store_stock_write', 'on', true);
  for item in select product_id, qty from classroom.store_sale_items where sale_id = sale.id loop
    update classroom.store_products set stock_qty = stock_qty + item.qty where id = item.product_id;
    insert into classroom.store_stock_movements (school_id, product_id, kind, qty, sale_id, note, created_by)
    values (sale.school_id, item.product_id, 'void', item.qty, sale.id, btrim(reason), auth.uid());
  end loop;
  perform set_config('classroom.store_stock_write', 'off', true);

  update classroom.store_sales
     set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(reason)
   where id = sale.id
  returning * into sale;

  return sale;
end;
$fn$;

/* =============================================================================
   Profit
   =============================================================================
   Per item sold in the period, from what each sale actually charged and
   actually cost at the time. Voided sales are left out. The page groups these
   into categories; one row per item keeps "which uniform makes the money"
   answerable too. */
create or replace function classroom.store_profit(
  target_school uuid,
  from_date date default null,
  to_date date default null
)
returns table (
  product_id uuid,
  name text,
  size text,
  category text,
  qty_sold bigint,
  revenue numeric,
  cost numeric,
  profit numeric
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select i.product_id, i.name, i.size, i.category,
         sum(i.qty),
         sum(i.qty * i.unit_price),
         sum(i.qty * i.unit_cost),
         sum(i.qty * (i.unit_price - i.unit_cost))
  from classroom.store_sale_items i
  join classroom.store_sales s on s.id = i.sale_id
  where s.school_id = target_school
    and classroom.can_do_bursary(target_school)
    and s.voided_at is null
    and (from_date is null or s.sold_at >= from_date)
    and (to_date is null or s.sold_at < to_date + 1)
  group by i.product_id, i.name, i.size, i.category
  order by sum(i.qty * (i.unit_price - i.unit_cost)) desc;
$fn$;

grant execute on function
  classroom.restock_store_product(uuid, integer, numeric, numeric, text),
  classroom.adjust_store_stock(uuid, integer, text),
  classroom.record_store_sale(uuid, uuid, text, text, jsonb, text),
  classroom.void_store_sale(uuid, text),
  classroom.store_profit(uuid, date, date)
to authenticated;

/* =============================================================================
   The notification when a store bill is issued
   =============================================================================
   issue_invoice from 177, with one more case: a store bill says so, instead
   of reading "Additional charge". Everything else is as 177 left it. */
create or replace function classroom.issue_invoice(target_invoice uuid)
returns classroom.invoices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv classroom.invoices;
  n   int;
begin
  select * into inv from classroom.invoices where id = target_invoice;
  if not found then
    raise exception 'No such invoice';
  end if;

  if not classroom.can_do_bursary(inv.school_id) then
    raise exception 'Only the bursary can issue an invoice';
  end if;

  if inv.status = 'issued' then
    return inv;
  end if;

  if inv.status = 'cancelled' then
    raise exception 'That invoice was cancelled';
  end if;

  select count(*) into n from classroom.invoice_items where invoice_id = target_invoice;
  if n = 0 then
    raise exception 'An invoice with no items cannot be issued';
  end if;

  update classroom.invoices
  set status = 'issued', issued_by = auth.uid(), issued_at = now(), updated_at = now()
  where id = target_invoice
  returning * into inv;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select recipient, inv.school_id, 'invoice_issued',
         case
           when coalesce(inv.purpose, 'term_fee') = 'term_fee' then
             format('%s fees for %s', period.label, child.name)
           when inv.purpose = 'store' then
             format('School store — %s, for %s', period.label, child.name)
           else
             format('%s — %s, for %s', coalesce(st.name, 'Additional charge'), period.label, child.name)
         end,
         concat_ws(' · ',
           classroom.format_money(
             (select coalesce(sum(amount), 0) from classroom.invoice_items where invoice_id = inv.id)
             - inv.discount,
             sc.currency),
           inv.reference,
           case when inv.due_on is not null
             then 'due ' || to_char(inv.due_on, 'FMDD Mon YYYY')
           end),
         '/Fees'
  from classroom.terms t
  join classroom.schools sc on sc.id = inv.school_id
  left join classroom.sessions se on se.id = inv.session_id
  left join classroom.fee_structures st on st.id = inv.structure_id
  left join classroom.profiles p on p.id = inv.student_id
  cross join lateral (
    select btrim(concat_ws(' ', t.name, se.name)) as label
  ) period
  -- The same fallbacks, in the same order, as displayName() in
  -- src/Components/UI.jsx, so the notification names the child exactly as
  -- the page it links to does.
  cross join lateral (
    select coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
      nullif(btrim(p.username), ''),
      nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
      'your child'
    ) as name
  ) child
  cross join lateral (
    select inv.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g where g.student_id = inv.student_id
  ) people
  where t.id = inv.term_id and recipient is not null;

  return inv;
end;
$fn$;

/* =============================================================================
   Who sees the Store in their menu
   =============================================================================
   A new module is on by default for any school created from now on. Every
   school that exists today gets it switched off, except Charismartin, who
   asked for it — a store the others never set up would only be clutter in
   their menu. Any school admin can switch it on under School admin → Modules. */
update classroom.schools
   set disabled_modules = array_append(disabled_modules, 'store')
 where slug <> 'charismartin-intl'
   and not ('store' = any (disabled_modules));
