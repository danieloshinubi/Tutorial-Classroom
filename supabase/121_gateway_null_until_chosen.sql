-- =============================================================================
-- A school's gateway shows null until an owner/admin has actually chosen
-- one — not a copied-over "paystack/platform" that looks like a decision
-- nobody made. 116's backfill recorded every existing school's real
-- CURRENT processing arrangement (all of them were already running on the
-- shared Paystack account) so pay-init would not break real payments on
-- deploy day. That is still true operationally, but the row itself must
-- not read as a choice — provider/mode become nullable, and every
-- never-confirmed row (confirmed_at is null — none of them are a real
-- decision) is reset to null on both columns.
--
-- Run after 120. Safe to re-run.
-- =============================================================================

alter table classroom.payment_gateways
  alter column provider drop not null,
  alter column provider drop default,
  alter column mode drop not null,
  alter column mode drop default;

alter table classroom.payment_gateways drop constraint payment_gateways_provider_check;
alter table classroom.payment_gateways add constraint payment_gateways_provider_check
  check (provider is null or provider in ('paystack', 'flutterwave', 'stripe'));

alter table classroom.payment_gateways drop constraint payment_gateways_mode_check;
alter table classroom.payment_gateways add constraint payment_gateways_mode_check
  check (mode is null or mode in ('platform', 'byo'));

-- Only rows nobody has ever confirmed — genuinely nothing to preserve.
update classroom.payment_gateways
set provider = null, mode = null
where confirmed_at is null;

-- New schools get a bare, genuinely-unset row from here on.
create or replace function classroom.seed_default_payment_gateway()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  insert into classroom.payment_gateways (school_id, provider, mode, require_confirmation, is_active)
  values (new.id, null, null, false, true)
  on conflict (school_id) do nothing;
  return new;
end;
$fn$;

notify pgrst, 'reload schema';
