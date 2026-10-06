// Hands waiting outside mail to each school's own Resend (supabase/236).
// Called by mail_send the moment something is sent (for that message), and
// by the scheduler every minute when anything is due (retries, and mail
// that waited for the school to set up its domain). Shared cron secret only.
//
// Each sending goes as one email: its outside To, Cc and Bcc recipients
// together, from the sender's own address on the school's domain, with its
// attachments, importance and reply headers. Resend allows 50 per field, so
// anyone beyond that, and a sending with only Bcc recipients, goes to each
// person separately (nobody ever sees a Bcc). What happened is recorded per
// recipient by mail_outbound_result: sent, try again later, or failed with
// a note to the sender saying why.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resend } from "../_shared/mail/resend.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

interface Recipient {
  id: string;
  address: string;
  kind: "to" | "cc" | "bcc";
  /** The tiny picture's key when the sender asked to know of opens (supabase/241). */
  open_token?: string | null;
}
interface Claimed {
  message_id: string;
  school_id: string;
  from_address: string;
  from_name: string;
  subject: string;
  body_html: string;
  rfc_message_id: string;
  in_reply_to: string | null;
  importance: "low" | "normal" | "high";
  attempts: number;
  is_auto?: boolean;
  read_receipt?: boolean;
  recipients: Recipient[];
  attachments: { file_path: string; file_name: string; mime_type: string; size_bytes: number; content_id: string | null }[];
}
interface Secrets {
  domain: string | null;
  sending_enabled: boolean;
  api_key: string | null;
}
interface Unit {
  rows: Recipient[];
  to: string[];
  cc: string[];
  bcc: string[];
}

const PER_FIELD = 50;
// Resend takes 40 MB per email once attachments are base64-encoded.
const MAX_ATTACHMENTS = 28 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The emails one sending becomes.
function split(recipients: Recipient[]): Unit[] {
  const to = recipients.filter((r) => r.kind === "to");
  const cc = recipients.filter((r) => r.kind === "cc");
  const bcc = recipients.filter((r) => r.kind === "bcc");
  const units: Unit[] = [];
  let rest: Recipient[] = [];
  // Resend needs a To. Cc people stand in when there is no outside To.
  const main = to.length ? to : cc;
  const mainCc = to.length ? cc : [];
  if (main.length) {
    const t = main.slice(0, PER_FIELD);
    const c = mainCc.slice(0, PER_FIELD);
    const b = bcc.slice(0, PER_FIELD);
    units.push({ rows: [...t, ...c, ...b], to: t.map((r) => r.address), cc: c.map((r) => r.address), bcc: b.map((r) => r.address) });
    rest = [...main.slice(PER_FIELD), ...mainCc.slice(PER_FIELD), ...bcc.slice(PER_FIELD)];
  } else {
    rest = bcc;
  }
  rest.forEach((r) => units.push({ rows: [r], to: [r.address], cc: [], bcc: [] }));
  return units;
}

// data: pictures in the body as inline attachments (cid:).
function inlinePictures(html: string) {
  const files: Record<string, string>[] = [];
  let bytes = 0;
  const out = html.replace(/src=(["'])data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\1/gi, (_all, q, type, data) => {
    const id = `img${files.length + 1}.${crypto.randomUUID().slice(0, 8)}@schoolivio`;
    const clean = String(data).replace(/\s+/g, "");
    bytes += Math.floor(clean.length * 0.75);
    files.push({ filename: `picture${files.length + 1}.${String(type).split("/")[1].replace("jpeg", "jpg").replace("+xml", "")}`, content: clean, content_type: type, content_id: id });
    return `src=${q}cid:${id}${q}`;
  });
  return { html: out, files, bytes };
}

// The "opened" picture: one transparent pixel, last in the message.
function withPicture(html: string, token: string | null) {
  if (!token) return html;
  const img = `<img src="${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-open?t=${token}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : `${html}${img}`;
}

// Always quoted, so a name like "Admissions: Head" or "St. Mary's" never
// breaks the From line.
const quoteName = (name: string) => `"${name.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// The same recipients of the same message always get the same key, so a
// unit Resend took before a run was cut short is not sent again.
async function unitKey(messageId: string, ids: string[]) {
  const bytes = new TextEncoder().encode([...ids].sort().join(","));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `mail-${messageId}-${hash}`;
}

// Midnight UTC, when a Resend plan's daily allowance starts again.
const nextUtcMidnight = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5)).toISOString();
};
// Edge functions stop after a few minutes; stop well before.
const HARD_STOP_MS = 110000;

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("TICKET_MAIL_CRON_SECRET");
  if (!cronSecret) return json({ error: "Not configured" }, 500);
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", cronSecret)) return json({ error: "Not authorized" }, 401);

  const { message_id: only } = await req.json().catch(() => ({ message_id: null }));
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "classroom" },
  });

  const secrets = new Map<string, Secrets | null>();
  const lastCall = new Map<string, number>();
  const started = Date.now();
  let sent = 0;
  let failed = 0;

  const record = async (rows: Recipient[], ok: boolean, providerId: string | null, error: string | null, permanent: boolean) => {
    const { error: e } = await admin.rpc("mail_outbound_result", {
      recipient_ids: rows.map((r) => r.id),
      ok,
      provider_id_in: providerId,
      error_in: error,
      permanent,
    });
    if (e) console.error("mail_outbound_result", e.message);
  };

  // Up to 45 seconds of work per call; whatever is left waits for the next minute.
  while (Date.now() - started < 45000) {
    const { data, error } = await admin.rpc("mail_outbound_claim", { max_messages: 20, only_message: only ?? null });
    if (error) return json({ error: error.message }, 500);
    const batch = (data ?? []) as Claimed[];
    if (!batch.length) break;

    for (const m of batch) {
      if (Date.now() - started > HARD_STOP_MS) {
        await admin.rpc("mail_outbound_release", { recipient_ids: m.recipients.map((r) => r.id), retry_at: null, detail_in: null });
        continue;
      }
      if (!secrets.has(m.school_id)) {
        const { data: s } = await admin.rpc("mail_settings_secrets", { target_school: m.school_id });
        secrets.set(m.school_id, ((s as Secrets[] | null) ?? [])[0] ?? null);
      }
      const s = secrets.get(m.school_id);
      if (!s?.sending_enabled || !s.api_key || !s.domain) {
        await record(m.recipients, false, null, "The school's outside mail is not set up yet.", false);
        continue;
      }
      if (m.from_address.split("@")[1] !== s.domain) {
        await record(m.recipients, false, null,
          `Your address ${m.from_address} is not on ${s.domain}, the domain the school sends outside mail from. Ask your school admin to move your address (School admin → Mail settings), then send it again.`,
          true);
        failed += m.recipients.length;
        continue;
      }
      // Pictures inside the body (data: URIs, supabase/241) travel as inline
      // attachments the recipient's mail app shows in place (cid:).
      const inline = inlinePictures(m.body_html || "");
      const total = m.attachments.reduce((n, a) => n + Number(a.size_bytes || 0), 0) + inline.bytes;
      if (total > MAX_ATTACHMENTS) {
        await record(m.recipients, false, null,
          "Its attachments are too large for outside mail (about 28 MB in total at most). Send fewer or smaller files, or share a link instead.", true);
        failed += m.recipients.length;
        continue;
      }

      // Attachments are fetched by Resend from short-lived private links.
      const attachments: Record<string, string>[] = [];
      let linkError: string | null = null;
      for (const a of m.attachments) {
        const { data: link, error: le } = await admin.storage.from("mail").createSignedUrl(a.file_path, 3600);
        if (le || !link?.signedUrl) {
          linkError = `Could not attach ${a.file_name}.`;
          break;
        }
        const item: Record<string, string> = { filename: a.file_name, path: link.signedUrl, content_type: a.mime_type };
        if (a.content_id) item.content_id = a.content_id;
        attachments.push(item);
      }
      if (linkError) {
        await record(m.recipients, false, null, linkError, false);
        continue;
      }

      attachments.push(...inline.files);
      const headers: Record<string, string> = { "X-Schoolivio-Message": m.rfc_message_id };
      // An out-of-office reply says so, so other systems never answer it.
      if (m.is_auto) headers["Auto-Submitted"] = "auto-replied";
      // "Request a read receipt": the recipient's mail app may offer to send one.
      if (m.read_receipt) headers["Disposition-Notification-To"] = m.from_address;
      if (m.in_reply_to) {
        headers["In-Reply-To"] = m.in_reply_to;
        headers["References"] = m.in_reply_to;
      }
      if (m.importance === "high") Object.assign(headers, { "X-Priority": "1", Importance: "high" });
      if (m.importance === "low") Object.assign(headers, { "X-Priority": "5", Importance: "low" });

      const units = split(m.recipients);
      for (let i = 0; i < units.length; i += 1) {
        const u = units[i];
        // Out of time: the rest go back in the queue untouched, for the next run.
        if (Date.now() - started > HARD_STOP_MS) {
          const rest = units.slice(i).flatMap((x) => x.rows.map((r) => r.id));
          await admin.rpc("mail_outbound_release", { recipient_ids: rest, retry_at: null, detail_in: null });
          break;
        }
        // Several recipients in one email share one "opened" token, so an open
        // is never credited to whoever happened to be first.
        let token = u.rows.find((r) => r.open_token)?.open_token ?? null;
        if (token && u.rows.length > 1) {
          const { data: shared } = await admin.rpc("mail_outbound_share_token", { recipient_ids: u.rows.map((r) => r.id) });
          token = (shared as string | null) ?? token;
        }
        // Resend allows about two calls a second per account.
        const wait = 600 - (Date.now() - (lastCall.get(m.school_id) ?? 0));
        if (wait > 0) await sleep(wait);
        lastCall.set(m.school_id, Date.now());

        const payload: Record<string, unknown> = {
          from: m.from_name ? `${quoteName(m.from_name)} <${m.from_address}>` : m.from_address,
          to: u.to,
          subject: m.subject || "(no subject)",
          html: withPicture(inline.html || "<p></p>", token),
          headers,
          tags: [{ name: "schoolivio_message", value: m.message_id }],
        };
        if (u.cc.length) payload.cc = u.cc;
        if (u.bcc.length) payload.bcc = u.bcc;
        if (attachments.length) payload.attachments = attachments;

        const r = await resend<{ id: string }>(s.api_key, "/emails", {
          method: "POST",
          body: payload,
          idempotencyKey: await unitKey(m.message_id, u.rows.map((r) => r.id)),
        });
        if (r.ok && r.data?.id) {
          await record(u.rows, true, r.data.id, null, false);
          sent += u.rows.length;
          continue;
        }
        // The same key with a different body (fresh attachment links on a
        // retry): Resend already took this email under that key.
        if (r.status === 409 && /idempot/i.test(`${r.code ?? ""} ${r.message ?? ""}`)) {
          await record(u.rows, true, null, null, false);
          sent += u.rows.length;
          continue;
        }
        // Today's allowance on the school's Resend plan is used up: back in
        // the queue for just after midnight UTC, not counted as a failed try.
        if (r.code === "daily_quota_exceeded") {
          await admin.rpc("mail_outbound_release", {
            recipient_ids: u.rows.map((r2) => r2.id),
            retry_at: nextUtcMidnight(),
            detail_in: "The school has reached today's sending limit on its Resend plan. It goes again after midnight (UTC).",
          });
          continue;
        }
        // Try again later: too many at once, today's limit, Resend down, or
        // a key the admin can still fix. Anything else Resend turned down
        // for good (a bad address, an unverified domain).
        const transient = r.status === 0 || r.status === 429 || r.status >= 500 || r.code === "invalid_api_key" ||
          r.code === "restricted_api_key" || r.code === "missing_api_key" || r.status === 401;
        const reason = r.code === "daily_quota_exceeded"
          ? "The school has reached today's sending limit on its Resend plan. It will go again later."
          : r.message || "The mail service refused it.";
        await record(u.rows, false, null, reason, !transient);
        if (!transient) failed += u.rows.length;
      }
    }
    if (only) break;
  }

  return json({ sent, failed });
});
