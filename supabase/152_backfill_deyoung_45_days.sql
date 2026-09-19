-- =============================================================================
-- De-Young was the one school that already had a real trial_ends_at (from
-- start_trial_school() before 151 lengthened it), still on its original
-- 15-day deadline. Brings it in line with the other three and with 151's new
-- default, so every existing school is on the same 45-day trial as any new
-- one from here on.
-- =============================================================================

update classroom.schools
set trial_ends_at = now() + interval '45 days'
where plan = 'trial'
  and name = 'De-Young';
