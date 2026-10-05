// Console → Mail (supabase/239). Platform administrators only.
//
//   vercel  { token, teamId? }  saves the Vercel token that manages
//           schoolivio.com's DNS (checked against the zone first, kept in Vault).
//   dns     { schoolId }        adds a schoolivio.com school's mail records to
//           the zone in one go: the school's DNS records as its own Resend lists
//           them (sending, and the receiving MX once receiving is on), each under
//           <slug>.schoolivio.com, then asks Resend to check them.
//   microsoft { clientId, secret? }  Tekktopia's Microsoft app, for schools
//           bringing Microsoft 365 mail across (supabase/240).
//
// One thing is done first, every time: the school's own web address is pinned.
// Tenant sites answer through the zone's catch-all (*.schoolivio.com), and a
// catch-all stops covering a name the moment any record exists at or below it
// (resend._domainkey.<slug>, send.<slug>, an MX at <slug>). Without an explicit
// address for <slug> itself, adding mail records would take the school's site
// offline. So <slug> gets records pointing exactly where it points now.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { records, resend, statuses, type ResendDomain } from "../_shared/mail/resend.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ZONE = "schoolivio.com";

interface VercelRecord {
  id: string;
  name: string;
  type: string;
  value: string;
  mxPriority?: number;
}

async function vercel<T>(token: string, team: string | null, path: string, init: { method?: string; body?: unknown } = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (team) url.searchParams.set("teamId", team);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const message = (data as { error?: { message?: string } } | null)?.error?.message ?? (res.ok ? null : text || res.statusText);
  return { ok: res.ok, status: res.status, data: data as T, message };
}

async function allRecords(token: string, team: string | null): Promise<VercelRecord[]> {
  const out: VercelRecord[] = [];
  let until: number | null = null;
  for (let page = 0; page < 50; page += 1) {
    type Page = { records?: VercelRecord[]; pagination?: { next: number | null } };
    const r: { ok: boolean; data: Page; message: string | null } = await vercel<Page>(
      token, team, `/v5/domains/${ZONE}/records?limit=100${until ? `&until=${until}` : ""}`);
    if (!r.ok) throw new Error(`Vercel did not list schoolivio.com's records: ${r.message}`);
    out.push(...(r.data.records ?? []));
    until = r.data.pagination?.next ?? null;
    if (!until) break;
  }
  return out;
}

// Where a name answers right now, asked of public DNS.
async function currentAddresses(host: string): Promise<string[]> {
  const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`);
  if (!res.ok) return [];
  const body = await res.json() as { Answer?: { type: number; data: string }[] };
  return (body.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
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
    if (!isAdmin) return json({ error: "Only a platform administrator can do this." }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "classroom" },
      auth: { persistSession: false },
    });
    const body = await req.json().catch(() => ({}));

    if (body.action === "vercel") {
      const token = String(body.token ?? "").trim();
      const team = String(body.teamId ?? "").trim() || null;
      if (token.length < 20) return json({ error: "Paste the whole Vercel token." }, 400);
      const check = await vercel(token, team, `/v5/domains/${ZONE}/records?limit=1`);
      if (!check.ok) {
        return json({ error: check.status === 403 || check.status === 404
          ? "That token cannot see schoolivio.com's DNS. Make it in the team that owns schoolivio.com, and give that team's ID."
          : `Vercel did not accept it: ${check.message}` }, 400);
      }
      const { error: e1 } = await admin.rpc("platform_set_secret", { which: "vercel", plaintext: token });
      if (e1) return json({ error: e1.message }, 500);
      const { error: e2 } = await admin.rpc("platform_set_vercel_team", { team_in: team ?? "" });
      if (e2) return json({ error: e2.message }, 500);
      return json({ ok: true });
    }

    // Tekktopia's Microsoft app, for schools bringing Microsoft 365 mail
    // across (supabase/240): its client id, and its secret in Vault.
    if (body.action === "microsoft") {
      const clientId = String(body.clientId ?? "").trim();
      const secret = String(body.secret ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "The application (client) ID looks like 00000000-0000-0000-0000-000000000000." }, 400);
      const { error: e1 } = await admin.rpc("platform_set_microsoft_client", { client_in: clientId });
      if (e1) return json({ error: e1.message }, 500);
      if (secret) {
        const { error: e2 } = await admin.rpc("platform_set_secret", { which: "microsoft", plaintext: secret });
        if (e2) return json({ error: e2.message }, 500);
      }
      return json({ ok: true });
    }

    if (body.action === "dns") {
      const schoolId = String(body.schoolId ?? "");
      const { data: token } = await admin.rpc("platform_get_secret", { which: "vercel" });
      if (!token) return json({ error: "Save the Vercel token first (Console → Mail)." }, 400);
      const { data: team } = await admin.rpc("platform_vercel_team");
      const { data: slug } = await admin.rpc("mail_school_slug", { target_school: schoolId });
      const { data: rows } = await admin.rpc("mail_settings_secrets", { target_school: schoolId });
      const s = ((rows as { domain: string | null; region: string | null; resend_domain_id: string | null; api_key: string | null }[] | null) ?? [])[0];
      if (!slug || !s?.domain || s.domain !== `${slug}.${ZONE}`) return json({ error: "This school does not use a schoolivio.com address." }, 400);
      if (!s.api_key || !s.resend_domain_id) return json({ error: "The school has not connected its Resend account yet." }, 400);

      // The records as the school's Resend lists them now.
      const got = await resend<ResendDomain>(s.api_key, `/domains/${s.resend_domain_id}`);
      if (!got.ok || !got.data) return json({ error: `The school's Resend did not answer: ${got.message}` }, 400);
      const wanted = records(got.data);

      const existing = await allRecords(String(token), team ? String(team) : null);
      const has = (name: string, type: string, value?: string) =>
        existing.some((r) => r.name === name && r.type === type && (value === undefined || r.value.replace(/^"|"$/g, "") === value));
      const comment = `Schoolivio Mail: ${slug}`;
      const create = async (rec: Record<string, unknown>) => {
        const r = await vercel<{ uid?: string }>(String(token), team ? String(team) : null, `/v2/domains/${ZONE}/records`, {
          method: "POST",
          body: { ttl: 60, comment, ...rec },
        });
        if (!r.ok && r.status !== 409) throw new Error(`Vercel refused ${rec.type} ${rec.name || "@"}: ${r.message}`);
        return r.ok;
      };

      // 1. Keep the school's site where it is.
      let pinned = 0;
      const siteHere = existing.some((r) => r.name === slug && ["A", "AAAA", "ALIAS", "CNAME"].includes(r.type));
      if (!siteHere) {
        const wildcard = existing.find((r) => r.name === "*" && ["ALIAS", "CNAME"].includes(r.type));
        if (wildcard) {
          // CNAME cannot sit beside MX; ALIAS can, and answers the same.
          if (await create({ name: slug, type: "ALIAS", value: wildcard.value })) pinned += 1;
        } else {
          const ips = await currentAddresses(`${slug}.${ZONE}`);
          if (!ips.length) return json({ error: `Could not tell where ${slug}.${ZONE} points, so nothing was changed.` }, 400);
          for (const ip of ips) if (await create({ name: slug, type: "A", value: ip })) pinned += 1;
        }
      }

      // 2. The mail records, under <slug>.
      let added = 0;
      for (const r of wanted) {
        const name = r.name ? `${r.name}.${slug}` : slug;
        if (has(name, r.type, r.value)) continue;
        const rec: Record<string, unknown> = { name, type: r.type, value: r.value };
        if (r.type === "MX") rec.mxPriority = r.priority ?? 10;
        if (await create(rec)) added += 1;
      }

      // 3. Ask Resend to look, and record where things stand.
      await resend(s.api_key, `/domains/${s.resend_domain_id}/verify`, { method: "POST" });
      const after = await resend<ResendDomain>(s.api_key, `/domains/${s.resend_domain_id}`);
      const d = after.ok && after.data ? after.data : got.data;
      const st = statuses(d);
      const { error: e1 } = await admin.rpc("mail_settings_save", {
        target_school: schoolId,
        domain_in: s.domain,
        region_in: s.region,
        resend_domain_id_in: s.resend_domain_id,
        domain_status_in: st.sending,
        dns_records_in: records(d),
        api_key_in: null,
        webhook_id_in: null,
        webhook_secret_in: null,
        last_error_in: null,
        actor: me.user.id,
      });
      if (e1) return json({ error: e1.message }, 500);
      await admin.rpc("mail_settings_receiving", { target_school: schoolId, enabled_in: st.receivingOn, status_in: st.receiving });
      await admin.rpc("mail_platform_dns_done", { target_school: schoolId });
      return json({ ok: true, added, pinned, status: st.sending });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    return json({ error: (err as Error).message || "Something went wrong." }, 500);
  }
});
