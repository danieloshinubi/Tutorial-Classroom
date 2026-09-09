-- =============================================================================
-- Bursary: fee structures, invoices, and payments that need approving
--
-- The shape of the thing:
--
--   fee_structure     what a class is charged in a term — "JSS 1, First Term"
--   fee_items         the lines that make it up: tuition, books, bus
--   invoice           one student's copy of that, with a reference
--   invoice_items     COPIED from the fee items when the invoice is issued
--   payment           money against an invoice, which a bursar approves
--
-- Three decisions worth stating, because they are the ones that cause
-- arguments with parents if you get them wrong:
--
-- 1. Invoice items are copied, not referenced. When the school raises tuition
--    mid-term, invoices already issued keep the figures the parent was shown.
--    A fee structure is a template; an issued invoice is a statement of what
--    somebody owes, and rewriting it retrospectively is indefensible.
--
-- 2. A balance is never stored. It is invoice total minus APPROVED payments,
--    computed on read. A stored balance drifts the first time a payment is
--    approved by one route and not another, and then the school and the
--    parent hold different numbers.
--
-- 3. Only an approved payment reduces what is owed. A parent uploading a
--    transfer receipt creates a payment that is `submitted` — visible to
--    them, visible to the bursary, and worth nothing against the balance
--    until a bursar approves it. Rejecting one requires a reason.
-- =============================================================================

create type classroom.invoice_status as enum ('draft', 'issued', 'cancelled');
create type classroom.payment_status as enum ('submitted', 'approved', 'rejected');
create type classroom.payment_method as enum
  ('cash', 'transfer', 'pos', 'cheque', 'online', 'waiver');

/* -----------------------------------------------------------------------------
   What a class is charged in a term
   -------------------------------------------------------------------------- */
create table classroom.fee_structures (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  session_id uuid not null references classroom.sessions (id) on delete cascade,
  term_id    uuid not null references classroom.terms (id) on delete cascade,
  -- Null means "every class this term", which is how most schools start.
  class_id   uuid references classroom.classes (id) on delete cascade,
  name       text not null,
  due_on     date,
  notes      text,
  is_active  boolean not null default true,
  created_by uuid references classroom.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One structure per class per term. A partial index because null class_id
-- means "all classes", and null is not equal to itself in a unique index.
create unique index fee_structures_per_class
  on classroom.fee_structures (term_id, class_id) where class_id is not null;
create unique index fee_structures_whole_school
  on classroom.fee_structures (term_id) where class_id is null;

create index fee_structures_school_idx on classroom.fee_structures (school_id, term_id);

create table classroom.fee_items (
  id           uuid primary key default gen_random_uuid(),
  structure_id uuid not null references classroom.fee_structures (id) on delete cascade,
  name         text not null,
  amount       numeric(14,2) not null check (amount >= 0),
  -- A bus fare only applies to children who take the bus.
  is_optional  boolean not null default false,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create index fee_items_structure_idx on classroom.fee_items (structure_id, position);

/* -----------------------------------------------------------------------------
   One student's bill
   -------------------------------------------------------------------------- */
create table classroom.invoices (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  student_id   uuid not null references classroom.profiles (id) on delete cascade,
  session_id   uuid not null references classroom.sessions (id) on delete cascade,
  term_id      uuid not null references classroom.terms (id) on delete cascade,
  class_id     uuid references classroom.classes (id) on delete set null,
  structure_id uuid references classroom.fee_structures (id) on delete set null,

  reference    text not null,
  seq          int  not null,
  status       classroom.invoice_status not null default 'draft',

  -- A bursar's discretion: a scholarship, a staff child, a hardship case.
  -- Recorded with a reason so it can be explained at an audit.
  discount     numeric(14,2) not null default 0 check (discount >= 0),
  discount_reason text,

  due_on       date,
  notes        text,

  issued_by    uuid references classroom.profiles (id) on delete set null,
  issued_at    timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,

  created_by   uuid references classroom.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint invoices_reference_once unique (school_id, reference),
  constraint invoices_once_per_term unique (student_id, term_id)
);

create index invoices_school_idx  on classroom.invoices (school_id, term_id, status);
create index invoices_student_idx on classroom.invoices (student_id);

create table classroom.invoice_items (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references classroom.invoices (id) on delete cascade,
  name       text not null,
  amount     numeric(14,2) not null check (amount >= 0),
  position   int not null default 0
);

create index invoice_items_invoice_idx on classroom.invoice_items (invoice_id, position);

/* -----------------------------------------------------------------------------
   Money against a bill
   -------------------------------------------------------------------------- */
create table classroom.payments (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  invoice_id  uuid not null references classroom.invoices (id) on delete cascade,

  amount      numeric(14,2) not null check (amount > 0),
  method      classroom.payment_method not null default 'transfer',
  status      classroom.payment_status not null default 'submitted',

  -- The bank's reference, or the teller number written on the slip.
  reference   text,
  paid_on     date not null default current_date,
  note        text,

  -- Where an uploaded receipt lives, for a parent who paid at the bank.
  proof_path  text,

  submitted_by uuid references classroom.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  decided_by   uuid references classroom.profiles (id) on delete set null,
  decided_at   timestamptz,
  decision_note text
);

create index payments_invoice_idx on classroom.payments (invoice_id, status);
create index payments_school_idx  on classroom.payments (school_id, status, paid_on);

/* =============================================================================
   Helpers
   ============================================================================= */

-- Who runs the money. A principal is not on this list: they sign off results,
-- not the accounts.
create or replace function classroom.can_do_bursary(target_school uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select classroom.has_role_in(
    target_school,
    array['owner', 'admin', 'bursar']::classroom.member_role[]
  );
$fn$;

-- Is this invoice mine, or my child's?
create or replace function classroom.is_my_invoice(target_invoice uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select exists (
    select 1 from classroom.invoices i
    where i.id = target_invoice
      and (
        i.student_id = auth.uid()
        or exists (
          select 1 from classroom.guardian_students g
          where g.student_id = i.student_id and g.guardian_id = auth.uid()
        )
      )
  );
$fn$;

grant execute on function classroom.can_do_bursary(uuid) to authenticated;
grant execute on function classroom.is_my_invoice(uuid)  to authenticated;

/* =============================================================================
   Row level security
   ============================================================================= */
alter table classroom.fee_structures enable row level security;
alter table classroom.fee_items      enable row level security;
alter table classroom.invoices       enable row level security;
alter table classroom.invoice_items  enable row level security;
alter table classroom.payments       enable row level security;

/* --- fee structures: bursary writes, the school reads ---------------------- */
-- Families may read the structure: a parent is entitled to know what the
-- school charges for their child's class, and hiding it invites the
-- suspicion that the figures move.
create policy "the school reads its fee structures"
  on classroom.fee_structures for select to authenticated
  using (classroom.is_member_of(school_id));

create policy "bursary maintains fee structures"
  on classroom.fee_structures for all to authenticated
  using (classroom.can_do_bursary(school_id))
  with check (classroom.can_do_bursary(school_id));

create policy "the school reads fee items"
  on classroom.fee_items for select to authenticated
  using (
    exists (
      select 1 from classroom.fee_structures s
      where s.id = fee_items.structure_id and classroom.is_member_of(s.school_id)
    )
  );

create policy "bursary maintains fee items"
  on classroom.fee_items for all to authenticated
  using (
    exists (
      select 1 from classroom.fee_structures s
      where s.id = fee_items.structure_id and classroom.can_do_bursary(s.school_id)
    )
  )
  with check (
    exists (
      select 1 from classroom.fee_structures s
      where s.id = fee_items.structure_id and classroom.can_do_bursary(s.school_id)
    )
  );

/* --- invoices -------------------------------------------------------------- */
create policy "bursary reads every invoice"
  on classroom.invoices for select to authenticated
  using (classroom.can_do_bursary(school_id));

-- A family sees an invoice once it has been issued. A draft is the bursary
-- still working, and a parent chasing a figure that has not been agreed is
-- nobody's idea of a good afternoon.
create policy "families read their issued invoices"
  on classroom.invoices for select to authenticated
  using (
    status <> 'draft'
    and (
      student_id = auth.uid()
      or exists (
        select 1 from classroom.guardian_students g
        where g.student_id = invoices.student_id and g.guardian_id = auth.uid()
      )
    )
  );

-- No direct INSERT, UPDATE or DELETE policy. Invoices are raised, issued and
-- cancelled through the functions below, which stamp who did it and refuse to
-- alter an invoice that money has already been approved against.

create policy "bursary reads invoice items"
  on classroom.invoice_items for select to authenticated
  using (
    exists (
      select 1 from classroom.invoices i
      where i.id = invoice_items.invoice_id and classroom.can_do_bursary(i.school_id)
    )
  );

create policy "families read their invoice items"
  on classroom.invoice_items for select to authenticated
  using (
    exists (
      select 1 from classroom.invoices i
      where i.id = invoice_items.invoice_id
        and i.status <> 'draft'
        and classroom.is_my_invoice(i.id)
    )
  );

/* --- payments -------------------------------------------------------------- */
create policy "bursary reads every payment"
  on classroom.payments for select to authenticated
  using (classroom.can_do_bursary(school_id));

create policy "families read payments on their invoices"
  on classroom.payments for select to authenticated
  using (classroom.is_my_invoice(invoice_id));

-- A parent may declare a payment they have made. Note what the WITH CHECK
-- forbids: any status other than submitted. They cannot approve their own
-- money, and there is no policy that would let them try.
create policy "families declare a payment"
  on classroom.payments for insert to authenticated
  with check (
    status = 'submitted'
    and decided_by is null
    and decided_at is null
    and submitted_by = auth.uid()
    and classroom.is_my_invoice(invoice_id)
    and exists (
      select 1 from classroom.invoices i
      where i.id = payments.invoice_id and i.status = 'issued'
    )
  );

-- A family may correct a declaration while it is still waiting, and withdraw
-- one they got wrong. Once decided it is a record.
create policy "families fix a waiting declaration"
  on classroom.payments for update to authenticated
  using (status = 'submitted' and submitted_by = auth.uid() and classroom.is_my_invoice(invoice_id))
  with check (status = 'submitted' and submitted_by = auth.uid());

create policy "families withdraw a waiting declaration"
  on classroom.payments for delete to authenticated
  using (status = 'submitted' and submitted_by = auth.uid() and classroom.is_my_invoice(invoice_id));

-- The bursary records money taken at the desk.
create policy "bursary records a payment"
  on classroom.payments for insert to authenticated
  with check (classroom.can_do_bursary(school_id));

-- Deliberately no UPDATE policy for the bursary: approving and rejecting go
-- through the functions below so that every decision is stamped with who made
-- it. Nothing can quietly flip a payment to approved.

grant select, insert, update, delete on classroom.fee_structures to authenticated;
grant select, insert, update, delete on classroom.fee_items      to authenticated;
grant select, insert, update, delete on classroom.invoices       to authenticated;
grant select, insert, update, delete on classroom.invoice_items  to authenticated;
grant select, insert, update, delete on classroom.payments       to authenticated;

/* =============================================================================
   Raising and issuing invoices
   ============================================================================= */

-- INV/JNC/2026/0001 — recognisable when a parent reads it down the phone.
create or replace function classroom.next_invoice_reference(
  target_school uuid,
  target_term   uuid
)
returns table (reference text, seq int)
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  school   classroom.schools;
  sess     classroom.sessions;
  next_seq int;
  prefix   text;
begin
  select * into school from classroom.schools where id = target_school;
  select s.* into sess
  from classroom.sessions s
  join classroom.terms t on t.session_id = s.id
  where t.id = target_term;

  -- Serialise numbering for this school, as the admissions reference does.
  perform pg_advisory_xact_lock(hashtext('invoice:' || target_school::text));

  select coalesce(max(i.seq), 0) + 1 into next_seq
  from classroom.invoices i
  where i.school_id = target_school;

  select string_agg(left(word, 1), '')
  into prefix
  from (select regexp_split_to_table(upper(school.name), '[^A-Z0-9]+') as word) parts
  where word <> '';

  return query select
    format('INV/%s/%s/%s',
           coalesce(nullif(left(prefix, 4), ''), 'SCH'),
           classroom.reference_year(sess.name),
           lpad(next_seq::text, 4, '0')),
    next_seq;
end;
$fn$;

-- Raises one student's invoice from a fee structure, copying its lines.
-- Optional items are left off unless asked for by name, because a bus fare
-- charged to a child who walks is the fastest way to lose a parent's trust.
create or replace function classroom.raise_invoice(
  target_structure uuid,
  target_student   uuid,
  include_optional text[] default '{}',
  discount         numeric default 0,
  discount_reason  text default null
)
returns classroom.invoices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  st       classroom.fee_structures;
  inv      classroom.invoices;
  ref      text;
  next_seq int;
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

  if discount < 0 then
    raise exception 'A discount cannot be negative';
  end if;

  if discount > 0 and btrim(coalesce(discount_reason, '')) = '' then
    raise exception 'Say why the discount was given — it has to be explainable later';
  end if;

  select class_id into the_class from classroom.class_students
  where student_id = target_student
    and class_id in (select id from classroom.classes where session_id = st.session_id)
  limit 1;

  select r.reference, r.seq into ref, next_seq
  from classroom.next_invoice_reference(st.school_id, st.term_id) r;

  insert into classroom.invoices (
    school_id, student_id, session_id, term_id, class_id, structure_id,
    reference, seq, due_on, discount, discount_reason, created_by
  ) values (
    st.school_id, target_student, st.session_id, st.term_id,
    coalesce(the_class, st.class_id), st.id,
    ref, next_seq, st.due_on, discount, nullif(btrim(coalesce(discount_reason,'')), ''),
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

-- Raises one invoice per student in the class, skipping anyone who already
-- has one for that term. Returns how many it made.
create or replace function classroom.raise_invoices_for_class(target_structure uuid)
returns int
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  st    classroom.fee_structures;
  made  int := 0;
  pupil uuid;
begin
  select * into st from classroom.fee_structures where id = target_structure;
  if not found then
    raise exception 'No such fee structure';
  end if;

  if not classroom.can_do_bursary(st.school_id) then
    raise exception 'Only the bursary can raise invoices';
  end if;

  for pupil in
    select m.user_id
    from classroom.school_members m
    where m.school_id = st.school_id
      and m.is_active
      and m.role = 'student'
      and (
        st.class_id is null
        or exists (
          select 1 from classroom.class_students cs
          where cs.student_id = m.user_id and cs.class_id = st.class_id
        )
      )
      and not exists (
        select 1 from classroom.invoices i
        where i.student_id = m.user_id and i.term_id = st.term_id
      )
  loop
    perform classroom.raise_invoice(target_structure, pupil);
    made := made + 1;
  end loop;

  return made;
end;
$fn$;

-- Issuing is what makes an invoice visible to the family, and freezes it.
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
         format('Fees for %s', t.name),
         format('%s — %s', inv.reference, to_char(
           (select coalesce(sum(amount), 0) from classroom.invoice_items where invoice_id = inv.id)
           - inv.discount, 'FM999,999,999.00')),
         '/Fees'
  from classroom.terms t,
  lateral (
    select inv.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g where g.student_id = inv.student_id
  ) people
  where t.id = inv.term_id and recipient is not null;

  return inv;
end;
$fn$;

create or replace function classroom.cancel_invoice(target_invoice uuid, reason text)
returns classroom.invoices
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv  classroom.invoices;
  paid numeric;
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

  update classroom.invoices
  set status = 'cancelled', cancelled_at = now(),
      cancel_reason = btrim(reason), updated_at = now()
  where id = target_invoice
  returning * into inv;

  return inv;
end;
$fn$;

/* =============================================================================
   Approving money
   ============================================================================= */

create or replace function classroom.approve_payment(
  target_payment uuid,
  note           text default null
)
returns classroom.payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  pay classroom.payments;
  inv classroom.invoices;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  if not classroom.can_do_bursary(pay.school_id) then
    raise exception 'Only the bursary can approve a payment';
  end if;

  if pay.status <> 'submitted' then
    raise exception 'That payment is already %', pay.status;
  end if;

  update classroom.payments
  set status = 'approved', decided_by = auth.uid(),
      decided_at = now(), decision_note = note
  where id = target_payment
  returning * into pay;

  select * into inv from classroom.invoices where id = pay.invoice_id;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select recipient, pay.school_id, 'payment_approved',
         'Payment received',
         format('%s against %s', to_char(pay.amount, 'FM999,999,999.00'), inv.reference),
         '/Fees'
  from lateral (
    select inv.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g where g.student_id = inv.student_id
  ) people
  where recipient is not null;

  return pay;
end;
$fn$;

create or replace function classroom.reject_payment(
  target_payment uuid,
  note           text
)
returns classroom.payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  pay classroom.payments;
  inv classroom.invoices;
begin
  select * into pay from classroom.payments where id = target_payment;
  if not found then
    raise exception 'No such payment';
  end if;

  if not classroom.can_do_bursary(pay.school_id) then
    raise exception 'Only the bursary can reject a payment';
  end if;

  -- Telling a parent their money was refused without saying why is how a
  -- bursary spends its week on the phone.
  if btrim(coalesce(note, '')) = '' then
    raise exception 'Say why the payment is being rejected';
  end if;

  if pay.status <> 'submitted' then
    raise exception 'That payment is already %', pay.status;
  end if;

  update classroom.payments
  set status = 'rejected', decided_by = auth.uid(),
      decided_at = now(), decision_note = btrim(note)
  where id = target_payment
  returning * into pay;

  select * into inv from classroom.invoices where id = pay.invoice_id;

  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select recipient, pay.school_id, 'payment_rejected',
         'A payment could not be accepted',
         format('%s against %s — %s',
                to_char(pay.amount, 'FM999,999,999.00'), inv.reference, btrim(note)),
         '/Fees'
  from lateral (
    select inv.student_id as recipient
    union
    select g.guardian_id from classroom.guardian_students g where g.student_id = inv.student_id
  ) people
  where recipient is not null;

  return pay;
end;
$fn$;

-- Money taken at the desk: recorded and approved in one movement, because the
-- bursar counting the notes IS the approval. Still stamped, so the trail
-- shows who took it.
create or replace function classroom.take_payment(
  target_invoice uuid,
  amount         numeric,
  method         classroom.payment_method default 'cash',
  reference      text default null,
  paid_on        date default current_date,
  note           text default null
)
returns classroom.payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  inv classroom.invoices;
  pay classroom.payments;
begin
  select * into inv from classroom.invoices where id = target_invoice;
  if not found then
    raise exception 'No such invoice';
  end if;

  if not classroom.can_do_bursary(inv.school_id) then
    raise exception 'Only the bursary can take a payment';
  end if;

  if inv.status <> 'issued' then
    raise exception 'That invoice is %, so nothing can be paid against it', inv.status;
  end if;

  if amount is null or amount <= 0 then
    raise exception 'A payment has to be more than nothing';
  end if;

  insert into classroom.payments (
    school_id, invoice_id, amount, method, status, reference, paid_on, note,
    submitted_by, decided_by, decided_at
  ) values (
    inv.school_id, target_invoice, amount, method, 'approved',
    nullif(btrim(coalesce(reference, '')), ''), coalesce(paid_on, current_date),
    nullif(btrim(coalesce(note, '')), ''),
    auth.uid(), auth.uid(), now()
  )
  returning * into pay;

  return pay;
end;
$fn$;

grant execute on function classroom.next_invoice_reference(uuid, uuid)                  to authenticated;
grant execute on function classroom.raise_invoice(uuid, uuid, text[], numeric, text)    to authenticated;
grant execute on function classroom.raise_invoices_for_class(uuid)                      to authenticated;
grant execute on function classroom.issue_invoice(uuid)                                 to authenticated;
grant execute on function classroom.cancel_invoice(uuid, text)                          to authenticated;
grant execute on function classroom.approve_payment(uuid, text)                         to authenticated;
grant execute on function classroom.reject_payment(uuid, text)                          to authenticated;
grant execute on function classroom.take_payment(uuid, numeric, classroom.payment_method, text, date, text) to authenticated;

/* =============================================================================
   Reading the money back

   security_invoker, so a parent selecting from these views gets their own
   children and a bursar gets the school — the policies above decide, not the
   view.
   ============================================================================= */
create view classroom.invoice_balances with (security_invoker = true) as
select
  i.id            as invoice_id,
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
  coalesce(items.gross, 0)                              as gross,
  coalesce(items.gross, 0) - i.discount                 as payable,
  coalesce(paid.approved, 0)                            as paid,
  coalesce(items.gross, 0) - i.discount - coalesce(paid.approved, 0) as balance,
  coalesce(pending.waiting, 0)                          as awaiting_approval,
  case
    when i.status = 'cancelled' then 'cancelled'
    when coalesce(items.gross, 0) - i.discount - coalesce(paid.approved, 0) <= 0 then 'paid'
    when coalesce(paid.approved, 0) > 0 then 'part paid'
    when i.due_on is not null and i.due_on < current_date then 'overdue'
    else 'unpaid'
  end                                                   as standing
from classroom.invoices i
left join lateral (
  select sum(amount) as gross from classroom.invoice_items where invoice_id = i.id
) items on true
left join lateral (
  select sum(amount) as approved from classroom.payments
  where invoice_id = i.id and status = 'approved'
) paid on true
left join lateral (
  select sum(amount) as waiting from classroom.payments
  where invoice_id = i.id and status = 'submitted'
) pending on true;

grant select on classroom.invoice_balances to authenticated;

-- Who owes what, worst first. The bursar's morning.
create or replace function classroom.debtors(
  target_school uuid,
  target_term   uuid default null
)
returns table (
  student_id uuid,
  student    text,
  class_name text,
  invoices   int,
  payable    numeric,
  paid       numeric,
  balance    numeric,
  oldest_due date,
  guardians  text
)
language sql stable security definer
set search_path = classroom, public
as $fn$
  select
    b.student_id,
    coalesce(nullif(btrim(p.first_name || ' ' || p.surname), ''), p.username, p.email),
    c.name,
    count(*)::int,
    sum(b.payable),
    sum(b.paid),
    sum(b.balance),
    min(b.due_on),
    (
      select string_agg(
        coalesce(nullif(btrim(gp.first_name || ' ' || gp.surname), ''), gp.email)
        || coalesce(' <' || gp.email || '>', ''), ', ')
      from classroom.guardian_students g
      join classroom.profiles gp on gp.id = g.guardian_id
      where g.student_id = b.student_id
    )
  from classroom.invoice_balances b
  join classroom.profiles p on p.id = b.student_id
  left join classroom.classes c on c.id = b.class_id
  where b.school_id = target_school
    and b.status = 'issued'
    and b.balance > 0
    and (target_term is null or b.term_id = target_term)
    and classroom.can_do_bursary(target_school)
  group by b.student_id, p.first_name, p.surname, p.username, p.email, c.name
  order by sum(b.balance) desc;
$fn$;

-- The one number a proprietor asks for.
create or replace function classroom.collection_summary(
  target_school uuid,
  target_term   uuid default null
)
returns table (
  invoiced        numeric,
  collected       numeric,
  outstanding     numeric,
  awaiting        numeric,
  collection_rate numeric,
  invoices        int,
  settled         int,
  debtors         int
)
language sql stable security definer
set search_path = classroom, public
as $fn$
  select
    coalesce(sum(b.payable), 0),
    coalesce(sum(b.paid), 0),
    coalesce(sum(b.balance), 0),
    coalesce(sum(b.awaiting_approval), 0),
    case
      when coalesce(sum(b.payable), 0) = 0 then null
      else round(coalesce(sum(b.paid), 0) * 100.0 / sum(b.payable), 1)
    end,
    count(*)::int,
    count(*) filter (where b.balance <= 0)::int,
    count(*) filter (where b.balance > 0)::int
  from classroom.invoice_balances b
  where b.school_id = target_school
    and b.status = 'issued'
    and (target_term is null or b.term_id = target_term)
    and classroom.can_do_bursary(target_school);
$fn$;

grant execute on function classroom.debtors(uuid, uuid)            to authenticated;
grant execute on function classroom.collection_summary(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
