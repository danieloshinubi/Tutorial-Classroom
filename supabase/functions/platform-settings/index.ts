// Console → Settings saves Schoolivio's sender (SMTP) and Paystack account
// (supabase/225). Plain fields go to platform_settings; the SMTP password
// and the Paystack secret key go to Vault and can never be read back by a
// browser. "test" sends a test email to the signed-in admin from the saved
// sender, so a wrong password shows up now rather than on a school's
// reminder day.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { platformSettings, platformTransport } from "../_shared/platform/settings.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const { data: isAdmin } = await caller.rpc("is_platform_admin");
    if (!isAdmin) return json({ error: "Only a platform administrator can change Schoolivio settings." }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "classroom" },
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));

    if (body.action === "test") {
      const s = await platformSettings(admin);
      const mail = await platformTransport(admin, s);
      if (!mail) return json({ error: "Save the sender's address, server and password first." }, 400);
      try {
        await mail.transport.sendMail({
          from: mail.from,
          to: me.user.email,
          subject: "Schoolivio test email",
          text: "This is a test from Console → Settings. Trial and renewal reminders will be sent from this address.",
        });
      } catch (err) {
        return json({ error: `The mail server refused it: ${(err as Error).message}` }, 400);
      }
      return json({ ok: true, sentTo: me.user.email });
    }

    const s = body.settings || {};
    const security = ["ssl", "starttls", "none"].includes(s.smtp_security) ? s.smtp_security : null;
    const port = s.smtp_port ? Number(s.smtp_port) : null;
    if (port !== null && !(Number.isInteger(port) && port > 0 && port < 65536)) return json({ error: "Enter a valid port." }, 400);
    for (const key of ["sender_address", "contact_email"]) {
      if (s[key] && !EMAIL.test(String(s[key]).trim())) return json({ error: "Enter valid email addresses." }, 400);
    }
    const publicKey = String(s.paystack_public_key || "").trim();
    if (publicKey && !/^pk_(test|live)_\w+$/.test(publicKey)) return json({ error: "A Paystack public key starts with pk_live_ or pk_test_." }, 400);
    const secretKey = String(body.paystackSecret || "").trim();
    if (secretKey && !/^sk_(test|live)_\w+$/.test(secretKey)) return json({ error: "A Paystack secret key starts with sk_live_ or sk_test_." }, 400);

    const { error: saveError } = await admin.rpc("platform_save_settings", {
      settings: {
        sender_address: s.sender_address ? String(s.sender_address).trim().toLowerCase() : null,
        sender_name: s.sender_name ? String(s.sender_name).slice(0, 80) : null,
        smtp_host: s.smtp_host ? String(s.smtp_host).trim() : null,
        smtp_port: port,
        smtp_security: security,
        smtp_username: s.smtp_username ? String(s.smtp_username).trim() : null,
        paystack_public_key: publicKey || null,
        contact_email: s.contact_email ? String(s.contact_email).trim().toLowerCase() : null,
      },
      actor: me.user.id,
    });
    if (saveError) return json({ error: saveError.message }, 400);

    if (body.smtpPassword) {
      const { error } = await admin.rpc("platform_set_secret", { which: "smtp", plaintext: String(body.smtpPassword) });
      if (error) return json({ error: error.message }, 500);
    }
    if (secretKey) {
      const { error } = await admin.rpc("platform_set_secret", { which: "paystack", plaintext: secretKey });
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not save that." }, 500);
  }
});
