-- =============================================================================
-- 142 gave billing records a per-school reader (platform_billing_for_school),
-- which is right for a school's own detail page but leaves no way to see the
-- ledger across every school at once — the same gap Gateways/Mailboxes/Trials
-- already had before their own platform_* readers existed. This is that
-- reader for billing, joined to the school name the same way those are.
-- =============================================================================

create or replace function classroom.platform_billing_records(limit_rows int default 300)
returns table (
  id            uuid,
  school_id     uuid,
  school_name   text,
  plan          text,
  amount        numeric,
  currency      text,
  period_start  date,
  period_end    date,
  status        text,
  note          text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select
    b.id, b.school_id, s.name,
    b.plan, b.amount, b.currency, b.period_start, b.period_end, b.status, b.note,
    b.created_at
  from classroom.billing_records b
  join classroom.schools s on s.id = b.school_id
  where classroom.is_platform_admin()
  order by b.created_at desc
  limit greatest(1, least(limit_rows, 1000));
$fn$;

grant execute on function classroom.platform_billing_records(int) to authenticated;

notify pgrst, 'reload schema';
