// One raw email (RFC 822 bytes, whatever the source) into a mailbox
// (supabase/240): parsed, its pictures kept inside the body, its other files
// put in the private "mail" bucket, and mail_import_message files it in the
// right folder with read and flagged as they were.

import { Buffer } from "node:buffer";
import { simpleParser } from "npm:mailparser@3.9.26";

// deno-lint-ignore no-explicit-any
export type AdminClient = any;

export type Folder = "inbox" | "drafts" | "sent" | "archive" | "junk" | "deleted";

export interface Job {
  id: string;
  school_id: string;
  mailbox_id: string;
  source: "imap" | "mbox" | "eml" | "microsoft";
  label: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: "ssl" | "starttls" | "none" | null;
  imap_username: string | null;
  password: string | null;
  since: string | null;
  file_paths: string[];
  target_folder: Folder | null;
  source_user: string | null;
  cursor: Record<string, unknown>;
  mailbox_address: string;
  previous_addresses: string[] | null;
}

export interface Tally {
  found: number;
  imported: number;
  skipped: number;
  failed: number;
  bytes: number;
}
export const tally = (): Tally => ({ found: 0, imported: 0, skipped: 0, failed: 0, bytes: 0 });

/** Thrown when the mailbox has no room left: the import stops. */
export class MailboxFull extends Error {}

const MAX_FILE = 25 * 1024 * 1024;
const MAX_INLINE = 2 * 1024 * 1024;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const safeName = (name: string) => (name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 120);

const decoder = new TextDecoder("latin1");

/** The Message-ID from the header block, without parsing the whole message. */
export function headerMessageId(raw: Uint8Array): string | null {
  const head = decoder.decode(raw.subarray(0, Math.min(raw.length, 64 * 1024))).split(/\r?\n\r?\n/)[0];
  const m = head.match(/^message-id:\s*(<[^>\r\n]+>)/im);
  return m ? m[1].trim() : null;
}

async function sha(raw: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw)));
  return Array.from(d.subarray(0, 20), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The once-only key for a message: its Message-ID, or a fingerprint of the message. */
export async function importKey(raw: Uint8Array, messageId?: string | null) {
  const id = (messageId || headerMessageId(raw) || "").trim();
  return id ? `imp:${id.slice(0, 400)}` : `imp:sha:${await sha(raw)}`;
}

/** Which of these keys the mailbox already has. */
export async function seenKeys(admin: AdminClient, mailboxId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { data } = await admin.rpc("mail_import_seen", { target_mailbox: mailboxId, keys });
  return new Set((data as string[] | null) ?? []);
}

// deno-lint-ignore no-explicit-any
const addresses = (field: any): { name: string; address: string }[] => {
  const list = Array.isArray(field) ? field : field ? [field] : [];
  // deno-lint-ignore no-explicit-any
  return list.flatMap((a: any) => a?.value ?? []).filter((v: { address?: string }) => v?.address)
    .map((v: { name?: string; address: string }) => ({ name: v.name ?? "", address: v.address.toLowerCase() }));
};

export const isMine = (job: Job, address: string) => {
  const a = address.toLowerCase();
  return a === job.mailbox_address || (job.previous_addresses ?? []).includes(a) ||
    a === (job.imap_username ?? "").toLowerCase() || a === (job.source_user ?? "").toLowerCase();
};

/**
 * Import one message. `folder` is where the source had it; a function may be
 * given instead, to decide once the sender is known (MBOX without labels).
 */
export async function importRaw(
  admin: AdminClient,
  job: Job,
  raw: Uint8Array,
  folder: Folder | ((from: string) => Folder),
  flags: { read?: boolean; flagged?: boolean; key?: string },
  t: Tally,
): Promise<void> {
  const key = flags.key ?? (await importKey(raw));
  // mailparser reads a Node Buffer (or a stream), not a plain byte array.
  const parsed = await simpleParser(Buffer.from(raw.buffer, raw.byteOffset, raw.length));
  const from = addresses(parsed.from)[0] ?? { name: (parsed.from as { text?: string } | undefined)?.text?.replace(/<>/g, "").trim() ?? "", address: "" };
  const where = typeof folder === "function" ? folder(from.address) : folder;
  // Outlook keeps a company (Exchange) sender as an internal id, not an
  // address. Mail in Sent was sent by the mailbox's owner.
  if (!from.address && where === "sent") from.address = job.mailbox_address;

  let html = parsed.html || (parsed.text ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(parsed.text)}</pre>` : "<p></p>");
  const envelope = crypto.randomUUID();
  const stored: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const a of parsed.attachments ?? []) {
    const cid = (a.contentId ?? "").replace(/^<|>$/g, "");
    // A picture shown inside the message stays inside it: mailparser has
    // already put it in the body, so it is not kept a second time.
    if (cid && a.related) continue;
    if (cid && a.size <= MAX_INLINE && html.includes(`cid:${cid}`)) {
      // mailparser gives file contents as a Node Buffer.
      html = html.split(`cid:${cid}`).join(`data:${a.contentType};base64,${(a.content as unknown as { toString(enc: string): string }).toString("base64")}`);
      continue;
    }
    if (a.size > MAX_FILE) {
      skipped.push(a.filename || "attachment");
      continue;
    }
    const path = `${job.mailbox_id}/${envelope}/${crypto.randomUUID()}-${safeName(a.filename ?? "")}`;
    const up = await admin.storage.from("mail").upload(path, a.content, { contentType: a.contentType || "application/octet-stream", upsert: false });
    if (up.error) {
      skipped.push(a.filename || "attachment");
      continue;
    }
    stored.push({ file_path: path, file_name: a.filename || "attachment", mime_type: a.contentType || "application/octet-stream", size_bytes: a.size, content_id: null });
  }
  if (skipped.length) {
    html = `<p style="color:#b45309">Schoolivio could not keep ${skipped.length === 1 ? "this attachment" : "these attachments"} (over 25 MB): ${escapeHtml(skipped.join(", "))}</p>${html}`;
  }

  const refs = parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [];
  const { data: outcome, error } = await admin.rpc("mail_import_message", {
    target_mailbox: job.mailbox_id,
    key_in: key,
    envelope_in: envelope,
    folder_in: where,
    msg: {
      from_address: from.address,
      from_name: from.name,
      to_list: addresses(parsed.to),
      cc_list: addresses(parsed.cc),
      bcc_list: addresses(parsed.bcc),
      reply_to: addresses(parsed.replyTo),
      subject: parsed.subject ?? "",
      html,
      message_id: parsed.messageId ?? null,
      in_reply_to: parsed.inReplyTo ?? null,
      references: refs,
      sent_at: parsed.date ? parsed.date.toISOString() : null,
      size: raw.length,
      importance: parsed.priority === "high" ? "high" : parsed.priority === "low" ? "low" : "normal",
      is_read: flags.read ?? true,
      is_flagged: flags.flagged ?? false,
    },
    files: stored,
  });
  if (error || outcome !== "imported") {
    // Nothing kept: its files go too.
    if (stored.length) await admin.storage.from("mail").remove(stored.map((f) => f.file_path as string));
  }
  if (error) throw new Error(error.message);
  if (outcome === "full") throw new MailboxFull("The mailbox is full (5 GB), so the import stopped. Delete some mail or ask the school admin for more room, then catch up.");
  if (outcome === "imported") {
    t.imported += 1;
    t.bytes += raw.length;
  } else {
    t.skipped += 1;
  }
}
