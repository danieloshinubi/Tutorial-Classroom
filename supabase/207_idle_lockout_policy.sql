-- Inactivity sign-out, set per school (School admin → Security).
--
-- Everyone was signed out after 10 idle minutes, fixed in AuthContext.jsx.
-- A school can now switch that off or pick its own number of minutes; it
-- applies to every member of the school. Defaults keep today's behaviour.
-- Writable by whoever may already update the school row (owner/admin, the
-- "school admins update their school" policy in 007).
alter table classroom.schools
  add column if not exists idle_lockout_enabled boolean not null default true,
  add column if not exists idle_lockout_minutes integer not null default 10;

alter table classroom.schools drop constraint if exists schools_idle_lockout_minutes_range;
alter table classroom.schools
  add constraint schools_idle_lockout_minutes_range check (idle_lockout_minutes between 2 and 240);

notify pgrst, 'reload schema';
