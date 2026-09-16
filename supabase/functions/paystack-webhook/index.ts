// Paystack tells us a payment succeeded — for either Schoolivio's own
// shared account, or a school's own Paystack account configured to send
// its webhooks here too (one shared endpoint, disambiguated by the
// gatewayId carried in checkout metadata — see pay-init). This is the only
// thing that credits an invoice.
//
// Why not the browser's callback: a "payment successful" message arriving
// from a client can be replayed, edited, or simply made up. The webhook is
// signed with the secret key, so this function can prove Paystack — using
// THAT secret — sent it. The client's return from the payment page is used
// for nothing but showing the family a friendly result.
//
// Three things this has to get right:
//
//   which secret     a school on its own Paystack account signs with its
//                     own secret, not the platform's. The payload's own
//                     metadata.gatewayId says which school this is for —
//                     but that's still-unverified data at this point, so
//                     it's only ever used to pick WHICH secret to check the
//                     signature against, never trusted on its own. A forged
//                     payload naming someone else's gatewayId still fails
//                     verification against that school's real key.
//
//   the signature     HMAC SHA-512 of the raw body with the secret key. It
//                     has to be computed on the exact bytes received, so the
//                     body is read as text and only parsed afterwards.
//
//   idempotency       Paystack retries anything it did not get a 200 for.
//                     settle_online_payment() is keyed on the gateway
//                     reference and returns the existing row rather than
//                     crediting twice, so a retry is harmless — and we still
//                     answer 200 so the retries stop.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { paystackAdapter } from "../_shared/gateways/paystack.ts";
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

  // Only ever used to pick a candidate secret — see the header comment.
  // verifiedSchoolId is set ONLY when gatewayId resolved to a real,
  // correctly-configured gateway row and that row's own secret is what
  // gets checked below — never when any fallback happens — so that a
  // signature verified against gatewayId's secret can only ever be trusted
  // to mean "this really is that gateway's school", never a different one.
  const gatewayId = paystackAdapter.peekGatewayId(raw);
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
  // No gatewayId, it no longer resolves to an active gateway (e.g. one
  // disconnected after checkout began), or it resolved but had no secret
  // configured: fall back to the platform's own key rather than
  // hard-failing — covers every pre-existing checkout started before this
  // feature shipped. verifiedSchoolId stays null here, so
  // settle_online_payment applies no cross-tenant check for this delivery
  // — the same single-shared-secret trust model that already existed
  // before BYO gateways did.
  if (!secrets.secret_key) {
    secrets = resolvePlatformSecrets("paystack");
  }
  if (!secrets.secret_key) {
    console.error("No Paystack secret key available (platform or gateway) — cannot verify anything");
    return new Response("Not configured", { status: 503 });
  }

  const validSignature = await paystackAdapter.verifyWebhookSignature(raw, req.headers, secrets);
  if (!validSignature) {
    // Somebody who is not Paystack (or the gatewayId named the wrong
    // school's secret). Say nothing useful about why.
    console.warn("Rejected a webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = paystackAdapter.parseWebhookEvent(raw);
  } catch {
    return new Response("Unreadable body", { status: 400 });
  }

  if (event.kind !== "success") {
    return new Response("Ignored", { status: 200 });
  }

  const { invoiceId, reference, amount, payerId, feeAmount } = event;
  if (!invoiceId || !reference || !amount) {
    console.error("charge.success without an invoice id, reference or amount", reference);
    // 200 on purpose: retrying will not add metadata that was never there.
    return new Response("Nothing to settle", { status: 200 });
  }

  const { error } = await admin.rpc("settle_online_payment", {
    target_invoice: invoiceId,
    paid_amount: amount,
    gateway_name: "paystack",
    gateway_reference: reference,
    gateway_fee: feeAmount ?? null,
    payer: payerId ?? null,
    gateway_mode: gatewayMode,
    verified_school_id: verifiedSchoolId,
  });

  if (error) {
    // A real failure — let Paystack retry, because the money has left the
    // parent's account and the invoice does not know about it yet.
    console.error("Could not settle", reference, error.message);
    return new Response(`Could not settle: ${error.message}`, { status: 500 });
  }

  return new Response("Settled", { status: 200 });
});
