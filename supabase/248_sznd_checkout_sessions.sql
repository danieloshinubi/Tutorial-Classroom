-- =============================================================================
-- Sznd does not echo back the `metadata` object we send on checkout
-- initialize — confirmed live 2026-10-12 against a real completed
-- transaction: GET /client/transactions/v2 returns origin_reference (our own
-- `reference`) and narration (our `description`), but no metadata field at
-- all, on the transaction record or (going by how thin the record already
-- is) very likely on the webhook either. Paystack/Flutterwave/Stripe all
-- faithfully echo metadata, so sznd.ts's parseWebhookEvent reading
-- metadata.invoice_id was silently finding nothing — the webhook could
-- arrive, verify, and parse as a real success, and still have no invoice to
-- credit.
--
-- The fix: track our own reference -> invoice mapping at checkout time,
-- since Sznd won't carry it for us. One row per Sznd checkout attempt,
-- written by pay-init right after a successful initCheckout call, read by
-- sznd-webhook using whichever reference the webhook actually carries
-- (origin_reference, transaction_reference, or reference — still not fully
-- confirmed which).
--
-- Sznd-specific, not a generalised "every gateway" table — the other three
-- providers don't have this problem, and there's no reason to carry this
-- extra write on every pay-init call for gateways that don't need it.
--
-- Run after 247. Safe to re-run.
-- =============================================================================

create table if not exists classroom.sznd_checkout_sessions (
  reference    text primary key,
  gateway_id   uuid not null references classroom.payment_gateways (id) on delete cascade,
  invoice_id   uuid not null references classroom.invoices (id) on delete cascade,
  payer_id     uuid not null references classroom.profiles (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists sznd_checkout_sessions_invoice_idx
  on classroom.sznd_checkout_sessions (invoice_id);

-- Only ever written/read by Edge Functions (pay-init, sznd-webhook) with the
-- service role — never by a browser client directly, so RLS stays on with
-- no policies at all, the same "locked down by default" shape
-- payment_gateways' secret columns already use.
alter table classroom.sznd_checkout_sessions enable row level security;

-- Attempts pile up (one per checkout click, including retries) — nothing
-- reads a row older than a few days once its payment has settled or died,
-- so there's no reason to keep them forever.
create or replace function classroom.prune_sznd_checkout_sessions()
returns void
language sql
security definer
set search_path = classroom, public
as $fn$
  delete from classroom.sznd_checkout_sessions where created_at < now() - interval '30 days';
$fn$;

revoke all on function classroom.prune_sznd_checkout_sessions() from public;
grant execute on function classroom.prune_sznd_checkout_sessions() to service_role;

notify pgrst, 'reload schema';
