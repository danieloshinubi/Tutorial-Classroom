// Connects a school's own mailbox to the Tickets module — phase 2 supports
// generic IMAP/SMTP with a username and app password; Microsoft 365 and
// Google connect through their own OAuth flow instead (a later phase), so
// this function rejects those providers for now rather than pretending to
// support them.
//
// The app password never touches a table column. It is written straight to
// Supabase Vault via classroom.set_mailbox_secret(), called only from the
// service-role client below — the same boundary admin-reset-password draws
// around its own privileged write.

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

const SECURITY_BY_PORT: Record<number, string> = { 993: "ssl", 143: "starttls", 465: "ssl", 587: "starttls", 25: "none" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);

    const {
      schoolId,
      label,
      address,
      displayName,
      provider,
      imapHost,
      imapPort,
      imapSecurity,
      smtpHost,
      smtpPort,
      smtpSecurity,
      username,
      password,
    } = await req.json();

    if (!schoolId || !address || !provider) {
      return json({ error: "A school, an address and a provider are required." }, 400);
    }
    if (provider !== "imap_smtp") {
      return json(
        { error: "Microsoft 365 and Google connect a different way — that's coming soon. Use a generic IMAP/SMTP mailbox and an app password for now." },
        400,
      );
    }
    if (!imapHost || !smtpHost || !username || !password) {
      return json({ error: "The IMAP host, SMTP host, username and app password are all required." }, 400);
    }

    // As the caller — the same way pay-init asks payable_now() as the paying
    // user rather than trusting the client's own claim about its access.
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
    if (!isAdmin) return json({ error: "Only an owner or admin can connect a mailbox." }, 403);

    // Only past this point does anything privileged happen, and only with
    // the service role — create_ticket_mailbox is granted to nobody else.
    // The row and its vault secret are written in one function call, one
    // transaction: either both exist or neither does, so there is no
    // half-connected mailbox to clean up if the secret write fails.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "classroom" } },
    );

    const { data: mailbox, error: createError } = await admin.rpc("create_ticket_mailbox", {
      target_school: schoolId,
      label_in: label || "Support",
      address_in: address,
      display_name_in: displayName || null,
      provider_in: provider,
      imap_host_in: imapHost,
      imap_port_in: imapPort ? Number(imapPort) : 993,
      imap_security_in: imapSecurity || SECURITY_BY_PORT[Number(imapPort)] || "ssl",
      smtp_host_in: smtpHost,
      smtp_port_in: smtpPort ? Number(smtpPort) : 587,
      smtp_security_in: smtpSecurity || SECURITY_BY_PORT[Number(smtpPort)] || "starttls",
      username_in: username,
      password_in: password,
    });
    if (createError) return json({ error: createError.message }, 400);

    return json({
      id: mailbox.id,
      label: mailbox.label,
      address: mailbox.address,
      displayName: mailbox.display_name,
      provider: mailbox.provider,
      isActive: mailbox.is_active,
    });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not connect that mailbox." }, 500);
  }
});
