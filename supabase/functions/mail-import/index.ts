// Importing old mail (supabase/240).
//
// From the browser (signed in; the mailbox's owner or a school admin):
//   start_imap  { mailboxId, host, port, security, username, password, since?, label? }
//               checks the login works before anything is saved.
//   start_files { mailboxId, kind: "mbox" | "eml", paths, sizes, folder?, label }
//               the files are already in the "mail-imports" bucket.
//               kind "pst": an Outlook .pst read in the browser
//               (tools/pst-worker); its mail follows in mbox parts:
//   append_part { importId, path, size }   one more part uploaded.
//   finish_parts { importId }              the whole file has been read.
//   microsoft_consent { schoolId, returnTo }  (school admin) the Microsoft 365
//               approval link; Microsoft sends the admin back to this
//               function (GET), which records the school's tenant.
//   microsoft_start { schoolId, mailboxIds? }  (school admin) an import for
//               every listed mailbox (all staff when left out).
// From the scheduler (shared cron secret):
//   work        one short turn of the next import that is due, then hands on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { MailboxFull, type Job, tally } from "./pipeline.ts";
import { imapClient, microsoftToken, runFiles, runImap, runMicrosoft } from "./sources.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SELF = `${URL_BASE}/functions/v1/mail-import`;
const CRON = Deno.env.get("TICKET_MAIL_CRON_SECRET") ?? "";

const sameSecret = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const admin = () => createClient(URL_BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "classroom" }, auth: { persistSession: false } });

// The approval link's state: who asked, for which school, where to go back,
// signed so it cannot be made up.
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(CRON), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))));
}
const allowedReturn = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && (url.hostname === "schoolivio.com" || url.hostname.endsWith(".schoolivio.com")) ||
      url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
};

// Another turn straight away, after this response.
function handOn() {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  const p = fetch(SELF, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": CRON }, body: '{"action":"work"}' }).catch(() => null);
  runtime?.waitUntil?.(p);
}

async function work() {
  const db = admin();
  const { data: claimed, error } = await db.rpc("mail_import_claim");
  if (error) throw new Error(error.message);
  if (!claimed) return { idle: true };
  const job = claimed as Job;
  const t = tally();
  // A short turn: about 30 seconds and 30 messages, well inside the limits.
  const budget = { deadline: Date.now() + 30000, messages: 30 };
  let status: string | null = "running";
  let err: string | null = null;
  let cursor: Record<string, unknown> | null = null;
  let remove: string[] = [];
  try {
    let turn;
    if (job.source === "imap") turn = await runImap(db, job, t, budget);
    else if (job.source === "mbox" || job.source === "eml") turn = await runFiles(db, job, t, budget);
    else {
      const { data: ms } = await db.rpc("platform_microsoft");
      const { data: secret } = await db.rpc("platform_get_secret", { which: "microsoft" });
      const { data: tenant } = await db.rpc("mail_microsoft_tenant", { target_school: job.school_id });
      if (!ms?.client_id || !secret) throw new Error("Schoolivio's Microsoft 365 connection is not set up.");
      if (!tenant) throw new Error("The school has not approved Microsoft 365 yet.");
      turn = await runMicrosoft(db, job, t, budget, await microsoftToken(String(tenant), ms.client_id, String(secret)));
    }
    cursor = { ...turn.cursor, errors: 0 };
    remove = turn.remove ?? [];
    if (turn.done) status = "done";
  } catch (e) {
    err = (e as Error).message || "The import stopped.";
    // A login that no longer works, or a full mailbox, stops it. Anything
    // else (a server not answering) is tried again, up to ten turns running.
    const errors = Number(job.cursor.errors ?? 0) + 1;
    cursor = { ...job.cursor, errors };
    const fatal = e instanceof MailboxFull || errors >= 10 ||
      /mailbox is full|password|authenticat|login|credentials|not set up|not approved|no microsoft 365 account|invalid_client|AUTHENTICATIONFAILED/i.test(err);
    status = fatal ? "failed" : "running";
  }
  const { error: saved } = await db.rpc("mail_import_progress", { target_import: job.id, cursor_in: cursor, status_in: status, add: t, error_in: err });
  if (!saved && remove.length) await db.storage.from("mail-imports").remove(remove).catch(() => null);
  return { id: job.id, status, ...t };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  // Microsoft sends the school's admin back here after the approval screen.
  if (req.method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    const [payload, sig] = state.split(".");
    let back = "https://schoolivio.com";
    try {
      if (!CRON || !payload || !sig || sig !== (await sign(payload))) throw new Error("bad state");
      const s = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { s: string; u?: string; r: string; t: number };
      if (allowedReturn(s.r)) back = s.r;
      if (Date.now() - s.t > 60 * 60 * 1000) throw new Error("This approval link has expired. Start it again from Mail settings.");
      const tenant = url.searchParams.get("tenant") ?? "";
      const ok = url.searchParams.get("admin_consent")?.toLowerCase() === "true" && /^[0-9a-f-]{36}$|^[a-z0-9.-]+$/i.test(tenant);
      if (!ok) throw new Error(url.searchParams.get("error_description") || "Microsoft 365 was not approved.");
      // The tenant in the address could have been changed by hand: it must be
      // the Microsoft 365 organisation that owns the school's own domain.
      const db = admin();
      const { data: ms } = await db.rpc("platform_microsoft");
      const { data: secret } = await db.rpc("platform_get_secret", { which: "microsoft" });
      const { data: st } = await db.rpc("mail_settings_secrets", { target_school: s.s });
      const domain = String(((st as { domain?: string }[] | null) ?? [])[0]?.domain ?? "").toLowerCase();
      if (!domain) throw new Error("Add the school's own domain under Mail settings first.");
      // A fresh approval can take a few seconds to work: tried a few times.
      let owns = false;
      for (let attempt = 0; attempt < 4 && !owns; attempt += 1) {
        if (attempt) await new Promise((r) => setTimeout(r, 3000));
        try {
          const token = await microsoftToken(tenant, ms.client_id, String(secret));
          // (User.Read.All, which the import already has: someone there has an address on it.)
          const found = await fetch(
            `https://graph.microsoft.com/v1.0/users?$count=true&$top=1&$select=id&$filter=${encodeURIComponent(`endswith(mail,'@${domain.replace(/'/g, "''")}')`)}`,
            { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } },
          );
          const users = ((await found.json().catch(() => ({})))?.value ?? []) as unknown[];
          owns = found.ok && users.length > 0;
        } catch {
          owns = false;
        }
      }
      if (!owns) throw new Error(`That Microsoft 365 organisation does not own ${domain}. Sign in with the school's own Microsoft 365 admin account.`);
      const { error } = await db.rpc("mail_set_microsoft_tenant", { target_school: s.s, tenant_in: tenant, actor: s.u ?? null });
      if (error) throw new Error(error.message);
      const to = new URL(back);
      to.searchParams.set("microsoft", "ok");
      return Response.redirect(to.toString(), 302);
    } catch (e) {
      const to = new URL(back);
      to.searchParams.set("microsoft", "error");
      to.searchParams.set("reason", ((e as Error).message || "").slice(0, 200));
      return Response.redirect(to.toString(), 302);
    }
  }

  const body = await req.json().catch(() => ({}));

  if (body.action === "work") {
    if (!CRON || !sameSecret(req.headers.get("x-cron-secret") ?? "", CRON)) return json({ error: "Not authorized" }, 401);
    try {
      const r = await work();
      // Straight on to the next turn while there is work; a .pst waiting for
      // its next part is looked at again when the part arrives (or by the scheduler).
      if (!("idle" in r) && (r.found > 0 || r.status !== "running")) handOn();
      return json(r);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  // Everything else is a signed-in person.
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization) return json({ error: "Sign in first." }, 401);
  const caller = createClient(URL_BASE, Deno.env.get("SUPABASE_ANON_KEY")!, {
    db: { schema: "classroom" },
    global: { headers: { Authorization: authorization } },
  });
  const { data: me } = await caller.auth.getUser();
  if (!me?.user) return json({ error: "Sign in first." }, 401);
  const db = admin();

  try {
    if (body.action === "start_imap" || body.action === "start_files") {
      const mailboxId = String(body.mailboxId ?? "");
      const { data: may } = await caller.rpc("mail_can_import", { target_mailbox: mailboxId });
      if (!may) return json({ error: "You can only import into your own mailbox." }, 403);

      let fields: Record<string, unknown>;
      let password: string | null = null;
      if (body.action === "start_imap") {
        const host = String(body.host ?? "").trim().toLowerCase();
        const username = String(body.username ?? "").trim();
        password = String(body.password ?? "");
        const security = ["ssl", "starttls", "none"].includes(body.security) ? body.security : "ssl";
        const port = Number(body.port) || (security === "ssl" ? 993 : 143);
        if (!host || !username || !password) return json({ error: "Enter the server, the username and the password." }, 400);
        // The login is tried now, so a wrong password shows up straight away.
        try {
          const c = await imapClient({ imap_host: host, imap_port: port, imap_security: security, imap_username: username, password });
          await c.logout().catch(() => null);
        } catch (e) {
          return json({ error: `Could not sign in to ${host}: ${(e as Error).message || "check the details"}. For Gmail, use an app password; IMAP must be turned on.` }, 400);
        }
        fields = { source: "imap", label: String(body.label || `${username}`), imap_host: host, imap_port: port, imap_security: security, imap_username: username, since: body.since || null };
      } else if (body.kind === "pst") {
        // An Outlook .pst read in the browser: parts follow (append_part), then finish_parts.
        fields = { source: "mbox", label: String(body.label || "Outlook data file (.pst)"), file_paths: [], cursor: { sizes: [], g: 0, open: true, appended_at: new Date().toISOString() } };
      } else {
        const kind = body.kind === "eml" ? "eml" : "mbox";
        const paths = (Array.isArray(body.paths) ? body.paths : []).map(String);
        const sizes = (Array.isArray(body.sizes) ? body.sizes : []).map(Number);
        if (!paths.length) return json({ error: "Upload the files first." }, 400);
        if (paths.some((p: string) => !p.startsWith(`${mailboxId}/`))) return json({ error: "Those files are not in your upload area." }, 400);
        if (kind === "mbox" && sizes.length !== paths.length) return json({ error: "The upload is incomplete. Try again." }, 400);
        fields = {
          source: kind, label: String(body.label || (kind === "mbox" ? "MBOX file" : `${paths.length} EML file${paths.length === 1 ? "" : "s"}`)),
          file_paths: paths, target_folder: ["inbox", "sent", "archive"].includes(body.folder) ? body.folder : null,
          cursor: kind === "mbox" ? { sizes, g: 0 } : { i: 0 },
        };
      }
      const { data: imp, error } = await db.rpc("mail_import_create", { target_mailbox: mailboxId, actor: me.user.id, fields, password_in: password });
      if (error) return json({ error: error.message }, 400);
      handOn();
      return json({ ok: true, id: (imp as { id: string }).id });
    }

    // A .pst being read in the browser: one more part uploaded, or the file finished.
    if (body.action === "append_part" || body.action === "finish_parts") {
      const importId = String(body.importId ?? "");
      const { error } = body.action === "append_part"
        ? await caller.rpc("mail_import_append", { target_import: importId, path_in: String(body.path ?? ""), size_in: Number(body.size) || 0 })
        : await caller.rpc("mail_import_finish", { target_import: importId });
      if (error) return json({ error: error.message }, 400);
      handOn();
      return json({ ok: true });
    }

    if (body.action === "microsoft_consent" || body.action === "microsoft_start") {
      const schoolId = String(body.schoolId ?? "");
      const { data: isAdmin } = await caller.rpc("is_school_admin", { target_school: schoolId });
      if (!isAdmin) return json({ error: "Only a school admin can connect Microsoft 365." }, 403);
      const { data: ms } = await db.rpc("platform_microsoft");
      if (!ms?.ready) return json({ error: "Schoolivio's Microsoft 365 connection is not set up yet. Please contact Schoolivio support." }, 400);

      if (body.action === "microsoft_consent") {
        const returnTo = String(body.returnTo ?? "");
        if (!allowedReturn(returnTo)) return json({ error: "Unknown return address." }, 400);
        const payload = b64url(new TextEncoder().encode(JSON.stringify({ s: schoolId, u: me.user.id, r: returnTo, t: Date.now() })));
        const state = `${payload}.${await sign(payload)}`;
        const link = new URL("https://login.microsoftonline.com/organizations/v2.0/adminconsent");
        link.searchParams.set("client_id", ms.client_id);
        link.searchParams.set("scope", "https://graph.microsoft.com/.default");
        link.searchParams.set("redirect_uri", SELF);
        link.searchParams.set("state", state);
        return json({ ok: true, url: link.toString() });
      }

      const { data: tenant } = await db.rpc("mail_microsoft_tenant", { target_school: schoolId });
      if (!tenant) return json({ error: "Approve Microsoft 365 first." }, 400);
      const { data: people } = await caller.rpc("mail_admin_people", { target_school: schoolId });
      const wanted = new Set((Array.isArray(body.mailboxIds) ? body.mailboxIds : []).map(String));
      let started = 0;
      const problems: string[] = [];
      for (const p of (people ?? []) as { mailbox_id: string | null; address: string | null; name: string }[]) {
        if (!p.mailbox_id || !p.address || (wanted.size && !wanted.has(p.mailbox_id))) continue;
        const { error } = await db.rpc("mail_import_create", {
          target_mailbox: p.mailbox_id, actor: me.user.id,
          fields: { source: "microsoft", label: `Microsoft 365 (${p.address})`, source_user: p.address },
        });
        if (error) problems.push(`${p.name}: ${error.message}`);
        else started += 1;
      }
      if (started) handOn();
      return json({ ok: true, started, problems });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong." }, 500);
  }
});
