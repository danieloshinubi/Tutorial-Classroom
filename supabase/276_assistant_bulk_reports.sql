-- 276: bigger questions in one lookup (2026-10-17).
--
-- A tester's stock, restock and "across all courses" questions ran out of
-- time: the assistant fetched product by product and course by course, one
-- slow round each. These answer those questions in a single call, worked
-- out here, as the person asking (security invoker, so row level security
-- still decides what each person sees).

-- The store: sales for the period (unchanged), plus the whole shelf and
-- what to restock.
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
  ),
  sold as (
    select i.product_id, sum(i.qty) as qty
      from classroom.store_sale_items i join sales s on s.id = i.sale_id
     group by i.product_id
  ),
  shelf as (
    select p.*, coalesce(sd.qty, 0) as sold_in_period,
           case when p.stock_qty <= 0 then 'out of stock'
                when p.reorder_level is not null and p.stock_qty <= p.reorder_level then 'low'
                else 'ok' end as state
      from classroom.store_products p left join sold sd on sd.product_id = p.id
     where p.school_id = target_school and p.is_active
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
    'stock', coalesce((select jsonb_agg(jsonb_build_object(
        'item', sh.name || coalesce(' (' || sh.size || ')', ''),
        'category', initcap(sh.category),
        'in_stock', sh.stock_qty,
        'warning_level', sh.reorder_level,
        'state', sh.state,
        'sold_in_period', sh.sold_in_period,
        'sell_price', sh.sell_price,
        'cost', coalesce(sh.net_cost, sh.cost_price)) order by sh.category, sh.name, sh.size)
      from shelf sh), '[]'::jsonb),
    'restock', coalesce((select jsonb_agg(jsonb_build_object(
        'item', sh.name || coalesce(' (' || sh.size || ')', ''),
        'in_stock', sh.stock_qty,
        'warning_level', sh.reorder_level,
        'state', sh.state,
        'to_reach_twice_warning_level', greatest(coalesce(sh.reorder_level, 0) * 2 - sh.stock_qty, 0)) order by sh.stock_qty)
      from shelf sh where sh.state <> 'ok'), '[]'::jsonb),
    'stock_value_at_cost', (select coalesce(sum(greatest(stock_qty, 0) * coalesce(net_cost, cost_price)), 0) from shelf),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('item', sh.name || coalesce(' (' || sh.size || ')', ''), 'in_stock', sh.stock_qty, 'warning_level', sh.reorder_level) order by sh.stock_qty)
      from shelf sh where sh.state <> 'ok'), '[]'::jsonb),
    'page', '/Store'
  ) into result;
  return result;
end;
$$;

-- Every course the person can see, at a glance: teachers, pupils, exams
-- (published or draft, when they open and close), assignments and their
-- due dates, and how busy the stream has been.
create or replace function classroom.ai_courses(target_school uuid)
returns jsonb language sql stable set search_path = classroom, public
as $$
  with cs as (
    select c.* from classroom.courses c
     where c.school_id = target_school and not c.archived
       and (c.session_id is null or c.session_id = (select id from classroom.sessions where school_id = target_school and is_current limit 1))
     order by c.code limit 80
  )
  select jsonb_build_object(
    'today', to_char(classroom.ai_today(), 'FMDy FMDD Mon YYYY'),
    'courses', coalesce(jsonb_agg(jsonb_build_object(
      'course', c.code || ' ' || c.title,
      'teachers', (select string_agg(classroom.ai_person_name(x.user_id), ', ')
                     from (select c.owner_id as user_id union select ct.user_id from classroom.course_teachers ct where ct.course_id = c.id) x),
      'pupils', (select count(*) from classroom.enrollments e where e.course_id = c.id and e.status = 'approved'),
      'waiting_to_join', (select count(*) from classroom.enrollments e where e.course_id = c.id and e.status = 'pending'),
      'exams', (select coalesce(jsonb_agg(jsonb_build_object(
                  'exam', ex.title,
                  'type', case ex.kind when 'midterm' then 'Mid-term' else 'Exam' end,
                  'status', case when ex.published then 'Published' else 'Draft' end,
                  'opens', to_char(ex.opens_at at time zone 'Africa/Lagos', 'FMDy FMDD Mon, FMHH12:MI am'),
                  'closes', to_char(ex.closes_at at time zone 'Africa/Lagos', 'FMDy FMDD Mon, FMHH12:MI am'),
                  'questions', classroom.exam_question_count(ex.id),
                  'attempts', (select count(*) from classroom.exam_attempts a where a.exam_id = ex.id)) order by ex.created_at), '[]'::jsonb)
                from classroom.exams ex where ex.course_id = c.id),
      'assignments', (select coalesce(jsonb_agg(jsonb_build_object(
                  'assignment', a.title,
                  'due', to_char(a.due_at at time zone 'Africa/Lagos', 'FMDy FMDD Mon, FMHH12:MI am'),
                  'overdue', a.due_at is not null and a.due_at < now(),
                  'handed_in', (select count(*) from classroom.submissions s where s.assignment_id = a.id)) order by a.due_at nulls last), '[]'::jsonb)
                from classroom.assignments a where a.course_id = c.id),
      'stream_posts_last_14_days', (select count(*) from classroom.messages m where m.course_id = c.id and m.created_at > now() - interval '14 days'),
      'last_stream_post', (select to_char(max(m.created_at) at time zone 'Africa/Lagos', 'FMDD Mon YYYY') from classroom.messages m where m.course_id = c.id),
      'materials', (select count(*) from classroom.materials mt where mt.course_id = c.id)
    ) order by c.code), '[]'::jsonb),
    'totals', jsonb_build_object(
      'courses', (select count(*) from cs),
      'exams_published', (select count(*) from classroom.exams ex join cs on cs.id = ex.course_id where ex.published),
      'exams_draft', (select count(*) from classroom.exams ex join cs on cs.id = ex.course_id where not ex.published),
      'assignments_due_next_7_days', (select count(*) from classroom.assignments a join cs on cs.id = a.course_id where a.due_at between now() and now() + interval '7 days'),
      'courses_with_no_stream_post_in_14_days', (select count(*) from cs where not exists (select 1 from classroom.messages m where m.course_id = cs.id and m.created_at > now() - interval '14 days'))),
    'page', '/Courses'
  )
  from cs c
$$;

-- The school at a glance, for "how are we doing?" or a morning brief:
-- fees, payroll, attendance, store, what looks wrong, and what is coming.
create or replace function classroom.ai_health(target_school uuid)
returns jsonb language plpgsql stable set search_path = classroom, public
as $$
declare
  fees jsonb := classroom.ai_fees(target_school);
  pay jsonb := classroom.ai_payroll_month(target_school);
  att jsonb := classroom.ai_attendance(target_school);
  store jsonb := classroom.ai_store(target_school);
  cal jsonb := classroom.ai_calendar(target_school, classroom.ai_today(), classroom.ai_today() + 14);
begin
  return jsonb_build_object(
    'today', to_char(classroom.ai_today(), 'FMDay FMDD Mon YYYY'),
    'fees_this_term', case when (fees ->> 'found')::boolean then jsonb_build_object('term', fees ->> 'term', 'school_fees', fees -> 'totals_term_fees', 'including_application_fees', fees -> 'totals_including_application_fees', 'top_debtors', (select coalesce(jsonb_agg(d), '[]'::jsonb) from (select d from jsonb_array_elements(fees -> 'who_owes_largest_first') d limit 5) x)) else fees end,
    'payroll_this_month', case when (pay ->> 'found')::boolean then pay - 'top_earners' - 'page' else pay end,
    'attendance_this_month', att - 'by_class' - 'page',
    'store_this_month', jsonb_build_object('sales', store -> 'sales', 'takings', store -> 'takings', 'profit', store -> 'profit', 'needs_restock', store -> 'restock'),
    'things_that_look_wrong', classroom.ai_checks(target_school) -> 'findings',
    'next_14_days', cal -> 'events',
    'exams_closing_next_7_days', coalesce((select jsonb_agg(jsonb_build_object('exam', ex.title, 'course', c.code, 'closes', to_char(ex.closes_at at time zone 'Africa/Lagos', 'FMDy FMDD Mon, FMHH12:MI am'), 'status', case when ex.published then 'Published' else 'Draft' end) order by ex.closes_at)
       from classroom.exams ex join classroom.courses c on c.id = ex.course_id
      where c.school_id = target_school and ex.closes_at between now() and now() + interval '7 days'), '[]'::jsonb)
  );
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['ai_store(uuid, date, date)', 'ai_courses(uuid)', 'ai_health(uuid)'] loop
    execute format('revoke all on function classroom.%s from public, anon', f);
    execute format('grant execute on function classroom.%s to authenticated, service_role', f);
  end loop;
end $$;
