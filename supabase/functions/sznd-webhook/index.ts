// Sznd tells us a payment succeeded — for either Schoolivio's own shared
// account, or a school's own Sznd account. This is the only thing that
// credits an invoice. Mirrors paystack-webhook/index.ts's overall shape;
// see that file's header comment for why a webhook (not the browser's
// callback) is what's trusted.
//
// Two things differ from Paystack here, both confirmed live 2026-10-12:
//
//   no metadata    Sznd does not echo back the `metadata` object sent at
//                  checkout — not on the transaction record
//                  (GET /client/transactions/v2), and going by how thin
//                  that record already is, not on the webhook either. So
//                  unlike every other adapter here, gatewayId/invoiceId/
//                  payerId can't be read off the webhook body at all —
//                  they're looked up from classroom.sznd_checkout_sessions
//                  (248_sznd_checkout_sessions.sql) by whichever reference
//                  the webhook actually carries, written by pay-init right
//                  after initCheckout succeeds.
//
//   signature      HMAC-SHA256 of the raw body alone (no timestamp folded
//                  in), carried in X-Transfaar-Signature — see
//                  _shared/gateways/sznd.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { szndAdapter } from "../_shared/gateways/sznd.ts";
import { resolvePlatformSecrets } from "../_shared/gateways/platformCredentials.ts";

// Every plausible field name Sznd might carry our own `reference` under,
// checked both top-level and nested under `data` — the exact webhook shape
// is still not confirmed, only the transaction record's shape is (which
// uses origin_reference). Order is most-likely-first.
const referenceCandidates = (event: Record<string, unknown>): string[] => {
  const top = event ?? {};
  const nested = (event?.data as Record<string, unknown>) ?? {};
  const keys = ["origin_reference", "reference", "transaction_reference"];
  const out: string[] = [];
  for (const obj of [top, nested]) {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "string" && value && !out.includes(value)) out.push(value);
    }
  }
  return out;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Raw bytes, before any parsing — the signature is computed over these
  // exact bytes.
  const raw = await req.text();

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response("Unreadable body", { status: 400 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "classroom" } },
  );

  // Look up our own session row by whichever reference the webhook turns
  // out to carry — this is what gives us gatewayId AND invoiceId/payerId,
  // neither of which Sznd echoes back itself.
  let session: { gateway_id: string; invoice_id: string; payer_id: string } | null = null;
  let matchedReference: string | null = null;
  for (const candidate of referenceCandidates(parsed)) {
    const { data } = await admin
      .from("sznd_checkout_sessions")
      .select("gateway_id, invoice_id, payer_id")
      .eq("reference", candidate)
      .maybeSingle();
    if (data) {
      session = data;
      matchedReference = candidate;
      break;
    }
  }

  // Only ever used to pick a candidate secret — see paystack-webhook's
  // header comment on verifiedSchoolId. Unlike Paystack, gatewayId here
  // comes from OUR session row (matched above), never from the payload.
  let secrets: Record<string, string> = {};
  let gatewayMode = "platform";
  let verifiedSchoolId: string | null = null;

  if (session) {
    const { data: gw } = await admin
      .rpc("gateway_secret_for_webhook", { target_gateway: session.gateway_id })
      .single();
    if (gw) {
      const resolved = gw.mode === "byo" ? (gw.secrets || {}) : resolvePlatformSecrets(gw.provider);
      if (resolved.secret_key) {
        secrets = resolved;
        gatewayMode = gw.mode;
        verifiedSchoolId = gw.school_id;
      }
    }
  }
  // No session match (an attempt from before this table existed, or a
  // webhook whose reference field genuinely isn't any of the ones checked
  // above): fall back to the platform's own key rather than hard-failing.
  // verifiedSchoolId stays null, so settle_online_payment applies no
  // cross-tenant check for this delivery.
  if (!secrets.secret_key) {
    secrets = resolvePlatformSecrets("sznd");
  }
  if (!secrets.secret_key) {
    console.error("No Sznd secret key available (platform or gateway) — cannot verify anything");
    return new Response("Not configured", { status: 503 });
  }

  const validSignature = await szndAdapter.verifyWebhookSignature(raw, req.headers, secrets);
  if (!validSignature) {
    // Somebody who is not Sznd (or the matched session named the wrong
    // school's secret). Say nothing useful about why.
    console.warn("Rejected a webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const event = szndAdapter.parseWebhookEvent(raw);
  if (event.kind !== "success") {
    return new Response("Ignored", { status: 200 });
  }

  // Prefer the session row over anything the event itself reports — Sznd
  // doesn't send metadata, so event.invoiceId/payerId are expected to be
  // undefined; the session is the only reliable source for either.
  const invoiceId = session?.invoice_id ?? event.invoiceId;
  const payerId = session?.payer_id ?? event.payerId;
  const reference = matchedReference ?? event.reference;
  const { amount, feeAmount } = event;

  if (!invoiceId || !reference || !amount) {
    console.error(
      "Completed Sznd transaction without an invoice id, reference or amount",
      reference,
      session ? "(session matched)" : "(no session match)",
    );
    // 200 on purpose: retrying will not add information that was never
    // there, and a missing session row for a pre-248 checkout attempt is
    // not something Sznd retrying the same webhook will fix.
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
