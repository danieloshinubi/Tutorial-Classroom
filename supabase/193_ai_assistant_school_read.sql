-- The assistant's edge function reads the school's name, currency and
-- monthly AI limit with the service role (192), and the admissions assistant
-- its contact details. The service role had no privileges on
-- classroom.schools, so both lookups failed and every request came back
-- "Unknown school". Read access to this one table, for the server only;
-- browsers keep the row level security they had.
grant select on classroom.schools to service_role;

notify pgrst, 'reload schema';
