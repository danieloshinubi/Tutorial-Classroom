-- Any country: each school chooses its own currency (and time zone) when it
-- is created, on schoolivio.com or in the console, and can change them later
-- in School admin → School settings. Everything that shows money already
-- reads schools.currency; this makes it choosable and safe.
--
--   start_trial_school / create_school   take currency_in and timezone_in.
--   schools_guard                        a valid ISO currency code and a real
--                                        time zone. A school's own admins can
--                                        no longer write its plan, trial end,
--                                        paid-until date, active flag or
--                                        address (slug): only the console and
--                                        Schoolivio's own functions can. Before
--                                        this, the "school admins update their
--                                        school" policy let an admin extend
--                                        their own trial or mark it paid.
--   admission fees                       follow the school's currency.
--   format_money                         symbols for many more currencies.

-- 1. Guard ---------------------------------------------------------------------
create or replace function classroom.schools_guard()
returns trigger language plpgsql set search_path = classroom, public as $fn$
begin
  new.currency := upper(btrim(coalesce(new.currency, 'NGN')));
  if new.currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a currency from the list (a three-letter code such as NGN, USD or KES).';
  end if;
  if new.timezone is null or not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Choose a time zone from the list.';
  end if;

  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') and not classroom.is_platform_admin() then
    if new.plan is distinct from old.plan
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.paid_until is distinct from old.paid_until
       or new.is_active is distinct from old.is_active
       or new.archived_at is distinct from old.archived_at
       or new.ai_token_limit is distinct from old.ai_token_limit
       or new.slug is distinct from old.slug then
      raise exception 'Only Schoolivio can change a school''s plan, dates, status or address.';
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists schools_guard on classroom.schools;
create trigger schools_guard before insert or update on classroom.schools
  for each row execute function classroom.schools_guard();

-- 2. Admission fees follow the school's currency -------------------------------
create or replace function classroom.schools_currency_follow()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  update classroom.admission_config set currency = new.currency
   where school_id = new.id and currency is distinct from new.currency;
  return null;
end;
$fn$;
drop trigger if exists schools_currency_follow on classroom.schools;
create trigger schools_currency_follow after update of currency on classroom.schools
  for each row when (new.currency is distinct from old.currency)
  execute function classroom.schools_currency_follow();

create or replace function classroom.admission_config_currency()
returns trigger language plpgsql security definer set search_path = classroom, public as $fn$
begin
  select currency into new.currency from classroom.schools where id = new.school_id;
  return new;
end;
$fn$;
drop trigger if exists admission_config_currency on classroom.admission_config;
create trigger admission_config_currency before insert or update on classroom.admission_config
  for each row execute function classroom.admission_config_currency();

create or replace function classroom.effective_admission_config(target_school uuid, target_session uuid)
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  select coalesce(
    (select to_jsonb(c) from classroom.admission_config c
     where c.school_id = target_school and c.session_id = target_session),
    (select to_jsonb(c) from classroom.admission_config c
     where c.school_id = target_school and c.session_id is null),
    jsonb_build_object(
      'application_fee_enabled', false,
      'application_fee_amount', 0,
      'currency', coalesce((select currency from classroom.schools where id = target_school), 'NGN'),
      'payment_verification', 'manual',
      'form_locked_until_paid', true,
      'acceptance_fee_enabled', false,
      'acceptance_fee_amount', 0,
      'require_jamb', false,
      'require_matric', false,
      'require_interview', false,
      'require_referees', false,
      'require_next_of_kin', true,
      'academic_hierarchy', 'flat',
      'use_applicant_accounts', true,
      'allow_anonymous_apply', true
    )
  );
$fn$;

-- 3. Money in emails and notices ------------------------------------------------
create or replace function classroom.format_money(amount numeric, currency text)
returns text language sql immutable as $fn$
  select
    case upper(coalesce(nullif(btrim(currency), ''), 'NGN'))
      when 'NGN' then '₦' when 'USD' then '$' when 'GBP' then '£' when 'EUR' then '€'
      when 'GHS' then 'GH₵' when 'ZAR' then 'R' when 'KES' then 'KSh ' when 'UGX' then 'USh '
      when 'TZS' then 'TSh ' when 'RWF' then 'RF ' when 'XOF' then 'CFA ' when 'XAF' then 'FCFA '
      when 'EGP' then 'E£' when 'MAD' then 'MAD ' when 'ETB' then 'Br ' when 'ZMW' then 'K'
      when 'INR' then '₹' when 'PKR' then 'Rs ' when 'BDT' then '৳' when 'PHP' then '₱'
      when 'JPY' then '¥' when 'CNY' then 'CN¥' when 'KRW' then '₩' when 'AED' then 'AED '
      when 'SAR' then 'SAR ' when 'CAD' then 'CA$' when 'AUD' then 'A$' when 'NZD' then 'NZ$'
      when 'BRL' then 'R$' when 'MXN' then 'MX$' when 'TRY' then '₺' when 'CHF' then 'CHF '
      else upper(btrim(currency)) || ' '
    end
    || case
         when round(coalesce(amount, 0), 2) = trunc(coalesce(amount, 0))
           then to_char(trunc(coalesce(amount, 0)), 'FM999,999,999,990')
         else to_char(round(coalesce(amount, 0), 2), 'FM999,999,999,990.00')
       end;
$fn$;

-- 4. Choosing them when a school is created --------------------------------------
drop function if exists classroom.start_trial_school(text, text);
create or replace function classroom.start_trial_school(
  school_name text, school_slug text, currency_in text default 'NGN', timezone_in text default 'Africa/Lagos')
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

  insert into classroom.schools (name, slug, plan, trial_ends_at, is_active, currency, timezone)
  values (clean_name, clean_slug, 'trial', now() + interval '21 days', true,
          coalesce(nullif(btrim(currency_in), ''), 'NGN'), coalesce(nullif(btrim(timezone_in), ''), 'Africa/Lagos'))
  returning * into new_school;

  insert into classroom.school_members (school_id, user_id, role)
  values (new_school.id, auth.uid(), 'owner')
  on conflict (school_id, user_id) do nothing;

  return new_school;
end;
$fn$;
revoke all on function classroom.start_trial_school(text, text, text, text) from public, anon;
grant execute on function classroom.start_trial_school(text, text, text, text) to authenticated;

drop function if exists classroom.create_school(text, text, text);
create or replace function classroom.create_school(
  school_name text, school_slug text, owner_email text default null,
  currency_in text default 'NGN', timezone_in text default 'Africa/Lagos')
returns classroom.schools language plpgsql security definer set search_path = classroom, public as $fn$
declare
  created classroom.schools;
  owner   uuid;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only platform administrators can create a school';
  end if;

  insert into classroom.schools (name, slug, plan, trial_ends_at, currency, timezone)
  values (btrim(school_name), lower(btrim(school_slug)), 'trial', now() + interval '21 days',
          coalesce(nullif(btrim(currency_in), ''), 'NGN'), coalesce(nullif(btrim(timezone_in), ''), 'Africa/Lagos'))
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
revoke all on function classroom.create_school(text, text, text, text, text) from public, anon;
grant execute on function classroom.create_school(text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
