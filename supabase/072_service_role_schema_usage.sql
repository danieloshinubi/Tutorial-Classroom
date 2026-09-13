-- =============================================================================
-- service_role was never granted USAGE on the classroom schema
--
-- 001_grants.sql (and schema.sql before it) granted USAGE on schema
-- classroom to anon and authenticated only. service_role was given EXECUTE
-- on individual functions — classroom.settle_online_payment() (035, 050),
-- now classroom.record_password_reset() (071) — but EXECUTE on a function
-- does not substitute for USAGE on the schema it lives in; Postgres checks
-- USAGE before it will even resolve a schema-qualified name for a role,
-- independent of SECURITY DEFINER or any object-level grant.
--
-- Found live, while testing 071: the new admin-reset-password Edge Function
-- called classroom.record_password_reset() over the service-role client and
-- got "permission denied for schema classroom" — not a grant on the
-- function (confirmed present), but a missing grant on the schema itself
-- (confirmed via has_schema_privilege('service_role', 'classroom', 'USAGE') = false).
--
-- This is not new to 071. classroom.settle_online_payment() — the Paystack
-- webhook's only way to credit a payment — has been reachable through the
-- exact same service-role-scoped-to-classroom client since 035, and would
-- hit this identical error. That means every Paystack payment settled
-- through the webhook has likely been failing silently since that feature
-- shipped, not just the account-management feature this migration was
-- written to support.
--
-- Run after 001. Safe to re-run.
-- =============================================================================

grant usage on schema classroom to service_role;

notify pgrst, 'reload schema';
