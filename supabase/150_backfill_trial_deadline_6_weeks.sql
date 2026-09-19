-- =============================================================================
-- 149 backfilled Jane-Nath/Dowen/LPSS with a 15-day deadline, matching
-- create_school()'s own default. User asked for those three specifically to
-- get 1.5 months instead. Re-targets the exact same rows 149 touched
-- (still trial, still no deadline older than a few minutes) rather than
-- every trial school, so De-Young's own real signup-based deadline is left
-- alone.
-- =============================================================================

update classroom.schools
set trial_ends_at = now() + interval '45 days'
where plan = 'trial'
  and name in ('Jane-Nath College', 'Dowen College', 'LPSS');
