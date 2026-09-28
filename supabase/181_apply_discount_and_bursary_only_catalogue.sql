-- The last piece of Phase 1: discount rules can now actually be applied.
--
-- 174 created discount_rules and taught raise_invoice() to resolve one, but
-- nothing in the app could use it: Bursary raises a structure's invoices in
-- bulk (raise_invoices_for_class), which takes no rule — and could not
-- sensibly take one, because "Staff child — 50%" belongs to particular
-- children, not to a whole class. So a school could define its discounts and
-- never give one; not a single invoice anywhere had discount_rule_id set.
--
-- The workflow this supports: raise the term's invoices as drafts, apply the
-- right discount to the children it belongs to, then issue. Applying is
-- limited to drafts on purpose — once issued, the family has been notified of
-- a figure, and changing it silently afterwards is exactly what a statement
-- must never do. (A discount on an issued bill is a void-and-reraise.)
--
-- Also here: the fee catalogue and discount rules become bursary-only reads.

/* -----------------------------------------------------------------------------
   Who can read the catalogue and the discounts
   -----------------------------------------------------------------------------
   Both tables had two policies: "bursary maintains …" (FOR ALL, can_do_bursary)
   and "the school reads …" (SELECT, is_member_of — any member at all, parents
   and students included). Nothing a family sees reads either table: their
   bills carry their own copied lines (invoice_items) and the discount's
   label (invoices.discount_reason). What the broad policy did expose was the
   school's internal price list, its switched-off charges, and its whole
   discount policy — who gets what off — to every parent. Dropping it leaves
   the bursary policy, which already covers reading, as the only way in:
   owner, admin and bursar. raise_invoice() and apply_discount_rule() are
   security definer and unaffected. */
drop policy if exists "the school reads its fee catalogue" on classroom.fee_catalogue;
drop policy if exists "the school reads discount rules" on classroom.discount_rules;

/* -----------------------------------------------------------------------------
   apply_discount_rule(invoice, rule) — or rule null to take a discount off
   -----------------------------------------------------------------------------
   The amount is resolved here, never sent from the page, with exactly
   raise_invoice()'s arithmetic so a discount given at raise time and one
   applied afterwards come to the same figure: a percentage of what the
   invoice bills, rounded to kobo; a fixed amount, never more than the bill.
   What the invoice bills is its own copied lines — the structure may have
   changed since, and the invoice, not the template, is the debt.

   The rule's label becomes the discount reason, which is what the family
   sees on their bill ("Discount · Staff child"), without their being able to
   read the rules table itself. */
create or replace function classroom.apply_discount_rule(target_invoice uuid, target_rule uuid)
returns classroom.invoices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv    classroom.invoices;
  rule   classroom.discount_rules;
  gross  numeric(14,2);
  amount numeric(14,2);
begin
  -- Locked, so two people applying different discounts at once cannot leave
  -- an invoice with one rule's id and the other's amount.
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

  select coalesce(sum(ii.amount), 0) into gross
    from classroom.invoice_items ii
   where ii.invoice_id = inv.id;

  amount := case
    when rule.kind = 'percent' then round(gross * rule.value / 100, 2)
    else least(rule.value, gross)
  end;

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
