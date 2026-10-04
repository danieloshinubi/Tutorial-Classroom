// A school pays Schoolivio for its plan with Paystack (supabase/225).
//
//   start   an owner or admin asks to pay. The price comes from the
//           database (school_plan_quote: Starter or Growth by the number of
//           active students), never from the browser, and a Paystack
//           checkout is opened for it on Schoolivio's own account.
//   verify  back from Paystack, the app asks Paystack itself, with the
//           secret key, whether that reference was paid and for how much.
//           Only then does confirm_subscription_payment switch the school
//           to its plan for a month and record it in Billing. Confirming
//           twice is harmless.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { platformSecret } from "../_shared/platform/settings.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const newReference = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `SCHV-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};

// Paystack only ever sends the payer back to the school's own address.
const safeCallback = (url: unknown, slug: string) => {
  const fallback = `https://${slug}.schoolivio.com/School?tab=billing`;
  try {
    const u = new URL(String(url));
    const ok = u.hostname === `${slug}.schoolivio.com` || u.hostname === "localhost" || u.hostname.endsWith(".localhost");
    return ok ? u.toString() : fallback;
  } catch {
    return fallback;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      db: { schema: "classroom" },
      global: { headers: { Authorization: authorization } },
    });
    const { data: me } = await caller.auth.getUser();
    if (!me?.user) return json({ error: "Sign in first." }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "classroom" },
      auth: { persistSession: false },
    });
    const secretKey = await platformSecret(admin, "paystack");
    if (!secretKey) return json({ error: "Online payment is not available yet. Please write to us to pay." }, 503);

    const body = await req.json().catch(() => ({}));

    if (body.action === "start") {
      const schoolId = String(body.schoolId || "");
      if (!schoolId) return json({ error: "Which school?" }, 400);
      const ref = newReference();
      const { data: quote, error } = await admin.rpc("start_subscription_payment", {
        target_school: schoolId,
        actor: me.user.id,
        ref,
      });
      if (error) return json({ error: error.message }, 400);
      if (!quote?.email) return json({ error: "Your account has no email address to bill." }, 400);

      const started = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: quote.email,
          amount: Math.round(Number(quote.amount) * 100),
          currency: "NGN",
          reference: ref,
          callback_url: safeCallback(body.callbackUrl, quote.slug),
          metadata: { purpose: "schoolivio_subscription", school_id: schoolId, school_name: quote.school_name, plan: quote.plan },
        }),
      });
      const result = await started.json().catch(() => null);
      if (!started.ok || !result?.status) {
        await admin.rpc("mark_subscription_payment", { ref, status_in: "failed", response: result || {} });
        return json({ error: result?.message || "Paystack would not start that payment." }, 502);
      }
      return json({ authorizationUrl: result.data.authorization_url, reference: ref });
    }

    if (body.action === "verify") {
      const ref = String(body.reference || "");
      if (!/^SCHV-[0-9A-F]{16}$/.test(ref)) return json({ error: "Unknown payment." }, 400);
      // Only someone who can see the payment (the school's owners and
      // admins, or the console) may ask about it.
      const { data: mine } = await caller.from("subscription_payments").select("id").eq("reference", ref).maybeSingle();
      if (!mine) return json({ error: "Unknown payment." }, 404);

      const checked = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const result = await checked.json().catch(() => null);
      const tx = result?.data;
      if (!checked.ok || !tx) return json({ status: "pending" });
      if (tx.status === "success" && tx.currency === "NGN") {
        const { data, error } = await admin.rpc("confirm_subscription_payment", {
          ref,
          paid_amount: Number(tx.amount) / 100,
          paid_at_in: tx.paid_at || null,
          response: { id: tx.id, channel: tx.channel, paid_at: tx.paid_at, amount: tx.amount },
        });
        if (error) return json({ error: error.message }, 400);
        return json(data);
      }
      if (tx.status === "failed" || tx.status === "abandoned") {
        await admin.rpc("mark_subscription_payment", { ref, status_in: tx.status, response: { status: tx.status } });
        return json({ status: tx.status });
      }
      return json({ status: "pending" });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    return json({ error: (err as Error).message || "Could not complete that." }, 500);
  }
});
