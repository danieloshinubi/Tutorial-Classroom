-- Can edit, View only and No access for every module, School admin and the
-- Audit log included (after 230-232). School admin keeps 232's two rules:
-- nobody switches off their own, and the last owner or admin keeps it.
alter table classroom.member_module_access drop constraint if exists member_module_access_school_none;
alter table classroom.member_module_access drop constraint if exists member_module_access_auditlog_read;

notify pgrst, 'reload schema';
