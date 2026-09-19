-- =============================================================================
-- 148 fixed create_school() so every NEW school gets a 15-day trial deadline.
-- This backfills the three existing ones that were created through that same
-- tool before the fix and have had no deadline at all since creation
-- (Jane-Nath, Dowen College, LPSS) — confirmed by the user rather than done
-- silently, since it starts a real lockout countdown on schools already in
-- active use. Only touches rows still on trial with trial_ends_at null, so
-- it's a no-op if run again.
-- =============================================================================

update classroom.schools
set trial_ends_at = now() + interval '15 days'
where plan = 'trial'
  and trial_ends_at is null;
