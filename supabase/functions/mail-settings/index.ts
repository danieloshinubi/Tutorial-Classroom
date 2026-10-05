// School admin → Mail settings (supabase/236). Connects the school's own
// Resend account so mail to outside addresses goes out from the school's
// own domain. Same boundary as payment-gateway-connect: the caller is
// checked as a school admin with their own token, and only then does the
// service role write the settings and put the key in Vault. The key is
// never sent back.
//
//   connect     { schoolId, domain, apiKey?, region? }  checks the key, adds
//               the domain to the school's Resend (or finds it there), reads
//               the DNS records to add, and turns on delivery reports.
//               apiKey may be left out to keep the saved one.
//   verify      { schoolId }  asks Resend to check the DNS records now.
//   refresh     { schoolId }  reads where Resend's own check has got to.
//   receiving   { schoolId, enable }  turns receiving outside mail on or off
//               for the domain (supabase/238).
//   disconnect  { schoolId }  forgets the key; outside mail stops.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { keyProblem, records, REPORT_EVENTS, resend, statuses, type ResendDomain } from "../_shared/mail/resend.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const REGIONS = ["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"];

interface Secrets {
  domain: string | null;
  region: string | null;
  resend_domain_id: string | null;
  domain_status: string | null;
  sending_enabled: boolean;
  webhook_id: string | null;
  api_key: string | null;
  webhook_secret: string | null;
}

// Delivery reports: a webhook in the school's Resend pointing at
// mail-resend-webhook for this school. Any earlier one to the same address
// is removed first so reports never arrive twice.
async function turnOnReports(key: string, schoolId: string, oldId: string | null) {
  const endpoint = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-resend-webhook?school=${schoolId}`;
  const existing = await resend<{ data?: { id: string; endpoint: string }[] }>(key, "/webhooks");
  const stale = new Set<string>(oldId ? [oldId] : []);
  (existing.data?.data ?? []).forEach((w) => w.endpoint === endpoint && stale.add(w.id));
  for (const id of stale) await resend(key, `/webhooks/${id}`, { method: "DELETE" });

  let made = await resend<{ id: string; signing_secret: string }>(key, "/webhooks", {
    method: "POST",
    body: { endpoint, events: REPORT_EVENTS },
  });
  if (!made.ok && made.status === 422) {
    made = await resend<{ id: string; signing_secret: string }>(key, "/webhooks", {
      method: "POST",
      body: { endpoint, events: REPORT_EVENTS.filter((e) => e !== "email.suppressed") },
    });
  }
  if (!made.ok || !made.data?.id || !made.data?.signing_secret) {
    return { id: null, secret: null, error: `Mail will send, but delivery reports could not be switched on: ${made.message || "Resend refused"}.` };
  }
  return { id: made.data.id, secret: made.data.signing_secret, error: null };
}

// Waiting outside mail goes as soon as the domain is verified.
const kickOutbound = () =>
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-outbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": Deno.env.get("TICKET_MAIL_CRON_SECRET") ?? "" },
    body: "{}",
  }).catch(() => null);

// deno-lint-ignore no-explicit-any
async function secretsFor(admin: any, schoolId: string): Promise<Secrets | null> {
  const { data, error } = await admin.rpc("mail_settings_secrets", { target_school: schoolId });
  if (error) throw new Error(error.message);
  return ((data as Secrets[] | null) ?? [])[0] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sign in first." }, 401);
    const body = await req.json().catch(() => ({}));
    const { action, schoolId } = body as { action?: string; schoolId?: string };
    if (!schoolId || !action) return json({ error: "A school and an action are required." }, 400);

    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      db: { schema: "classroom" },
      global: { headers: { Authorization: authorization } },
    });
    const { data: authUser } = await caller.auth.getUser();
    if (!authUser?.user) return json({ error: "Sign in first." }, 401);
    const { data: isAdmin, error: checkError } = await caller.rpc("is_school_admin", { target_school: schoolId });
    if (checkError) return json({ error: checkError.message }, 400);
    if (!isAdmin) return json({ error: "Only a school admin can change the school's mail settings." }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "classroom" },
    });
    const current = await secretsFor(admin, schoolId);

    const save = async (fields: {
      domain: string | null;
      region: string | null;
      domainId: string | null;
      status: string;
      records: unknown[];
      apiKey?: string | null;
      webhookId?: string | null;
      webhookSecret?: string | null;
      error?: string | null;
    }) => {
      const { error } = await admin.rpc("mail_settings_save", {
        target_school: schoolId,
        domain_in: fields.domain,
        region_in: fields.region,
        resend_domain_id_in: fields.domainId,
        domain_status_in: fields.status,
        dns_records_in: fields.records,
        api_key_in: fields.apiKey ?? null,
        webhook_id_in: fields.webhookId ?? null,
        webhook_secret_in: fields.webhookSecret ?? null,
        last_error_in: fields.error ?? null,
        actor: authUser.user.id,
      });
      if (error) throw new Error(error.message);
    };
    const saveReceiving = async (d: ResendDomain | null) => {
      const st = statuses(d);
      const { error } = await admin.rpc("mail_settings_receiving", { target_school: schoolId, enabled_in: st.receivingOn, status_in: st.receiving });
      if (error) throw new Error(error.message);
    };

    // Receiving on or off (supabase/238): the domain's receiving switch in
    // the school's Resend, and the webhook made again so it also carries
    // received mail ("email.received").
    if (action === "receiving") {
      if (!current?.api_key || !current.resend_domain_id) return json({ error: "Connect the school's Resend account first." }, 400);
      const enable = body.enable !== false;
      const patched = await resend(current.api_key, `/domains/${current.resend_domain_id}`, {
        method: "PATCH",
        body: { capabilities: { sending: "enabled", receiving: enable ? "enabled" : "disabled" } },
      });
      if (!patched.ok) {
        return json({ error: patched.status === 401 || patched.status === 403 ? keyProblem(patched) : `Resend could not change receiving: ${patched.message || "unknown error"}` }, 400);
      }
      const reports = enable ? await turnOnReports(current.api_key, schoolId, current.webhook_id) : { id: null, secret: null, error: null };
      const full = await resend<ResendDomain>(current.api_key, `/domains/${current.resend_domain_id}`);
      const d = full.ok && full.data ? full.data : null;
      await save({
        domain: current.domain,
        region: current.region,
        domainId: current.resend_domain_id,
        status: d ? statuses(d).sending : current.domain_status ?? "not_started",
        records: d ? records(d) : [],
        webhookId: reports.id,
        webhookSecret: reports.secret,
        error: reports.error,
      });
      // Resend may take a moment to show the switch; what was asked for is recorded.
      const st = d ? statuses(d) : { receiving: "not_started" };
      const { error } = await admin.rpc("mail_settings_receiving", { target_school: schoolId, enabled_in: enable, status_in: st.receiving });
      if (error) throw new Error(error.message);
      return json({ ok: true, warning: reports.error });
    }

    if (action === "disconnect") {
      if (current?.api_key && current.webhook_id) {
        await resend(current.api_key, `/webhooks/${current.webhook_id}`, { method: "DELETE" });
      }
      const { error } = await admin.rpc("mail_settings_clear", { target_school: schoolId });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "connect") {
      const domain = String(body.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const region = REGIONS.includes(body.region) ? body.region : current?.region ?? "us-east-1";
      const pasted = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const key = pasted || current?.api_key || "";
      if (!DOMAIN.test(domain)) return json({ error: "Enter the school's domain, like charismartinschools.org." }, 400);
      // A school with no domain of its own uses its own <slug>.schoolivio.com
      // (supabase/239), whose records Schoolivio adds; no other schoolivio.com name.
      const { data: mine } = await caller.rpc("mail_settings_get", { target_school: schoolId });
      const fallback = (mine as { fallback_domain?: string } | null)?.fallback_domain ?? "";
      if ((domain === "schoolivio.com" || domain.endsWith(".schoolivio.com")) && domain !== fallback) {
        return json({ error: `Of schoolivio.com, this school can use ${fallback} only.` }, 400);
      }
      if (!key) return json({ error: "Paste the school's Resend API key." }, 400);
      if (pasted && !pasted.startsWith("re_")) return json({ error: "A Resend API key starts with re_. Copy it again from Resend." }, 400);

      // The key must be able to manage domains, not only send.
      const list = await resend<{ data?: ResendDomain[] }>(key, "/domains");
      if (!list.ok) return json({ error: keyProblem(list) }, 400);

      let found = (list.data?.data ?? []).find((d) => d.name === domain) ?? null;
      if (!found) {
        const made = await resend<ResendDomain>(key, "/domains", { method: "POST", body: { name: domain, region } });
        if (!made.ok || !made.data) {
          return json({ error: `Resend could not add ${domain}: ${made.message || "unknown error"}` }, 400);
        }
        found = made.data;
      }
      const full = await resend<ResendDomain>(key, `/domains/${found.id}`);
      const d = full.ok && full.data ? full.data : found;

      const keyChanged = !!pasted && pasted !== current?.api_key;
      const reports = keyChanged || !current?.webhook_id
        ? await turnOnReports(key, schoolId, current?.webhook_id ?? null)
        : { id: null, secret: null, error: null };

      await save({
        domain,
        region: d.region ?? region,
        domainId: d.id,
        status: statuses(d).sending,
        records: records(d),
        apiKey: pasted || null,
        webhookId: reports.id,
        webhookSecret: reports.secret,
        error: reports.error,
      });
      await saveReceiving(d);
      if (statuses(d).sending === "verified") await kickOutbound();
      return json({ ok: true, status: statuses(d).sending, warning: reports.error });
    }

    if (action === "verify" || action === "refresh") {
      if (!current?.api_key || !current.resend_domain_id) return json({ error: "Connect the school's Resend account first." }, 400);
      if (action === "verify") {
        const asked = await resend(current.api_key, `/domains/${current.resend_domain_id}/verify`, { method: "POST" });
        if (!asked.ok) return json({ error: asked.status === 401 || asked.status === 403 ? keyProblem(asked) : asked.message || "Resend could not check it." }, 400);
      }
      const full = await resend<ResendDomain>(current.api_key, `/domains/${current.resend_domain_id}`);
      if (!full.ok || !full.data) return json({ error: full.status === 401 || full.status === 403 ? keyProblem(full) : full.message || "Resend could not be reached." }, 400);
      const d = full.data;
      await save({
        domain: current.domain,
        region: current.region,
        domainId: current.resend_domain_id,
        status: statuses(d).sending,
        records: records(d),
      });
      await saveReceiving(d);
      if (statuses(d).sending === "verified" && !current.sending_enabled) await kickOutbound();
      return json({ ok: true, status: statuses(d).sending });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message || "Could not save the mail settings." }, 500);
  }
});
