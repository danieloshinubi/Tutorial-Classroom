-- Schools paying Schoolivio: trial reminders and monthly subscription by
-- Paystack.
--
--   platform_settings        Schoolivio's own sender (SMTP) and Paystack
--                            account. The password and the secret key live
--                            in Vault, set through the platform-settings
--                            Edge Function and never readable by a browser.
--   school_plan_quote        a school's plan and monthly price from its
--                            active student count, as on the landing page:
--                            Starter NGN 450,000 (up to 200 students),
--                            Growth NGN 950,000 (up to 800), Enterprise
--                            (more) by arrangement.
--   due_subscription_reminders / record_subscription_reminder
--                            5, 3 and 1 day(s) before, and on the day, a
--                            trial or a paid month ends: each owner and
--                            admin is emailed and notified once per step.
--   subscription_payments    one Paystack payment; confirmed by
--                            confirm_subscription_payment, which switches
--                            the school to its plan and moves paid_until on
--                            a month. Paying again before then extends it.
--
-- A school whose paid month ended more than 3 days ago is locked like a
-- lapsed trial (the app's TrialGate) until it pays.

-- 1. A school's paid-up date ---------------------------------------------------
alter table classroom.schools add column if not exists paid_until date;

-- 2. Schoolivio's own settings (one row) -------------------------------------
create table if not exists classroom.platform_settings (
  id boolean primary key default true check (id),
  sender_address text,
  sender_name text not null default 'Schoolivio',
  smtp_host text,
  smtp_port integer,
  smtp_security text check (smtp_security in ('ssl', 'starttls', 'none')),
  smtp_username text,
  smtp_secret_id uuid,
  paystack_public_key text,
  paystack_secret_id uuid,
  contact_email text not null default 'info@tekktopia.com',
  updated_at timestamptz not null default now()
);
insert into classroom.platform_settings (id) values (true) on conflict do nothing;
alter table classroom.platform_settings enable row level security;
drop policy if exists "platform admins read settings" on classroom.platform_settings;
create policy "platform admins read settings" on classroom.platform_settings
  for select to authenticated using (classroom.is_platform_admin());
grant select on classroom.platform_settings to authenticated;
revoke select (smtp_secret_id, paystack_secret_id) on classroom.platform_settings from authenticated;

-- What the console shows (never the secrets themselves).
create or replace function classroom.platform_settings_view()
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  select case when classroom.is_platform_admin() then jsonb_build_object(
    'sender_address', sender_address, 'sender_name', sender_name, 'smtp_host', smtp_host,
    'smtp_port', smtp_port, 'smtp_security', smtp_security, 'smtp_username', smtp_username,
    'smtp_connected', smtp_secret_id is not null,
    'paystack_public_key', paystack_public_key, 'paystack_connected', paystack_secret_id is not null,
    'contact_email', contact_email, 'updated_at', updated_at) end
  from classroom.platform_settings where id;
$fn$;
revoke all on function classroom.platform_settings_view() from public, anon;
grant execute on function classroom.platform_settings_view() to authenticated;

-- Service role only: write the settings and a secret, read a secret back.
create or replace function classroom.platform_save_settings(settings jsonb, actor uuid)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
begin
  if not exists (select 1 from classroom.platform_admins where user_id = actor) then
    raise exception 'Only a platform administrator can change Schoolivio settings';
  end if;
  update classroom.platform_settings set
    sender_address = coalesce(nullif(btrim(settings->>'sender_address'), ''), sender_address),
    sender_name = coalesce(nullif(btrim(settings->>'sender_name'), ''), sender_name),
    smtp_host = coalesce(nullif(btrim(settings->>'smtp_host'), ''), smtp_host),
    smtp_port = coalesce((settings->>'smtp_port')::integer, smtp_port),
    smtp_security = coalesce(nullif(settings->>'smtp_security', ''), smtp_security),
    smtp_username = coalesce(nullif(btrim(settings->>'smtp_username'), ''), smtp_username),
    paystack_public_key = coalesce(nullif(btrim(settings->>'paystack_public_key'), ''), paystack_public_key),
    contact_email = coalesce(nullif(btrim(settings->>'contact_email'), ''), contact_email),
    updated_at = now()
  where id;
end;
$fn$;

create or replace function classroom.platform_set_secret(which text, plaintext text)
returns void language plpgsql security definer set search_path = classroom, public, vault as $fn$
declare new_id uuid; old_id uuid;
begin
  if which not in ('smtp', 'paystack') then raise exception 'Unknown secret'; end if;
  new_id := vault.create_secret(plaintext, 'platform:' || which || ':' || gen_random_uuid()::text, 'Schoolivio platform credential');
  if which = 'smtp' then
    select smtp_secret_id into old_id from classroom.platform_settings where id;
    update classroom.platform_settings set smtp_secret_id = new_id, updated_at = now() where id;
  else
    select paystack_secret_id into old_id from classroom.platform_settings where id;
    update classroom.platform_settings set paystack_secret_id = new_id, updated_at = now() where id;
  end if;
  if old_id is not null then delete from vault.secrets where id = old_id; end if;
end;
$fn$;

create or replace function classroom.platform_get_secret(which text)
returns text language sql stable security definer set search_path = classroom, public, vault as $fn$
  select s.decrypted_secret from vault.decrypted_secrets s
   where s.id = (select case which when 'smtp' then smtp_secret_id when 'paystack' then paystack_secret_id end
                   from classroom.platform_settings where id);
$fn$;

create or replace function classroom.platform_mail_settings()
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  select jsonb_build_object('sender_address', sender_address, 'sender_name', sender_name, 'smtp_host', smtp_host,
    'smtp_port', smtp_port, 'smtp_security', smtp_security, 'smtp_username', smtp_username,
    'contact_email', contact_email, 'paystack_public_key', paystack_public_key)
  from classroom.platform_settings where id;
$fn$;

revoke all on function classroom.platform_save_settings(jsonb, uuid) from public, anon, authenticated;
revoke all on function classroom.platform_set_secret(text, text) from public, anon, authenticated;
revoke all on function classroom.platform_get_secret(text) from public, anon, authenticated;
revoke all on function classroom.platform_mail_settings() from public, anon, authenticated;
grant execute on function classroom.platform_save_settings(jsonb, uuid), classroom.platform_set_secret(text, text),
  classroom.platform_get_secret(text), classroom.platform_mail_settings() to service_role;

-- 3. Price ---------------------------------------------------------------------
create or replace function classroom.school_plan_quote(target_school uuid)
returns jsonb language sql stable security definer set search_path = classroom, public as $fn$
  with n as (
    select count(distinct user_id)::int as students from classroom.school_members
     where school_id = target_school and role = 'student' and is_active
  )
  select jsonb_build_object(
    'students', n.students,
    'plan', case when n.students <= 200 then 'starter' when n.students <= 800 then 'growth' else 'enterprise' end,
    'plan_name', case when n.students <= 200 then 'Starter' when n.students <= 800 then 'Growth' else 'Enterprise' end,
    'amount', case when n.students <= 200 then 450000 when n.students <= 800 then 950000 else null end,
    'currency', 'NGN')
  from n;
$fn$;
revoke all on function classroom.school_plan_quote(uuid) from public, anon, authenticated;
grant execute on function classroom.school_plan_quote(uuid) to service_role;

-- What an owner or admin sees on School admin → Plan & billing.
create or replace function classroom.my_school_subscription(target_school uuid)
returns jsonb language plpgsql stable security definer set search_path = classroom, public as $fn$
declare s classroom.schools; q jsonb; contact text; pending int;
begin
  if not classroom.is_school_admin(target_school) then raise exception 'Only an owner or admin can see the school''s plan'; end if;
  select * into s from classroom.schools where id = target_school;
  q := classroom.school_plan_quote(target_school);
  select contact_email into contact from classroom.platform_settings where id;
  return q || jsonb_build_object(
    'current_plan', s.plan, 'trial_ends_at', s.trial_ends_at, 'paid_until', s.paid_until,
    'contact_email', contact,
    'can_pay_online', exists (select 1 from classroom.platform_settings where id and paystack_secret_id is not null),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('reference', reference, 'amount', amount, 'status', status,
                     'plan', plan, 'paid_at', paid_at, 'period_end', period_end, 'created_at', created_at) order by created_at desc)
                     from (select * from classroom.subscription_payments where school_id = target_school order by created_at desc limit 12) p), '[]'::jsonb));
end;
$fn$;

-- 4. Payments ------------------------------------------------------------------
create table if not exists classroom.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references classroom.schools (id) on delete cascade,
  reference text not null unique,
  plan text not null check (plan in ('starter', 'growth')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'NGN',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'abandoned')),
  started_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  period_start date,
  period_end date,
  gateway_response jsonb,
  created_at timestamptz not null default now()
);
create index if not exists subscription_payments_school_idx on classroom.subscription_payments (school_id, created_at desc);
create index if not exists subscription_payments_started_by_idx on classroom.subscription_payments (started_by);
alter table classroom.subscription_payments enable row level security;
drop policy if exists "school admins and platform read subscription payments" on classroom.subscription_payments;
create policy "school admins and platform read subscription payments" on classroom.subscription_payments
  for select to authenticated using (classroom.is_school_admin(school_id) or classroom.is_platform_admin());
grant select on classroom.subscription_payments to authenticated;
drop trigger if exists audit_trg on classroom.subscription_payments;
create trigger audit_trg after insert or update or delete on classroom.subscription_payments
  for each row execute function classroom.write_audit_log();

-- Service role (subscription-pay): a payment about to start.
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
  insert into classroom.subscription_payments (school_id, reference, plan, amount, started_by)
  values (target_school, ref, q->>'plan', (q->>'amount')::numeric, actor);
  return q || jsonb_build_object('email', who, 'school_name', s.name, 'slug', s.slug);
end;
$fn$;

-- Service role (subscription-pay, after Paystack confirms): idempotent.
create or replace function classroom.confirm_subscription_payment(ref text, paid_amount numeric, paid_at_in timestamptz, response jsonb)
returns jsonb language plpgsql security definer set search_path = classroom, public as $fn$
declare p classroom.subscription_payments; s classroom.schools; starts date; ends date;
begin
  select * into p from classroom.subscription_payments where reference = ref for update;
  if not found then raise exception 'Unknown payment reference'; end if;
  if p.status = 'paid' then return jsonb_build_object('status', 'paid', 'period_end', p.period_end, 'already', true); end if;
  if paid_amount < p.amount then
    update classroom.subscription_payments set status = 'failed', gateway_response = response where id = p.id;
    raise exception 'The amount paid does not match the plan';
  end if;
  select * into s from classroom.schools where id = p.school_id for update;
  starts := greatest(current_date, coalesce(s.paid_until, current_date));
  ends := (starts + interval '1 month')::date;
  update classroom.subscription_payments
     set status = 'paid', paid_at = coalesce(paid_at_in, now()), period_start = starts, period_end = ends, gateway_response = response
   where id = p.id;
  update classroom.schools set plan = p.plan, paid_until = ends where id = p.school_id;
  insert into classroom.billing_records (school_id, plan, amount, currency, period_start, period_end, status, note)
  values (p.school_id, p.plan, p.amount, p.currency, starts, ends, 'paid', 'Paystack ' || ref);
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select a, p.school_id, 'subscription_paid', 'Thank you: ' || initcap(p.plan) || ' plan paid',
         'Paid up until ' || to_char(ends, 'FMDD Mon YYYY') || '.', '/School?tab=billing'
    from classroom.school_approvers(p.school_id) a;
  return jsonb_build_object('status', 'paid', 'period_end', ends);
end;
$fn$;

create or replace function classroom.mark_subscription_payment(ref text, status_in text, response jsonb)
returns void language sql security definer set search_path = classroom, public as $fn$
  update classroom.subscription_payments set status = status_in, gateway_response = response
   where reference = ref and status = 'pending' and status_in in ('failed', 'abandoned');
$fn$;

revoke all on function classroom.start_subscription_payment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function classroom.confirm_subscription_payment(text, numeric, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function classroom.mark_subscription_payment(text, text, jsonb) from public, anon, authenticated;
grant execute on function classroom.start_subscription_payment(uuid, uuid, text),
  classroom.confirm_subscription_payment(text, numeric, timestamptz, jsonb),
  classroom.mark_subscription_payment(text, text, jsonb) to service_role;
revoke all on function classroom.my_school_subscription(uuid) from public, anon;
grant execute on function classroom.my_school_subscription(uuid) to authenticated;

-- 5. Reminders -----------------------------------------------------------------
create table if not exists classroom.subscription_reminders (
  school_id uuid not null references classroom.schools (id) on delete cascade,
  kind text not null check (kind in ('trial', 'renewal')),
  ends_on date not null,
  days_before integer not null check (days_before in (0, 1, 3, 5)),
  sent_at timestamptz not null default now(),
  primary key (school_id, kind, ends_on, days_before)
);
alter table classroom.subscription_reminders enable row level security;

-- Every reminder due today that has not gone yet: for trials and for paid
-- months, at 5, 3 and 1 day(s) before the end and on the day itself. A
-- reminder missed on its day (a failed run) still goes the next day, as
-- long as a later step has not already been sent.
create or replace function classroom.due_subscription_reminders()
returns table (
  school_id uuid, school_name text, slug text, kind text, ends_on date, days_before integer, days_left integer,
  recipients jsonb, plan_name text, amount numeric)
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
       and e.ends_on - current_date <= 5
  ), next_step as (
    -- The one step that applies today: the smallest not-yet-passed step.
    select distinct on (st.id) st.*
      from steps st
     order by st.id, st.days_before asc
  )
  select n.id, n.name, n.slug, n.kind, n.ends_on, n.days_before, n.days_left,
         coalesce((select jsonb_agg(distinct jsonb_build_object('email', u.email, 'name', classroom.person_label(u.id), 'user_id', u.id))
                     from classroom.school_approvers(n.id) a join auth.users u on u.id = a where u.email is not null), '[]'::jsonb),
         classroom.school_plan_quote(n.id)->>'plan_name',
         (classroom.school_plan_quote(n.id)->>'amount')::numeric
    from next_step n
   where not exists (
     select 1 from classroom.subscription_reminders r
      where r.school_id = n.id and r.kind = n.kind and r.ends_on = n.ends_on and r.days_before <= n.days_before);
$fn$;

create or replace function classroom.record_subscription_reminder(target_school uuid, kind_in text, ends_on_in date, days_in integer)
returns void language plpgsql security definer set search_path = classroom, public as $fn$
declare s classroom.schools; title text; body text;
begin
  insert into classroom.subscription_reminders (school_id, kind, ends_on, days_before)
  values (target_school, kind_in, ends_on_in, days_in) on conflict do nothing;
  if not found then return; end if;
  select * into s from classroom.schools where id = target_school;
  title := case
    when days_in = 0 and kind_in = 'trial' then 'Your free trial ends today'
    when days_in = 0 then 'Your Schoolivio plan ends today'
    when kind_in = 'trial' then 'Your free trial ends in ' || days_in || ' day' || case when days_in = 1 then '' else 's' end
    else 'Your Schoolivio plan ends in ' || days_in || ' day' || case when days_in = 1 then '' else 's' end end;
  body := 'Start your monthly plan to keep ' || s.name || ' running without a break. Pay under School admin → Plan & billing.';
  insert into classroom.notifications (user_id, school_id, kind, title, body, link)
  select a, target_school, 'subscription_reminder', title, body, '/School?tab=billing'
    from classroom.school_approvers(target_school) a;
end;
$fn$;
revoke all on function classroom.due_subscription_reminders() from public, anon, authenticated;
revoke all on function classroom.record_subscription_reminder(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function classroom.due_subscription_reminders(), classroom.record_subscription_reminder(uuid, text, date, integer) to service_role;

-- Daily at 08:00 Lagos time (07:00 UTC). Same shared secret as the mail poller.
select cron.unschedule('schoolivio-subscription-reminders')
 where exists (select 1 from cron.job where jobname = 'schoolivio-subscription-reminders');
select cron.schedule(
  'schoolivio-subscription-reminders',
  '0 7 * * *',
  $job$
    select net.http_post(
      url := 'https://nulvsbapllfxvhdmyudt.supabase.co/functions/v1/subscription-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ticket_mail_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

-- 6. The console's plan names now match the landing page ------------------------
create or replace function classroom.platform_set_plan(target_school uuid, new_plan text)
returns classroom.schools language plpgsql security definer set search_path = classroom, public as $fn$
declare
  row classroom.schools;
begin
  if not classroom.is_platform_admin() then
    raise exception 'Only a platform administrator can change a plan';
  end if;
  if new_plan not in ('trial', 'starter', 'growth', 'enterprise') then
    raise exception 'Unknown plan: %', new_plan;
  end if;
  update classroom.schools set plan = new_plan where id = target_school returning * into row;
  if not found then
    raise exception 'No such school';
  end if;
  return row;
end;
$fn$;

notify pgrst, 'reload schema';
