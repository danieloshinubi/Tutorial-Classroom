// Received outside mail (supabase/238). Resend's "email.received" report
// carries only who and what; the message itself, its headers and its files
// are fetched from the school's Resend, the files put in the private "mail"
// bucket, and mail_receive puts a copy in each recipient's Inbox (or Junk).
//
// Addresses at the school with no mailbox, or with a full one, are told to
// the sender in a short "not delivered" reply, but only when the sender
// passed SPF or DKIM (so a forged sender never gets mail from the school)
// and the message was not itself automatic (no replies to robots).

import { resend } from "../_shared/mail/resend.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

interface Received {
  id: string;
  from: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  received_for?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string | string[]>;
  message_id?: string;
  created_at?: string;
  authentication?: Record<string, unknown>;
}
interface ReceivedFile {
  id: string;
  filename?: string;
  size?: number;
  content_type?: string;
  content_disposition?: string | null;
  content_id?: string | null;
  download_url?: string;
}
interface Target {
  address: string;
  mailbox_id: string | null;
  outcome: "ok" | "unknown" | "full";
}

const MAX_FILE = 25 * 1024 * 1024;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Ada Obi <ada@x.com>" → { name: "Ada Obi", address: "ada@x.com" }. */
export function parseAddress(raw: string): { name: string; address: string } {
  const m = String(raw ?? "").match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() };
  return { name: "", address: String(raw ?? "").trim().toLowerCase() };
}

const headerMap = (h: Received["headers"]) => {
  const out: Record<string, string> = {};
  Object.entries(h ?? {}).forEach(([k, v]) => (out[k.toLowerCase()] = Array.isArray(v) ? v.join(" ") : String(v ?? "")));
  return out;
};

// SPF / DKIM / DMARC results as Resend gives them: "pass", or { result: "pass" }.
const result = (auth: Received["authentication"], key: string) => {
  const v = auth?.[key] as unknown;
  if (typeof v === "string") return v.toLowerCase();
  if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>).result).toLowerCase();
  return "";
};

const safeName = (name: string) => (name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 120);

export async function receive(admin: AdminClient, school: string, key: string, domain: string | null, sendingOn: boolean, emailId: string) {
  const { data: seen } = await admin.rpc("mail_inbound_seen", { target_school: school, inbound_id_in: emailId });
  if (seen) return { delivered: 0, duplicate: true };

  const got = await resend<Received>(key, `/emails/receiving/${emailId}?html_format=data_uri`);
  if (!got.ok || !got.data) throw new Error(`Could not fetch the received email: ${got.message}`);
  const e = got.data;
  const headers = headerMap(e.headers);
  const from = parseAddress(e.from);

  const files: ReceivedFile[] = [];
  const list = await resend<{ data?: ReceivedFile[] }>(key, `/emails/receiving/${emailId}/attachments?limit=100`);
  // Pictures inside the message are already in its body (data_uri); the rest are attachments.
  (list.data?.data ?? []).forEach((f) => !(f.content_disposition === "inline" && f.content_id) && files.push(f));

  const html = e.html?.trim()
    ? e.html
    : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(e.text ?? "")}</pre>`;
  const size = html.length + files.reduce((n, f) => n + Number(f.size || 0), 0);

  const addresses = [...(e.to ?? []), ...(e.cc ?? []), ...(e.bcc ?? []), ...(e.received_for ?? [])].map((a) => parseAddress(a).address);
  const { data: t, error: te } = await admin.rpc("mail_inbound_targets", { target_school: school, addresses, size_in: size });
  if (te) throw new Error(te.message);
  const targets = (t ?? []) as Target[];
  const mailboxes = Array.from(new Set(targets.filter((x) => x.outcome === "ok").map((x) => x.mailbox_id as string)));
  const refused = targets.filter((x) => x.outcome !== "ok");

  let delivered = 0;
  const skipped: string[] = [];
  if (mailboxes.length) {
    const envelope = crypto.randomUUID();
    const stored: Record<string, unknown>[] = [];
    for (const f of files) {
      if (Number(f.size || 0) > MAX_FILE || !f.download_url) {
        skipped.push(f.filename || "attachment");
        continue;
      }
      const res = await fetch(f.download_url);
      if (!res.ok) {
        skipped.push(f.filename || "attachment");
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const path = `${mailboxes[0]}/${envelope}/${crypto.randomUUID()}-${safeName(f.filename ?? "")}`;
      const up = await admin.storage.from("mail").upload(path, bytes, { contentType: f.content_type || "application/octet-stream", upsert: false });
      if (up.error) {
        skipped.push(f.filename || "attachment");
        continue;
      }
      stored.push({ file_path: path, file_name: f.filename || "attachment", mime_type: f.content_type || "application/octet-stream", size_bytes: bytes.length, content_id: f.content_id ?? null });
    }
    const note = skipped.length
      ? `<p style="color:#b45309">Schoolivio could not keep ${skipped.length === 1 ? "this attachment" : "these attachments"} (over 25 MB, or unavailable): ${escapeHtml(skipped.join(", "))}</p>`
      : "";

    const priority = headers["x-priority"] ?? "";
    const importance = /^\s*[12]/.test(priority) || /high|urgent/i.test(headers["importance"] ?? "")
      ? "high"
      : /^\s*[45]/.test(priority) || /low/i.test(headers["importance"] ?? "") ? "low" : "normal";

    const { data: n, error } = await admin.rpc("mail_receive", {
      target_school: school,
      inbound_id_in: emailId,
      envelope_in: envelope,
      mailbox_ids: mailboxes,
      msg: {
        from_address: from.address,
        from_name: from.name,
        to_list: (e.to ?? []).map(parseAddress),
        cc_list: (e.cc ?? []).map(parseAddress),
        reply_to: (e.reply_to ?? []).map(parseAddress),
        subject: e.subject ?? "",
        html: note + html,
        message_id: e.message_id || headers["message-id"] || null,
        in_reply_to: headers["in-reply-to"] || null,
        references: (headers["references"] ?? "").split(/\s+/).filter(Boolean),
        sent_at: e.created_at ?? null,
        size,
        importance,
        // Mail that fails its own domain's DMARC check is most likely forged.
        junk: result(e.authentication, "dmarc") === "fail",
      },
      files: stored,
    });
    if (error) throw new Error(error.message);
    delivered = Number(n) || 0;
  }

  // Tell a real sender about addresses that could not take it.
  const proven = result(e.authentication, "spf") === "pass" || result(e.authentication, "dkim") === "pass";
  const robot = /^(no-?reply|mailer-daemon|postmaster|bounce)/i.test(from.address) ||
    (headers["auto-submitted"] && headers["auto-submitted"] !== "no") || /bulk|list|junk/i.test(headers["precedence"] ?? "");
  if (refused.length && proven && !robot && sendingOn && domain && from.address) {
    const lines = refused.map((r) => `<li>${escapeHtml(r.address)}: ${r.outcome === "full" ? "this mailbox is full" : "there is no such address"}</li>`).join("");
    await resend(key, "/emails", {
      method: "POST",
      body: {
        from: `Mail Delivery <postmaster@${domain}>`,
        to: [from.address],
        subject: `Not delivered: ${e.subject ?? ""}`.slice(0, 250),
        html: `<p>Your message <strong>${escapeHtml(e.subject ?? "(no subject)")}</strong> could not be delivered to:</p><ul>${lines}</ul><p>Please check the address and try again.</p>`,
        headers: { "Auto-Submitted": "auto-replied" },
      },
      idempotencyKey: `bounce-${emailId}`,
    });
  }
  return { delivered, refused: refused.length };
}
