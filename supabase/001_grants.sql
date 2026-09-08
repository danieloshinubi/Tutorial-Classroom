-- =============================================================================
-- Patch: table privileges for the `classroom` schema
--
-- Only needed if you ran the first version of schema.sql, which created the
-- tables and RLS policies but never granted table privileges. Symptom:
--
--   permission denied for table levels   (SQLSTATE 42501)
--
-- Supabase grants these automatically on `public`; a custom schema gets none.
-- Safe to run more than once. If you run the current schema.sql from scratch
-- you do not need this file — the grants are in there now.
-- =============================================================================

grant usage on schema classroom to anon, authenticated;

grant select, insert, update, delete on all tables in schema classroom to authenticated;
grant usage, select on all sequences in schema classroom to authenticated;

alter default privileges in schema classroom
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema classroom
  grant usage, select on sequences to authenticated;

-- The authorisation helpers the RLS policies call.
grant execute on function
  classroom.my_role(),
  classroom.is_admin(),
  classroom.is_staff(),
  classroom.can_manage_course(uuid),
  classroom.can_manage_assignment(uuid)
to authenticated;

notify pgrst, 'reload schema';
