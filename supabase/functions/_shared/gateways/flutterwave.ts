// Flutterwave adapter — second real implementation of PaymentGatewayAdapter
// (see types.ts), alongside Paystack.
//
// Two things about Flutterwave that don't match Paystack's shape:
//   amount unit    Flutterwave takes the amount in the currency's own major
//                  unit (naira, not kobo) — no *100 like Paystack needs.
//   webhook auth   Flutterwave has no per-request signature to compute.
//                  Instead you set a fixed string ("secret hash") once in
//                  your Flutterwave dashboard, and every webhook carries it
//                  back verbatim in the verif-hash header — verification is
//                  a straight comparison against that stored value, not an
//                  HMAC of the body. That value has nowhere else to live, so
//                  it's a third BYO credential field (secrets.hash) beside
//                  secret_key/public_key — see PaymentGatewaySettingsPanel's
//                  flutterwave field list.

import type { CheckoutContext, CheckoutResult, PaymentGatewayAdapter, WebhookEvent } from "./types.ts";

const sameDigest = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differences === 0;
};

export const flutterwaveAdapter: PaymentGatewayAdapter = {
  async initCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const secretKey = ctx.secrets.secret_key;
    if (!secretKey) throw new Error("Online payment is not configured. The school has not connected Flutterwave yet.");

    // Flutterwave has no concept of "the reference Paystack already gave
    // us" to reuse — tx_ref is ours to invent, and it's what comes back on
    // the webhook (in data.tx_ref) to tie the two together.
    const txRef = `flw-${ctx.metadata.invoiceId}-${crypto.randomUUID()}`;

    const started = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: ctx.amount,
        currency: ctx.currency || "NGN",
        redirect_url: ctx.callbackUrl,
        customer: { email: ctx.email },
        meta: {
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
    if (!started.ok || result?.status !== "success") {
      throw new Error(result?.message || "Flutterwave would not start that payment.");
    }

    return { authorizationUrl: result.data.link, reference: txRef };
  },

  peekGatewayId(rawBody: string): string | null {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed?.data?.meta?.gatewayId || null;
    } catch {
      return null;
    }
  },

  async verifyWebhookSignature(rawBody, headers, secrets): Promise<boolean> {
    const hash = secrets.hash;
    if (!hash) return false;
    const received = headers.get("verif-hash") ?? "";
    return sameDigest(hash, received);
  },

  parseWebhookEvent(rawBody: string): WebhookEvent {
    const event = JSON.parse(rawBody);
    const data = event?.data;

    if (event?.event !== "charge.completed" || data?.status !== "successful") {
      return { kind: "ignored" };
    }

    return {
      kind: "success",
      reference: data?.tx_ref,
      amount: typeof data?.amount === "number" ? data.amount : undefined,
      feeAmount: typeof data?.app_fee === "number" ? data.app_fee : undefined,
      invoiceId: data?.meta?.invoice_id,
      payerId: data?.meta?.payer_id,
    };
  },
};
