-- =============================================================================
-- Discounts that come off particular fees, not the whole bill.
--
-- A real school's staff discount: 50% off tuition, 40% off the end-of-session
-- party, and extra coaching free for a staff child in an exam class. Their
-- parent discount is on tuition only. discount_rules (174) could only take a
-- percentage or an amount off the WHOLE bill, so "Staff child, 50%" also
-- halved PTA, WAEC and exam materials, which the school does not give.
--
-- A rule may now list the fees it covers, each with its own percentage or
-- amount (discount_rule_items). A rule with no list works exactly as before,
-- on the whole bill. Either way the naira figure still lands in
-- invoices.discount, so invoice_balances and the accounts postings (188) are
-- untouched.
--
-- To know which line of a bill is "tuition", a bill line now remembers the
-- catalogue fee it came from (invoice_items.catalogue_id), copied from the
-- structure when the bill is raised. Names are not enough: a school renames
-- "Tuition" to "Tuition fee" next term, and the discount should still find it.
-- =============================================================================

/* --- 1. Bill lines remember their catalogue fee ---------------------------- */

alter table classroom.invoice_items
  add column if not exists catalogue_id uuid references classroom.fee_catalogue (id) on delete set null;

-- Structure lines typed by hand before the catalogue existed, whose name is a
-- catalogue fee's name, are that fee.
update classroom.fee_items fi
   set catalogue_id = fc.id
  from classroom.fee_structures st
  join classroom.fee_catalogue fc on fc.school_id = st.school_id
 where fi.structure_id = st.id
   and fi.catalogue_id is null
   and lower(btrim(fc.label)) = lower(btrim(fi.name));

-- Existing bills: from the structure line they were copied from, else by name.
update classroom.invoice_items ii
   set catalogue_id = fi.catalogue_id
  from classroom.invoices i
  join classroom.fee_items fi on fi.structure_id = i.structure_id
 where ii.invoice_id = i.id
   and ii.catalogue_id is null
   and fi.catalogue_id is not null
   and fi.name = ii.name;

update classroom.invoice_items ii
   set catalogue_id = fc.id
  from classroom.invoices i
  join classroom.fee_catalogue fc on fc.school_id = i.school_id
 where ii.invoice_id = i.id
   and ii.catalogue_id is null
   and i.purpose in ('term_fee', 'other')
   and lower(btrim(fc.label)) = lower(btrim(ii.name));

/* --- 2. Which fees a discount covers --------------------------------------- */

create table if not exists classroom.discount_rule_items (
  rule_id      uuid not null references classroom.discount_rules (id) on delete cascade,
  catalogue_id uuid not null references classroom.fee_catalogue (id) on delete cascade,
  kind         text not null check (kind in ('percent', 'fixed')),
  value        numeric(14,2) not null check (value > 0),
  primary key (rule_id, catalogue_id),
  constraint discount_rule_items_percent_range check (kind <> 'percent' or value <= 100)
);

alter table classroom.discount_rule_items enable row level security;

-- Bursary-only, like the rules themselves (181): who gets what off is not for
-- families to read. The fee must be the same school's as the rule.
drop policy if exists "bursary maintains discount rule items" on classroom.discount_rule_items;
create policy "bursary maintains discount rule items"
  on classroom.discount_rule_items for all to authenticated
  using (exists (
    select 1 from classroom.discount_rules r
     where r.id = rule_id and classroom.can_do_bursary(r.school_id)
  ))
  with check (exists (
    select 1 from classroom.discount_rules r
      join classroom.fee_catalogue fc on fc.id = catalogue_id and fc.school_id = r.school_id
     where r.id = rule_id and classroom.can_do_bursary(r.school_id)
  ));

grant select, insert, update, delete on classroom.discount_rule_items to authenticated;

/* --- 3. What a rule comes to on a bill -------------------------------------
   One piece of arithmetic for raising, applying and previewing, so the three
   can never disagree. Per line: a percentage of it, rounded to kobo, or a
   fixed amount but never more than the line. Internal; the callers below
   check who is asking. */

create or replace function classroom.discount_amount(target_invoice uuid, target_rule uuid)
returns numeric
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select case
    when exists (select 1 from classroom.discount_rule_items where rule_id = target_rule) then
      coalesce((
        select sum(case
                     when dri.kind = 'percent' then round(ii.amount * dri.value / 100, 2)
                     else least(dri.value, ii.amount)
                   end)
          from classroom.invoice_items ii
          join classroom.discount_rule_items dri
            on dri.rule_id = target_rule and dri.catalogue_id = ii.catalogue_id
         where ii.invoice_id = target_invoice
      ), 0)
    else (
      select case
               when r.kind = 'percent' then round(g.gross * r.value / 100, 2)
               else least(r.value, g.gross)
             end
        from classroom.discount_rules r,
             (select coalesce(sum(amount), 0) as gross
                from classroom.invoice_items where invoice_id = target_invoice) g
       where r.id = target_rule
    )
  end;
$fn$;

revoke all on function classroom.discount_amount(uuid, uuid) from public, anon, authenticated;

-- What the bursar sees before applying: the figure, and whether the rule
-- touches this bill at all.
create or replace function classroom.preview_discount(target_invoice uuid, target_rule uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = classroom, public
as $fn$
declare
  school uuid;
begin
  select school_id into school from classroom.invoices where id = target_invoice;
  if school is null or not classroom.can_do_bursary(school) then
    raise exception 'Only the bursary can see a discount';
  end if;
  if not exists (select 1 from classroom.discount_rules where id = target_rule and school_id = school) then
    raise exception 'No such discount';
  end if;
  return classroom.discount_amount(target_invoice, target_rule);
end;
$fn$;

grant execute on function classroom.preview_discount(uuid, uuid) to authenticated;

/* --- 4. apply_discount_rule, on the shared arithmetic ----------------------- */

create or replace function classroom.apply_discount_rule(target_invoice uuid, target_rule uuid)
returns classroom.invoices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv    classroom.invoices;
  rule   classroom.discount_rules;
  amount numeric(14,2);
begin
  select * into inv from classroom.invoices where id = target_invoice for update;
  if not found then
    raise exception 'No such invoice';
  end if;

  if not classroom.can_do_bursary(inv.school_id) then
    raise exception 'Only the bursary can change a discount';
  end if;

  if inv.status <> 'draft' then
    raise exception 'Only a draft invoice can be discounted — this one has already been issued to the family. Void it and raise it again to change the amount.';
  end if;

  if target_rule is null then
    update classroom.invoices
       set discount = 0, discount_reason = null, discount_rule_id = null, updated_at = now()
     where id = inv.id
    returning * into inv;
    return inv;
  end if;

  select * into rule from classroom.discount_rules
   where id = target_rule and school_id = inv.school_id and is_active;
  if not found then
    raise exception 'No such discount, or it has been switched off';
  end if;

  amount := classroom.discount_amount(inv.id, rule.id);

  -- Applying "Staff child" to a PTA bill would record a discount of nothing
  -- and look as if it had worked.
  if amount = 0 and exists (select 1 from classroom.discount_rule_items where rule_id = rule.id) then
    raise exception '% does not cover any fee on this bill (it covers %).',
      rule.label,
      (select string_agg(fc.label, ', ' order by fc.position, fc.label)
         from classroom.discount_rule_items dri
         join classroom.fee_catalogue fc on fc.id = dri.catalogue_id
        where dri.rule_id = rule.id);
  end if;

  update classroom.invoices
     set discount = amount,
         discount_reason = rule.label,
         discount_rule_id = rule.id,
         updated_at = now()
   where id = inv.id
  returning * into inv;

  return inv;
end;
$fn$;

grant execute on function classroom.apply_discount_rule(uuid, uuid) to authenticated;

/* --- 5. raise_invoice: copies the catalogue fee, discounts per line ---------
   Same signature and behaviour as 174, except that bill lines carry their
   catalogue fee, and a named rule is worked out from the lines just copied
   (so it can see which one is tuition) rather than from the template.        */

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

  if st.level_year is not null then
    if the_class is null or not exists (
      select 1 from classroom.classes c
      where c.id = the_class and c.level_year = st.level_year
    ) then
      raise exception 'That student is not in the level this fee applies to';
    end if;
  end if;

  if discount_rule is not null then
    select * into rule from classroom.discount_rules
    where id = discount_rule and school_id = st.school_id and is_active;
    if not found then
      raise exception 'No such discount';
    end if;
    -- Worked out once the lines exist, below.
    discount := 0;
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

  -- The copy. A template is not a statement of debt.
  insert into classroom.invoice_items (invoice_id, name, amount, position, catalogue_id)
  select inv.id, fi.name, fi.amount, fi.position,
         coalesce(fi.catalogue_id, (
           select fc.id from classroom.fee_catalogue fc
            where fc.school_id = st.school_id
              and lower(btrim(fc.label)) = lower(btrim(fi.name))
         ))
  from classroom.fee_items fi
  where fi.structure_id = st.id
    and (not fi.is_optional or fi.name = any(include_optional));

  if discount_rule is not null then
    update classroom.invoices
       set discount = classroom.discount_amount(inv.id, discount_rule)
     where id = inv.id
    returning * into inv;
  end if;

  return inv;
end;
$fn$;

grant execute on function classroom.raise_invoice(uuid, uuid, text[], numeric, text, uuid) to authenticated;
