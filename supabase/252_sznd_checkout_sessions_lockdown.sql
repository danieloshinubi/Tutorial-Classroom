-- =============================================================================
-- classroom.sznd_checkout_sessions (248) somehow ended up with `authenticated`
-- granted select/insert/update/delete at the SQL privilege level — this was
-- never intended (the table has zero RLS policies, written and read only by
-- pay-init/sznd-webhook's service-role clients), and it never should have
-- gotten there. Found live, 2026-10-12, during a security review pass.
--
-- Not live-exploitable today: RLS is enabled with zero policies, which is
-- Postgres's default-deny — no row is visible or writable to `authenticated`
-- regardless of these grants. But relying on "RLS happens to be on and
-- nobody added a policy yet" as the only thing standing between a browser
-- client and this table is exactly the kind of latent risk payment_gateways
-- (116) explicitly revokes against ("No insert/delete grant to authenticated
-- at all") rather than leaving to RLS alone. This table holds nothing a
-- browser client should ever see or touch directly — matching that same
-- discipline here.
--
-- Run after 251. Safe to re-run.
-- =============================================================================

revoke all on classroom.sznd_checkout_sessions from authenticated;

notify pgrst, 'reload schema';
