// Adds someone to the platform console (Platform → Team → Add someone), the
// way a school adds a member of staff: name and email in, the account made
// there and then with a temporary password, which is shown to the admin once
// and must be replaced at first sign-in. Someone who already has a
// Schoolivio account is simply given console access and keeps their own
// password. Each account is either approved school by school or break-glass
// (supabase/224).
//
// Only the Auth Admin API (service_role key, kept here and never in the
// browser) can create a login with a chosen password. The caller must
// already be a platform administrator; the database checks that again
// (platform_grant_admin, supabase/223).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same alphabet as src/lib/provisioning.js: no 0/O or 1/l/I to misread.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const pick = (chars: string, n: number) => {
  const bytes = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};
const temporaryPassword = () => `${pick(UPPER, 3)}-${pick(LOWER, 4)}-${pick(DIGITS, 3)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const firstName = String(body.firstName || "").trim().slice(0, 80);
    const surname = String(body.surname || "").trim().slice(0, 80);
    if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (!firstName || !surname) return json({ error: "Enter their first name and surname." }, 400);
    // How they get into schools (supabase/224): each school approves them, or
    // break-glass, any school at any time.
    const accessType = body.accessType === "breakglass" ? "breakglass" : "approval";

    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      db: { schema: "classroom" },
      global: { headers: { Authorization: authorization } },
    });
    const { data: me } = await caller.auth.getUser();
    if (!me?.user) return json({ error: "Sign in first." }, 401);
    const { data: isAdmin, error: adminError } = await caller.rpc("is_platform_admin");
    if (adminError) return json({ error: adminError.message }, 400);
    if (!isAdmin) return json({ error: "Only a platform administrator can add someone to the console." }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "classroom" },
      auth: { persistSession: false },
    });

    const { data: existingId, error: lookupError } = await admin.rpc("platform_user_by_email", { target_email: email });
    if (lookupError) return json({ error: lookupError.message }, 500);

    let userId = existingId as string | null;
    let password: string | null = null;

    if (!userId) {
      password = temporaryPassword();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        // The admin vouches for the address, as a school does for its staff.
        email_confirm: true,
        user_metadata: { first_name: firstName, surname },
      });
      if (createError || !created?.user) {
        return json({ error: createError?.message || "Could not create that account." }, 400);
      }
      userId = created.user.id;
    }

    const { error: grantError } = await admin.rpc("platform_grant_admin", {
      target_user: userId,
      actor: me.user.id,
      is_new: Boolean(password),
      type_in: accessType,
    });
    if (grantError) return json({ error: grantError.message }, 400);

    return json({ email, name: `${firstName} ${surname}`, password, existed: !password, accessType });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not add that person." }, 500);
  }
});
