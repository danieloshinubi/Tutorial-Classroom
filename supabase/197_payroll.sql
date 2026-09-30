-- =============================================================================
-- Payroll (Phase 3).
--
-- Monthly payroll for any school: staff pay, PAYE, pension, NHF, the school's
-- own deductions (loans, salary advances, cooperative savings, insurance),
-- and payments to consultants, vendors and honoraria with withholding tax.
--
-- Decisions it follows (the school's, not ours):
--   * PAYE under the Nigeria Tax Act 2025 (in force 1 Jan 2026): 0% on the
--     first N800,000 a year, then 15%, 18%, 21%, 23% and 25%; no
--     consolidated relief; rent relief of 20% of rent paid, capped at
--     N500,000. Pension, NHF and approved insurance come off before tax.
--     The bands are data, not code: each school's copy can be edited when
--     the law changes, and the school confirms them before its first
--     payroll can be approved.
--   * Contributory pension 8% employee, 10% employer, on basic + housing +
--     transport (Pension Reform Act 2014). NHF 2.5% of basic, for staff who
--     contribute.
--   * Anyone can be paid, with or without a Schoolivio login; a staff record
--     links to an account when there is one, so that person can see their
--     own payslips.
--   * The school says who approves (the Proprietress, i.e. owner, by
--     default). Preparing and approving are separate steps.
--
-- Salaries are the most sensitive data in the system: only owner, admin and
-- bursar can read or change payroll, and each person can read only their own
-- approved payslips. Every table is audited.
--
-- In the books (188), when a school keeps them:
--   approve  Dr Salaries (gross) and Employer pension; Cr PAYE, Pension,
--            NHF and Staff deductions payable, and Salaries payable (net)
--   paid     Dr Salaries payable, Cr Bank
--   a payment to a consultant: Dr Consultants and honoraria (gross),
--            Cr Withholding tax payable and Bank/Cash (net)
-- =============================================================================

-- ------------------------------------------------------------ who may do it

create or replace function classroom.can_do_payroll(target_school uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select classroom.has_role_in(target_school, array['owner', 'admin', 'bursar']::classroom.member_role[]);
$fn$;

grant execute on function classroom.can_do_payroll(uuid) to authenticated;

-- ---------------------------------------------------------------- settings

create table if not exists classroom.payroll_settings (
  school_id            uuid primary key references classroom.schools (id) on delete cascade,
  -- [{ "upto": 800000, "rate": 0 }, ..., { "upto": null, "rate": 25 }], annual,
  -- cumulative upper limits, in order.
  paye_bands           jsonb not null default '[
    {"upto": 800000, "rate": 0},
    {"upto": 3000000, "rate": 15},
    {"upto": 12000000, "rate": 18},
    {"upto": 25000000, "rate": 21},
    {"upto": 50000000, "rate": 23},
    {"upto": null, "rate": 25}
  ]'::jsonb,
  rent_relief_percent  numeric(5,2) not null default 20 check (rent_relief_percent between 0 and 100),
  rent_relief_cap      numeric(14,2) not null default 500000 check (rent_relief_cap >= 0),
  pension_employee_percent numeric(5,2) not null default 8 check (pension_employee_percent between 0 and 100),
  pension_employer_percent numeric(5,2) not null default 10 check (pension_employer_percent between 0 and 100),
  nhf_percent          numeric(5,2) not null default 2.5 check (nhf_percent between 0 and 100),
  pay_day              int check (pay_day between 1 and 31),          -- null: last day of the month
  approver_roles       classroom.member_role[] not null default array['owner']::classroom.member_role[],
  tax_office           text,
  paying_bank          text,
  bands_confirmed_at   timestamptz,
  bands_confirmed_by   uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ------------------------------------------------------------------- staff

create table if not exists classroom.payroll_staff (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references classroom.schools (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  full_name       text not null check (btrim(full_name) <> ''),
  job_title       text,
  start_date      date,
  end_date        date,
  is_active       boolean not null default true,
  basic           numeric(14,2) not null default 0 check (basic >= 0),
  housing         numeric(14,2) not null default 0 check (housing >= 0),
  transport       numeric(14,2) not null default 0 check (transport >= 0),
  -- [{ "label": "Responsibility", "amount": 10000 }], monthly
  other_allowances jsonb not null default '[]'::jsonb,
  pension_applies boolean not null default true,
  nhf_applies     boolean not null default false,
  annual_rent     numeric(14,2) not null default 0 check (annual_rent >= 0),
  bank_name       text,
  account_number  text,
  account_name    text,
  tin             text,
  pension_provider text,
  rsa_pin         text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint payroll_staff_dates check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists payroll_staff_school_idx on classroom.payroll_staff (school_id, is_active);
create unique index if not exists payroll_staff_user_once
  on classroom.payroll_staff (school_id, user_id) where user_id is not null;

-- ----------------------------------------------- the school's own deductions

create table if not exists classroom.payroll_deduction_types (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references classroom.schools (id) on delete cascade,
  label      text not null check (btrim(label) <> ''),
  -- Health insurance and life assurance premiums reduce taxable pay; loans,
  -- advances and cooperative savings do not.
  before_tax boolean not null default false,
  is_active  boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists payroll_deduction_types_label_once
  on classroom.payroll_deduction_types (school_id, lower(btrim(label)));

create table if not exists classroom.payroll_staff_deductions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  staff_id    uuid not null references classroom.payroll_staff (id) on delete cascade,
  type_id     uuid not null references classroom.payroll_deduction_types (id) on delete restrict,
  kind        text not null default 'fixed' check (kind in ('fixed', 'percent')),
  -- Monthly: an amount, or a percentage of gross pay.
  value       numeric(14,2) not null check (value > 0),
  -- For a loan or advance: what is still owed. Each approved payroll takes
  -- it down; at zero the deduction stops by itself.
  balance     numeric(14,2) check (balance >= 0),
  starts_on   date,
  ends_on     date,
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint payroll_staff_deductions_percent check (kind <> 'percent' or value <= 100)
);

create index if not exists payroll_staff_deductions_staff_idx on classroom.payroll_staff_deductions (staff_id);

-- -------------------------------------------------------------- runs, slips

create table if not exists classroom.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references classroom.schools (id) on delete cascade,
  period       date not null check (extract(day from period) = 1),   -- the month, as its 1st
  status       text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  note         text,
  prepared_by  uuid references auth.users (id) on delete set null,
  prepared_at  timestamptz not null default now(),
  approved_by  uuid references auth.users (id) on delete set null,
  approved_at  timestamptz,
  paid_on      date,
  paid_by      uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create unique index if not exists payroll_runs_once_per_month on classroom.payroll_runs (school_id, period);

create table if not exists classroom.payslips (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references classroom.schools (id) on delete cascade,
  run_id           uuid not null references classroom.payroll_runs (id) on delete cascade,
  staff_id         uuid references classroom.payroll_staff (id) on delete set null,
  user_id          uuid references auth.users (id) on delete set null,
  -- A snapshot: the payslip says what was paid, whatever changes later.
  full_name        text not null,
  job_title        text,
  bank_name        text,
  account_number   text,
  account_name     text,
  tin              text,
  pension_provider text,
  rsa_pin          text,
  days_factor      numeric(6,4) not null default 1,     -- part month for a joiner/leaver
  earnings         jsonb not null default '[]'::jsonb,  -- [{label, amount}]
  deductions       jsonb not null default '[]'::jsonb,  -- [{label, amount, before_tax, deduction_id}]
  gross            numeric(14,2) not null default 0,
  pension_employee numeric(14,2) not null default 0,
  pension_employer numeric(14,2) not null default 0,
  nhf              numeric(14,2) not null default 0,
  rent_relief      numeric(14,2) not null default 0,    -- annual
  taxable_annual   numeric(14,2) not null default 0,
  paye             numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  net              numeric(14,2) not null default 0,
  created_at       timestamptz not null default now(),
  constraint payslips_once_per_run unique (run_id, staff_id)
);

create index if not exists payslips_user_idx on classroom.payslips (user_id);

-- ------------------------------------------------ consultants, vendors, etc

create table if not exists classroom.payroll_payees (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references classroom.schools (id) on delete cascade,
  name           text not null check (btrim(name) <> ''),
  kind           text not null default 'consultant' check (kind in ('consultant', 'vendor', 'honorarium', 'other')),
  service        text,
  wht_rate       numeric(5,2) not null default 0 check (wht_rate between 0 and 100),
  bank_name      text,
  account_number text,
  account_name   text,
  tin            text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists classroom.payroll_payee_payments (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references classroom.schools (id) on delete cascade,
  payee_id    uuid not null references classroom.payroll_payees (id) on delete restrict,
  description text not null check (btrim(description) <> ''),
  gross       numeric(14,2) not null check (gross > 0),
  wht_rate    numeric(5,2) not null check (wht_rate between 0 and 100),
  wht         numeric(14,2) not null,
  net         numeric(14,2) not null,
  paid_on     date not null default current_date,
  paid_from   text not null default 'bank' check (paid_from in ('bank', 'cash')),
  reference   text,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists payroll_payee_payments_school_idx on classroom.payroll_payee_payments (school_id, paid_on);

-- --------------------------------------------------------------------- RLS

do $$
declare t text;
begin
  foreach t in array array['payroll_settings', 'payroll_staff', 'payroll_deduction_types', 'payroll_staff_deductions',
                           'payroll_runs', 'payroll_payees', 'payroll_payee_payments']
  loop
    execute format('alter table classroom.%I enable row level security', t);
    execute format('drop policy if exists "payroll staff manage" on classroom.%I', t);
    execute format(
      'create policy "payroll staff manage" on classroom.%I for all to authenticated
         using (classroom.can_do_payroll(school_id)) with check (classroom.can_do_payroll(school_id))', t);
    execute format('grant select, insert, update, delete on classroom.%I to authenticated', t);
  end loop;
end $$;

-- Runs and payslips change only through the functions below.
revoke insert, update, delete on classroom.payroll_runs from authenticated;
drop policy if exists "payroll staff manage" on classroom.payroll_runs;
create policy "payroll staff read runs" on classroom.payroll_runs for select to authenticated
  using (classroom.can_do_payroll(school_id));
-- Payments to consultants go through record_payee_payment (it posts them).
revoke insert, update, delete on classroom.payroll_payee_payments from authenticated;

-- Whether a run's payslips have been released to staff. A function, because
-- staff cannot read payroll_runs themselves, and a policy's subquery runs
-- with the reader's own permissions.
create or replace function classroom.payroll_run_released(target_run uuid)
returns boolean
language sql stable security definer
set search_path = classroom, public
as $fn$
  select exists (select 1 from classroom.payroll_runs where id = target_run and status in ('approved', 'paid'));
$fn$;

grant execute on function classroom.payroll_run_released(uuid) to authenticated;

alter table classroom.payslips enable row level security;
drop policy if exists "payroll staff read payslips" on classroom.payslips;
create policy "payroll staff read payslips" on classroom.payslips for select to authenticated
  using (classroom.can_do_payroll(school_id));
drop policy if exists "people read their own approved payslips" on classroom.payslips;
create policy "people read their own approved payslips" on classroom.payslips for select to authenticated
  using (user_id = auth.uid() and classroom.payroll_run_released(run_id));
grant select on classroom.payslips to authenticated;

do $$
declare t text;
begin
  foreach t in array array['payroll_settings', 'payroll_staff', 'payroll_deduction_types', 'payroll_staff_deductions',
                           'payroll_runs', 'payslips', 'payroll_payees', 'payroll_payee_payments']
  loop
    execute format(
      'drop trigger if exists audit_trg on classroom.%I;
       create trigger audit_trg after insert or update or delete on classroom.%I
         for each row execute function classroom.write_audit_log();', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------ the arithmetic

-- Tax on an annual chargeable income, band by band.
create or replace function classroom.payroll_annual_tax(chargeable numeric, bands jsonb)
returns numeric
language plpgsql
immutable
as $fn$
declare
  band jsonb;
  lower_limit numeric := 0;
  upper_limit numeric;
  tax numeric := 0;
begin
  if chargeable is null or chargeable <= 0 then return 0; end if;
  for band in select * from jsonb_array_elements(bands)
  loop
    upper_limit := nullif(band ->> 'upto', '')::numeric;
    if upper_limit is null or chargeable <= upper_limit then
      tax := tax + (chargeable - lower_limit) * (band ->> 'rate')::numeric / 100;
      return round(tax, 2);
    end if;
    tax := tax + (upper_limit - lower_limit) * (band ->> 'rate')::numeric / 100;
    lower_limit := upper_limit;
  end loop;
  return round(tax, 2);
end;
$fn$;

grant execute on function classroom.payroll_annual_tax(numeric, jsonb) to authenticated;

-- One staff member's payslip for a month, worked out (not saved).
create or replace function classroom.payroll_compute(target_staff uuid, period_in date)
returns jsonb
language plpgsql
stable
security definer
set search_path = classroom, public
as $fn$
declare
  st   classroom.payroll_staff;
  cfg  classroom.payroll_settings;
  month_start date := date_trunc('month', period_in)::date;
  month_end   date := (date_trunc('month', period_in) + interval '1 month - 1 day')::date;
  days_in     int;
  worked_from date;
  worked_to   date;
  factor      numeric := 1;
  earnings    jsonb := '[]'::jsonb;
  deductions  jsonb := '[]'::jsonb;
  allowance   jsonb;
  gross       numeric := 0;
  basic       numeric;
  housing     numeric;
  transport   numeric;
  pension_emp numeric := 0;
  pension_er  numeric := 0;
  nhf         numeric := 0;
  before_tax  numeric := 0;
  after_tax   numeric := 0;
  rent_relief numeric := 0;
  chargeable  numeric := 0;
  paye        numeric := 0;
  d           record;
  amount      numeric;
begin
  select * into st from classroom.payroll_staff where id = target_staff;
  if not found then raise exception 'No such staff member'; end if;
  select * into cfg from classroom.payroll_settings where school_id = st.school_id;
  if not found then raise exception 'Set up payroll first'; end if;

  -- Part month for someone who joined or left during it.
  days_in := month_end - month_start + 1;
  worked_from := greatest(month_start, coalesce(st.start_date, month_start));
  worked_to := least(month_end, coalesce(st.end_date, month_end));
  if worked_to < worked_from then
    factor := 0;
  elsif worked_from > month_start or worked_to < month_end then
    factor := round((worked_to - worked_from + 1)::numeric / days_in, 4);
  end if;

  basic := round(st.basic * factor, 2);
  housing := round(st.housing * factor, 2);
  transport := round(st.transport * factor, 2);
  if basic > 0 then earnings := earnings || jsonb_build_object('label', 'Basic salary', 'amount', basic); end if;
  if housing > 0 then earnings := earnings || jsonb_build_object('label', 'Housing', 'amount', housing); end if;
  if transport > 0 then earnings := earnings || jsonb_build_object('label', 'Transport', 'amount', transport); end if;
  gross := basic + housing + transport;
  for allowance in select * from jsonb_array_elements(coalesce(st.other_allowances, '[]'::jsonb))
  loop
    amount := round(coalesce((allowance ->> 'amount')::numeric, 0) * factor, 2);
    continue when amount <= 0;
    earnings := earnings || jsonb_build_object('label', coalesce(nullif(btrim(allowance ->> 'label'), ''), 'Allowance'), 'amount', amount);
    gross := gross + amount;
  end loop;

  if st.pension_applies then
    pension_emp := round((basic + housing + transport) * cfg.pension_employee_percent / 100, 2);
    pension_er := round((basic + housing + transport) * cfg.pension_employer_percent / 100, 2);
  end if;
  if st.nhf_applies then
    nhf := round(basic * cfg.nhf_percent / 100, 2);
  end if;

  -- The school's own deductions that apply this month.
  for d in
    select sd.id, sd.kind, sd.value, sd.balance, t.label, t.before_tax
      from classroom.payroll_staff_deductions sd
      join classroom.payroll_deduction_types t on t.id = sd.type_id
     where sd.staff_id = st.id and sd.is_active and t.is_active
       and (sd.starts_on is null or sd.starts_on <= month_end)
       and (sd.ends_on is null or sd.ends_on >= month_start)
       and (sd.balance is null or sd.balance > 0)
     order by t.position, t.label
  loop
    amount := case when d.kind = 'percent' then round(gross * d.value / 100, 2) else d.value end;
    if d.balance is not null then amount := least(amount, d.balance); end if;
    continue when amount <= 0;
    deductions := deductions || jsonb_build_object('label', d.label, 'amount', amount, 'before_tax', d.before_tax, 'deduction_id', d.id);
    if d.before_tax then before_tax := before_tax + amount; else after_tax := after_tax + amount; end if;
  end loop;

  -- PAYE on the year's pay, a twelfth each month.
  rent_relief := least(round(st.annual_rent * cfg.rent_relief_percent / 100, 2), cfg.rent_relief_cap);
  chargeable := greatest(0, (gross - pension_emp - nhf - before_tax) * 12 - rent_relief);
  paye := round(classroom.payroll_annual_tax(chargeable, cfg.paye_bands) / 12, 2);

  return jsonb_build_object(
    'days_factor', factor,
    'earnings', earnings,
    'deductions', deductions,
    'gross', gross,
    'pension_employee', pension_emp,
    'pension_employer', pension_er,
    'nhf', nhf,
    'rent_relief', rent_relief,
    'taxable_annual', chargeable,
    'paye', paye,
    'other_deductions', before_tax + after_tax,
    'net', gross - pension_emp - nhf - paye - before_tax - after_tax
  );
end;
$fn$;

grant execute on function classroom.payroll_compute(uuid, date) to authenticated;

-- ---------------------------------------------------------------- setup

create or replace function classroom.payroll_setup(target_school uuid)
returns classroom.payroll_settings
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  cfg classroom.payroll_settings;
begin
  if not classroom.can_do_payroll(target_school) then
    raise exception 'Only the owner, an admin or the bursar can set up payroll';
  end if;
  insert into classroom.payroll_settings (school_id) values (target_school) on conflict do nothing;
  -- The deductions most schools have, ready to use or switch off.
  insert into classroom.payroll_deduction_types (school_id, label, before_tax, position)
  values
    (target_school, 'Staff loan', false, 1),
    (target_school, 'Salary advance', false, 2),
    (target_school, 'Cooperative savings', false, 3),
    (target_school, 'Health insurance', true, 4),
    (target_school, 'Life assurance', true, 5)
  on conflict do nothing;
  select * into cfg from classroom.payroll_settings where school_id = target_school;
  return cfg;
end;
$fn$;

grant execute on function classroom.payroll_setup(uuid) to authenticated;

-- The school confirms the tax bands it will use, once, before the first
-- payroll can be approved (and again after editing them).
create or replace function classroom.payroll_confirm_bands(target_school uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  if not classroom.can_do_payroll(target_school) then raise exception 'Not allowed'; end if;
  update classroom.payroll_settings
     set bands_confirmed_at = now(), bands_confirmed_by = auth.uid(), updated_at = now()
   where school_id = target_school;
end;
$fn$;

grant execute on function classroom.payroll_confirm_bands(uuid) to authenticated;

-- Editing the bands or rates unconfirms them.
create or replace function classroom.payroll_settings_guard()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'UPDATE' and (
       new.paye_bands is distinct from old.paye_bands
    or new.rent_relief_percent is distinct from old.rent_relief_percent
    or new.rent_relief_cap is distinct from old.rent_relief_cap
  ) and new.bands_confirmed_at is not distinct from old.bands_confirmed_at then
    new.bands_confirmed_at := null;
    new.bands_confirmed_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists payroll_settings_guard on classroom.payroll_settings;
create trigger payroll_settings_guard before update on classroom.payroll_settings
  for each row execute function classroom.payroll_settings_guard();

-- ----------------------------------------------------------------- the run

create or replace function classroom.payroll_refresh_run(target_run uuid)
returns classroom.payroll_runs
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  r  classroom.payroll_runs;
  st classroom.payroll_staff;
  c  jsonb;
  month_end date;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  if not classroom.can_do_payroll(r.school_id) then raise exception 'Not allowed'; end if;
  if r.status <> 'draft' then raise exception 'This payroll has been approved; it can no longer be recalculated.'; end if;
  month_end := (r.period + interval '1 month - 1 day')::date;

  delete from classroom.payslips where run_id = r.id;
  for st in
    select * from classroom.payroll_staff
     where school_id = r.school_id and is_active
       and (start_date is null or start_date <= month_end)
       and (end_date is null or end_date >= r.period)
     order by full_name
  loop
    c := classroom.payroll_compute(st.id, r.period);
    continue when (c ->> 'gross')::numeric <= 0;
    insert into classroom.payslips (
      school_id, run_id, staff_id, user_id, full_name, job_title, bank_name, account_number, account_name,
      tin, pension_provider, rsa_pin, days_factor, earnings, deductions, gross, pension_employee,
      pension_employer, nhf, rent_relief, taxable_annual, paye, other_deductions, net)
    values (
      r.school_id, r.id, st.id, st.user_id, st.full_name, st.job_title, st.bank_name, st.account_number, st.account_name,
      st.tin, st.pension_provider, st.rsa_pin, (c ->> 'days_factor')::numeric, c -> 'earnings', c -> 'deductions',
      (c ->> 'gross')::numeric, (c ->> 'pension_employee')::numeric, (c ->> 'pension_employer')::numeric,
      (c ->> 'nhf')::numeric, (c ->> 'rent_relief')::numeric, (c ->> 'taxable_annual')::numeric,
      (c ->> 'paye')::numeric, (c ->> 'other_deductions')::numeric, (c ->> 'net')::numeric);
  end loop;

  update classroom.payroll_runs set updated_at = now() where id = r.id returning * into r;
  return r;
end;
$fn$;

grant execute on function classroom.payroll_refresh_run(uuid) to authenticated;

create or replace function classroom.payroll_prepare(target_school uuid, period_in date)
returns classroom.payroll_runs
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  r classroom.payroll_runs;
  month_start date := date_trunc('month', period_in)::date;
begin
  if not classroom.can_do_payroll(target_school) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from classroom.payroll_settings where school_id = target_school) then
    raise exception 'Set up payroll first';
  end if;
  select * into r from classroom.payroll_runs where school_id = target_school and period = month_start;
  if found then
    if r.status = 'draft' then return classroom.payroll_refresh_run(r.id); end if;
    raise exception 'Payroll for % has already been approved.', to_char(month_start, 'FMMonth YYYY');
  end if;
  insert into classroom.payroll_runs (school_id, period, prepared_by)
  values (target_school, month_start, auth.uid()) returning * into r;
  return classroom.payroll_refresh_run(r.id);
end;
$fn$;

grant execute on function classroom.payroll_prepare(uuid, date) to authenticated;

create or replace function classroom.payroll_delete_draft(target_run uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare r classroom.payroll_runs;
begin
  select * into r from classroom.payroll_runs where id = target_run;
  if not found then raise exception 'No such payroll'; end if;
  if not classroom.can_do_payroll(r.school_id) then raise exception 'Not allowed'; end if;
  if r.status <> 'draft' then raise exception 'An approved payroll cannot be deleted.'; end if;
  delete from classroom.payroll_runs where id = r.id;
end;
$fn$;

grant execute on function classroom.payroll_delete_draft(uuid) to authenticated;

create or replace function classroom.payroll_approve(target_run uuid)
returns classroom.payroll_runs
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  r   classroom.payroll_runs;
  cfg classroom.payroll_settings;
  t   record;
  label text;
  on_date date;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  select * into cfg from classroom.payroll_settings where school_id = r.school_id;
  if not classroom.has_role_in(r.school_id, cfg.approver_roles) then
    raise exception 'Only % can approve payroll at this school.',
      array_to_string(array(select initcap(x::text) from unnest(cfg.approver_roles) x), ' or ');
  end if;
  if r.status <> 'draft' then raise exception 'This payroll is already %.', r.status; end if;
  if cfg.bands_confirmed_at is null then
    raise exception 'Confirm the PAYE bands under Payroll → Settings before approving the first payroll.';
  end if;
  if not exists (select 1 from classroom.payslips where run_id = r.id) then
    raise exception 'There are no payslips in this payroll.';
  end if;

  update classroom.payroll_runs
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = r.id returning * into r;

  -- Loans and advances go down by what this month took.
  update classroom.payroll_staff_deductions sd
     set balance = greatest(0, sd.balance - x.amount)
    from (
      select (d ->> 'deduction_id')::uuid as id, sum((d ->> 'amount')::numeric) as amount
        from classroom.payslips p, jsonb_array_elements(p.deductions) d
       where p.run_id = r.id
       group by 1
    ) x
   where sd.id = x.id and sd.balance is not null;

  -- The books, when the school keeps them.
  on_date := (r.period + interval '1 month - 1 day')::date;
  if classroom.acct_enabled(r.school_id, on_date) then
    select sum(gross) gross, sum(pension_employee) pe, sum(pension_employer) per, sum(nhf) nhf,
           sum(paye) paye, sum(other_deductions) other, sum(net) net
      into t from classroom.payslips where run_id = r.id;
    label := 'Payroll for ' || to_char(r.period, 'FMMonth YYYY');
    perform classroom.acct_post(r.school_id, on_date, label || ' approved', 'payroll', r.id, 'approve',
      jsonb_build_array(
        jsonb_build_object('key', 'salaries', 'debit', t.gross),
        jsonb_build_object('key', 'pension_expense', 'debit', t.per),
        jsonb_build_object('key', 'paye_payable', 'credit', t.paye),
        jsonb_build_object('key', 'pension_payable', 'credit', t.pe + t.per),
        jsonb_build_object('key', 'nhf_payable', 'credit', t.nhf),
        jsonb_build_object('key', 'deductions_payable', 'credit', t.other),
        jsonb_build_object('key', 'salaries_payable', 'credit', t.net)
      ));
  end if;

  -- Each person with an account hears their payslip is ready.
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select p.user_id, r.school_id, 'payslip_ready',
         'Your payslip for ' || to_char(r.period, 'FMMonth YYYY') || ' is ready',
         'Net pay ' || to_char(p.net, 'FM999,999,999,990.00'),
         '/Payslips'
    from classroom.payslips p
   where p.run_id = r.id and p.user_id is not null;

  return r;
end;
$fn$;

grant execute on function classroom.payroll_approve(uuid) to authenticated;

create or replace function classroom.payroll_mark_paid(target_run uuid, paid_on_in date)
returns classroom.payroll_runs
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  r classroom.payroll_runs;
  net_total numeric;
begin
  select * into r from classroom.payroll_runs where id = target_run for update;
  if not found then raise exception 'No such payroll'; end if;
  if not classroom.can_do_payroll(r.school_id) then raise exception 'Not allowed'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved payroll can be marked as paid.'; end if;
  update classroom.payroll_runs
     set status = 'paid', paid_on = coalesce(paid_on_in, current_date), paid_by = auth.uid(), updated_at = now()
   where id = r.id returning * into r;
  if classroom.acct_enabled(r.school_id, r.paid_on) then
    select sum(net) into net_total from classroom.payslips where run_id = r.id;
    perform classroom.acct_post(r.school_id, r.paid_on,
      'Salaries paid for ' || to_char(r.period, 'FMMonth YYYY'), 'payroll', r.id, 'paid',
      jsonb_build_array(
        jsonb_build_object('key', 'salaries_payable', 'debit', net_total),
        jsonb_build_object('key', 'bank', 'credit', net_total)));
  end if;
  return r;
end;
$fn$;

grant execute on function classroom.payroll_mark_paid(uuid, date) to authenticated;

-- ------------------------------------------------ paying a consultant/vendor

create or replace function classroom.record_payee_payment(
  target_payee uuid, description_in text, gross_in numeric, paid_on_in date,
  paid_from_in text default 'bank', wht_rate_in numeric default null, reference_in text default null)
returns classroom.payroll_payee_payments
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  pe  classroom.payroll_payees;
  pay classroom.payroll_payee_payments;
  rate numeric;
  wht numeric;
begin
  select * into pe from classroom.payroll_payees where id = target_payee;
  if not found then raise exception 'No such payee'; end if;
  if not classroom.can_do_payroll(pe.school_id) then raise exception 'Not allowed'; end if;
  if coalesce(gross_in, 0) <= 0 then raise exception 'Enter the amount before tax.'; end if;
  if btrim(coalesce(description_in, '')) = '' then raise exception 'Say what the payment is for.'; end if;
  rate := coalesce(wht_rate_in, pe.wht_rate);
  wht := round(gross_in * rate / 100, 2);
  insert into classroom.payroll_payee_payments
    (school_id, payee_id, description, gross, wht_rate, wht, net, paid_on, paid_from, reference, recorded_by)
  values (pe.school_id, pe.id, btrim(description_in), gross_in, rate, wht, gross_in - wht,
          coalesce(paid_on_in, current_date), case when paid_from_in = 'cash' then 'cash' else 'bank' end,
          nullif(btrim(coalesce(reference_in, '')), ''), auth.uid())
  returning * into pay;

  if classroom.acct_enabled(pe.school_id, pay.paid_on) then
    perform classroom.acct_post(pe.school_id, pay.paid_on,
      'Paid ' || pe.name || ' — ' || pay.description, 'payee_payment', pay.id, 'paid',
      jsonb_build_array(
        jsonb_build_object('key', 'professional_fees', 'debit', pay.gross),
        jsonb_build_object('key', 'wht_payable', 'credit', pay.wht),
        jsonb_build_object('key', pay.paid_from, 'credit', pay.net)));
  end if;
  return pay;
end;
$fn$;

grant execute on function classroom.record_payee_payment(uuid, text, numeric, date, text, numeric, text) to authenticated;

-- ------------------------------------------- the accounts payroll posts to

-- Four accounts the starter chart (188) did not have, added to every school
-- that already keeps books; acct_seed_chart adds them for new ones.
create or replace function classroom.acct_seed_payroll_accounts(target_school uuid)
returns void
language sql
security definer
set search_path = classroom, public
as $fn$
  insert into classroom.chart_of_accounts (school_id, code, name, type, system_key, description, position)
  values
    (target_school, '2130', 'NHF payable', 'liability', 'nhf_payable', 'National Housing Fund deducted from staff pay.', 141),
    (target_school, '2140', 'Salaries payable', 'liability', 'salaries_payable', 'Net pay approved but not yet paid out.', 142),
    (target_school, '2150', 'Staff deductions payable', 'liability', 'deductions_payable', 'Loans, savings and insurance deducted from pay.', 143),
    (target_school, '5120', 'Consultants and honoraria', 'expense', 'professional_fees', 'Consultants, vendors'' services and honoraria.', 445)
  on conflict do nothing;
$fn$;

revoke all on function classroom.acct_seed_payroll_accounts(uuid) from public, anon, authenticated;

select classroom.acct_seed_payroll_accounts(school_id) from classroom.accounting_settings;

create or replace function classroom.acct_seed_payroll_after_chart()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  perform classroom.acct_seed_payroll_accounts(new.school_id);
  return null;
end;
$fn$;

drop trigger if exists accounting_settings_payroll_accounts on classroom.accounting_settings;
create trigger accounting_settings_payroll_accounts after insert on classroom.accounting_settings
  for each row execute function classroom.acct_seed_payroll_after_chart();

-- ----------------------------------------------- keep the assistant out of it

-- The AI assistant (192) never sees bank details, tax or pension numbers.
create or replace function classroom.ai_catalog()
returns jsonb
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  with hidden_tables(name) as (
    values ('payment_gateways'), ('ticket_mailboxes'), ('push_subscriptions'),
           ('attendance_devices'), ('platform_admins'), ('ai_usage'),
           ('original_verifications')
  ),
  readable as (
    select c.oid, c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'classroom'
       and c.relkind in ('r', 'v')
       and has_table_privilege('authenticated', c.oid, 'select')
       and c.relname not in (select name from hidden_tables)
  ),
  cols as (
    select r.relname,
           jsonb_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum) as columns
      from readable r
      join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
     where a.attname !~* '(secret|token|password|passcode|api_key|private_key|p256dh|refresh|access_key|signing|account_number|rsa_pin|^tin$)'
     group by r.relname
  ),
  links as (
    select r.relname, jsonb_agg(distinct f.relname) as links_to
      from readable r
      join pg_constraint k on k.conrelid = r.oid and k.contype = 'f'
      join pg_class f on f.oid = k.confrelid
     where f.relname in (select relname from readable)
     group by r.relname
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'table', cols.relname,
             'view', (select relkind = 'v' from readable where relname = cols.relname),
             'columns', cols.columns,
             'links_to', coalesce(links.links_to, '[]'::jsonb)
           ) order by cols.relname
         ), '[]'::jsonb)
    from cols
    left join links on links.relname = cols.relname;
$fn$;

revoke all on function classroom.ai_catalog() from public, anon, authenticated;
grant execute on function classroom.ai_catalog() to service_role;

-- --------------------------------------------------------------- the module

-- Charismartin only, for now, like Accounts (188).
update classroom.schools
   set disabled_modules = array_append(coalesce(disabled_modules, '{}'), 'payroll')
 where slug <> 'charismartin-intl'
   and not ('payroll' = any(coalesce(disabled_modules, '{}')));

notify pgrst, 'reload schema';
