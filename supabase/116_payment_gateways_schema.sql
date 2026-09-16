-- =============================================================================
-- Every school picks its own payment gateway — Schoolivio's shared Paystack
-- account, or its own credentials for whichever provider it prefers.
--
-- One row per school, not a list: the decision is explicitly "choose ONE",
-- so switching provider or mode updates this row in place rather than
-- juggling which of several rows is active.
--
-- Secrets follow the exact discipline classroom.ticket_mailboxes already
-- established (080_ticket_mailboxes.sql): never a plain column, only a
-- reference (secret_vault_id) into Supabase Vault, written and read back
-- only by a SECURITY DEFINER function granted to service_role alone — so
-- only an Edge Function, never a browser client (not even the school's own
-- owner), ever sees a decrypted credential. Unlike a mailbox, a gateway's
-- secret shape differs per provider (Paystack: one secret key; Stripe:
-- secret key + webhook signing secret; ...), so it is stored as a single
-- JSON blob rather than one column per possible field.
--
-- "Any gateway" is a schema/UI promise, not a working-integration promise:
-- provider is checked against a fixed list so the column can hold a value
-- without a later migration, but only Paystack gets real checkout/webhook
-- code in this pass (see the _shared/gateways adapter module) — the check
-- constraint is deliberately ahead of what's actually wired up.
--
-- Run after 115. Safe to re-run.
-- =============================================================================

create table if not exists classroom.payment_gateways (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references classroom.schools (id) on delete cascade,

  provider              text not null default 'paystack'
    check (provider in ('paystack', 'flutterwave', 'stripe')),
  mode                  text not null default 'platform'
    check (mode in ('platform', 'byo')),
  is_active             boolean not null default true,

  -- Some schools don't trust a gateway webhook to always land, and want a
  -- bursar to confirm even a gateway-reported payment before it counts.
  -- Per-school, not a platform-wide rule — see settle_online_payment().
  require_confirmation  boolean not null default false,

  -- Non-secret, provider-shaped config — e.g. {"public_key": "pk_..."}.
  -- Never a secret; safe to read back to the browser.
  public_config         jsonb not null default '{}'::jsonb,

  -- One Vault secret holding a JSON blob of whatever this provider's
  -- credentials look like. Null in 'platform' mode (env vars are used
  -- instead — see platformCredentials.ts).
  secret_vault_id       uuid,

  -- Null means "nobody has actually reviewed this row" — including the
  -- backfilled default every existing school gets below. The settings
  -- panel turns this into a visible "you haven't confirmed this yet"
  -- banner rather than pretending a choice was made. Stamped by the
  -- trigger below on every update, so simply re-saving the same option
  -- counts as confirming it.
  confirmed_at          timestamptz,
  confirmed_by          uuid references classroom.profiles (id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (school_id)
);

create index if not exists payment_gateways_school_idx on classroom.payment_gateways (school_id);

alter table classroom.payment_gateways enable row level security;

drop policy if exists "school admins view their gateway" on classroom.payment_gateways;
create policy "school admins view their gateway"
  on classroom.payment_gateways for select to authenticated
  using (classroom.has_role_in(school_id, array['owner','admin']::classroom.member_role[]));

-- The one thing a browser client may change directly — no Vault involved,
-- so no need for an Edge Function round trip just to flip a toggle or
-- pause a gateway. Choosing/switching provider or credentials always goes
-- through the service-role RPC below instead (same boundary
-- ticket_mailboxes draws around connecting vs. toggling is_active).
drop policy if exists "school admins toggle confirmation and pause" on classroom.payment_gateways;
create policy "school admins toggle confirmation and pause"
  on classroom.payment_gateways for update to authenticated
  using (classroom.has_role_in(school_id, array['owner','admin']::classroom.member_role[]))
  with check (classroom.has_role_in(school_id, array['owner','admin']::classroom.member_role[]));

grant select on classroom.payment_gateways to authenticated;
grant update (require_confirmation, is_active) on classroom.payment_gateways to authenticated;

-- No insert/delete grant to authenticated at all, and no update grant on
-- provider/mode/public_config/secret_vault_id — those only ever change
-- through upsert_payment_gateway() (117), which runs as service_role.

create or replace function classroom.stamp_gateway_confirmed()
returns trigger
language plpgsql
as $fn$
begin
  -- Only a real signed-in user's own direct update (the narrow
  -- require_confirmation/is_active toggle path) auto-stamps here.
  -- auth.uid() is null for every other writer of this row — the
  -- service-role upsert_payment_gateway() (called from payment-gateway-
  -- connect with no user JWT in scope), a migration, an admin script — and
  -- none of those should silently mark a row "confirmed" just because a
  -- column changed. upsert_payment_gateway() stamps confirmed_at/
  -- confirmed_by explicitly itself, with the real actor passed through
  -- from the one place that still knows who they are (confirmed this
  -- session: an earlier version that stamped confirmed_at unconditionally
  -- here caused a data-repair UPDATE to falsely mark three untouched
  -- schools as "reviewed").
  if auth.uid() is not null then
    new.confirmed_at := now();
    new.confirmed_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists payment_gateways_stamp_confirmed on classroom.payment_gateways;
create trigger payment_gateways_stamp_confirmed
  before update on classroom.payment_gateways
  for each row execute function classroom.stamp_gateway_confirmed();

drop trigger if exists audit_trg on classroom.payment_gateways;
create trigger audit_trg after insert or update or delete on classroom.payment_gateways
  for each row execute function classroom.write_audit_log();

/* ---------------------------------------------------------------------------
   Vault-backed secret helpers — the same two functions
   set_mailbox_secret()/get_mailbox_secret() already establish this pattern
   with, generalised: one JSON blob instead of a single password, since the
   fields a provider's credentials need vary.
   --------------------------------------------------------------------------- */
create or replace function classroom.set_gateway_secret(target_gateway uuid, secrets jsonb)
returns void
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
declare
  new_id uuid;
  old_id uuid;
begin
  new_id := vault.create_secret(
    secrets::text,
    'payment_gateway:' || target_gateway::text || ':' || gen_random_uuid()::text,
    'Payment gateway credentials (JSON blob, provider-shaped)'
  );

  select secret_vault_id into old_id from classroom.payment_gateways where id = target_gateway;
  update classroom.payment_gateways set secret_vault_id = new_id, updated_at = now() where id = target_gateway;

  if old_id is not null then
    delete from vault.secrets where id = old_id;
  end if;
end;
$fn$;

revoke all on function classroom.set_gateway_secret(uuid, jsonb) from public;
grant execute on function classroom.set_gateway_secret(uuid, jsonb) to service_role;

create or replace function classroom.get_gateway_secret(target_gateway uuid)
returns jsonb
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
declare
  vid uuid;
  val text;
begin
  select secret_vault_id into vid from classroom.payment_gateways where id = target_gateway;
  if vid is null then return null; end if;
  select decrypted_secret into val from vault.decrypted_secrets where id = vid;
  if val is null then return null; end if;
  return val::jsonb;
end;
$fn$;

revoke all on function classroom.get_gateway_secret(uuid) from public;
grant execute on function classroom.get_gateway_secret(uuid) to service_role;

-- Clearing a gateway back to platform mode (or disconnecting entirely)
-- should clean up its vault secret rather than orphan it — same reasoning
-- as delete_ticket_mailbox().
create or replace function classroom.clear_gateway_secret(target_gateway uuid)
returns void
language plpgsql
security definer
set search_path = classroom, public, vault
as $fn$
declare
  old_id uuid;
begin
  select secret_vault_id into old_id from classroom.payment_gateways where id = target_gateway;
  update classroom.payment_gateways set secret_vault_id = null, updated_at = now() where id = target_gateway;
  if old_id is not null then
    delete from vault.secrets where id = old_id;
  end if;
end;
$fn$;

revoke all on function classroom.clear_gateway_secret(uuid) from public;
grant execute on function classroom.clear_gateway_secret(uuid) to service_role;

/* ---------------------------------------------------------------------------
   Descriptive only — which mode actually settled a given payment. Sits
   beside the existing gateway/gateway_ref/gateway_fee columns from
   035_online_payments.sql.
   --------------------------------------------------------------------------- */
alter table classroom.payments
  add column if not exists gateway_mode text check (gateway_mode in ('platform', 'byo'));

/* ---------------------------------------------------------------------------
   Backfill + seed. Every existing school gets a row recording exactly what
   it is already running on today — zero behaviour change on deploy day.
   confirmed_at stays null: this is a recorded default, not a hidden one,
   and the settings panel will visibly flag it as never reviewed.
   --------------------------------------------------------------------------- */
insert into classroom.payment_gateways (school_id, provider, mode, require_confirmation, is_active)
select id, 'paystack', 'platform', false, true
from classroom.schools s
where not exists (select 1 from classroom.payment_gateways g where g.school_id = s.id);

-- New schools get the same default row from here on, so "every school has
-- exactly one payment_gateways row" holds without pay-init having to
-- special-case a missing one.
create or replace function classroom.seed_default_payment_gateway()
returns trigger
language plpgsql
security definer
set search_path = classroom, public
as $fn$
begin
  insert into classroom.payment_gateways (school_id, provider, mode, require_confirmation, is_active)
  values (new.id, 'paystack', 'platform', false, true)
  on conflict (school_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists schools_seed_payment_gateway on classroom.schools;
create trigger schools_seed_payment_gateway
  after insert on classroom.schools
  for each row execute function classroom.seed_default_payment_gateway();

notify pgrst, 'reload schema';
