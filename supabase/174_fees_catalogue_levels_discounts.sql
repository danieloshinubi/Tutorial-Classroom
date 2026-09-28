-- =============================================================================
-- Fees, part 1: a reusable catalogue, level scoping, supplementary invoices,
-- and named discounts.
--
-- Driven by a real school's fee list — application forms, WAEC, exam materials,
-- dictionaries, PTA, extra coaching, end-of-session party, with WAEC charged
-- only to SSS 3, and discounts for staff and parents. Four things in the
-- existing bursary schema (030_bursary.sql) stood in the way:
--
--   1. A fee's name is free text inside one fee_structure, so "WAEC" is retyped
--      every term for every class and nothing links the instances together.
--   2. A structure can target one class (class_id) or the whole school. There is
--      no level scoping, so "SSS 3" — which is a LEVEL spanning several classes —
--      cannot be expressed at all.
--   3. invoices_once_per_term UNIQUE (student_id, term_id) means a student can
--      hold exactly one invoice per term, so a WAEC or party charge cannot sit
--      beside the term fee. It has to be crammed into the same bill or not
--      billed.
--   4. A discount is a naira lump sum plus free text. "Staff child — 50%" is
--      retyped, and re-derived by hand, on every single invoice.
--
-- Everything already working is left alone: partial payments, the payment
-- approval queue, online settlement, reference generation, and the
-- invoice_balances view all keep their current behaviour.
-- =============================================================================

/* --- 1. A school's own catalogue of fees ------------------------------------
   Same shape as the other school-defined lists in this schema
   (clearance_departments, screening_requirements): school-scoped, ordered,
   deactivatable rather than deleted, unique by label. Structures reference it
   so the same charge is recognisably the same charge across terms and classes.  */

create table if not exists classroom.fee_catalogue (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references classroom.schools (id) on delete cascade,
  label          text not null check (btrim(label) <> ''),
  -- What it usually costs. A structure may still override per term/class, so
  -- this is a starting point, not the price.
  default_amount numeric(14,2) check (default_amount >= 0),
  -- Loose grouping for reporting ("exam", "activity", "material"). Deliberately
  -- free text, not an enum: every school splits its fees differently and an
  -- enum here would need a migration per school.
  category       text,
  position       int not null default 0,
  -- Retired fees stay for the invoices that already reference them.
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create unique index if not exists fee_catalogue_label_once
  on classroom.fee_catalogue (school_id, lower(btrim(label)));

alter table classroom.fee_catalogue enable row level security;

drop policy if exists "bursary maintains the fee catalogue" on classroom.fee_catalogue;
create policy "bursary maintains the fee catalogue"
  on classroom.fee_catalogue for all to authenticated
  using (classroom.can_do_bursary(school_id))
  with check (classroom.can_do_bursary(school_id));

drop policy if exists "the school reads its fee catalogue" on classroom.fee_catalogue;
create policy "the school reads its fee catalogue"
  on classroom.fee_catalogue for select to authenticated
  using (classroom.is_member_of(school_id));

grant select, insert, update, delete on classroom.fee_catalogue to authenticated;

-- Nullable on purpose: a one-off charge should not force a catalogue entry, and
-- every existing fee_item predates the catalogue entirely.
alter table classroom.fee_items
  add column if not exists catalogue_id uuid references classroom.fee_catalogue (id) on delete set null;

/* --- 2. Level scoping --------------------------------------------------------
   classes.level_year is the integer a class sits in and classroom.levels maps
   that year to the school's own label ("SSS 3"). Scoping a structure by
   level_year therefore covers every class in that year without naming them.     */

alter table classroom.fee_structures
  add column if not exists level_year int;

-- A structure targets exactly one audience: the whole school, one level, or one
-- class. Allowing both at once would leave "which wins?" to be decided by
-- whichever query ran.
alter table classroom.fee_structures
  drop constraint if exists fee_structures_one_audience;
alter table classroom.fee_structures
  add constraint fee_structures_one_audience
  check (class_id is null or level_year is null);

-- The old pair of indexes allowed one structure per class per term FULL STOP,
-- which is what made a second charge impossible even for a different purpose.
-- Replaced by three, each scoped by purpose as well as audience.
drop index if exists classroom.fee_structures_per_class;
drop index if exists classroom.fee_structures_whole_school;

create unique index if not exists fee_structures_whole_school
  on classroom.fee_structures (term_id, purpose)
  where class_id is null and level_year is null;

create unique index if not exists fee_structures_per_level
  on classroom.fee_structures (term_id, purpose, level_year)
  where level_year is not null;

create unique index if not exists fee_structures_per_class
  on classroom.fee_structures (term_id, purpose, class_id)
  where class_id is not null;

/* --- 3. Supplementary invoices ----------------------------------------------
   The old rule (one invoice per student per term) was really trying to stop the
   same bill being raised twice by accident. Keyed to the STRUCTURE instead, that
   protection is stronger and narrower: a given structure bills a given student
   once, and any number of different structures can bill them in the same term.  */

alter table classroom.invoices
  drop constraint if exists invoices_once_per_term;

create unique index if not exists invoices_once_per_structure
  on classroom.invoices (student_id, structure_id)
  where structure_id is not null and student_id is not null;

/* --- 4. Named discounts ------------------------------------------------------
   The resolved naira figure still lands in invoices.discount, so
   invoice_balances (030_bursary.sql) keeps working untouched — this adds where
   the number CAME FROM, it does not change how a balance is computed.           */

create table if not exists classroom.discount_rules (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  label      text not null check (btrim(label) <> ''),
  kind       text not null check (kind in ('percent', 'fixed')),
  value      numeric(14,2) not null check (value >= 0),
  is_active  boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  -- A percentage over 100 would produce a negative bill.
  constraint discount_rules_percent_range
    check (kind <> 'percent' or value <= 100)
);

create unique index if not exists discount_rules_label_once
  on classroom.discount_rules (school_id, lower(btrim(label)));

alter table classroom.discount_rules enable row level security;

drop policy if exists "bursary maintains discount rules" on classroom.discount_rules;
create policy "bursary maintains discount rules"
  on classroom.discount_rules for all to authenticated
  using (classroom.can_do_bursary(school_id))
  with check (classroom.can_do_bursary(school_id));

drop policy if exists "the school reads discount rules" on classroom.discount_rules;
create policy "the school reads discount rules"
  on classroom.discount_rules for select to authenticated
  using (classroom.is_member_of(school_id));

grant select, insert, update, delete on classroom.discount_rules to authenticated;

alter table classroom.invoices
  add column if not exists discount_rule_id uuid references classroom.discount_rules (id) on delete set null;

/* --- 5. raise_invoice: purpose, level scoping, discount rules ----------------
   Two fixes beyond the new discount argument:

   * purpose was never copied from the structure, so a structure marked
     'other' still produced a 'term_fee' invoice. Harmless while only one
     invoice per term existed; now that supplementary invoices are possible,
     purpose is what tells them apart.
   * the class recorded on the invoice fell back to st.class_id, which is null
     for a level-scoped structure. It now falls back to the student's actual
     class in that session either way.                                           */

-- Dropped, not replaced: adding a parameter changes the signature, and
-- "create or replace" would leave the old 5-argument version in place as an
-- overload. A call passing exactly five arguments would then match both (the
-- old one exactly, the new one through its default) and fail as ambiguous —
-- so every existing invoice-raising call would break the moment this shipped.
drop function if exists classroom.raise_invoice(uuid, uuid, text[], numeric, text);

create or replace function classroom.raise_invoice(
  target_structure uuid,
  target_student uuid,
  include_optional text[] default '{}'::text[],
  discount numeric default 0,
  discount_reason text default null,
  discount_rule uuid default null
)
returns classroom.invoices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  st        classroom.fee_structures;
  inv       classroom.invoices;
  rule      classroom.discount_rules;
  ref       text;
  next_seq  int;
  the_class uuid;
  gross     numeric(14,2);
begin
  select * into st from classroom.fee_structures where id = target_structure;
  if not found then
    raise exception 'No such fee structure';
  end if;

  if not classroom.can_do_bursary(st.school_id) then
    raise exception 'Only the bursary can raise an invoice';
  end if;

  if not exists (
    select 1 from classroom.school_members m
    where m.school_id = st.school_id and m.user_id = target_student and m.is_active
  ) then
    raise exception 'That student is not at this school';
  end if;

  select class_id into the_class from classroom.class_students
  where student_id = target_student
    and class_id in (select id from classroom.classes where session_id = st.session_id)
  limit 1;

  -- A level-scoped structure only applies to students actually in that level.
  -- Checked here rather than trusted to the caller: this function is the single
  -- door through which every invoice is raised.
  if st.level_year is not null then
    if the_class is null or not exists (
      select 1 from classroom.classes c
      where c.id = the_class and c.level_year = st.level_year
    ) then
      raise exception 'That student is not in the level this fee applies to';
    end if;
  end if;

  -- A named rule wins over a hand-typed amount, and supplies its own reason so
  -- "why was this discounted" is answerable without anyone remembering to type it.
  if discount_rule is not null then
    select * into rule from classroom.discount_rules
    where id = discount_rule and school_id = st.school_id and is_active;
    if not found then
      raise exception 'No such discount';
    end if;

    select coalesce(sum(fi.amount), 0) into gross
    from classroom.fee_items fi
    where fi.structure_id = st.id
      and (not fi.is_optional or fi.name = any(include_optional));

    discount := case
      when rule.kind = 'percent' then round(gross * rule.value / 100, 2)
      else least(rule.value, gross)
    end;
    discount_reason := rule.label;
  end if;

  if discount < 0 then
    raise exception 'A discount cannot be negative';
  end if;

  if discount > 0 and btrim(coalesce(discount_reason, '')) = '' then
    raise exception 'Say why the discount was given — it has to be explainable later';
  end if;

  select r.reference, r.seq into ref, next_seq
  from classroom.next_invoice_reference(st.school_id, st.term_id) r;

  insert into classroom.invoices (
    school_id, student_id, session_id, term_id, class_id, structure_id,
    reference, seq, due_on, discount, discount_reason, discount_rule_id,
    purpose, created_by
  ) values (
    st.school_id, target_student, st.session_id, st.term_id,
    coalesce(the_class, st.class_id), st.id,
    ref, next_seq, st.due_on, discount, nullif(btrim(coalesce(discount_reason,'')), ''),
    discount_rule, coalesce(st.purpose, 'term_fee'),
    auth.uid()
  )
  returning * into inv;

  -- The copy. See the header: a template is not a statement of debt.
  insert into classroom.invoice_items (invoice_id, name, amount, position)
  select inv.id, fi.name, fi.amount, fi.position
  from classroom.fee_items fi
  where fi.structure_id = st.id
    and (not fi.is_optional or fi.name = any(include_optional));

  return inv;
end;
$fn$;

grant execute on function classroom.raise_invoice(uuid, uuid, text[], numeric, text, uuid) to authenticated;

notify pgrst, 'reload schema';
