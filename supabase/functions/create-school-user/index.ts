// Creates a login on behalf of a school administrator.
//
// This cannot be a direct database call: creating an auth user needs the
// service_role key, which bypasses row level security entirely and must never
// be shipped to a browser. So the key stays here, and this function verifies
// the caller really does administer the school they are adding someone to.
//
// Deploy:
//   supabase functions deploy create-school-user
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ROLES = [
  "owner",
  "admin",
  "bursar",
  "admissions",
  "teacher",
  "student",
  "parent",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Who is asking? Resolved from their own JWT, never from the request body.
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      db: { schema: "classroom" },
    });

    const { data: { user: caller } } = await asCaller.auth.getUser();
    if (!caller) return json({ error: "Not signed in." }, 401);

    const { school_id, email, first_name, surname, role } = await req.json();

    if (!school_id || !email || !role) {
      return json({ error: "school_id, email and role are required." }, 400);
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return json({ error: `Unknown role "${role}".` }, 400);
    }

    // The authorisation check. Uses the caller's own client, so row level
    // security applies: they cannot even see a school they don't belong to.
    const { data: membership } = await asCaller
      .from("school_members")
      .select("role")
      .eq("school_id", school_id)
      .eq("user_id", caller.id)
      .eq("is_active", true)
      .maybeSingle();

    const { data: platform } = await asCaller
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    const mayInvite =
      platform || (membership && ["owner", "admin"].includes(membership.role));

    if (!mayInvite) {
      return json({ error: "Only a school administrator can add people." }, 403);
    }

    const admin = createClient(url, serviceKey, { db: { schema: "classroom" } });

    // Reuse an existing account when the email is already known — a parent
    // with children at two schools should not end up with two logins.
    let userId: string | null = null;
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      userId = existing.id;
    } else {
      // An invitation, not a password: an administrator who sets a password
      // knows that password.
      const { data: invited, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(email, {
          data: { first_name, surname, role: "student" },
        });

      if (inviteError) {
        // Falls back to creating the account without sending mail, so the
        // flow still works before SMTP is configured.
        const { data: created, error: createError } =
          await admin.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { first_name, surname },
          });
        if (createError) return json({ error: createError.message }, 400);
        userId = created.user.id;
      } else {
        userId = invited.user.id;
      }
    }

    // The trigger on auth.users creates the profile, but an existing account
    // may predate it, so make sure the row is there and named.
    await admin.from("profiles").upsert(
      {
        id: userId,
        email,
        first_name: first_name || "",
        surname: surname || "",
      },
      { onConflict: "id" },
    );

    const { error: memberError } = await admin
      .from("school_members")
      .upsert(
        { school_id, user_id: userId, role, is_active: true },
        { onConflict: "school_id,user_id" },
      );

    if (memberError) return json({ error: memberError.message }, 400);

    return json({ user_id: userId, email, role });
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
