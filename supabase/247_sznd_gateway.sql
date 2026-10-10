-- =============================================================================
-- Adds Sznd (dashboard/checkout domain: transfaar.com) as a fourth real
-- provider, alongside Paystack/Flutterwave/Stripe — same adapter pattern
-- (_shared/gateways/sznd.ts), same per-school choice of platform-shared vs.
-- BYO credentials. Schema-only change: the provider check constraint
-- (nullable since 121) is the only thing naming providers by value.
--
-- Run after 246. Safe to re-run.
-- =============================================================================

alter table classroom.payment_gateways drop constraint payment_gateways_provider_check;
alter table classroom.payment_gateways add constraint payment_gateways_provider_check
  check (provider is null or provider in ('paystack', 'flutterwave', 'stripe', 'sznd'));

notify pgrst, 'reload schema';
