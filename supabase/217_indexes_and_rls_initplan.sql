-- Database work that grows with schools, made to stay flat.
--
-- 1. Every foreign key gets an index on its column(s). 124 had none, so
--    finding one school's rows, or one invoice's lines, read the whole table,
--    and deleting a parent row scanned each child table. Ten per-school
--    tables also had no index on school_id at all.
-- 2. Row-level security rules call auth.uid() / auth.jwt() through a
--    sub-select, so Postgres works out who is signed in once per query
--    instead of once per row (Supabase's documented RLS performance rule).
--    The rules themselves do not change: each expression is the live one
--    with only that call wrapped.

-- 1 -----------------------------------------------------------------------
do $$
declare
  fk record;
  cols text;
  idx text;
begin
  for fk in
    select c.conrelid, c.conrelid::regclass as tbl, c.conkey,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as collist,
           (select string_agg(a.attname, '_' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as colname
      from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'classroom'::regnamespace
       and not exists (
         select 1 from pg_index ix
          where ix.indrelid = c.conrelid
            and (ix.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
       )
  loop
    idx := left(replace(fk.tbl::text, 'classroom.', '') || '_' || fk.colname, 55) || '_fkx';
    execute format('create index if not exists %I on %s (%s)', idx, fk.tbl, fk.collist);
  end loop;

  for fk in
    select c.table_name
      from information_schema.columns c
      join pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
     where c.table_schema = 'classroom' and c.column_name = 'school_id'
       and not exists (
         select 1 from pg_index ix
          join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = (ix.indkey::int2[])[0]
          where ix.indrelid = format('classroom.%I', c.table_name)::regclass and a.attname = 'school_id'
       )
  loop
    execute format('create index if not exists %I on classroom.%I (school_id)', left(fk.table_name, 50) || '_school_idx', fk.table_name);
  end loop;
end $$;

-- 2 -----------------------------------------------------------------------
do $$
declare
  p record;
  q text;
  c text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'classroom'
       and (coalesce(qual, '') ~ 'auth\.(uid|jwt)\(\)' or coalesce(with_check, '') ~ 'auth\.(uid|jwt)\(\)')
  loop
    q := p.qual;
    c := p.with_check;
    -- Already wrapped calls deparse as "( SELECT auth.uid() AS uid)"; leave those.
    if q is not null then
      q := regexp_replace(q, '(?<!SELECT )auth\.(uid|jwt)\(\)', '(select auth.\1())', 'g');
    end if;
    if c is not null then
      c := regexp_replace(c, '(?<!SELECT )auth\.(uid|jwt)\(\)', '(select auth.\1())', 'g');
    end if;
    if q is distinct from p.qual and q is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q);
    end if;
    if c is distinct from p.with_check and c is not null then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, c);
    end if;
  end loop;
end $$;

analyze;
