-- The server's clock, for timers that must not trust the device's
-- (2026-10-15). An exam's time left was worked out from the pupil's own
-- clock: one running fast ended the paper early, one running slow showed
-- time that was not really left. The exam page now measures the difference
-- once and counts down against the server.
create or replace function classroom.server_now()
returns timestamptz language sql stable as $fn$ select now(); $fn$;
revoke execute on function classroom.server_now() from public, anon;
grant execute on function classroom.server_now() to authenticated, service_role;

notify pgrst, 'reload schema';
