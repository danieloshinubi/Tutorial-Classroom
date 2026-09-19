-- =============================================================================
-- Billing records — a ledger, not a billing engine. Today classroom.
-- schools.plan is a free-text label ('trial'/'basic'/'standard'/'premium')
-- with no connection to money at all: nothing charges a school, nothing
-- tracks whether an invoice for a given period was ever paid. Building an
-- actual recurring-billing engine (subscriptions, card-on-file, dunning,
-- automatic plan downgrade on non-payment) is a project of its own — far
-- past what belongs in this pass alongside eight other features — so this
-- is deliberately the smaller, honest piece: a manual record of what a
-- school owes/paid for a given period, kept by platform staff by hand,
-- exactly the way a small SaaS invoices on Paystack/bank transfer/Stripe
-- links today rather than through in-app recurring billing. It gives you
-- a real history to look back on and a place to note "this school is
-- overdue" — it does not collect a single naira from anyone.
-- =============================================================================

create table if not exists classroom.billing_records (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references classroom.schools (id) on delete cascade,
  plan          text not null,
  amount        numeric(12,2) not null check (amount >= 0),
  currency      text not null default 'NGN',
  period_start  date not null,
  period_end    date not null check (period_end > period_start),
  status        text not null default 'pending' check (status in ('pending','paid','overdue','waived')),
  note          text,
  recorded_by   uuid references classroom.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists billing_records_school_idx on classroom.billing_records (school_id, period_start desc);

alter table classroom.billing_records enable row level security;

-- Platform-only, same as payment_gateways' own posture: nothing here is a
-- school's own data to read, even for its own owner — a school seeing its
-- own billing history would be a real feature eventually, but that's a
-- tenant-facing invoices page, a different piece of work from this ledger.
drop policy if exists "platform admins manage billing records" on classroom.billing_records;
create policy "platform admins manage billing records"
  on classroom.billing_records for all to authenticated
  using (classroom.is_platform_admin())
  with check (classroom.is_platform_admin());

drop trigger if exists audit_trg on classroom.billing_records;
create trigger audit_trg after insert or update or delete on classroom.billing_records
  for each row execute function classroom.write_audit_log();

create or replace function classroom.touch_billing_record()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists billing_records_touch on classroom.billing_records;
create trigger billing_records_touch before update on classroom.billing_records
  for each row execute function classroom.touch_billing_record();

create or replace function classroom.platform_add_billing_record(
  target_school   uuid,
  plan_in         text,
  amount_in       numeric,
  currency_in     text,
  period_start_in date,
  period_end_in   date,
  status_in       text default 'pending',
  note_in         text default null
) returns classroom.billing_records
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  row classroom.billing_records;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can record billing';
  end if;

  insert into classroom.billing_records
    (school_id, plan, amount, currency, period_start, period_end, status, note, recorded_by)
  values
    (target_school, plan_in, amount_in, coalesce(currency_in, 'NGN'),
     period_start_in, period_end_in, coalesce(status_in, 'pending'), note_in, auth.uid())
  returning * into row;

  return row;
end;
$fn$;

grant execute on function classroom.platform_add_billing_record(uuid, text, numeric, text, date, date, text, text) to authenticated;

create or replace function classroom.platform_set_billing_status(target_record uuid, status_in text)
returns classroom.billing_records
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  row classroom.billing_records;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can update billing';
  end if;
  if status_in not in ('pending','paid','overdue','waived') then
    raise exception 'Unknown billing status: %', status_in;
  end if;

  update classroom.billing_records set status = status_in
  where id = target_record
  returning * into row;

  if not found then raise exception 'No such billing record'; end if;
  return row;
end;
$fn$;

grant execute on function classroom.platform_set_billing_status(uuid, text) to authenticated;

create or replace function classroom.platform_billing_for_school(target_school uuid)
returns setof classroom.billing_records
language sql stable security definer
set search_path = classroom, public
as $fn$
  select * from classroom.billing_records
  where school_id = target_school and classroom.is_platform_admin()
  order by period_start desc;
$fn$;

grant execute on function classroom.platform_billing_for_school(uuid) to authenticated;

notify pgrst, 'reload schema';
