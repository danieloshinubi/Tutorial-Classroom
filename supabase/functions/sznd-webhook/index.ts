// Sznd tells us a payment succeeded — for either a parent's fee payment
// (credits an invoice) or a payroll payout to a staff member's bank account
// (settles classroom.payroll_payouts). One shared endpoint for both, since
// Sznd sends both DEPOSIT and WITHDRAWAL transaction events the same way.
// Mirrors paystack-webhook/index.ts's overall shape; see that file's header
// comment for why a webhook (not the browser's callback) is what's trusted.
//
// Two things differ from Paystack here, both confirmed live 2026-10-12:
//
//   no metadata    Sznd does not echo back the `metadata` object sent at
//                  checkout — not on the transaction record
//                  (GET /client/transactions/v2), and going by how thin
//                  that record already is, not on the webhook either. So
//                  unlike every other adapter here, which table/row a
//                  delivery belongs to can't be read off the webhook body
//                  at all — it's looked up by whichever reference the
//                  webhook actually carries, against BOTH
//                  classroom.sznd_checkout_sessions (248, collections) and
//                  classroom.payroll_payouts (250, payroll), since this one
//                  endpoint handles both. Each writes its own
//                  Sznd-destined `reference` at the point money starts
//                  moving — pay-init for collections, start_sznd_payroll_
//                  payout for payroll.
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

// Same status-field tolerance as sznd.ts's parseWebhookEvent — here it's
// also checked for FAILED (not just COMPLETED), because a payout that
// fails has to flip payroll_payouts to 'failed' rather than sit 'processing'
// forever; a failed deposit, by contrast, is correctly just ignored (the
// family's checkout attempt simply didn't pan out, nothing to undo).
const statusOf = (event: Record<string, unknown>): string | undefined =>
  (event?.status as string) ?? (event?.status_name as string) ?? (event?.transaction_status as string);

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

  // Try every candidate reference against both tables this endpoint serves
  // — a collection session (248) or a payroll payout (250) — and stop at
  // the first real hit. The two reference schemes never collide in
  // practice (pay-init's are bare UUIDs, start_sznd_payroll_payout's start
  // with "szp"), but checking both is cheap and makes no assumption about
  // either prefix staying stable.
  let session: { gateway_id: string; invoice_id: string; payer_id: string } | null = null;
  let payout: { id: string; school_id: string } | null = null;
  let matchedReference: string | null = null;

  for (const candidate of referenceCandidates(parsed)) {
    const { data: sessionRow } = await admin
      .from("sznd_checkout_sessions")
      .select("gateway_id, invoice_id, payer_id")
      .eq("reference", candidate)
      .maybeSingle();
    if (sessionRow) {
      session = sessionRow;
      matchedReference = candidate;
      break;
    }
    const { data: payoutRow } = await admin
      .from("payroll_payouts")
      .select("id, school_id")
      .eq("gateway_ref", candidate)
      .maybeSingle();
    if (payoutRow) {
      payout = payoutRow;
      matchedReference = candidate;
      break;
    }
  }

  // Only ever used to pick a candidate secret — see paystack-webhook's
  // header comment on verifiedSchoolId. gatewayId here comes from OUR own
  // matched row, never from the payload.
  let secrets: Record<string, string> = {};
  let gatewayMode = "platform";
  let verifiedSchoolId: string | null = null;

  const gatewayIdToResolve = session?.gateway_id
    ?? (payout
      ? (await admin.from("payment_gateways").select("id").eq("school_id", payout.school_id).maybeSingle()).data?.id
      : undefined);

  if (gatewayIdToResolve) {
    const { data: gw } = await admin
      .rpc("gateway_secret_for_webhook", { target_gateway: gatewayIdToResolve })
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
  // No match at all (a webhook whose reference field genuinely isn't any of
  // the ones checked above, or an attempt from before these tables
  // existed): fall back to the platform's own key rather than
  // hard-failing. verifiedSchoolId stays null, so settle_online_payment
  // applies no cross-tenant check for this delivery.
  if (!secrets.secret_key) {
    secrets = resolvePlatformSecrets("sznd");
  }
  if (!secrets.secret_key) {
    console.error("No Sznd secret key available (platform or gateway) — cannot verify anything");
    return new Response("Not configured", { status: 503 });
  }

  const validSignature = await szndAdapter.verifyWebhookSignature(raw, req.headers, secrets);
  if (!validSignature) {
    // Somebody who is not Sznd (or the matched row named the wrong
    // school's secret). Say nothing useful about why.
    console.warn("Rejected a webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const status = statusOf(parsed);

  // ---- payroll payout branch -------------------------------------------
  if (payout) {
    if (status === "COMPLETED") {
      const { error } = await admin.rpc("settle_sznd_payroll_payout", {
        target_reference: matchedReference,
        new_status: "paid",
      });
      if (error) {
        console.error("Could not settle payroll payout", matchedReference, error.message);
        return new Response(`Could not settle: ${error.message}`, { status: 500 });
      }
      return new Response("Settled", { status: 200 });
    }
    if (status === "FAILED" || status === "CANCELLED") {
      const { error } = await admin.rpc("settle_sznd_payroll_payout", {
        target_reference: matchedReference,
        new_status: "failed",
        failure_reason_in: `Sznd reported this transfer as ${status}.`,
      });
      if (error) {
        console.error("Could not record failed payroll payout", matchedReference, error.message);
        return new Response(`Could not settle: ${error.message}`, { status: 500 });
      }
      return new Response("Recorded as failed", { status: 200 });
    }
    // Still pending on Sznd's side — nothing to do yet.
    return new Response("Ignored", { status: 200 });
  }

  // ---- fee collection branch ---------------------------------------------
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
