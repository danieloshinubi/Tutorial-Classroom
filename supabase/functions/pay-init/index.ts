// Starts a Paystack transaction for one invoice.
//
// The client sends an invoice id and nothing else. In particular it does not
// send an amount: this function asks the database what is outstanding, as the
// signed-in user, and charges that. If the browser could name the figure,
// anyone could pay ₦1 against a ₦175,000 bill.
//
// The secret key lives here, in the function's environment. It is never in
// the React bundle — CRA inlines every REACT_APP_* variable into JavaScript
// that anybody can read, so a secret key there would be public.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) {
      return json(
        { error: "Online payment is not configured. The school has not connected Paystack yet." },
        503,
      );
    }

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { invoiceId, callbackUrl } = await req.json();
    if (!invoiceId) return json({ error: "Which invoice?" }, 400);

    // As the caller, so row level security decides whether this invoice is
    // theirs. A parent cannot start a payment against another family's bill.
    // The DB schema hint is deliberate. Everything the platform runs on
    // lives in classroom.*; without this hint, .rpc("payable_now", ...)
    // routes through PostgREST's default schema (public) and comes back
    // with "Could not find the function public.payable_now(target_invoice)
    // in the schema cache."
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        db: { schema: "classroom" },
        global: { headers: { Authorization: authorization } },
      },
    );

    const { data: user } = await supabase.auth.getUser();
    if (!user?.user) return json({ error: "Sign in first." }, 401);

    const { data, error } = await supabase.rpc("payable_now", {
      target_invoice: invoiceId,
    });
    if (error) return json({ error: error.message }, 400);

    const invoice = Array.isArray(data) ? data[0] : data;
    if (!invoice) {
      return json(
        { error: "That invoice is not yours, is not issued, or has nothing outstanding." },
        404,
      );
    }

    const balance = Number(invoice.balance);
    if (!(balance > 0)) return json({ error: "Nothing is outstanding on that invoice." }, 400);

    const email = invoice.payer_email || user.user.email;
    if (!email) return json({ error: "Your account has no email address to bill." }, 400);

    // Paystack works in the smallest unit — kobo for naira, cents elsewhere.
    // Rounding is deliberate: a fractional kobo is rejected by the API.
    const smallestUnit = Math.round(balance * 100);

    const started = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: smallestUnit,
        currency: invoice.currency || "NGN",
        callback_url: callbackUrl,
        // Read back in the webhook. The invoice id has to survive the round
        // trip through Paystack, and metadata is how it does.
        metadata: {
          invoice_id: invoice.invoice_id,
          invoice_reference: invoice.reference,
          school_id: invoice.school_id,
          payer_id: user.user.id,
          school_name: invoice.school_name,
        },
      }),
    });

    const result = await started.json();
    if (!started.ok || !result?.status) {
      return json(
        { error: result?.message || "Paystack would not start that payment." },
        502,
      );
    }

    return json({
      authorizationUrl: result.data.authorization_url,
      reference: result.data.reference,
      amount: balance,
      currency: invoice.currency || "NGN",
    });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not start that payment." }, 500);
  }
});
