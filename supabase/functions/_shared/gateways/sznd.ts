// Sznd (dashboard/checkout domain: transfaar.com; staging page title shows
// "Sznd Business Dashboard") adapter — our payments partner. Three things
// about Sznd that don't match Paystack's shape:
//
//   amount unit    Sznd takes amount as a DECIMAL STRING in the currency's
//                  own major unit ("1000.00"), not an integer in the
//                  smallest unit like Paystack's kobo.
//
//   request auth   Every call to a Sznd /client endpoint — not just the
//                  webhook — is itself HMAC-signed: X-Api-Key identifies the
//                  account, X-Timestamp is an RFC3339 UTC timestamp, and
//                  X-Signature is hex(HMAC-SHA256(secretKey, body + "|" +
//                  timestamp)). The webhook reuses that same construction
//                  (X-Transfaar-Signature, HMAC-SHA256 of the raw body with
//                  the secret key) rather than a distinct signing secret —
//                  so unlike Flutterwave/Stripe, Sznd needs no second BYO
//                  field beyond the one secret key.
//
//   required name  Unlike Paystack/Flutterwave/Stripe, checkout/initialize
//                  400s without both first_name and last_name — not just
//                  email. See CheckoutContext.firstName/lastName.
//
// STATUS as of 2026-10-10, tested live against staging
// (https://transfaar-test-a8d2cb980af2.herokuapp.com) with real
// tf_dev_biz_.../sk_dev_biz_... credentials:
//   confirmed    request signing, checkout/initialize (incl. its real
//                nested-under-`data` response shape), payment/verify, and
//                that the hosted checkout page actually redirects back to
//                our redirectUrl with a `status` query param on completion.
//   unconfirmed  a real completed-payment webhook delivery. Both of Sznd's
//                documented "always approved" staging test cards
//                (5111 1111 1111 1118 no-3DS, and the Visa 3DS one) failed
//                with a generic "something went wrong while trying to
//                charge your card" / HTTP 500 from Sznd's own charge
//                endpoint on repeated attempts — a staging-side issue, not
//                ours (the charge call goes browser-to-Sznd directly via
//                access_code, nothing in this codebase is on that path).
//                verifyWebhookSignature/parseWebhookEvent below are written
//                against the transaction webhook's documented shape and
//                payment/verify's CONFIRMED response shape, but have never
//                seen a real completed webhook body — re-verify both
//                against one before trusting this in production.

import type { CheckoutContext, CheckoutResult, PaymentGatewayAdapter, WebhookEvent } from "./types.ts";

// Confirmed live 2026-10-10 against Sznd's documented staging host —
// docs.sznd.app serves documentation only, not the API, and has no DNS
// record of its own. Production gets its own base URL from Sznd's
// integration team and MUST be set via this env var before going live;
// this default is staging-only.
const SZND_BASE_URL = Deno.env.get("SZND_BASE_URL") || "https://transfaar-test-a8d2cb980af2.herokuapp.com";

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hmacSha256Hex = async (secret: string, data: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
};

const sameDigest = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differences === 0;
};

// Every /client call needs this same three-header signature, keyed off the
// exact body bytes sent — computed fresh per request rather than shared,
// since the timestamp has to be current.
const signedHeaders = async (apiKey: string, secretKey: string, body: string) => {
  const timestamp = new Date().toISOString();
  const signature = await hmacSha256Hex(secretKey, `${body}|${timestamp}`);
  return {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
};

export const szndAdapter: PaymentGatewayAdapter = {
  async initCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const apiKey = ctx.secrets.api_key;
    const secretKey = ctx.secrets.secret_key;
    if (!apiKey || !secretKey) {
      throw new Error("Online payment is not configured. The school has not connected Sznd yet.");
    }

    // Sznd wants a decimal major-unit string ("1000.00"), never a float and
    // never kobo/cents — ctx.amount is already naira-shaped (see pay-init).
    // first_name/last_name are required — confirmed against staging
    // 2026-10-10 (omitting them 400s with "missing required fields").
    const reference = `sznd-${ctx.metadata.invoiceId}-${crypto.randomUUID()}`;
    const body = JSON.stringify({
      email: ctx.email,
      first_name: ctx.firstName,
      last_name: ctx.lastName,
      amount: ctx.amount.toFixed(2),
      currency: ctx.currency || "NGN",
      reference,
      redirectUrl: ctx.callbackUrl,
      description: ctx.metadata.invoiceReference
        ? `Payment for ${ctx.metadata.invoiceReference}`
        : undefined,
      metadata: {
        invoice_id: ctx.metadata.invoiceId,
        invoice_reference: ctx.metadata.invoiceReference,
        school_id: ctx.metadata.schoolId,
        school_name: ctx.metadata.schoolName,
        payer_id: ctx.metadata.payerId,
        gatewayId: ctx.metadata.gatewayId,
      },
    });

    const headers = await signedHeaders(apiKey, secretKey, body);
    const started = await fetch(`${SZND_BASE_URL}/api/v1/client/checkout/initialize`, {
      method: "POST",
      headers,
      body,
    });

    const result = await started.json();
    // Confirmed against staging 2026-10-10: a successful response nests
    // everything under `data` — { data: { checkout_link, transactionRef,
    // reference, access_code, valid_until }, message, success }, not
    // top-level as Paystack/Flutterwave shape their responses.
    const data = result?.data;
    if (!started.ok || !data?.checkout_link) {
      throw new Error(result?.message || result?.error || "Sznd would not start that payment.");
    }

    return {
      authorizationUrl: data.checkout_link,
      // Our own reference, not Sznd's transactionRef — this is what
      // settle_online_payment keys payments.gateway_ref on, and it's the
      // one value guaranteed to be ours regardless of which identifier a
      // given webhook delivery happens to echo back (see
      // parseWebhookEvent's multi-field fallback below).
      reference,
    };
  },

  // Still-UNVERIFIED against a real completed-payment webhook as of
  // 2026-10-10 — Sznd's staging rejected both documented "always approved"
  // test cards with a generic charge failure (their side, not ours; see
  // TEAM_BRIEF), so a real webhook delivery was never observed. The
  // transaction/verify endpoint's response shape (confirmed) uses `metadata`
  // at the top level, which is what this assumes the webhook mirrors — but
  // that is an assumption, not a confirmed fact. Re-verify both
  // peekGatewayId and parseWebhookEvent against one real webhook payload
  // before trusting Sznd in production.
  peekGatewayId(rawBody: string): string | null {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed?.metadata?.gatewayId ?? parsed?.data?.metadata?.gatewayId ?? null;
    } catch {
      return null;
    }
  },

  async verifyWebhookSignature(rawBody, headers, secrets): Promise<boolean> {
    const secretKey = secrets.secret_key;
    if (!secretKey) return false;
    const received = headers.get("x-transfaar-signature") ?? "";
    const expected = await hmacSha256Hex(secretKey, rawBody);
    return sameDigest(expected, received);
  },

  parseWebhookEvent(rawBody: string): WebhookEvent {
    const event = JSON.parse(rawBody);
    // GET /client/payment/verify (confirmed live 2026-10-10) returns
    // status/status_name/transaction_status all holding the same value
    // ("PENDING", then "COMPLETED" or "FAILED") — accepting any of the
    // three here in case the webhook only populates one of them.
    const status = event?.status ?? event?.status_name ?? event?.transaction_status;
    if (status !== "COMPLETED") {
      return { kind: "ignored" };
    }

    // Our own `reference` from initCheckout is what identifies the payment
    // on OUR side (it's what gateway_ref is keyed on) — but it's still
    // unconfirmed which field name, if any, a real webhook echoes it back
    // under, so every plausible name is tried, in the order most-ours to
    // least-ours.
    const reference = event?.reference ?? event?.provider_reference ?? event?.transaction_reference;
    const amountRaw = event?.amount ?? event?.target_amount ?? event?.source_amount;
    const metadata = event?.metadata ?? event?.data?.metadata;

    return {
      kind: "success",
      reference,
      amount: amountRaw != null ? Number(amountRaw) : undefined,
      feeAmount: undefined,
      invoiceId: metadata?.invoice_id,
      payerId: metadata?.payer_id,
    };
  },
};
