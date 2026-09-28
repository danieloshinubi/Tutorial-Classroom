-- The "your fees are ready" notification, written so a parent can act on it.
--
-- What it said before: title "Fees for First Term", body
-- "INV-0001 — 212,000.00". Three problems, all reported from a real
-- run-through:
--   * no currency. The Fees page shows ₦212,000; the notification showed a
--     bare 212,000.00, so the same bill appeared in two different shapes.
--   * no child. A parent with two children at the school got two identical
--     "Fees for First Term" notifications and could not tell them apart.
--   * no session. "First Term" is next year's First Term too.
--
-- Now: title "First Term 2026/2027 fees for Ada Obi", body
-- "₦212,000 · INV-0001 · due 15 Oct 2026". An additional charge (WAEC, the
-- end-of-session party) leads with its own name instead, since "fees" alone
-- would read as a second term bill: "WAEC — First Term 2026/2027, for Ada Obi".

/* -----------------------------------------------------------------------------
   format_money: the SQL side of src/lib/money.js
   -----------------------------------------------------------------------------
   Same rules, so a notification and the page it links to agree: the local
   symbol rather than the ISO code, and kobo all-or-nothing — ₦45,000 or
   ₦45,000.50, never ₦45,000.00 and never ₦45,000.5.

   The symbol list covers what schools here actually use. Anything else falls
   back to its ISO code ("XOF 45,000"), which is unambiguous even if plain.
   If a symbol is added here, it should match what Intl's narrowSymbol prints
   for that currency in money.js. */
create or replace function classroom.format_money(amount numeric, currency text)
returns text
language sql
immutable
as $fn$
  select
    case upper(coalesce(nullif(btrim(currency), ''), 'NGN'))
      when 'NGN' then '₦'
      when 'USD' then '$'
      when 'GBP' then '£'
      when 'EUR' then '€'
      when 'GHS' then 'GH₵'
      when 'ZAR' then 'R'
      else upper(btrim(currency)) || ' '
    end
    || case
         when round(coalesce(amount, 0), 2) = trunc(coalesce(amount, 0))
           then to_char(trunc(coalesce(amount, 0)), 'FM999,999,999,990')
         else to_char(round(coalesce(amount, 0), 2), 'FM999,999,999,990.00')
       end;
$fn$;

grant execute on function classroom.format_money(numeric, text) to authenticated;

/* -----------------------------------------------------------------------------
   issue_invoice: unchanged except for the notification it writes
   -----------------------------------------------------------------------------
   Same signature, so "create or replace" replaces it in place rather than
   leaving an overload (the trap 174 had to drop its way out of). Every check
   above the insert is copied from the live definition verbatim.

   The join to terms stays an inner join, exactly as before: an invoice with no
   term sends no notification here, which is how it has always behaved, and
   the admissions invoices that have no term are notified from their own
   flow. Widening that is a separate decision, not a wording fix. */
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
