// Starts an online payment for one invoice — against whichever gateway the
// invoice's school has chosen (Schoolivio's shared account, or the school's
// own credentials), for whichever provider that is. See
// _shared/gateways/types.ts for the adapter interface every provider
// implements identically from this function's point of view.
//
// The client sends an invoice id and nothing else. In particular it does not
// send an amount: this function asks the database what is outstanding, as the
// signed-in user, and charges that. If the browser could name the figure,
// anyone could pay ₦1 against a ₦175,000 bill.
//
// The secret key lives here (env var, platform mode) or in Vault (BYO mode)
// — never in the React bundle. CRA inlines every REACT_APP_* variable into
// JavaScript anybody can read, so a secret key there would be public.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getAdapter } from "../_shared/gateways/registry.ts";
import { resolvePlatformSecrets } from "../_shared/gateways/platformCredentials.ts";

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
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { invoiceId, callbackUrl } = await req.json();
    if (!invoiceId) return json({ error: "Which invoice?" }, 400);

    // As the caller, so row level security decides whether this invoice is
    // theirs. A parent (or an applicant) cannot start a payment against
    // another family's bill. The DB schema hint is deliberate. Everything
    // the platform runs on lives in classroom.*; without this hint,
    // .rpc(...) routes through PostgREST's default schema (public) and
    // comes back with "Could not find the function" errors.
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

    const [{ data: invoiceData, error: invoiceError }, { data: gatewayData, error: gatewayError }] =
      await Promise.all([
        supabase.rpc("payable_now", { target_invoice: invoiceId }),
        supabase.rpc("gateway_settings_for_payer", { target_invoice: invoiceId }),
      ]);
    if (invoiceError) return json({ error: invoiceError.message }, 400);

    const invoice = Array.isArray(invoiceData) ? invoiceData[0] : invoiceData;
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

    const gateway = gatewayError ? null : (Array.isArray(gatewayData) ? gatewayData[0] : gatewayData);
    // A row exists for every school (116's seed trigger), but provider/mode
    // are null until an owner/admin actually picks one (121) — that's the
    // same "not configured" state as no row at all.
    if (!gateway || !gateway.provider || !gateway.mode) {
      return json(
        { error: "Your school hasn't set up online payments yet. An owner or admin needs to choose one in Settings." },
        503,
      );
    }

    // Only BYO mode ever touches a service-role client, and only to read a
    // decrypted secret — never to do anything else, and never returned to
    // the browser.
    let secrets: Record<string, string> = {};
    if (gateway.mode === "byo") {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { db: { schema: "classroom" } },
      );
      const { data: secretData, error: secretError } = await admin.rpc("get_gateway_secret", {
        target_gateway: gateway.gateway_id,
      });
      if (secretError || !secretData) {
        return json({ error: "Could not read this school's payment gateway credentials." }, 500);
      }
      secrets = secretData;
    } else {
      secrets = resolvePlatformSecrets(gateway.provider);
    }

    const adapter = getAdapter(gateway.provider);
    const { authorizationUrl, reference } = await adapter.initCheckout({
      amount: balance,
      currency: invoice.currency || "NGN",
      email,
      callbackUrl,
      metadata: {
        invoiceId: invoice.invoice_id,
        invoiceReference: invoice.reference,
        schoolId: invoice.school_id,
        schoolName: invoice.school_name,
        payerId: user.user.id,
        gatewayId: gateway.gateway_id,
      },
      publicConfig: gateway.public_config || {},
      secrets,
    });

    return json({
      authorizationUrl,
      reference,
      amount: balance,
      currency: invoice.currency || "NGN",
    });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not start that payment." }, 500);
  }
});
