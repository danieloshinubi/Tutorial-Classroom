// Lets a school's owner or admin change the email address another person
// signs in with, the way admin-reset-password resets their password. Only
// the Auth Admin API (service_role key, kept here and never in the React
// bundle) can change someone else's login. The checks run first as the
// caller (classroom.email_change_blocker, supabase/214).
//
// The new address takes effect at once, with no confirmation link: the admin
// is vouching for it, the same as when they created the account. The old
// address stops working for sign-in immediately.

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const { schoolId, targetUserId, email } = await req.json();
    const newEmail = String(email || "").trim().toLowerCase();
    if (!schoolId || !targetUserId) return json({ error: "Which person, and at which school?" }, 400);
    if (!EMAIL.test(newEmail)) return json({ error: "Enter a valid email address." }, 400);

    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      db: { schema: "classroom" },
      global: { headers: { Authorization: authorization } },
    });
    const { data: authUser } = await caller.auth.getUser();
    if (!authUser?.user) return json({ error: "Sign in first." }, 401);

    const { data: blocker, error: checkError } = await caller.rpc("email_change_blocker", {
      target_school: schoolId,
      target_user: targetUserId,
    });
    if (checkError) return json({ error: checkError.message }, 400);
    if (blocker) return json({ error: blocker }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "classroom" },
    });

    const { data: before, error: readError } = await admin.auth.admin.getUserById(targetUserId);
    if (readError || !before?.user) return json({ error: "That account could not be found." }, 404);
    const oldEmail = (before.user.email || "").toLowerCase();
    if (oldEmail === newEmail) return json({ email: newEmail, unchanged: true });

    const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, {
      email: newEmail,
      email_confirm: true,
    });
    if (updateError) {
      const taken = /already|registered|exists|duplicate/i.test(updateError.message || "");
      return json({ error: taken ? "Another account already uses that email address." : updateError.message }, 400);
    }

    // The login has changed; the profile and audit log follow. A failure
    // here must not tell the admin it failed, because the old address has
    // already stopped working.
    const { error: recordError } = await admin.rpc("record_email_change", {
      target_school: schoolId,
      target_user: targetUserId,
      actor: authUser.user.id,
      old_email: oldEmail,
      new_email: newEmail,
    });
    if (recordError) console.error("record_email_change failed:", recordError.message);

    return json({ email: newEmail });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not change that email address." }, 500);
  }
});
