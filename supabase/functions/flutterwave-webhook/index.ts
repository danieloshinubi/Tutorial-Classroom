// Flutterwave's confirmation that a payment succeeded — same shape and same
// reasoning as paystack-webhook (read that one's header comment for why a
// webhook, not the browser's own callback, is what actually credits an
// invoice), adapted for Flutterwave's own verification (a fixed "secret
// hash" comparison, not an HMAC of the body — see flutterwave.ts) and its
// own amount unit (already in naira, not kobo).
//
// A school on its own Flutterwave account points its dashboard's webhook
// URL at this endpoint (not paystack-webhook) — same shared-endpoint-
// disambiguated-by-gatewayId model, one endpoint per provider rather than
// one endpoint for everything, because each provider's own verification
// scheme needs that provider's own adapter to check it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { flutterwaveAdapter } from "../_shared/gateways/flutterwave.ts";
import { resolvePlatformSecrets } from "../_shared/gateways/platformCredentials.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "classroom" } },
  );

  const gatewayId = flutterwaveAdapter.peekGatewayId(raw);
  let secrets: Record<string, string> = {};
  let gatewayMode = "platform";
  let verifiedSchoolId: string | null = null;

  if (gatewayId) {
    const { data: gw } = await admin.rpc("gateway_secret_for_webhook", { target_gateway: gatewayId }).single();
    if (gw) {
      const resolved = gw.mode === "byo" ? (gw.secrets || {}) : resolvePlatformSecrets(gw.provider);
      if (resolved.hash) {
        secrets = resolved;
        gatewayMode = gw.mode;
        verifiedSchoolId = gw.school_id;
      }
    }
  }
  if (!secrets.hash) {
    secrets = resolvePlatformSecrets("flutterwave");
  }
  if (!secrets.hash) {
    console.error("No Flutterwave secret hash available (platform or gateway) — cannot verify anything");
    return new Response("Not configured", { status: 503 });
  }

  const validSignature = await flutterwaveAdapter.verifyWebhookSignature(raw, req.headers, secrets);
  if (!validSignature) {
    console.warn("Rejected a webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = flutterwaveAdapter.parseWebhookEvent(raw);
  } catch {
    return new Response("Unreadable body", { status: 400 });
  }

  if (event.kind !== "success") {
    return new Response("Ignored", { status: 200 });
  }

  const { invoiceId, reference, amount, payerId, feeAmount } = event;
  if (!invoiceId || !reference || !amount) {
    console.error("charge.completed without an invoice id, reference or amount", reference);
    return new Response("Nothing to settle", { status: 200 });
  }

  const { error } = await admin.rpc("settle_online_payment", {
    target_invoice: invoiceId,
    paid_amount: amount,
    gateway_name: "flutterwave",
    gateway_reference: reference,
    gateway_fee: feeAmount ?? null,
    payer: payerId ?? null,
    gateway_mode: gatewayMode,
    verified_school_id: verifiedSchoolId,
  });

  if (error) {
    console.error("Could not settle", reference, error.message);
    return new Response(`Could not settle: ${error.message}`, { status: 500 });
  }

  return new Response("Settled", { status: 200 });
});
