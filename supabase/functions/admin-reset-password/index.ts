// Lets a school admin/owner reset another person's password within their own
// school — the way an IT admin resets a user's password from Microsoft
// 365's admin center. Not possible from the browser on its own: Supabase
// only lets someone change their OWN password from the client; only the Auth
// Admin API, which needs the service_role key, can set someone else's. That
// key lives here, in the function's environment — never in the React bundle.

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

// Same alphabet as src/lib/provisioning.js's temporaryPassword() — no
// ambiguous 0/O, 1/l/I.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const pick = (chars: string, n: number) =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
const temporaryPassword = () => `${pick(ALPHABET, 3)}-${pick(LOWER, 4)}-${pick(DIGITS, 3)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { schoolId, targetUserId } = await req.json();
    if (!schoolId || !targetUserId) {
      return json({ error: "Which person, and at which school?" }, 400);
    }

    // As the caller, so can_manage_member_account resolves against their own
    // row-level-security view of things — the same way pay-init asks
    // payable_now() as the paying user rather than trusting the client.
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

    const { data: allowed, error: checkError } = await caller.rpc("can_manage_member_account", {
      target_school: schoolId,
      target_user: targetUserId,
    });
    if (checkError) return json({ error: checkError.message }, 400);
    if (!allowed) {
      return json({ error: "You do not administer that person's account at this school." }, 403);
    }

    // Only past this point does anything privileged happen, and only with
    // the service role — the same boundary paystack-webhook draws around
    // settle_online_payment().
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    const newPassword = temporaryPassword();
    const { data: targetUser, error: pwError } = await admin.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
    });
    if (pwError) return json({ error: pwError.message }, 400);

    // Sets the same "must replace it before doing anything else" flag an
    // administrator-created account already gets, and writes the one audit
    // log entry this action produces (auth.users lives outside classroom,
    // and profiles is deliberately excluded from the generic audit trigger,
    // so nothing else would record this). A SECURITY DEFINER function,
    // not a raw table write: service_role has no table-level GRANT on
    // profiles or audit_log in this schema (only `authenticated` does) —
    // BYPASSRLS skips row level security policies, not that separate
    // requirement — so a direct .from() write here would fail silently.
    const { error: followUpError } = await admin.rpc("record_password_reset", {
      target_school: schoolId,
      target_user: targetUserId,
      actor: authUser.user.id,
    });
    if (followUpError) {
      // The password itself is already changed — the one thing that must
      // not happen is telling the admin it failed when the person's old
      // password already stopped working.
      console.error("record_password_reset failed:", followUpError.message);
    }

    return json({ password: newPassword, email: targetUser?.user?.email || null });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not reset that password." }, 500);
  }
});
