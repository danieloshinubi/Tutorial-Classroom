// Stripe's confirmation that a checkout session completed — same shape and
// reasoning as paystack-webhook, adapted for Stripe's own signature scheme
// (Stripe-Signature: t=.../v1=... verified against a webhook SIGNING
// secret, a different credential from the API secret key — see stripe.ts)
// and its own event/amount shape (checkout.session.completed, amount_total
// in cents).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { stripeAdapter } from "../_shared/gateways/stripe.ts";
import { resolvePlatformSecrets } from "../_shared/gateways/platformCredentials.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "classroom" } },
  );

  const gatewayId = stripeAdapter.peekGatewayId(raw);
  let secrets: Record<string, string> = {};
  let gatewayMode = "platform";
  let verifiedSchoolId: string | null = null;

  if (gatewayId) {
    const { data: gw } = await admin.rpc("gateway_secret_for_webhook", { target_gateway: gatewayId }).single();
    if (gw) {
      const resolved = gw.mode === "byo" ? (gw.secrets || {}) : resolvePlatformSecrets(gw.provider);
      if (resolved.webhook_secret) {
        secrets = resolved;
        gatewayMode = gw.mode;
        verifiedSchoolId = gw.school_id;
      }
    }
  }
  if (!secrets.webhook_secret) {
    secrets = resolvePlatformSecrets("stripe");
  }
  if (!secrets.webhook_secret) {
    console.error("No Stripe webhook secret available (platform or gateway) — cannot verify anything");
    return new Response("Not configured", { status: 503 });
  }

  const validSignature = await stripeAdapter.verifyWebhookSignature(raw, req.headers, secrets);
  if (!validSignature) {
    console.warn("Rejected a webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = stripeAdapter.parseWebhookEvent(raw);
  } catch {
    return new Response("Unreadable body", { status: 400 });
  }

  if (event.kind !== "success") {
    return new Response("Ignored", { status: 200 });
  }

  const { invoiceId, reference, amount, payerId } = event;
  if (!invoiceId || !reference || !amount) {
    console.error("checkout.session.completed without an invoice id, reference or amount", reference);
    return new Response("Nothing to settle", { status: 200 });
  }

  const { error } = await admin.rpc("settle_online_payment", {
    target_invoice: invoiceId,
    paid_amount: amount,
    gateway_name: "stripe",
    gateway_reference: reference,
    gateway_fee: null,
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
