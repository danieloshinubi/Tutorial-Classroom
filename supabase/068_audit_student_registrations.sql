-- =============================================================================
-- The audit trigger only attaches itself to tables that already existed
-- when 062_audit_log.sql's DO block ran (062's own comment says as much —
-- "a table added later needs the same two lines run against it by hand").
-- classroom.student_registrations (067) is exactly that case. It carries
-- school_id directly, so write_audit_log()'s existing fast path already
-- resolves it correctly — only the trigger attachment itself was missing.
-- =============================================================================

drop trigger if exists audit_trg on classroom.student_registrations;
create trigger audit_trg after insert or update or delete on classroom.student_registrations
  for each row execute function classroom.write_audit_log();

notify pgrst, 'reload schema';
