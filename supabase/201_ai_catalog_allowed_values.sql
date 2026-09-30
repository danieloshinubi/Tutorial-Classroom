-- The AI assistant's table catalogue (192, 197) now lists the values a
-- column accepts, so the assistant stops guessing them.
--
-- Found in use: asked to put a pen in the store, it said the store "only has
-- one category: uniform", because the one item on sale was a uniform. The
-- allowed categories (uniform, book, notebook, stationery, casual) live in a
-- check constraint it could not see. Now a column reads
--   category:text[one of uniform|book|notebook|stationery|casual]
-- from its check constraint, and an enum column lists its labels the same
-- way. The same catalogue feeds the assistant's new create/update/delete
-- record actions, so it also knows what it may write.
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
  -- Single-column check constraints that list values: col in ('a','b').
  checked as (
    select k.conrelid as oid, k.conkey[1] as attnum,
           string_agg(distinct m[1], '|') as allowed
      from pg_constraint k
      cross join lateral regexp_matches(pg_get_constraintdef(k.oid), '''([^'']+)''', 'g') as m
     where k.contype = 'c'
       and array_length(k.conkey, 1) = 1
       and k.conrelid in (select oid from readable)
       and pg_get_constraintdef(k.oid) ~* '(= any|\min\M)'
     group by k.conrelid, k.conkey[1]
  ),
  enums as (
    select e.enumtypid as typid, string_agg(e.enumlabel, '|' order by e.enumsortorder) as allowed
      from pg_enum e
     group by e.enumtypid
  ),
  cols as (
    select r.relname,
           jsonb_agg(
             a.attname || ':' || format_type(a.atttypid, a.atttypmod)
               || coalesce('[one of ' || coalesce(ch.allowed, en.allowed) || ']', '')
             order by a.attnum
           ) as columns,
           bool_or(a.attname = 'school_id') as has_school
      from readable r
      join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
      left join checked ch on ch.oid = r.oid and ch.attnum = a.attnum
      left join enums en on en.typid = a.atttypid
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
             'links_to', coalesce(links.links_to, '[]'::jsonb),
             'has_school_id', cols.has_school,
             'writable', has_table_privilege('authenticated', (select oid from readable where relname = cols.relname), 'insert')
           ) order by cols.relname
         ), '[]'::jsonb)
    from cols
    left join links on links.relname = cols.relname;
$fn$;

revoke all on function classroom.ai_catalog() from public, anon, authenticated;
grant execute on function classroom.ai_catalog() to service_role;
