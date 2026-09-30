-- =============================================================================
-- The in-app AI assistant, for signed-in people in every school (Phase 1).
--
-- The assistant reads school data through the caller's own sign-in, the same
-- way the app does (supabase/functions/ai-assistant), so row level security
-- decides what it can see: a parent's assistant cannot see another family
-- because the database returns nothing, not because a prompt declined.
--
-- It is given structured lookups (table, columns, filters, grouping), never
-- raw SQL. Raw SQL run as the caller could reset the session role back to the
-- connection's own login and step from there into the service role, which
-- ignores row level security entirely. Structured lookups go through the
-- same API gateway as the app and cannot change role.
--
-- This migration adds what the edge function needs around that:
--   * a per-school monthly token limit (the assistant is included, capped);
--   * the catalogue of tables and columns it may look at, generated from the
--     live schema so it never goes stale, with secrets left out;
--   * record_ai_usage closed to browsers (173 granted it to authenticated,
--     which let anyone write fake usage rows against any school).
-- =============================================================================

alter table classroom.schools
  add column if not exists ai_token_limit bigint not null default 5000000
    check (ai_token_limit >= 0);

comment on column classroom.schools.ai_token_limit is
  'Monthly AI assistant tokens (input + output) this school may use. 0 switches the assistant off.';

-- Only the edge function (service role) records usage.
revoke execute on function classroom.record_ai_usage(uuid, text, text, integer, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function classroom.record_ai_usage(uuid, text, text, integer, integer, uuid, text)
  to service_role;

-- What the assistant may look at: every classroom table or view a signed-in
-- person can select from, minus the ones that hold credentials or device
-- keys, minus any column whose name says it is a secret. Row level security
-- still applies to every row on top of this.
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
           jsonb_agg(
             a.attname || ':' || format_type(a.atttypid, a.atttypmod)
             order by a.attnum
           ) as columns
      from readable r
      join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
     where a.attname !~* '(secret|token|password|passcode|api_key|private_key|p256dh|refresh|access_key|signing)'
     group by r.relname
  ),
  links as (
    select r.relname,
           jsonb_agg(distinct f.relname) as links_to
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

-- The limit and this month's use together, for the edge function's check
-- and for the page to show "x% of this month's assistant used".
create or replace function classroom.ai_allowance(target_school uuid)
returns jsonb
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select jsonb_build_object(
    'limit', s.ai_token_limit,
    'used', classroom.ai_tokens_this_month(s.id)
  )
    from classroom.schools s
   where s.id = target_school
     and (classroom.is_member_of(s.id) or auth.role() = 'service_role');
$fn$;

grant execute on function classroom.ai_allowance(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
