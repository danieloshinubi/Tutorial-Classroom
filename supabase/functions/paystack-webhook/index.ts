// Paystack tells us a payment succeeded. This is the only thing that credits
// an invoice.
//
// Why not the browser's callback: a "payment successful" message arriving
// from a client can be replayed, edited, or simply made up. The webhook is
// signed with the secret key, so this function can prove Paystack sent it.
// The client's return from the payment page is used for nothing but showing
// the family a friendly result.
//
// Two things this has to get right:
//
//   the signature   HMAC SHA-512 of the raw body with the secret key. It has
//                   to be computed on the exact bytes received, so the body
//                   is read as text and only parsed afterwards.
//
//   idempotency     Paystack retries anything it did not get a 200 for.
//                   settle_online_payment() is keyed on the gateway
//                   reference and returns the existing row rather than
//                   crediting twice, so a retry is harmless — and we still
//                   answer 200 so the retries stop.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// Length-independent comparison, so a mismatch does not leak where it failed.
const sameDigest = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) {
    differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differences === 0;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) {
    console.error("PAYSTACK_SECRET_KEY is not set — cannot verify anything");
    return new Response("Not configured", { status: 503 });
  }

  // Raw bytes, before any parsing. Re-serialising JSON would change the
  // whitespace and the signature would never match.
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
  );

  if (!sameDigest(expected, signature)) {
    // Somebody who is not Paystack. Say nothing useful about why.
    console.warn("Rejected a webhook with a bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: {
    event?: string;
    data?: {
      reference?: string;
      amount?: number;
      currency?: string;
      status?: string;
      fees?: number;
      metadata?: Record<string, string>;
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Unreadable body", { status: 400 });
  }

  // Anything else — a refund, a transfer, a subscription — is not ours to act
  // on, but it is a legitimate delivery, so acknowledge it.
  if (event.event !== "charge.success" || event.data?.status !== "success") {
    return new Response("Ignored", { status: 200 });
  }

  const invoiceId = event.data?.metadata?.invoice_id;
  const reference = event.data?.reference;
  const amount = event.data?.amount;

  if (!invoiceId || !reference || !amount) {
    console.error("charge.success without an invoice id, reference or amount", reference);
    // 200 on purpose: retrying will not add metadata that was never there.
    return new Response("Nothing to settle", { status: 200 });
  }

  // Service role, because settle_online_payment() is granted to nobody else.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.rpc("settle_online_payment", {
    target_invoice: invoiceId,
    // Back from the smallest unit. Paystack sent kobo; the invoice is in naira.
    paid_amount: amount / 100,
    gateway_name: "paystack",
    gateway_reference: reference,
    gateway_fee: event.data?.fees ? event.data.fees / 100 : null,
    payer: event.data?.metadata?.payer_id ?? null,
  });

  if (error) {
    // A real failure — let Paystack retry, because the money has left the
    // parent's account and the invoice does not know about it yet.
    console.error("Could not settle", reference, error.message);
    return new Response(`Could not settle: ${error.message}`, { status: 500 });
  }

  return new Response("Settled", { status: 200 });
});
