// Stripe adapter — third real implementation of PaymentGatewayAdapter (see
// types.ts). Two things about Stripe that don't match Paystack's shape:
//
//   request body   Stripe's REST API takes application/x-www-form-urlencoded,
//                  not JSON — including for nested objects, which are
//                  encoded as bracketed field names (line_items[0][...]).
//
//   webhook auth   The Stripe-Signature header is
//                  "t=<timestamp>,v1=<hex hmac>", where the hmac is computed
//                  over "<timestamp>.<raw body>" using a webhook SIGNING
//                  secret from the Stripe dashboard (whsec_...) — a
//                  different secret from the API secret key, and one Stripe
//                  never derives for you from the key alone. That's a third
//                  BYO credential field (secrets.webhook_secret) beside
//                  secret_key/public_key.
import type { CheckoutContext, CheckoutResult, PaymentGatewayAdapter, WebhookEvent } from "./types.ts";

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sameDigest = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differences === 0;
};

// Stripe's form encoding for a nested object: {a: {b: "c"}} -> "a[b]=c".
// Only as deep as checkout.sessions actually needs (line_items, metadata).
const toFormBody = (fields: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  const walk = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) => walk(`${key}[${k}]`, v));
    } else {
      params.append(key, String(value));
    }
  };
  Object.entries(fields).forEach(([k, v]) => walk(k, v));
  return params.toString();
};

export const stripeAdapter: PaymentGatewayAdapter = {
  async initCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const secretKey = ctx.secrets.secret_key;
    if (!secretKey) throw new Error("Online payment is not configured. The school has not connected Stripe yet.");

    // Stripe works in the smallest unit — cents for most currencies — same
    // rounding-is-deliberate reasoning as Paystack's kobo conversion.
    const smallestUnit = Math.round(ctx.amount * 100);

    const started = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: toFormBody({
        mode: "payment",
        success_url: ctx.callbackUrl,
        cancel_url: ctx.callbackUrl,
        customer_email: ctx.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: (ctx.currency || "USD").toLowerCase(),
              unit_amount: smallestUnit,
              product_data: { name: ctx.metadata.invoiceReference || "School fee" },
            },
          },
        ],
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
    if (!started.ok || !result?.url) {
      throw new Error(result?.error?.message || "Stripe would not start that payment.");
    }

    return { authorizationUrl: result.url, reference: result.id };
  },

  peekGatewayId(rawBody: string): string | null {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed?.data?.object?.metadata?.gatewayId || null;
    } catch {
      return null;
    }
  },

  async verifyWebhookSignature(rawBody, headers, secrets): Promise<boolean> {
    const webhookSecret = secrets.webhook_secret;
    if (!webhookSecret) return false;

    const header = headers.get("stripe-signature") ?? "";
    const parts = Object.fromEntries(
      header.split(",").map((part) => {
        const [k, v] = part.split("=");
        return [k, v];
      })
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = hex(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`))
    );
    return sameDigest(expected, signature);
  },

  parseWebhookEvent(rawBody: string): WebhookEvent {
    const event = JSON.parse(rawBody);
    const session = event?.data?.object;

    if (event?.type !== "checkout.session.completed" || session?.payment_status !== "paid") {
      return { kind: "ignored" };
    }

    return {
      kind: "success",
      reference: session?.id,
      // Back from the smallest unit — cents to dollars/naira/etc.
      amount: typeof session?.amount_total === "number" ? session.amount_total / 100 : undefined,
      invoiceId: session?.metadata?.invoice_id,
      payerId: session?.metadata?.payer_id,
    };
  },
};
