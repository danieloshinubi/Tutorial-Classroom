// Paystack adapter — this is today's pay-init/paystack-webhook logic,
// extracted verbatim into the PaymentGatewayAdapter shape. No behaviour
// change from what was already live.

import type { CheckoutContext, CheckoutResult, PaymentGatewayAdapter, WebhookEvent } from "./types.ts";

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Length-independent comparison, so a mismatch does not leak where it
// failed — same helper paystack-webhook has always used.
const sameDigest = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differences === 0;
};

export const paystackAdapter: PaymentGatewayAdapter = {
  async initCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const secretKey = ctx.secrets.secret_key;
    if (!secretKey) throw new Error("Online payment is not configured. The school has not connected Paystack yet.");

    // Paystack works in the smallest unit — kobo for naira. Rounding is
    // deliberate: a fractional kobo is rejected by the API.
    const smallestUnit = Math.round(ctx.amount * 100);

    const started = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: ctx.email,
        amount: smallestUnit,
        currency: ctx.currency || "NGN",
        callback_url: ctx.callbackUrl,
        // Read back in the webhook (via peekGatewayId + parseWebhookEvent).
        // The invoice id and gateway id have to survive the round trip
        // through Paystack, and metadata is how it does.
        metadata: {
          invoice_id: ctx.metadata.invoiceId,
          invoice_reference: ctx.metadata.invoiceReference,
          school_id: ctx.metadata.schoolId,
          school_name: ctx.metadata.schoolName,
          payer_id: ctx.metadata.payerId,
          gatewayId: ctx.metadata.gatewayId,
        },
      }),
    });

    const result = await started.json();
    if (!started.ok || !result?.status) {
      throw new Error(result?.message || "Paystack would not start that payment.");
    }

    return { authorizationUrl: result.data.authorization_url, reference: result.data.reference };
  },

  peekGatewayId(rawBody: string): string | null {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed?.data?.metadata?.gatewayId || null;
    } catch {
      return null;
    }
  },

  async verifyWebhookSignature(rawBody, headers, secrets): Promise<boolean> {
    const secretKey = secrets.secret_key;
    if (!secretKey) return false;

    const signature = headers.get("x-paystack-signature") ?? "";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secretKey),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
    return sameDigest(expected, signature);
  },

  parseWebhookEvent(rawBody: string): WebhookEvent {
    const event = JSON.parse(rawBody);

    // Anything else — a refund, a transfer, a subscription — is not ours to
    // act on, but it is a legitimate delivery.
    if (event.event !== "charge.success" || event.data?.status !== "success") {
      return { kind: "ignored" };
    }

    return {
      kind: "success",
      reference: event.data?.reference,
      // Back from the smallest unit — Paystack sends kobo, everything else
      // in this codebase works in naira.
      amount: typeof event.data?.amount === "number" ? event.data.amount / 100 : undefined,
      feeAmount: typeof event.data?.fees === "number" ? event.data.fees / 100 : undefined,
      invoiceId: event.data?.metadata?.invoice_id,
      payerId: event.data?.metadata?.payer_id,
    };
  },
};
