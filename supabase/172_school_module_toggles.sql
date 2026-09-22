-- =============================================================================
-- Per-school module switches.
--
-- A school that does not run, say, a bursary or an admissions office should not
-- have those sitting in everyone's navigation. This stores what a school has
-- turned OFF, not what it has turned on, and that direction is the whole point:
--
--   * a newly provisioned tenant starts with '{}' — nothing disabled, so every
--     module is live immediately, with no seeding step to run and nothing to
--     forget for a school created before this migration existed;
--   * a module added to the product later is automatically available to every
--     existing school, instead of being invisible until each one opts in.
--
-- Storing the enabled set would invert both of those into chores.
--
-- The module ids themselves are deliberately NOT validated against a list here.
-- The registry lives in src/lib/modules.js and changes with the product; a
-- mirror of it in SQL would drift, and the cost of a stale id sitting in this
-- array is nil — it matches no module and is ignored.
--
-- 'school' is the exception, and it is a hard constraint rather than a UI rule
-- because school admins can already UPDATE this table directly (policy "school
-- admins update their school"), so a check in the client would be one PATCH
-- away from being bypassed. /School is where the switches themselves live:
-- disabling it would lock the tenant out of its own settings permanently, with
-- no way back that does not involve someone with database access. Everything
-- else is fair game — a school can even hide its own Dashboard, because
-- homeFor() just falls through to whatever module remains.
-- =============================================================================

alter table classroom.schools
  add column if not exists disabled_modules text[] not null default '{}';

alter table classroom.schools
  drop constraint if exists schools_disabled_modules_keeps_admin;

alter table classroom.schools
  add constraint schools_disabled_modules_keeps_admin
  check ('school' <> all (disabled_modules));

comment on column classroom.schools.disabled_modules is
  'Module ids (src/lib/modules.js) this school has switched off. Empty = all modules live. ''school'' can never appear here — see schools_disabled_modules_keeps_admin.';

notify pgrst, 'reload schema';
