-- =============================================================================
-- Payment gateways, phase 2 — the service-role-only RPCs the new
-- payment-gateway-connect Edge Function and pay-init/paystack-webhook call.
--
-- Same boundary as 081_ticket_mail_rpcs.sql: service_role has no table-level
-- grant on classroom.payment_gateways (only `authenticated` does, narrowly —
-- see 116), so every privileged read/write goes through a SECURITY DEFINER
-- function here rather than a raw table call from a service-role client.
--
-- Run after 116. Safe to re-run.
-- =============================================================================

/* ---------------------------------------------------------------------------
   Connecting, switching, or disconnecting a school's gateway. Authorised
   entirely by payment-gateway-connect's own caller-scoped client, which
   checks owner/admin BEFORE this function is ever reached — this function
   does no authorisation of its own, because it cannot: by the time a
   service-role client calls it there is no caller identity left to check.
   auth.uid() is null here regardless of who originated the request, so a
   has_role_in() call inside this function would check nothing and always
   fail closed — exactly the trap 081_ticket_mail_rpcs.sql's header comment
   already calls out for create_ticket_mailbox() (confirmed live: an
   earlier version of this function that DID call has_role_in() here
   rejected a real owner's own request with "Only an owner or admin can
   change how this school takes payments", every time).
   --------------------------------------------------------------------------- */
create or replace function classroom.upsert_payment_gateway(
  target_school            uuid,
  provider_in              text,
  mode_in                  text,
  require_confirmation_in  boolean,
  public_config_in         jsonb default '{}'::jsonb,
  secrets_in               jsonb default null,
  confirmed_by_in          uuid default null
) returns classroom.payment_gateways
language plpgsql
security definer
set search_path = classroom, public
as $fn$
declare
  gw classroom.payment_gateways;
begin
  if mode_in not in ('platform', 'byo') then
    raise exception 'Unknown gateway mode: %', mode_in;
  end if;
  if mode_in = 'byo' and (secrets_in is null or secrets_in = '{}'::jsonb) then
    raise exception 'Enter this gateway''s credentials to connect your own account';
  end if;

  select * into gw from classroom.payment_gateways where school_id = target_school;
  if not found then
    -- confirmed_at/confirmed_by are set explicitly here rather than left to
    -- the stamp_gateway_confirmed trigger, which only fires on UPDATE — a
    -- fresh INSERT (only reachable if the 116 seed trigger somehow never
    -- ran for this school) would otherwise leave both null.
    insert into classroom.payment_gateways (
      school_id, provider, mode, require_confirmation, public_config, confirmed_at, confirmed_by
    )
    values (
      target_school, provider_in, mode_in, require_confirmation_in, coalesce(public_config_in, '{}'::jsonb),
      now(), confirmed_by_in
    )
    returning * into gw;
  else
    -- confirmed_by is passed in explicitly because auth.uid() is null by
    -- the time this SECURITY DEFINER function runs via the service-role
    -- client that calls it — the trigger's own auth.uid() fallback only
    -- applies to the separate direct owner/admin toggle path, which really
    -- does run with the caller's own JWT.
    update classroom.payment_gateways
    set provider = provider_in,
        mode = mode_in,
        require_confirmation = require_confirmation_in,
        public_config = coalesce(public_config_in, '{}'::jsonb),
        confirmed_by = confirmed_by_in
    where id = gw.id
    returning * into gw;
  end if;

  if mode_in = 'byo' then
    perform classroom.set_gateway_secret(gw.id, secrets_in);
  else
    perform classroom.clear_gateway_secret(gw.id);
  end if;

  select * into gw from classroom.payment_gateways where id = gw.id;
  return gw;
end;
$fn$;

revoke all on function classroom.upsert_payment_gateway(uuid, text, text, boolean, jsonb, jsonb, uuid) from public;
grant execute on function classroom.upsert_payment_gateway(uuid, text, text, boolean, jsonb, jsonb, uuid) to service_role;
-- The 6-argument signature (before confirmed_by_in) is superseded by the
-- 7-argument one above.
drop function if exists classroom.upsert_payment_gateway(uuid, text, text, boolean, jsonb, jsonb);

/* ---------------------------------------------------------------------------
   What pay-init needs, as the paying user — who may be an applicant, not a
   school member, so this cannot lean on classroom.schools' own
   membership-gated RLS. Same fix shape as payable_now() in 115: security
   definer, with the ownership check done explicitly instead.
   --------------------------------------------------------------------------- */
create or replace function classroom.gateway_settings_for_payer(target_invoice uuid)
returns table (
  gateway_id            uuid,
  provider              text,
  mode                  text,
  require_confirmation  boolean,
  public_config         jsonb
)
language sql
stable
security definer
set search_path = classroom, public
as $fn$
  select g.id, g.provider, g.mode, g.require_confirmation, g.public_config
  from classroom.invoices i
  join classroom.payment_gateways g on g.school_id = i.school_id
  where i.id = target_invoice
    and g.is_active
    and classroom.is_my_invoice(target_invoice);
$fn$;

grant execute on function classroom.gateway_settings_for_payer(uuid) to authenticated;

/* ---------------------------------------------------------------------------
   What the webhook needs to verify a signature and settle a payment.
   service_role only — a decrypted secret must never reach anywhere else.
   --------------------------------------------------------------------------- */
create or replace function classroom.gateway_secret_for_webhook(target_gateway uuid)
returns table (
  school_id  uuid,
  provider   text,
  mode       text,
  public_config jsonb,
  secrets    jsonb
)
language sql
stable
security definer
set search_path = classroom, public, vault
as $fn$
  select g.school_id, g.provider, g.mode, g.public_config,
         case when g.mode = 'byo' then classroom.get_gateway_secret(g.id) else null end
  from classroom.payment_gateways g
  where g.id = target_gateway and g.is_active;
$fn$;

revoke all on function classroom.gateway_secret_for_webhook(uuid) from public;
grant execute on function classroom.gateway_secret_for_webhook(uuid) to service_role;

notify pgrst, 'reload schema';
