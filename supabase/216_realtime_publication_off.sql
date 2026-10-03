-- Run once the app listening on private broadcast topics (215) is live.
-- Nothing listens with postgres_changes any more, so the tables leave the
-- supabase_realtime publication and the database stops checking every
-- change against every connected person.
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'classroom'
  loop
    execute format('alter publication supabase_realtime drop table %I.%I', t.schemaname, t.tablename);
  end loop;
end $$;

notify pgrst, 'reload schema';
