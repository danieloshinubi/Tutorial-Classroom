-- Any country, part two (after 226's currency):
--
--   schools.country        the school's country (ISO code), chosen with its
--                          currency when it is created and changeable in
--                          School settings. Existing schools are Nigerian.
--   payroll                Nigeria's statutory pay rules (PAYE under the
--                          Nigeria Tax Act 2025, 8% + 10% pension, NHF, rent
--                          relief) are only filled in for a Nigerian school.
--                          Anywhere else payroll starts with no statutory
--                          deductions at all, named generically ("Income
--                          tax", "Pension", "Housing fund"), until the school
--                          enters its own country's bands and rates and
--                          confirms them. Schoolivio does not guess another
--                          country's tax law. The names are the school's to
--                          change and follow through to payslips and the
--                          ledger's "… payable" accounts.
--   platform_plan_prices   Schoolivio's monthly plan prices, per currency, set
--                          in Console → Settings. A school is quoted in its own
--                          currency when a price exists for it, else in US
--                          dollars when that is set, else in naira.

-- 1. Country -------------------------------------------------------------------
alter table classroom.schools add column if not exists country text;
update classroom.schools set country = 'NG' where country is null and currency = 'NGN';

create or replace function classroom.schools_country_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  new.country := nullif(upper(btrim(coalesce(new.country, ''))), '');
  if new.country is not null and new.country !~ '^[A-Z]{2}$' then
    raise exception 'Choose a country from the list.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists schools_country_guard on classroom.schools;
create trigger schools_country_guard before insert or update of country on classroom.schools
  for each row execute function classroom.schools_country_guard();

drop function if exists classroom.start_trial_school(text, text, text, text);
create or replace function classroom.start_trial_school(
  school_name text, school_slug text, currency_in text default 'NGN', timezone_in text default 'Africa/Lagos',
  country_in text default null)
returns classroom.schools language plpgsql security definer set search_path = classroom, public as $fn$
declare
  clean_name text := btrim(school_name);
  clean_slug text := lower(btrim(school_slug));
  new_school classroom.schools;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if clean_name = '' or clean_slug = '' then
    raise exception 'A school needs a name and an address.';
  end if;
  if exists (select 1 from classroom.schools where slug = clean_slug) then
    raise exception 'That subdomain is already taken';
  end if;

  insert into classroom.schools (name, slug, plan, trial_ends_at, is_active, currency, timezone, country)
  values (clean_name, clean_slug, 'trial', now() + interval '21 days', true,
          coalesce(nullif(btrim(currency_in), ''), 'NGN'), coalesce(nullif(btrim(timezone_in), ''), 'Africa/Lagos'), country_in)
  returning * into new_school;

  insert into classroom.school_members (school_id, user_id, role)
  values (new_school.id, auth.uid(), 'owner')
  on conflict (school_id, user_id) do nothing;

  return new_school;
end;
$fn$;
revoke all on function classroom.start_trial_school(text, text, text, text, text) from public, anon;
grant execute on function classroom.start_trial_school(text, text, text, text, text) to authenticated;

drop function if exists classroom.create_school(text, text, text, text, text);
create or replace function classroom.create_school(
  school_name text, school_slug text, owner_email text default null,
  currency_in text default 'NGN', timezone_in text default 'Africa/Lagos', country_in text default null)
returns classroom.schools language plpgsql security definer set search_path = classroom, public as $fn$
declare
  created classroom.schools;
  owner   uuid;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only platform administrators can create a school';
  end if;

  insert into classroom.schools (name, slug, plan, trial_ends_at, currency, timezone, country)
  values (btrim(school_name), lower(btrim(school_slug)), 'trial', now() + interval '21 days',
          coalesce(nullif(btrim(currency_in), ''), 'NGN'), coalesce(nullif(btrim(timezone_in), ''), 'Africa/Lagos'), country_in)
  returning * into created;

  if owner_email is not null then
    select id into owner from classroom.profiles where email = lower(btrim(owner_email));
  end if;

  insert into classroom.school_members (school_id, user_id, role)
  values (created.id, coalesce(owner, auth.uid()), 'owner')
  on conflict (school_id, user_id) do update set role = 'owner';

  return created;
end;
$fn$;
revoke all on function classroom.create_school(text, text, text, text, text, text) from public, anon;
grant execute on function classroom.create_school(text, text, text, text, text, text) to authenticated;

-- 2. Payroll outside Nigeria ------------------------------------------------------
alter table classroom.payroll_settings add column if not exists tax_label text not null default 'PAYE';
alter table classroom.payroll_settings add column if not exists pension_label text not null default 'Pension';
alter table classroom.payroll_settings add column if not exists fund_label text not null default 'NHF';

create or replace function classroom.payroll_settings_country_defaults()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare c text;
begin
  select coalesce(country, case when currency = 'NGN' then 'NG' end) into c from classroom.schools where id = new.school_id;
  if c is distinct from 'NG' then
    new.paye_bands := '[{"upto": null, "rate": 0}]'::jsonb;
    new.rent_relief_percent := 0;
    new.rent_relief_cap := 0;
    new.pension_employee_percent := 0;
    new.pension_employer_percent := 0;
    new.nhf_percent := 0;
    new.tax_label := 'Income tax';
    new.pension_label := 'Pension';
    new.fund_label := 'Housing fund';
  end if;
  return new;
end;
$fn$;
drop trigger if exists payroll_settings_country_defaults on classroom.payroll_settings;
create trigger payroll_settings_country_defaults before insert on classroom.payroll_settings
  for each row execute function classroom.payroll_settings_country_defaults();

create or replace function classroom.payroll_settings_labels_check()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  new.tax_label := left(coalesce(nullif(btrim(new.tax_label), ''), 'Income tax'), 40);
  new.pension_label := left(coalesce(nullif(btrim(new.pension_label), ''), 'Pension'), 40);
  new.fund_label := left(coalesce(nullif(btrim(new.fund_label), ''), 'Housing fund'), 40);
  return new;
end;
$fn$;
drop trigger if exists payroll_settings_labels_check on classroom.payroll_settings;
create trigger payroll_settings_labels_check before insert or update on classroom.payroll_settings
  for each row execute function classroom.payroll_settings_labels_check();

-- The ledger's accounts carry the same names: "Income tax payable".
create or replace function classroom.payroll_labels_to_accounts()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  update classroom.chart_of_accounts set name = new.tax_label || ' payable'
   where school_id = new.school_id and system_key = 'paye_payable' and name is distinct from new.tax_label || ' payable';
  update classroom.chart_of_accounts set name = new.pension_label || ' payable'
   where school_id = new.school_id and system_key = 'pension_payable' and name is distinct from new.pension_label || ' payable';
  update classroom.chart_of_accounts set name = new.fund_label || ' payable'
   where school_id = new.school_id and system_key = 'nhf_payable' and name is distinct from new.fund_label || ' payable';
  return null;
end;
$fn$;
drop trigger if exists payroll_labels_to_accounts on classroom.payroll_settings;
create trigger payroll_labels_to_accounts after insert or update of tax_label, pension_label, fund_label on classroom.payroll_settings
  for each row execute function classroom.payroll_labels_to_accounts();

-- A ledger set up after payroll (or with none yet) gets the same names.
create or replace function classroom.chart_payroll_names()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
declare ps classroom.payroll_settings; c text;
begin
  if new.system_key not in ('paye_payable', 'pension_payable', 'nhf_payable') then return new; end if;
  select * into ps from classroom.payroll_settings where school_id = new.school_id;
  if found then
    new.name := case new.system_key when 'paye_payable' then ps.tax_label when 'pension_payable' then ps.pension_label else ps.fund_label end || ' payable';
  else
    select coalesce(country, case when currency = 'NGN' then 'NG' end) into c from classroom.schools where id = new.school_id;
    if c is distinct from 'NG' then
      new.name := case new.system_key when 'paye_payable' then 'Income tax payable' when 'pension_payable' then 'Pension payable' else 'Housing fund payable' end;
      if new.system_key = 'nhf_payable' then new.description := 'Housing fund contributions deducted from staff pay.'; end if;
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists chart_payroll_names on classroom.chart_of_accounts;
create trigger chart_payroll_names before insert on classroom.chart_of_accounts
  for each row execute function classroom.chart_payroll_names();

-- A staff member's own payslips carry the school's names for its deductions.
create or replace function classroom.my_payslips()
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
           'period', r.period, 'run_status', r.status, 'paid_on', r.paid_on,
           'school_name', s.name, 'school_logo', s.logo_url, 'school_country', s.country,
           'tax_label', coalesce(ps.tax_label, 'Income tax'),
           'pension_label', coalesce(ps.pension_label, 'Pension'),
           'fund_label', coalesce(ps.fund_label, 'Housing fund'))
         order by r.period desc), '[]'::jsonb)
    from classroom.payslips p
    join classroom.payroll_runs r on r.id = p.run_id and r.status in ('approved', 'paid')
    join classroom.schools s on s.id = p.school_id
    left join classroom.payroll_settings ps on ps.school_id = p.school_id
   where p.user_id = auth.uid();
$fn$;

-- 3. Schoolivio's prices per currency --------------------------------------------
create table if not exists classroom.platform_plan_prices (
  currency text primary key check (currency ~ '^[A-Z]{3}$'),
  starter numeric(14, 2) not null check (starter > 0),
  growth numeric(14, 2) not null check (growth > 0),
  updated_at timestamptz not null default now()
);
insert into classroom.platform_plan_prices (currency, starter, growth) values ('NGN', 450000, 950000)
on conflict do nothing;
alter table classroom.platform_plan_prices enable row level security;
-- Prices are public: the landing page shows them.
drop policy if exists "anyone reads plan prices" on classroom.platform_plan_prices;
create policy "anyone reads plan prices" on classroom.platform_plan_prices for select to anon, authenticated using (true);
grant select on classroom.platform_plan_prices to anon, authenticated;

create or replace function classroom.platform_set_plan_price(currency_in text, starter_in numeric, growth_in numeric)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_platform_admin() then raise exception 'Only a platform administrator can set prices'; end if;
  if starter_in is null or growth_in is null or starter_in <= 0 or growth_in <= 0 then
    raise exception 'Both prices must be more than zero.';
  end if;
  insert into classroom.platform_plan_prices (currency, starter, growth, updated_at)
  values (upper(btrim(currency_in)), starter_in, growth_in, now())
  on conflict (currency) do update set starter = excluded.starter, growth = excluded.growth, updated_at = now();
end;
$fn$;
create or replace function classroom.platform_remove_plan_price(currency_in text)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if not classroom.is_platform_admin() then raise exception 'Only a platform administrator can set prices'; end if;
  if upper(btrim(currency_in)) = 'NGN' then raise exception 'The naira price is the fallback and stays.'; end if;
  delete from classroom.platform_plan_prices where currency = upper(btrim(currency_in));
end;
$fn$;
revoke all on function classroom.platform_set_plan_price(text, numeric, numeric) from public, anon;
revoke all on function classroom.platform_remove_plan_price(text) from public, anon;
grant execute on function classroom.platform_set_plan_price(text, numeric, numeric), classroom.platform_remove_plan_price(text) to authenticated;

create or replace function classroom.school_plan_quote(target_school uuid)
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  with n as (
    select count(distinct user_id)::int as students from classroom.school_members
     where school_id = target_school and role = 'student' and is_active
  ), price as (
    select p.* from classroom.platform_plan_prices p
     where p.currency in ((select currency from classroom.schools where id = target_school), 'USD', 'NGN')
     order by case p.currency when (select currency from classroom.schools where id = target_school) then 0 when 'USD' then 1 else 2 end
     limit 1
  )
  select jsonb_build_object(
    'students', n.students,
    'plan', case when n.students <= 200 then 'starter' when n.students <= 800 then 'growth' else 'enterprise' end,
    'plan_name', case when n.students <= 200 then 'Starter' when n.students <= 800 then 'Growth' else 'Enterprise' end,
    'amount', case when n.students <= 200 then price.starter when n.students <= 800 then price.growth else null end,
    'currency', price.currency,
    'starter_price', price.starter,
    'growth_price', price.growth)
  from n, price;
$fn$;

create or replace function classroom.start_subscription_payment(target_school uuid, actor uuid, ref text)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare q jsonb; s classroom.schools; who text;
begin
  if not exists (select 1 from classroom.school_members where school_id = target_school and user_id = actor and is_active
                  and granted_via is null and role in ('owner', 'admin')) then
    raise exception 'Only the school''s owner or admin can pay for its plan';
  end if;
  q := classroom.school_plan_quote(target_school);
  if q->>'amount' is null then
    raise exception 'Schools with more than 800 students are on Enterprise, priced with you directly. Please contact us.';
  end if;
  select * into s from classroom.schools where id = target_school;
  select email into who from auth.users where id = actor;
  insert into classroom.subscription_payments (school_id, reference, plan, amount, currency, started_by)
  values (target_school, ref, q->>'plan', (q->>'amount')::numeric, q->>'currency', actor);
  return q || jsonb_build_object('email', who, 'school_name', s.name, 'slug', s.slug);
end;
$fn$;

drop function if exists classroom.due_subscription_reminders();
create or replace function classroom.due_subscription_reminders()
returns table (
  school_id uuid, school_name text, slug text, kind text, ends_on date, days_before integer, days_left integer,
  recipients jsonb, plan_name text, amount numeric, currency text)
language sql stable security definer set search_path = classroom, public as $fn$
  with ends as (
    select s.id, s.name, s.slug,
           case when s.plan = 'trial' then 'trial' else 'renewal' end as kind,
           case when s.plan = 'trial' then (s.trial_ends_at at time zone coalesce(nullif(s.timezone, ''), 'Africa/Lagos'))::date
                else s.paid_until end as ends_on
      from classroom.schools s
     where s.is_active and (
       (s.plan = 'trial' and s.trial_ends_at is not null) or (s.plan <> 'trial' and s.paid_until is not null))
  ), steps as (
    select e.*, d.days_before, (e.ends_on - current_date) as days_left
      from ends e
      cross join (values (5), (3), (1), (0)) d(days_before)
     where e.ends_on - current_date between 0 and d.days_before
  ), next_step as (
    select distinct on (st.id) st.* from steps st order by st.id, st.days_before asc
  ), quoted as (
    select n.*, classroom.school_plan_quote(n.id) as q from next_step n
  )
  select n.id, n.name, n.slug, n.kind, n.ends_on, n.days_before, n.days_left,
         coalesce((select jsonb_agg(distinct jsonb_build_object('email', u.email, 'name', classroom.person_label(u.id), 'user_id', u.id))
                     from classroom.school_approvers(n.id) a join auth.users u on u.id = a where u.email is not null), '[]'::jsonb),
         n.q->>'plan_name', (n.q->>'amount')::numeric, n.q->>'currency'
    from quoted n
   where not exists (
     select 1 from classroom.subscription_reminders r
      where r.school_id = n.id and r.kind = n.kind and r.ends_on = n.ends_on and r.days_before <= n.days_before);
$fn$;
revoke all on function classroom.due_subscription_reminders() from public, anon, authenticated;
grant execute on function classroom.due_subscription_reminders() to service_role;

-- Plan & billing lists each payment in the currency it was made in.
create or replace function classroom.my_school_subscription(target_school uuid)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare s classroom.schools; q jsonb; contact text;
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only an owner or admin can see the school''s plan'; end if;
  select * into s from classroom.schools where id = target_school;
  q := classroom.school_plan_quote(target_school);
  select contact_email into contact from classroom.platform_settings where id;
  return q || jsonb_build_object(
    'current_plan', s.plan, 'trial_ends_at', s.trial_ends_at, 'paid_until', s.paid_until,
    'contact_email', contact,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('reference', reference, 'amount', amount, 'currency', currency, 'status', status,
                     'plan', plan, 'paid_at', paid_at, 'period_end', period_end, 'created_at', created_at) order by created_at desc)
                     from (select * from classroom.subscription_payments where school_id = target_school order by created_at desc limit 12) p), '[]'::jsonb));
end;
$fn$;

notify pgrst, 'reload schema';
