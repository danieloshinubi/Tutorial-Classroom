-- =============================================================================
-- Carrying unpaid fees forward to the next term.
--
-- A real school's rule: fees not paid by the end of a term are added to the
-- child's bill for the next term. The debt is the same debt; only where it is
-- collected moves. So, for each child with money still owing on an earlier
-- bill:
--
--   * the later term's (draft) bill gains a line "Balance brought forward
--     from <reference>" for exactly what was owed, marked with the bill it
--     came from (invoice_items.brought_forward_from);
--   * the earlier bill is closed by a transfer of that amount (a payment of
--     method 'carried_forward', approved), so it no longer shows as owing
--     and the family never sees the same naira twice.
--
-- In the books (188) the money was already a receivable when the earlier bill
-- was issued. Moving it is receivable to receivable, which is no entry at
-- all: the transfer posts nothing, and the brought-forward line is left out
-- of the later bill's fee income and receivable. The school's total owed
-- stays exactly what it was.
--
-- Discounts never apply to a brought-forward amount: it was already
-- discounted, if at all, on the bill it came from.
--
-- Undoing is safe while the later bill is still a draft, and happens by
-- itself if that bill is deleted or voided: the transfers are removed and the
-- earlier bills owe again.
-- =============================================================================

alter table classroom.invoice_items
  add column if not exists brought_forward_from uuid references classroom.invoices (id) on delete restrict;

create index if not exists invoice_items_brought_forward_idx
  on classroom.invoice_items (brought_forward_from) where brought_forward_from is not null;

/* --- Books: a transfer posts nothing; brought-forward lines are not income -- */

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
    select coalesce(sum(amount), 0) as gross
      from classroom.invoice_items
     where invoice_id = i.id and brought_forward_from is null
  ) g
  where i.id = target_invoice;
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
  -- Receivable to receivable: nothing to post.
  if pay.method = 'carried_forward' then return; end if;
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

/* --- Discounts leave brought-forward lines alone (191's arithmetic) -------- */

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
         where ii.invoice_id = target_invoice and ii.brought_forward_from is null
      ), 0)
    else (
      select case
               when r.kind = 'percent' then round(g.gross * r.value / 100, 2)
               else least(r.value, g.gross)
             end
        from classroom.discount_rules r,
             (select coalesce(sum(amount), 0) as gross
                from classroom.invoice_items
               where invoice_id = target_invoice and brought_forward_from is null) g
       where r.id = target_rule
    )
  end;
$fn$;

revoke all on function classroom.discount_amount(uuid, uuid) from public, anon, authenticated;

/* --- Moving a balance tells nobody "payment received" --------------------- */

create or replace function classroom.notify_payment_received()
returns trigger
language plpgsql
security definer
set search_path to 'classroom', 'public', 'vault'
as $function$
begin
  if new.method = 'carried_forward' then
    return new;
  end if;
  perform net.http_post(
    url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/payment-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'payment_notify_secret')
    ),
    body := jsonb_build_object('payment_id', new.id)
  );
  return new;
exception when others then
  raise warning 'notify_payment_received could not queue a notification for payment %: %', new.id, sqlerrm;
  return new;
end;
$function$;

/* --- What a bill owes: a bill moved forward says so, rather than "paid" ---- */

create or replace view classroom.invoice_balances
with (security_invoker = true)
as
SELECT i.id AS invoice_id,
    i.school_id,
    i.student_id,
    i.session_id,
    i.term_id,
    i.class_id,
    i.reference,
    i.status,
    i.due_on,
    i.discount,
    i.discount_reason,
    i.issued_at,
    COALESCE(items.gross, 0::numeric) AS gross,
    COALESCE(items.gross, 0::numeric) - i.discount AS payable,
    COALESCE(paid.approved, 0::numeric) AS paid,
    CASE
            WHEN i.status = 'cancelled'::classroom.invoice_status THEN 0::numeric
            ELSE COALESCE(items.gross, 0::numeric) - i.discount - COALESCE(paid.approved, 0::numeric)
        END AS balance,
    COALESCE(pending.waiting, 0::numeric) AS awaiting_approval,
        CASE
            WHEN i.status = 'cancelled'::classroom.invoice_status THEN 'cancelled'::text
            WHEN (COALESCE(items.gross, 0::numeric) - i.discount - COALESCE(paid.approved, 0::numeric)) <= 0::numeric
             AND COALESCE(paid.moved, 0::numeric) > 0::numeric THEN 'carried forward'::text
            WHEN (COALESCE(items.gross, 0::numeric) - i.discount - COALESCE(paid.approved, 0::numeric)) <= 0::numeric THEN 'paid'::text
            WHEN COALESCE(paid.approved, 0::numeric) > 0::numeric THEN 'part paid'::text
            WHEN i.due_on IS NOT NULL AND i.due_on < CURRENT_DATE THEN 'overdue'::text
            ELSE 'unpaid'::text
        END AS standing,
        CASE
            WHEN i.student_id IS NULL THEN classroom.invoice_applicant_name(i.id)
            ELSE NULL::text
        END AS applicant_name,
    i.purpose
   FROM classroom.invoices i
     LEFT JOIN LATERAL ( SELECT sum(invoice_items.amount) AS gross
           FROM classroom.invoice_items
          WHERE invoice_items.invoice_id = i.id) items ON true
     LEFT JOIN LATERAL ( SELECT sum(payments.amount) AS approved,
                                sum(payments.amount) FILTER (WHERE payments.method = 'carried_forward'::classroom.payment_method) AS moved
           FROM classroom.payments
          WHERE payments.invoice_id = i.id AND payments.status = 'approved'::classroom.payment_status) paid ON true
     LEFT JOIN LATERAL ( SELECT sum(payments.amount) AS waiting
           FROM classroom.payments
          WHERE payments.invoice_id = i.id AND payments.status = 'submitted'::classroom.payment_status) pending ON true;

/* --- Removing what was brought forward ------------------------------------ */

-- The transfers that closed earlier bills into this one, removed, so those
-- bills owe again. Used by undo, and when the bill is deleted or voided.
create or replace function classroom.release_brought_forward(target_invoice uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  delete from classroom.payments p
   using classroom.invoice_items ii
   where ii.invoice_id = target_invoice
     and ii.brought_forward_from = p.invoice_id
     and p.method = 'carried_forward'
     and p.note = 'moved to ' || target_invoice::text;
end;
$fn$;

revoke all on function classroom.release_brought_forward(uuid) from public, anon, authenticated;

create or replace function classroom.invoices_release_brought_forward()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  if tg_op = 'DELETE' then
    perform classroom.release_brought_forward(old.id);
    delete from classroom.invoice_items where invoice_id = old.id and brought_forward_from is not null;
    return old;
  end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform classroom.release_brought_forward(new.id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists invoices_release_brought_forward on classroom.invoices;
create trigger invoices_release_brought_forward
  before delete or update of status on classroom.invoices
  for each row execute function classroom.invoices_release_brought_forward();

/* --- The bursar's action -------------------------------------------------- */

-- Moves every unpaid balance from bills of EARLIER terms onto each child's
-- draft term-fee bill for target_term. Only issued bills are moved (a draft
-- was never sent, a voided one owes nothing), only onto drafts (a bill the
-- family has already been sent does not change under them), and a child with
-- no draft yet is reported, not skipped silently.
create or replace function classroom.carry_forward_balances(target_term uuid)
returns jsonb
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  t      classroom.terms;
  s      classroom.sessions;
  src    record;
  dest   classroom.invoices;
  moved_count int := 0;
  moved_total numeric := 0;
  missing jsonb := '[]'::jsonb;
begin
  select * into t from classroom.terms where id = target_term;
  if not found then raise exception 'No such term'; end if;
  if not classroom.can_do_bursary(t.school_id) then
    raise exception 'Only the bursary can carry balances forward';
  end if;
  select * into s from classroom.sessions where id = t.session_id;

  for src in
    select b.invoice_id, b.student_id, b.reference, b.balance, b.term_id
      from classroom.invoice_balances b
      join classroom.invoices i on i.id = b.invoice_id
      join classroom.terms bt on bt.id = i.term_id
      join classroom.sessions bs on bs.id = bt.session_id
     where i.school_id = t.school_id
       and i.status = 'issued'
       and i.student_id is not null
       and b.balance > 0
       -- Earlier than the target term: an earlier session, or the same
       -- session and an earlier position.
       and (bs.starts_on < s.starts_on or (bs.id = s.id and bt.position < t.position))
     order by b.student_id, bs.starts_on, bt.position
  loop
    select * into dest
      from classroom.invoices
     where school_id = t.school_id
       and student_id = src.student_id
       and term_id = target_term
       and status = 'draft'
       and coalesce(purpose, 'term_fee') = 'term_fee'
     order by created_at
     limit 1;

    if not found then
      missing := missing || jsonb_build_object(
        'student_id', src.student_id,
        'from_reference', src.reference,
        'amount', src.balance);
      continue;
    end if;

    insert into classroom.invoice_items (invoice_id, name, amount, position, brought_forward_from)
    values (dest.id, 'Balance brought forward from ' || src.reference, src.balance, -1, src.invoice_id);

    insert into classroom.payments
      (school_id, invoice_id, amount, method, status, reference, paid_on, note, submitted_by, decided_by, decided_at, decision_note)
    values
      (t.school_id, src.invoice_id, src.balance, 'carried_forward', 'approved', dest.reference, current_date,
       'moved to ' || dest.id::text, auth.uid(), auth.uid(), now(),
       'Unpaid balance carried forward to ' || dest.reference);

    moved_count := moved_count + 1;
    moved_total := moved_total + src.balance;
  end loop;

  return jsonb_build_object('moved', moved_count, 'amount', moved_total, 'no_draft_bill', missing);
end;
$fn$;

grant execute on function classroom.carry_forward_balances(uuid) to authenticated;

-- Undo for one draft bill: its brought-forward lines go, the earlier bills
-- owe again.
create or replace function classroom.undo_carry_forward(target_invoice uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv classroom.invoices;
begin
  select * into inv from classroom.invoices where id = target_invoice;
  if not found then raise exception 'No such invoice'; end if;
  if not classroom.can_do_bursary(inv.school_id) then
    raise exception 'Only the bursary can do that';
  end if;
  if inv.status <> 'draft' then
    raise exception 'This bill has already been issued to the family, so what it carries cannot be changed. Void it and raise it again.';
  end if;
  perform classroom.release_brought_forward(target_invoice);
  delete from classroom.invoice_items where invoice_id = target_invoice and brought_forward_from is not null;
end;
$fn$;

grant execute on function classroom.undo_carry_forward(uuid) to authenticated;

notify pgrst, 'reload schema';
