-- =============================================================================
-- classroom.verify_application_payment() / verify_acceptance_payment()
-- (096_scope_admissions_rpcs_to_school.sql) let owner/admin/principal/
-- admissions/bursar all approve an admissions payment directly from the
-- Admissions workspace's own "Verify payment" button — a second, competing
-- path to the SAME action classroom.approve_payment() already does from
-- the Bursary Payment queue (unified for admissions purposes in
-- 119_unify_payment_confirmation.sql). Two separate ways to confirm the
-- same money is exactly the problem: admissions staff should never be the
-- ones confirming a payment was actually received — only bursary (plus
-- owner/admin, the same role set classroom.can_do_bursary() already uses
-- everywhere else) can. Money confirmation belongs to one place. Dropping
-- these outright rather than just tightening their role check, since
-- nothing legitimate should ever call them again once the frontend button
-- is gone (see the matching AdmissionsWorkspace.jsx change) — a narrower
-- but still-callable RPC would just be the same loophole with a smaller
-- door.
-- =============================================================================

drop function if exists classroom.verify_application_payment(uuid, uuid, text);
drop function if exists classroom.verify_acceptance_payment(uuid, uuid, text);

notify pgrst, 'reload schema';
