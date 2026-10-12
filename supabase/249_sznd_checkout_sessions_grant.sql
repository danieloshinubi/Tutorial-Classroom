-- =============================================================================
-- 248 created classroom.sznd_checkout_sessions but never granted service_role
-- anything on it — the same class of bug 072_service_role_schema_usage.sql
-- already documents once: USAGE on the classroom schema (072) is necessary
-- but not sufficient, Postgres still checks table-level privileges
-- separately. Found live, 2026-10-12, testing the first real webhook
-- against this table: pay-init's insert and sznd-webhook's select both go
-- straight through PostgREST with the service-role client (no
-- SECURITY DEFINER function in between, unlike payment_gateways' secrets),
-- so this table needs its own explicit grant.
--
-- Run after 248. Safe to re-run.
-- =============================================================================

grant select, insert on classroom.sznd_checkout_sessions to service_role;

notify pgrst, 'reload schema';
