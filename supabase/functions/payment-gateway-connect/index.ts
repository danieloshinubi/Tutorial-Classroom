// Connects (or switches, or reverts to platform mode for) a school's
// payment gateway. Mirrors mailbox-connect exactly: a caller-scoped check
// that the signed-in user is actually owner/admin for this school, then a
// service-role call that does the row write and the Vault secret write
// together, atomically — classroom.upsert_payment_gateway() is granted to
// nobody else.
//
// A BYO secret key never touches a table column and is never returned to
// the browser — only what's safe to show back (provider, mode, whether
// confirmation is required, the non-secret public config) comes back here.
//
// Two things this does that the original version didn't:
//
//   verification    A BYO secret key used to just get saved — the first
//                    time anyone found out it was wrong (mistyped, revoked,
//                    a live key pasted where a test key was meant) was a
//                    real family's payment failing. verifyCredentials() now
//                    makes one cheap, read-only call to the chosen
//                    provider's own API before anything is written, and the
//                    save is refused if that call doesn't authenticate.
//
//   provider "other" The admin UI offers "Other / not listed" for a gateway
//                    that isn't Paystack/Flutterwave/Stripe by name.
//                    detectProvider() tries the secret key against each of
//                    those in turn; if one of them actually accepts it (a
//                    school describing their Paystack account as "other"
//                    because they didn't see it in a shorter list, say),
//                    the row is saved under its real, working provider name
//                    — never literally "other", which has no adapter and
//                    could never take a real payment.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isImplemented } from "../_shared/gateways/registry.ts";
import { verifyCredentials, detectProvider } from "../_shared/gateways/verify.ts";

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

    const { schoolId, provider, mode, requireConfirmation, publicConfig, secrets } = await req.json();

    if (!schoolId || !provider || !mode) {
      return json({ error: "A school, a provider and a mode are required." }, 400);
    }
    if (mode !== "platform" && mode !== "byo") {
      return json({ error: "Mode must be either the shared platform account or your own." }, 400);
    }
    if (mode === "byo" && (!secrets || !secrets.secret_key)) {
      return json({ error: "Enter this gateway's credentials to connect your own account." }, 400);
    }
    // Platform mode has no admin-chosen credentials to detect or verify —
    // it's always Schoolivio's own account, so the provider named here has
    // to already be one of ours. BYO's own check (provider === "other" vs.
    // an implemented name) happens further down, after the admin check,
    // since detecting/verifying means an outbound call using whatever key
    // was pasted in and that shouldn't be reachable by just anyone.
    if (mode === "platform" && !isImplemented(provider)) {
      return json({ error: `${provider} isn't available yet.` }, 400);
    }

    // As the caller — the same way pay-init asks payable_now() as the
    // paying user rather than trusting the client's own claim of access.
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        db: { schema: "classroom" },
        global: { headers: { Authorization: authorization } },
      },
    );

    const { data: authUser } = await caller.auth.getUser();
    if (!authUser?.user) return json({ error: "Sign in first." }, 401);

    const { data: isAdmin, error: checkError } = await caller.rpc("has_role_in", {
      target_school: schoolId,
      roles: ["owner", "admin"],
    });
    if (checkError) return json({ error: checkError.message }, 400);
    if (!isAdmin) return json({ error: "Only an owner or admin can change how this school takes payments." }, 403);

    // Resolved to a real, adapter-backed provider name before anything is
    // written — "other" never reaches upsert_payment_gateway, and neither
    // does a key that failed to authenticate.
    let resolvedProvider = provider;
    let detectedProviderLabel: string | null = null;

    if (mode === "byo") {
      if (provider === "other") {
        resolvedProvider = await detectProvider(secrets.secret_key);
        if (!resolvedProvider) {
          return json(
            {
              error:
                "We couldn't tell which gateway this is from the key you entered — we don't have a working integration for it yet. Get in touch and tell us which gateway you're trying to connect.",
            },
            400,
          );
        }
        detectedProviderLabel = resolvedProvider;
      } else {
        if (!isImplemented(provider)) {
          return json({ error: `${provider} isn't available yet.` }, 400);
        }
        const check = await verifyCredentials(provider, secrets.secret_key);
        if (!check.ok) {
          return json(
            {
              error: check.message
                ? `That key was rejected by ${provider}: ${check.message}`
                : `That key was rejected by ${provider} — check it and try again.`,
            },
            400,
          );
        }
      }
    }

    // Only past this point does anything privileged happen, and only with
    // the service role — upsert_payment_gateway is granted to nobody else.
    // The row and its vault secret are written in one function call, one
    // transaction: either both exist or neither does.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    const { data: gateway, error: upsertError } = await admin.rpc("upsert_payment_gateway", {
      target_school: schoolId,
      provider_in: resolvedProvider,
      mode_in: mode,
      require_confirmation_in: Boolean(requireConfirmation),
      public_config_in: publicConfig || {},
      secrets_in: mode === "byo" ? secrets : null,
      // auth.uid() is null by the time this reaches the service-role
      // client, so the real actor is passed through explicitly from the
      // one place that still knows who they are.
      confirmed_by_in: authUser.user.id,
    });
    if (upsertError) return json({ error: upsertError.message }, 400);

    return json({
      provider: gateway.provider,
      mode: gateway.mode,
      isActive: gateway.is_active,
      requireConfirmation: gateway.require_confirmation,
      publicConfig: gateway.public_config,
      confirmedAt: gateway.confirmed_at,
      // Set only when the admin picked "Other / not listed" and we figured
      // out which real provider it was — lets the settings panel say so
      // explicitly instead of a generic "connected".
      detectedProvider: detectedProviderLabel,
    });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not save that gateway." }, 500);
  }
});
