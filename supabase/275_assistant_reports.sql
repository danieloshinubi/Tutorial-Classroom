-- 275: exact figures for the assistant (2026-10-16).
--
-- A tester asked the assistant nine questions and found it adding September
-- and October payroll together, doing PAYE arithmetic wrongly, inventing
-- events, and ignoring "this month" and "this term". The model should never
-- do that arithmetic or filtering itself. These functions do it, once, the
-- way the app's own pages do, and the assistant only reads what they return.
--
-- Each one:
--   * runs as the person asking (security invoker), so row level security
--     decides what they see: a parent sees their children, a teacher their
--     own payslip, the bursar everything (ai_paye_estimate is the one
--     exception: a tax estimate on a figure the person types, using the
--     school's own bands, which reveals nothing about anyone);
--   * works in Lagos time (Africa/Lagos, WAT), whatever the server clock;
--   * says which period it covers, and which page shows the same figures.

create or replace function classroom.ai_today()
returns date language sql stable set search_path = classroom, public
as $$ select (now() at time zone 'Africa/Lagos')::date $$;

create or replace function classroom.ai_person_name(who uuid)
returns text language sql stable set search_path = classroom, public
as $$
  select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''), p.username, split_part(p.email, '@', 1), 'Unknown')
    from classroom.profiles p where p.id = who
$$;

create or replace function classroom.ai_purpose_label(purpose text)
returns text language sql immutable
as $$
  select case coalesce(purpose, 'term_fee')
    when 'term_fee' then 'School fees'
    when 'application_fee' then 'Application fees'
    else initcap(replace(purpose, '_', ' ')) end
$$;

-- Money as people write it, in the school's currency (₦1,900,000).
create or replace function classroom.ai_money(target_school uuid, amount numeric)
returns text language sql stable set search_path = classroom, public
as $$
  select coalesce((select case s.currency when 'NGN' then '₦' when 'GHS' then 'GH₵' when 'USD' then '$' when 'GBP' then '£' when 'EUR' then '€' else s.currency || ' ' end
                     from classroom.schools s where s.id = target_school), '')
         || replace(to_char(round(amount, 2), 'FM999,999,999,990.00'), '.00', '')
$$;

-- Fees for one term (the current one unless given): billed, collected,
-- still owed and overpaid, by kind of bill; application fees for that
-- term's session alongside; the biggest debtors by name.
create or replace function classroom.ai_fees(target_school uuid, target_term uuid default null)
returns jsonb language plpgsql stable set search_path = classroom, public
as $$
declare
  t classroom.terms;
  result jsonb;
begin
  select * into t from classroom.terms
   where school_id = target_school and (id = target_term or (target_term is null and is_current))
   limit 1;
  if t.id is null then
    return jsonb_build_object('found', false, 'note', 'No current term is set, so there is no term to report on. Set one under School > Academic.');
  end if;

  with bills as (
    select b.*, case when b.purpose = 'application_fee' then 'application' else 'term' end as part
      from classroom.invoice_balances b
     where b.school_id = target_school
       and b.status <> 'draft' and b.status <> 'cancelled'
       and (b.term_id = t.id or (b.purpose = 'application_fee' and b.session_id = t.session_id))
  ),
  by_kind as (
    select part, classroom.ai_purpose_label(purpose) as kind,
           count(*) as bills,
           sum(payable) as billed,
           sum(paid) as collected,
           sum(greatest(balance, 0)) as still_owed,
           sum(greatest(-balance, 0)) as overpaid,
           sum(coalesce(awaiting_approval, 0)) as awaiting_approval
      from bills group by part, purpose
  ),
  owing as (
    select coalesce(classroom.ai_person_name(b.student_id), b.applicant_name, 'Unknown') as name,
           b.reference, classroom.ai_purpose_label(b.purpose) as kind, b.payable, b.paid, b.balance as owes
      from bills b where b.balance > 0 order by b.balance desc limit 15
  )
  select jsonb_build_object(
    'found', true,
    'term', t.name, 'term_dates', to_char(t.starts_on, 'FMDD Mon YYYY') || ' to ' || to_char(t.ends_on, 'FMDD Mon YYYY'),
    'counts', 'Only issued bills; drafts are not owed. Application fees are for the whole session.',
    'by_kind', coalesce((select jsonb_agg(to_jsonb(k) order by k.part desc, k.kind) from by_kind k), '[]'::jsonb),
    'totals_term_fees', (select jsonb_build_object('billed', coalesce(sum(billed), 0), 'collected', coalesce(sum(collected), 0), 'still_owed', coalesce(sum(still_owed), 0), 'overpaid', coalesce(sum(overpaid), 0)) from by_kind where part = 'term'),
    'totals_including_application_fees', (select jsonb_build_object('billed', coalesce(sum(billed), 0), 'collected', coalesce(sum(collected), 0), 'still_owed', coalesce(sum(still_owed), 0), 'overpaid', coalesce(sum(overpaid), 0)) from by_kind),
    'who_owes_largest_first', coalesce((select jsonb_agg(to_jsonb(o)) from owing o), '[]'::jsonb),
    'page', '/Bursary'
  ) into result;
  return result;
end;
$$;

-- One month's payroll (this month unless given): the run's status and
-- totals, and the top earner. Never adds months together.
create or replace function classroom.ai_payroll_month(target_school uuid, month_in date default null)
returns jsonb language plpgsql stable set search_path = classroom, public
as $$
declare
  m date := date_trunc('month', coalesce(month_in, classroom.ai_today()))::date;
  r classroom.payroll_runs;
  result jsonb;
begin
  select * into r from classroom.payroll_runs
   where school_id = target_school and date_trunc('month', period) = m
   order by prepared_at desc nulls last limit 1;

  if r.id is null then
    -- Staff without payroll access see no runs; their own payslips still.
    if not classroom.can_view_payroll(target_school) then
      return jsonb_build_object('found', false, 'month', to_char(m, 'FMMonth YYYY'),
        'note', 'This person cannot see the school payroll; only their own payslips (approved months).', 'page', '/Payslips');
    end if;
    return jsonb_build_object('found', false, 'month', to_char(m, 'FMMonth YYYY'),
      'note', 'No payroll has been prepared for this month.',
      'months_with_payroll', coalesce((select jsonb_agg(to_char(period, 'FMMonth YYYY') || ' (' || status || ')' order by period desc)
                                       from (select period, status from classroom.payroll_runs where school_id = target_school order by period desc limit 6) x), '[]'::jsonb),
      'page', '/Payroll');
  end if;

  select jsonb_build_object(
    'found', true,
    'month', to_char(m, 'FMMonth YYYY'),
    'status', r.status,
    'staff_paid', count(*),
    'gross', coalesce(sum(p.gross), 0),
    'paye', coalesce(sum(p.paye), 0),
    'pension_staff_share', coalesce(sum(p.pension_employee), 0),
    'pension_school_share', coalesce(sum(p.pension_employer), 0),
    'nhf', coalesce(sum(p.nhf), 0),
    'other_deductions', coalesce(sum(p.other_deductions), 0),
    'net_pay', coalesce(sum(p.net), 0),
    'cost_to_school', coalesce(sum(p.gross + p.pension_employer), 0),
    'top_earners', coalesce((select jsonb_agg(jsonb_build_object('name', x.full_name, 'job', x.job_title, 'gross', x.gross, 'net', x.net) order by x.gross desc)
                             from (select full_name, job_title, gross, net from classroom.payslips where run_id = r.id order by gross desc limit 3) x), '[]'::jsonb),
    'page', '/Payroll'
  ) into result
  from classroom.payslips p where p.run_id = r.id;
  return result;
end;
$$;

-- PAYE on a monthly salary the person names, worked exactly as payroll
-- does (Payroll > settings: the school's bands, pension and NHF rates).
create or replace function classroom.ai_paye_estimate(
  target_school uuid, monthly_gross numeric, pension boolean default true,
  nhf_on_basic numeric default 0, annual_rent numeric default 0
)
returns jsonb language plpgsql stable security definer set search_path = classroom, public
as $$
declare
  cfg classroom.payroll_settings;
  pension_m numeric := 0;
  nhf_m numeric := 0;
  relief numeric := 0;
  chargeable numeric;
  tax_year numeric;
begin
  if not classroom.is_member_of(target_school) then raise exception 'Not a member of this school'; end if;
  if monthly_gross is null or monthly_gross <= 0 then raise exception 'Give a monthly gross above 0'; end if;
  select * into cfg from classroom.payroll_settings where school_id = target_school;
  if not found then
    return jsonb_build_object('found', false, 'note', 'Payroll is not set up at this school yet, so there are no tax bands to use.');
  end if;

  if pension then pension_m := round(monthly_gross * cfg.pension_employee_percent / 100, 2); end if;
  if coalesce(nhf_on_basic, 0) > 0 then nhf_m := round(nhf_on_basic * cfg.nhf_percent / 100, 2); end if;
  relief := least(round(coalesce(annual_rent, 0) * cfg.rent_relief_percent / 100, 2), cfg.rent_relief_cap);
  chargeable := greatest(0, (monthly_gross - pension_m - nhf_m) * 12 - relief);
  tax_year := classroom.payroll_annual_tax(chargeable, cfg.paye_bands);

  return jsonb_build_object(
    'found', true,
    'monthly_gross', monthly_gross,
    'pension_monthly', pension_m, 'pension_rate_percent', case when pension then cfg.pension_employee_percent else 0 end,
    'nhf_monthly', nhf_m,
    'rent_relief_yearly', relief,
    'taxable_yearly', chargeable,
    'paye_yearly', round(tax_year, 2),
    'paye_monthly', round(tax_year / 12, 2),
    'net_monthly_before_other_deductions', round(monthly_gross - pension_m - nhf_m - tax_year / 12, 2),
    'method', 'Yearly pay less pension, NHF and rent relief, taxed on the school''s PAYE bands, then divided by 12. Same as Payroll.',
    'page', '/Payroll'
  );
end;
$$;

-- Store sales between two dates (this month unless given), and stock that
-- is at or below its warning level.
create or replace function classroom.ai_store(target_school uuid, from_date date default null, to_date date default null)
returns jsonb language plpgsql stable set search_path = classroom, public
as $$
declare
  f date := coalesce(from_date, date_trunc('month', classroom.ai_today())::date);
  t date := coalesce(to_date, classroom.ai_today());
  result jsonb;
begin
  with sales as (
    select s.* from classroom.store_sales s
     where s.school_id = target_school and s.voided_at is null
       and (s.sold_at at time zone 'Africa/Lagos')::date between f and t
  )
  select jsonb_build_object(
    'period', to_char(f, 'FMDD Mon YYYY') || ' to ' || to_char(t, 'FMDD Mon YYYY'),
    'sales', (select count(*) from sales),
    'takings', (select coalesce(sum(total), 0) from sales),
    'profit', (select coalesce(sum(total - coalesce(cost_total, 0)), 0) from sales),
    'by_payment', coalesce((select jsonb_object_agg(coalesce(payment, 'other'), amt) from (select payment, sum(total) amt from sales group by payment) x), '{}'::jsonb),
    'sales_list', coalesce((select jsonb_agg(jsonb_build_object(
        'reference', s.reference,
        'date', to_char(s.sold_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'),
        'buyer', coalesce(classroom.ai_person_name(s.student_id), s.buyer_name, 'Walk-in'),
        'total', s.total) order by s.sold_at desc)
      from (select * from sales order by sold_at desc limit 20) s), '[]'::jsonb),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('item', p.name || coalesce(' (' || p.size || ')', ''), 'in_stock', p.stock_qty, 'warning_level', p.reorder_level) order by p.stock_qty)
      from classroom.store_products p
      where p.school_id = target_school and p.is_active and p.reorder_level is not null and p.stock_qty <= p.reorder_level), '[]'::jsonb),
    'page', '/Store'
  ) into result;
  return result;
end;
$$;

-- What is coming up: term dates, events, and the notices the person can
-- see. Only what is on record; the assistant says so when something isn't.
create or replace function classroom.ai_calendar(target_school uuid, from_date date default null, to_date date default null)
returns jsonb language plpgsql stable set search_path = classroom, public
as $$
declare
  f date := coalesce(from_date, classroom.ai_today());
  t date := coalesce(to_date, classroom.ai_today() + 120);
begin
  return jsonb_build_object(
    'today', to_char(classroom.ai_today(), 'FMDay FMDD Mon YYYY'),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('term', tr.name, 'session', se.name, 'from', to_char(tr.starts_on, 'FMDD Mon YYYY'), 'to', to_char(tr.ends_on, 'FMDD Mon YYYY'), 'current', tr.is_current) order by tr.starts_on)
       from classroom.terms tr join classroom.sessions se on se.id = tr.session_id
      where tr.school_id = target_school and tr.ends_on >= f - 30 and tr.starts_on <= t + 120), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event', n.title, 'when', to_char(n.event_at at time zone 'Africa/Lagos', 'FMDy FMDD Mon YYYY, FMHH12:MI am'), 'where', n.event_place) order by n.event_at)
       from classroom.notices n
      where n.school_id = target_school and n.is_event and n.event_at is not null
        and (n.event_at at time zone 'Africa/Lagos')::date between f and t), '[]'::jsonb),
    'notices', coalesce((select jsonb_agg(jsonb_build_object('title', x.title, 'posted', to_char(x.posted at time zone 'Africa/Lagos', 'FMDD Mon YYYY'), 'text', x.body) order by x.posted desc)
       from (select n.title, left(regexp_replace(n.body, '\s+', ' ', 'g'), 300) as body, coalesce(n.published_at, n.created_at) as posted
               from classroom.notices n
              where n.school_id = target_school and coalesce(n.published_at, n.created_at) <= now()
                and coalesce(n.published_at, n.created_at) >= now() - interval '150 days'
              order by coalesce(n.published_at, n.created_at) desc limit 25) x), '[]'::jsonb),
    'rule', 'These are the only dates and events on record. Anything not listed here is not on record.',
    'page', '/News'
  );
end;
$$;

-- Classes this session: form teacher and how many pupils.
create or replace function classroom.ai_classes(target_school uuid)
returns jsonb language sql stable set search_path = classroom, public
as $$
  select jsonb_build_object(
    'session', (select name from classroom.sessions where school_id = target_school and is_current limit 1),
    'classes', coalesce(jsonb_agg(jsonb_build_object(
        'class', c.name,
        'level', coalesce(l.label, c.level_year::text),
        'form_teacher', case when c.form_teacher_id is null then null else classroom.ai_person_name(c.form_teacher_id) end,
        'pupils', (select count(*) from classroom.class_students cs where cs.class_id = c.id)
      ) order by c.level_year, c.name), '[]'::jsonb),
    'pupils_in_classes', coalesce(sum((select count(*) from classroom.class_students cs where cs.class_id = c.id)), 0),
    'page', '/School?tab=classes'
  )
  from classroom.classes c
  left join classroom.levels l on l.school_id = c.school_id and l.year = c.level_year
  where c.school_id = target_school
    and c.session_id = (select id from classroom.sessions where school_id = target_school and is_current limit 1)
$$;

-- Attendance between two dates (this month unless given): by class, and
-- the pupils absent most.
create or replace function classroom.ai_attendance(target_school uuid, from_date date default null, to_date date default null)
returns jsonb language plpgsql stable set search_path = classroom, public
as $$
declare
  f date := coalesce(from_date, date_trunc('month', classroom.ai_today())::date);
  t date := coalesce(to_date, classroom.ai_today());
  result jsonb;
begin
  with marks as (
    select a.* from classroom.attendance_records a
     where a.school_id = target_school
       and (a.session_at at time zone 'Africa/Lagos')::date between f and t
  )
  select jsonb_build_object(
    'period', to_char(f, 'FMDD Mon YYYY') || ' to ' || to_char(t, 'FMDD Mon YYYY'),
    'days_marked', (select count(distinct (session_at at time zone 'Africa/Lagos')::date) from marks),
    'present', (select count(*) from marks where status = 'present'),
    'absent', (select count(*) from marks where status = 'absent'),
    'by_class', coalesce((select jsonb_agg(jsonb_build_object('class', c.name, 'present', x.present, 'absent', x.absent,
                 'attendance_rate_percent', case when x.present + x.absent > 0 then round(100.0 * x.present / (x.present + x.absent), 1) end) order by c.name)
       from (select class_id, count(*) filter (where status = 'present') present, count(*) filter (where status = 'absent') absent from marks group by class_id) x
       join classroom.classes c on c.id = x.class_id), '[]'::jsonb),
    'most_absent', coalesce((select jsonb_agg(jsonb_build_object('pupil', classroom.ai_person_name(y.student_id), 'days_absent', y.n) order by y.n desc)
       from (select student_id, count(*) n from marks where status = 'absent' group by student_id order by count(*) desc limit 10) y), '[]'::jsonb),
    'page', '/Attendance'
  ) into result;
  return result;
end;
$$;

-- Things that look wrong, found without being asked: overpaid bills,
-- duplicate bills, payments waiting too long, low stock, payroll that
-- jumped from one month to the next.
create or replace function classroom.ai_checks(target_school uuid)
returns jsonb language plpgsql stable set search_path = classroom, public
as $$
declare
  findings jsonb := '[]'::jsonb;
  r record;
  last_two numeric[];
begin
  for r in
    select coalesce(classroom.ai_person_name(b.student_id), b.applicant_name, 'Unknown') as name, b.reference, b.purpose, b.payable, b.paid, -b.balance as over
      from classroom.invoice_balances b
     where b.school_id = target_school and b.status = 'issued' and b.balance < 0
     order by b.balance limit 10
  loop
    findings := findings || jsonb_build_object('severity', 'high', 'issue', 'Overpaid bill',
      'detail', format('%s (%s, %s): billed %s, paid %s, overpaid by %s. Check the payment amount; refund or keep as credit.',
                       r.reference, r.name, classroom.ai_purpose_label(r.purpose), classroom.ai_money(target_school, r.payable), classroom.ai_money(target_school, r.paid), classroom.ai_money(target_school, r.over)), 'page', '/Bursary');
  end loop;

  for r in
    select classroom.ai_person_name(i.student_id) as name, classroom.ai_purpose_label(i.purpose) as kind, count(*) n, string_agg(i.reference, ', ') refs
      from classroom.invoices i
     where i.school_id = target_school and i.status <> 'cancelled' and i.student_id is not null and i.term_id is not null
     group by i.student_id, i.term_id, i.purpose having count(*) > 1 limit 10
  loop
    findings := findings || jsonb_build_object('severity', 'medium', 'issue', 'Possible duplicate bills',
      'detail', format('%s has %s %s bills for the same term: %s.', r.name, r.n, r.kind, r.refs), 'page', '/Bursary');
  end loop;

  for r in
    select i.reference, p.amount, (classroom.ai_today() - (p.submitted_at at time zone 'Africa/Lagos')::date) as days
      from classroom.payments p join classroom.invoices i on i.id = p.invoice_id
     where p.school_id = target_school and p.status = 'submitted' and p.submitted_at < now() - interval '2 days'
     order by p.submitted_at limit 10
  loop
    findings := findings || jsonb_build_object('severity', 'medium', 'issue', 'Payment waiting for approval',
      'detail', format('%s for %s has waited %s days.', classroom.ai_money(target_school, r.amount), r.reference, r.days), 'page', '/Bursary');
  end loop;

  for r in
    select p.name || coalesce(' (' || p.size || ')', '') as item, p.stock_qty, p.reorder_level
      from classroom.store_products p
     where p.school_id = target_school and p.is_active and p.reorder_level is not null and p.stock_qty <= p.reorder_level
     order by p.stock_qty limit 10
  loop
    findings := findings || jsonb_build_object('severity', 'low', 'issue', 'Low stock',
      'detail', format('%s: %s left (warning level %s).', r.item, r.stock_qty, r.reorder_level), 'page', '/Store');
  end loop;

  select array_agg(g order by period desc) into last_two from (
    select r2.period, (select sum(gross) from classroom.payslips p where p.run_id = r2.id) g
      from classroom.payroll_runs r2 where r2.school_id = target_school order by r2.period desc limit 2) x;
  if array_length(last_two, 1) = 2 and last_two[2] > 0 and abs(last_two[1] - last_two[2]) / last_two[2] > 0.15 then
    findings := findings || jsonb_build_object('severity', 'medium', 'issue', 'Payroll changed sharply',
      'detail', format('Latest month''s gross pay is %s against %s the month before (%s%%).', classroom.ai_money(target_school, last_two[1]), classroom.ai_money(target_school, last_two[2]),
                       round(100 * (last_two[1] - last_two[2]) / last_two[2], 1)), 'page', '/Payroll');
  end if;

  return jsonb_build_object('checked', to_char(classroom.ai_today(), 'FMDD Mon YYYY'),
    'findings', findings,
    'note', case when jsonb_array_length(findings) = 0 then 'Nothing looks wrong in what this person can see.' else null end);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ai_today()', 'ai_money(uuid, numeric)', 'ai_person_name(uuid)', 'ai_purpose_label(text)',
    'ai_fees(uuid, uuid)', 'ai_payroll_month(uuid, date)', 'ai_paye_estimate(uuid, numeric, boolean, numeric, numeric)',
    'ai_store(uuid, date, date)', 'ai_calendar(uuid, date, date)', 'ai_classes(uuid)',
    'ai_attendance(uuid, date, date)', 'ai_checks(uuid)'
  ] loop
    execute format('revoke all on function classroom.%s from public, anon', f);
    execute format('grant execute on function classroom.%s to authenticated, service_role', f);
  end loop;
end $$;
