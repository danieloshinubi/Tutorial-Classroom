// Sznd tells us a payment succeeded — for either Schoolivio's own shared
// account, or a school's own Sznd account configured to send its webhooks
// here too (one shared endpoint, disambiguated by the gatewayId carried in
// checkout metadata — see pay-init). This is the only thing that credits an
// invoice. Mirrors paystack-webhook/index.ts exactly; see that file's header
// comment for the full reasoning on why a webhook (not the browser's
// callback) is what's trusted, and on gatewayId/verifiedSchoolId.
//
// The one real difference from Paystack: Sznd's webhook signature is
// HMAC-SHA256 of the raw body alone (no timestamp folded in), carried in
// X-Transfaar-Signature — see _shared/gateways/sznd.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { szndAdapter } from "../_shared/gateways/sznd.ts";
import { resolvePlatformSecrets } from "../_shared/gateways/platformCredentials.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Raw bytes, before any parsing. Re-serialising JSON would change the
  // whitespace and the signature would never match.
  const raw = await req.text();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "classroom" } },
  );

  // Only ever used to pick a candidate secret — see paystack-webhook's
  // header comment. verifiedSchoolId is set ONLY when gatewayId resolved to
  // a real, correctly-configured gateway row and that row's own secret is
  // what gets checked below.
  const gatewayId = szndAdapter.peekGatewayId(raw);
  let secrets: Record<string, string> = {};
  let gatewayMode = "platform";
  let verifiedSchoolId: string | null = null;

  if (gatewayId) {
    const { data: gw } = await admin.rpc("gateway_secret_for_webhook", { target_gateway: gatewayId }).single();
    if (gw) {
      const resolved = gw.mode === "byo" ? (gw.secrets || {}) : resolvePlatformSecrets(gw.provider);
      if (resolved.secret_key) {
        secrets = resolved;
        gatewayMode = gw.mode;
        verifiedSchoolId = gw.school_id;
      }
    }
  }
  // No gatewayId, it no longer resolves to an active gateway, or it resolved
  // but had no secret configured: fall back to the platform's own key rather
  // than hard-failing. verifiedSchoolId stays null here, so
  // settle_online_payment applies no cross-tenant check for this delivery.
  if (!secrets.secret_key) {
    secrets = resolvePlatformSecrets("sznd");
  }
  if (!secrets.secret_key) {
    console.error("No Sznd secret key available (platform or gateway) — cannot verify anything");
    return new Response("Not configured", { status: 503 });
  }

  const validSignature = await szndAdapter.verifyWebhookSignature(raw, req.headers, secrets);
  if (!validSignature) {
    // Somebody who is not Sznd (or the gatewayId named the wrong school's
    // secret). Say nothing useful about why.
    console.warn("Rejected a webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = szndAdapter.parseWebhookEvent(raw);
  } catch {
    return new Response("Unreadable body", { status: 400 });
  }

  if (event.kind !== "success") {
    return new Response("Ignored", { status: 200 });
  }

  const { invoiceId, reference, amount, payerId, feeAmount } = event;
  if (!invoiceId || !reference || !amount) {
    console.error("Completed transaction without an invoice id, reference or amount", reference);
    // 200 on purpose: retrying will not add metadata that was never there.
    return new Response("Nothing to settle", { status: 200 });
  }

  const { error } = await admin.rpc("settle_online_payment", {
    target_invoice: invoiceId,
    paid_amount: amount,
    gateway_name: "sznd",
    gateway_reference: reference,
    gateway_fee: feeAmount ?? null,
    payer: payerId ?? null,
    gateway_mode: gatewayMode,
    verified_school_id: verifiedSchoolId,
  });

  if (error) {
    // A real failure — let Sznd retry, because the money has left the
    // parent's account and the invoice does not know about it yet.
    console.error("Could not settle", reference, error.message);
    return new Response(`Could not settle: ${error.message}`, { status: 500 });
  }

  return new Response("Settled", { status: 200 });
});
