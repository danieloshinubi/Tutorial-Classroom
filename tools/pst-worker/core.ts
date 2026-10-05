// Turning an Outlook .pst (or .ost) into ordinary email (Schoolivio Mail,
// supabase/240), in the person's own browser. Every mail folder is walked;
// each message becomes a standard email with its original headers where
// Outlook kept them, its HTML or plain body, its recipients and its files
// (an attached message stays an attached message), plus three headers the
// importer reads: the folder it was in, and whether it was read and flagged.
// Messages are packed into mbox parts of about 40 MB, each sent up as it is
// ready, so a 10 GB file never has to be uploaded whole.
//
// pst-extractor (MIT, github.com/epfromer/pst-extractor) reads the file.

import { Buffer } from "buffer";
import { PSTFile, PSTFolder, PSTMessage, PSTAttachment } from "pst-extractor";

export type Folder = "inbox" | "sent" | "drafts" | "junk" | "deleted" | "archive";

export interface ScanFolder {
  path: string;
  folder: Folder;
  count: number;
}

const CRLF = "\r\n";
// One message is kept under this, its largest files left out if need be
// (storage takes parts of up to 50 MB).
const MAX_MESSAGE = 38 * 1024 * 1024;

/** Where an Outlook folder goes: by its well-known name, else Archive. Calendars, contacts and the like are skipped. */
export function placeOf(name: string): Folder | null {
  const n = name.trim().toLowerCase();
  if (/^(inbox|posteingang|boîte de réception|bandeja de entrada|caixa de entrada|posta in arrivo)$/.test(n)) return "inbox";
  if (/sent|gesendet|envoy|enviad|inviat/.test(n)) return "sent";
  if (/draft|entw[üu]rf|brouillon|borrador|rascunho|bozze/.test(n)) return "drafts";
  if (/junk|spam|courrier ind|correo no deseado|lixo/.test(n)) return "junk";
  if (/deleted|trash|gelöscht|supprim|eliminad|excluíd|cestino/.test(n)) return "deleted";
  if (/^(outbox|sync issues|conversation history|rss (feeds|subscriptions)|calendar|contacts|tasks|notes|journal|suggested contacts|quick step settings|search folders)$/.test(n)) return null;
  return "archive";
}

const wrap = (b64: string) => b64.replace(/.{1,76}/g, (line) => line + CRLF);
const b64 = (data: Uint8Array | string) => wrap(Buffer.from(data as Uint8Array).toString("base64"));

/** A header value people can read in any language (RFC 2047). */
function word(s: string) {
  const text = (s ?? "").replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const out: string[] = [];
  let chunk = "";
  for (const ch of Array.from(text)) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      out.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) out.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
  return out.join(CRLF + " ");
}

const smtp = (...candidates: (string | undefined | null)[]) =>
  candidates.map((c) => (c ?? "").trim()).find((c) => /^[^\s@/<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(c)) ?? "";

function address(name: string, email: string) {
  if (!email) return name ? word(name) : "";
  if (!name || name.toLowerCase() === email.toLowerCase()) return `<${email}>`;
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "")}" <${email}>` : `${word(name)} <${email}>`;
}

// deno-lint-ignore no-explicit-any
const item = (o: any, method: string, id: number, fallback?: unknown) => {
  try {
    return o[method](id, fallback);
  } catch {
    return fallback;
  }
};

// The original internet headers Outlook kept (received mail), minus the
// ones that describe the old body: ours replace them.
function originalHeaders(raw: string) {
  const lines = raw.replace(/\r?\n/g, "\n").split("\n");
  const out: string[] = [];
  let skip = false;
  for (const line of lines) {
    if (/^\s/.test(line)) {
      if (!skip && out.length) out.push(line);
      continue;
    }
    skip = /^(content-[\w-]+|mime-version|x-schoolivio-[\w-]+)\s*:/i.test(line);
    if (!skip && line.trim()) out.push(line);
  }
  return out;
}

function readAttachment(att: PSTAttachment): Uint8Array | null {
  const stream = att.fileInputStream;
  if (!stream) return null;
  const size = Number(att.filesize || att.size || 0);
  if (!size) return new Uint8Array(0);
  const buf = Buffer.alloc(size);
  stream.readCompletely(buf);
  return new Uint8Array(buf);
}

/** One message as a standard email (also used for a message attached to another). */
export function toMime(msg: PSTMessage, place: { folder?: Folder } = {}): { mime: string; dropped: string[] } {
  const dropped: string[] = [];
  const headers: string[] = [];
  // A Date the importer could not read is dropped; Outlook's own time is used instead.
  const kept = (msg.transportMessageHeaders ? originalHeaders(msg.transportMessageHeaders) : [])
    .filter((l) => !/^date:/i.test(l) || !Number.isNaN(Date.parse(l.slice(5).trim())));
  const has = (name: string) => kept.some((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  headers.push(...kept);

  const date = msg.clientSubmitTime || msg.messageDeliveryTime || msg.creationTime || null;
  const senderEmail = smtp(item(msg, "getStringItem", 0x5d01), msg.senderEmailAddress, msg.sentRepresentingEmailAddress, item(msg, "getStringItem", 0x5d02));
  const to: string[] = [];
  const cc: string[] = [];
  const bcc: string[] = [];
  for (let i = 0; i < msg.numberOfRecipients; i += 1) {
    const r = msg.getRecipient(i);
    if (!r) continue;
    const a = address(r.displayName, smtp(r.smtpAddress, r.emailAddress));
    if (!a) continue;
    (r.recipientType === 2 ? cc : r.recipientType === 3 ? bcc : to).push(a);
  }
  if (!has("from")) headers.push(`From: ${address(msg.senderName || msg.sentRepresentingName, senderEmail) || "<unknown@unknown.invalid>"}`);
  if (!has("to") && to.length) headers.push(`To: ${to.join(", ")}`);
  if (!has("cc") && cc.length) headers.push(`Cc: ${cc.join(", ")}`);
  if (bcc.length && !has("bcc")) headers.push(`Bcc: ${bcc.join(", ")}`);
  if (!has("subject")) headers.push(`Subject: ${word(msg.subject || "")}`);
  if (!has("date") && date) headers.push(`Date: ${new Date(date).toUTCString()}`);
  if (!has("message-id") && msg.internetMessageId) headers.push(`Message-ID: ${msg.internetMessageId}`);
  if (!has("in-reply-to") && msg.inReplyToId) headers.push(`In-Reply-To: ${msg.inReplyToId}`);
  if (msg.importance === 2 && !has("importance")) headers.push("Importance: high");
  if (msg.importance === 0 && !has("importance")) headers.push("Importance: low");
  if (place.folder) {
    headers.push(`X-Schoolivio-Folder: ${place.folder}`);
    headers.push(`X-Schoolivio-Read: ${msg.isRead ? "1" : "0"}`);
    headers.push(`X-Schoolivio-Flagged: ${item(msg, "getIntItem", 0x1090, 0) === 2 ? "1" : "0"}`);
  }
  headers.push("MIME-Version: 1.0");

  const html = msg.bodyHTML || "";
  const text = msg.body || "";
  const alt = `alt_${crypto.randomUUID()}`;
  const bodyPart = html && text
    ? [`Content-Type: multipart/alternative; boundary="${alt}"`, "", `--${alt}`,
       "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(Buffer.from(text, "utf8")).trimEnd(),
       `--${alt}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(Buffer.from(html, "utf8")).trimEnd(),
       `--${alt}--`].join(CRLF)
    : [`Content-Type: text/${html ? "html" : "plain"}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", b64(Buffer.from(html || text, "utf8")).trimEnd()].join(CRLF);

  // Files, largest last so that if anything has to give it is the biggest.
  const files: { head: string[]; body: string }[] = [];
  let size = bodyPart.length;
  const atts: PSTAttachment[] = [];
  for (let i = 0; i < msg.numberOfAttachments; i += 1) {
    try {
      const a = msg.getAttachment(i);
      if (a) atts.push(a);
    } catch { /* an unreadable attachment is left out */ }
  }
  atts.sort((x, y) => Number(x.filesize || x.size || 0) - Number(y.filesize || y.size || 0));
  for (const a of atts) {
    const name = a.longFilename || a.filename || "attachment";
    try {
      if (a.attachMethod === 5) {
        // An attached message stays one.
        const inner = a.embeddedPSTMessage;
        if (!inner) continue;
        const sub = toMime(inner).mime;
        if (size + sub.length * 1.37 > MAX_MESSAGE) {
          dropped.push(`${inner.subject || "message"}.eml`);
          continue;
        }
        const encoded = b64(Buffer.from(sub, "utf8"));
        size += encoded.length;
        files.push({ head: [`Content-Type: message/rfc822; name="${(inner.subject || "message").replace(/["\r\n]/g, "")}.eml"`, `Content-Disposition: attachment; filename="${(inner.subject || "message").replace(/["\r\n]/g, "")}.eml"`, "Content-Transfer-Encoding: base64"], body: encoded });
        continue;
      }
      const data = readAttachment(a);
      if (!data) continue;
      if (size + data.length * 1.37 > MAX_MESSAGE) {
        dropped.push(name);
        continue;
      }
      const encoded = b64(data);
      size += encoded.length;
      const head = [
        `Content-Type: ${a.mimeTag || "application/octet-stream"}; name="${/^[\x20-\x7e]*$/.test(name) ? name.replace(/"/g, "") : word(name)}"`,
        `Content-Disposition: ${a.contentId && a.isAttachmentInvisibleInHtml === false ? "inline" : "attachment"}; filename="${/^[\x20-\x7e]*$/.test(name) ? name.replace(/"/g, "") : word(name)}"`,
        "Content-Transfer-Encoding: base64",
      ];
      if (a.contentId) head.push(`Content-ID: <${a.contentId.replace(/^<|>$/g, "")}>`);
      files.push({ head, body: encoded });
    } catch {
      dropped.push(name);
    }
  }

  let body: string;
  if (!files.length && !dropped.length) {
    body = bodyPart;
  } else {
    const mixed = `mix_${crypto.randomUUID()}`;
    const parts = [bodyPart];
    if (dropped.length) {
      parts.push(["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "",
        b64(Buffer.from(`Left out of the import because the message was too large: ${dropped.join(", ")}`, "utf8")).trimEnd()].join(CRLF));
    }
    for (const f of files) parts.push([...f.head, "", f.body.trimEnd()].join(CRLF));
    body = [`Content-Type: multipart/mixed; boundary="${mixed}"`, "", ...parts.flatMap((p) => [`--${mixed}`, p]), `--${mixed}--`].join(CRLF);
  }
  // Our Content-Type line belongs with the headers.
  const [ctLine, ...rest] = body.split(CRLF);
  return { mime: [...headers, ctLine, ...rest].join(CRLF) + CRLF, dropped };
}

/** Every mail folder, with where it goes and how many items it holds. */
export function scan(pst: PSTFile): ScanFolder[] {
  const out: ScanFolder[] = [];
  const walk = (folder: PSTFolder, path: string, depth: number) => {
    if (depth > 0) {
      const cls = folder.containerClass || "";
      const place = placeOf(folder.displayName || "");
      if ((cls === "" || cls.startsWith("IPF.Note")) && place && folder.contentCount > 0) {
        out.push({ path, folder: place, count: folder.contentCount });
      }
    }
    if (folder.hasSubfolders && depth < 12) {
      for (const sub of folder.getSubFolders()) walk(sub, path ? `${path}/${sub.displayName}` : sub.displayName, depth + 1);
    }
  };
  walk(pst.getRootFolder(), "", 0);
  return out;
}

export interface Progress {
  done: number;
  skipped: number;
  folder: string;
}

/**
 * Walks the file and hands over mbox parts as they fill. `send` may make the
 * walk wait (it returns a promise) so that uploading never falls far behind.
 */
export async function extract(
  pst: PSTFile,
  send: (part: Uint8Array, messages: number) => Promise<void>,
  progress: (p: Progress) => void,
  partBytes = 40 * 1024 * 1024,
  shouldStop: () => boolean = () => false,
) {
  const enc = new TextEncoder();
  let chunks: Uint8Array[] = [];
  let bytes = 0;
  let inPart = 0;
  const p: Progress = { done: 0, skipped: 0, folder: "" };
  const flush = async () => {
    if (!inPart) return;
    const part = new Uint8Array(bytes);
    let o = 0;
    for (const c of chunks) {
      part.set(c, o);
      o += c.length;
    }
    chunks = [];
    bytes = 0;
    const n = inPart;
    inPart = 0;
    await send(part, n);
  };

  const walk = async (folder: PSTFolder, path: string, depth: number) => {
    if (shouldStop()) return;
    if (depth > 0) {
      const cls = folder.containerClass || "";
      const place = placeOf(folder.displayName || "");
      if ((cls === "" || cls.startsWith("IPF.Note")) && place && folder.contentCount > 0) {
        p.folder = path;
        let child = folder.getNextChild();
        while (child && !shouldStop()) {
          const msg = child as PSTMessage;
          const cls2 = (msg.messageClass || "IPM.Note").toUpperCase();
          // Mail, delivery reports, and meeting invitations and replies (they sit in mail folders too).
          if (cls2.startsWith("IPM.NOTE") || cls2.startsWith("REPORT.") || cls2.startsWith("IPM.SCHEDULE.MEETING") || cls2 === "IPM") {
            try {
              const { mime } = toMime(msg, { folder: place });
              // mboxrd: a body line that starts "From " would read as a new message.
              const safe = mime.replace(/\r\n(>*From )/g, "\r\n>$1");
              const piece = enc.encode(`From schoolivio@pst ${new Date(0).toUTCString()}\r\n${safe}\r\n`);
              chunks.push(piece);
              bytes += piece.length;
              inPart += 1;
              p.done += 1;
            } catch {
              p.skipped += 1;
            }
          } else {
            p.skipped += 1;          // appointments, contacts, tasks and the like
          }
          if (bytes >= partBytes) await flush();
          if ((p.done + p.skipped) % 25 === 0) progress({ ...p });
          child = folder.getNextChild();
        }
      }
    }
    if (folder.hasSubfolders && depth < 12) {
      for (const sub of folder.getSubFolders()) await walk(sub, path ? `${path}/${sub.displayName}` : sub.displayName, depth + 1);
    }
  };
  await walk(pst.getRootFolder(), "", 0);
  await flush();
  progress({ ...p });
  return p;
}
