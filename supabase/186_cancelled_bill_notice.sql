-- A family hears when a bill they were sent is cancelled, and a bill notice
-- opens that bill.
--
-- Found by testing the store as a parent: the school voided a ₦6,000 store
-- sale, which cancels its bill (void_store_sale -> cancel_invoice), and the
-- parent heard nothing. Their unread alert still read "₦6,000 ·
-- INV/CI/2026/0003", and it opened a Fees page where that bill was folded
-- away under "Show 1 paid or cancelled bill", so it looked owed.
--
-- 1. cancel_invoice notifies the pupil and every guardian (the same people
--    issue_invoice notifies), but only when the bill had been issued; a
--    draft never reached them. Money cannot be attached by then (it refuses
--    a bill with approved or waiting payments), so "nothing to pay" is true.
-- 2. Both notices link to /Fees?bill=<id>; the Fees page opens that bill and
--    scrolls to it, unfolding the paid-or-cancelled list if it is there.
-- 3. Existing bill notices are repointed at their bill, matched on the
--    reference in their text, so an alert already sitting in someone's list
--    opens the right bill too.

create or replace function classroom.cancel_invoice(target_invoice uuid, reason text)
returns classroom.invoices
language plpgsql
security definer
set search_path to 'classroom', 'public'
as $function$
declare
  inv  classroom.invoices;
  paid numeric;
  was_issued boolean;
begin
  select * into inv from classroom.invoices where id = target_invoice;
  if not found then
    raise exception 'No such invoice';
  end if;

  if not classroom.can_do_bursary(inv.school_id) then
    raise exception 'Only the bursary can cancel an invoice';
  end if;

  if btrim(coalesce(reason, '')) = '' then
    raise exception 'Say why the invoice is being cancelled';
  end if;

  select coalesce(sum(amount), 0) into paid
  from classroom.payments
  where invoice_id = target_invoice and status = 'approved';

  -- Money has been taken against this. Cancelling it would leave an approved
  -- payment attached to nothing, which is how a refund goes missing.
  if paid > 0 then
    raise exception 'Approved payments totalling % are attached to this invoice — refund or move them first', paid;
  end if;

  -- A payment the family has declared but nobody has decided yet would be
  -- left hanging on a cancelled bill — and approve_payment now refuses it —
  -- so it has to be dealt with first.
  if exists (select 1 from classroom.payments
             where invoice_id = target_invoice and status = 'submitted') then
    raise exception 'A payment the family declared on this invoice is still waiting. Approve or reject it under Bursary → Payments first.';
  end if;

  was_issued := inv.status = 'issued';

  update classroom.invoices
  set status = 'cancelled', cancelled_at = now(),
      cancel_reason = btrim(reason), updated_at = now()
  where id = target_invoice
  returning * into inv;

  -- The family were told about this bill, so they are told it is gone. Same
  -- title as the notice that announced it, so the two read as a pair; the
  -- reason stays with the school (it is written for the bursary's records).
  if was_issued then
    insert into classroom.notifications (user_id, school_id, kind, title, body, link)
    select recipient, inv.school_id, 'invoice_cancelled',
           'Cancelled: ' ||
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
             'nothing to pay'),
           '/Fees?bill=' || inv.id
    from classroom.terms t
    join classroom.schools sc on sc.id = inv.school_id
    left join classroom.sessions se on se.id = inv.session_id
    left join classroom.fee_structures st on st.id = inv.structure_id
    left join classroom.profiles p on p.id = inv.student_id
    cross join lateral (
      select btrim(concat_ws(' ', t.name, se.name)) as label
    ) period
    -- displayName()'s fallbacks, as in issue_invoice.
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
  end if;

  return inv;
end;
$function$;

-- issue_invoice: its notice opens the bill it is about. Patched on the live
-- definition (one anchor, checked), so nothing else in it changes.
do $$
declare
  def text;
  anchor constant text := E'''/Fees''\n  from classroom.terms t';
begin
  select pg_get_functiondef('classroom.issue_invoice(uuid)'::regprocedure) into def;
  if position(anchor in def) = 0 then
    if position('''/Fees?bill='' || inv.id' in def) > 0 then
      return; -- already applied
    end if;
    raise exception 'issue_invoice: anchor not found, nothing changed';
  end if;
  execute replace(def, anchor, E'''/Fees?bill='' || inv.id\n  from classroom.terms t');
end;
$$;

-- Notices already sent: point each at its bill, found by the reference in
-- its text. References are unique within a school.
update classroom.notifications n
set link = '/Fees?bill=' || i.id
from classroom.invoices i
where n.kind = 'invoice_issued'
  and n.link = '/Fees'
  and i.school_id = n.school_id
  and i.reference is not null
  and position(i.reference in n.body) > 0;
