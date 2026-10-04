// Sznd (dashboard/checkout domain: transfaar.com) adapter — our payments
// partner. Two things about Sznd that don't match Paystack's shape:
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

import type { CheckoutContext, CheckoutResult, PaymentGatewayAdapter, WebhookEvent } from "./types.ts";

const SZND_BASE_URL = Deno.env.get("SZND_BASE_URL") || "https://api.sznd.app";

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
    const body = JSON.stringify({
      email: ctx.email,
      amount: ctx.amount.toFixed(2),
      currency: ctx.currency || "NGN",
      reference: `sznd-${ctx.metadata.invoiceId}-${crypto.randomUUID()}`,
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
    if (!started.ok || !result?.checkout_link) {
      throw new Error(result?.message || "Sznd would not start that payment.");
    }

    return {
      authorizationUrl: result.checkout_link,
      reference: result.transactionRef || JSON.parse(body).reference,
    };
  },

  peekGatewayId(rawBody: string): string | null {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed?.metadata?.gatewayId || null;
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

    if (event?.event_type !== "transaction" || event?.status !== "COMPLETED") {
      return { kind: "ignored" };
    }

    return {
      kind: "success",
      reference: event?.reference,
      amount: typeof event?.target_amount === "string" ? Number(event.target_amount) : undefined,
      feeAmount: undefined,
      invoiceId: event?.metadata?.invoice_id,
      payerId: event?.metadata?.payer_id,
    };
  },
};
