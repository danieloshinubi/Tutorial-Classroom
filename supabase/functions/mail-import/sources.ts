// Where old mail comes from (supabase/240). Each source does a short turn —
// a few dozen messages, well inside an Edge Function's limits — and returns
// where the next turn should start. Nothing is ever imported twice: messages
// already in the mailbox are skipped by their Message-ID before being
// downloaded where the source allows it.

import { ImapFlow } from "npm:imapflow@2.0.2";
import { type AdminClient, type Folder, importKey, importRaw, isMine, type Job, seenKeys, type Tally } from "./pipeline.ts";

export interface Budget {
  deadline: number;      // Date.now() to stop by
  messages: number;      // most messages to parse this turn
}
export interface Turn {
  cursor: Record<string, unknown>;
  done: boolean;
}
const timeLeft = (b: Budget) => Date.now() < b.deadline && b.messages > 0;

// --- IMAP (any provider) ---------------------------------------------------------------
interface ImapFolder {
  path: string;
  folder: Folder;
  last_uid?: number;
  done?: boolean;
}

/** Where a server folder goes: its special use first, then its name. */
export function imapFolder(path: string, specialUse?: string): Folder | null {
  switch (specialUse) {
    case "\\Inbox": return "inbox";
    case "\\Sent": return "sent";
    case "\\Drafts": return "drafts";
    case "\\Junk": return "junk";
    case "\\Trash": return "deleted";
    case "\\Archive":
    case "\\All": return "archive";
    case "\\Flagged":
    case "\\Important": return null;   // views of mail kept elsewhere
  }
  const name = path.split(/[/.]/).pop() ?? path;
  if (/^inbox$/i.test(path)) return "inbox";
  if (/sent/i.test(name)) return "sent";
  if (/draft/i.test(name)) return "drafts";
  if (/junk|spam|bulk/i.test(name)) return "junk";
  if (/trash|deleted|bin/i.test(name)) return "deleted";
  if (/^(starred|important|flagged)$/i.test(name)) return null;
  return "archive";
}

const ORDER: Folder[] = ["inbox", "sent", "drafts", "junk", "deleted", "archive"];

export async function imapClient(job: Pick<Job, "imap_host" | "imap_port" | "imap_security" | "imap_username" | "password">) {
  const client = new ImapFlow({
    host: job.imap_host!,
    port: job.imap_port || 993,
    secure: job.imap_security !== "starttls" && job.imap_security !== "none",
    auth: { user: job.imap_username!, pass: job.password! },
    logger: false,
  });
  await client.connect();
  return client;
}

export async function runImap(admin: AdminClient, job: Job, t: Tally, b: Budget): Promise<Turn> {
  if (!job.password) throw new Error("The password for this account is no longer kept. Start a new import.");
  const client = await imapClient(job);
  try {
    let folders = (job.cursor.folders as ImapFolder[] | undefined) ?? null;
    if (!folders) {
      const list = await client.list();
      folders = list
        .filter((f) => !(f.flags as Set<string> | undefined)?.has("\\Noselect"))
        .map((f) => ({ path: f.path, folder: imapFolder(f.path, f.specialUse) }))
        .filter((f): f is ImapFolder => f.folder !== null)
        // Gmail's "All Mail" last: anything not already found under another label is archive.
        .sort((x, y) => (/all mail/i.test(x.path) ? 1 : 0) - (/all mail/i.test(y.path) ? 1 : 0) || ORDER.indexOf(x.folder) - ORDER.indexOf(y.folder));
    }
    for (const f of folders) {
      if (f.done) continue;
      if (!timeLeft(b)) break;
      const lock = await client.getMailboxLock(f.path);
      try {
        const from = (f.last_uid ?? 0) + 1;
        const query: Record<string, unknown> = { uid: `${from}:*` };
        if (job.since) query.since = new Date(job.since);
        const uids = ((await client.search(query, { uid: true })) || []).filter((u: number) => u >= from).sort((x: number, y: number) => x - y);
        if (!uids.length) {
          f.done = true;
          continue;
        }
        for (let i = 0; i < uids.length && timeLeft(b); i += 20) {
          const chunk = uids.slice(i, i + 20);
          // Headers and flags first, so mail already here is never downloaded.
          const heads: { uid: number; key: string; seen: boolean; flagged: boolean; size: number }[] = [];
          for await (const m of client.fetch(chunk.join(","), { uid: true, envelope: true, flags: true, size: true }, { uid: true })) {
            const id = m.envelope?.messageId;
            heads.push({
              uid: m.uid,
              key: id ? `imp:${id.slice(0, 400)}` : "",
              seen: (m.flags as Set<string> | undefined)?.has("\\Seen") ?? true,
              flagged: (m.flags as Set<string> | undefined)?.has("\\Flagged") ?? false,
              size: m.size ?? 0,
            });
          }
          heads.sort((x, y) => x.uid - y.uid);
          const have = await seenKeys(admin, job.mailbox_id, heads.map((h) => h.key).filter(Boolean));
          for (const h of heads) {
            if (!timeLeft(b)) break;
            t.found += 1;
            if (h.key && have.has(h.key)) {
              t.skipped += 1;
            } else if (h.size > 40 * 1024 * 1024) {
              t.failed += 1;
            } else {
              const msg = await client.fetchOne(String(h.uid), { source: true }, { uid: true });
              if (msg && msg.source) {
                b.messages -= 1;
                try {
                  await importRaw(admin, job, new Uint8Array(msg.source), f.folder, { read: h.seen, flagged: h.flagged, key: h.key || undefined }, t);
                } catch (err) {
                  if ((err as Error).message.startsWith("The mailbox is full")) throw err;
                  t.failed += 1;
                }
              }
            }
            f.last_uid = h.uid;
          }
          if (chunk[chunk.length - 1] === uids[uids.length - 1] && f.last_uid === uids[uids.length - 1]) f.done = true;
        }
      } finally {
        lock.release();
      }
    }
    return { cursor: { folders }, done: folders.every((f) => f.done) };
  } finally {
    await client.logout().catch(() => null);
  }
}

// --- Uploaded files: .mbox (in parts) and .eml ----------------------------------------------
const FROM_LINE = new TextEncoder().encode("\nFrom ");

function indexOf(hay: Uint8Array, needle: Uint8Array, from: number) {
  outer: for (let i = from; i <= hay.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

async function download(admin: AdminClient, path: string, start?: number, end?: number): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from("mail-imports").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) throw new Error(`Could not read ${path.split("/").pop()}.`);
  const res = await fetch(data.signedUrl, start === undefined ? {} : { headers: { Range: `bytes=${start}-${(end as number) - 1}` } });
  if (!res.ok) throw new Error(`Could not read ${path.split("/").pop()} (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Gmail's labels (Takeout's X-Gmail-Labels) as a folder, read and flagged. */
export function takeoutPlace(raw: Uint8Array, job: Job): { folder: Folder | ((from: string) => Folder); read: boolean; flagged: boolean } {
  const head = new TextDecoder().decode(raw.subarray(0, Math.min(raw.length, 64 * 1024))).split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
  // From an Outlook .pst, read in the browser (tools/pst-worker): the folder
  // it was in, and whether it was read and flagged.
  const pstFolder = head.match(/^x-schoolivio-folder:\s*(\w+)/im)?.[1]?.toLowerCase();
  if (pstFolder && ["inbox", "sent", "drafts", "junk", "deleted", "archive"].includes(pstFolder)) {
    return {
      folder: pstFolder as Folder,
      read: head.match(/^x-schoolivio-read:\s*(\d)/im)?.[1] !== "0",
      flagged: head.match(/^x-schoolivio-flagged:\s*(\d)/im)?.[1] === "1",
    };
  }
  const m = head.match(/^x-gmail-labels:\s*(.*)$/im);
  if (!m) return { folder: (from) => (isMine(job, from) ? "sent" : "inbox"), read: true, flagged: false };
  const labels = m[1].split(",").map((l) => l.trim().toLowerCase());
  const has = (...names: string[]) => names.some((n) => labels.includes(n));
  const folder: Folder = has("spam") ? "junk" : has("trash") ? "deleted" : has("draft", "drafts") ? "drafts"
    : has("inbox") ? "inbox" : has("sent") ? "sent" : "archive";
  return { folder, read: !has("unread"), flagged: has("starred") };
}

export async function runFiles(admin: AdminClient, job: Job, t: Tally, b: Budget): Promise<Turn> {
  const cursor = { ...job.cursor } as { sizes?: number[]; g?: number; i?: number; open?: boolean; appended_at?: string };
  if (job.source === "eml") {
    let i = cursor.i ?? 0;
    while (i < job.file_paths.length && timeLeft(b)) {
      const path = job.file_paths[i];
      const raw = await download(admin, path);
      t.found += 1;
      b.messages -= 1;
      try {
        await importRaw(admin, job, raw, (from) => (job.target_folder ?? (isMine(job, from) ? "sent" : "inbox")), { read: true }, t);
      } catch (err) {
        if ((err as Error).message.startsWith("The mailbox is full")) throw err;
        t.failed += 1;
      }
      await admin.storage.from("mail-imports").remove([path]);
      i += 1;
    }
    return { cursor: { i }, done: i >= job.file_paths.length };
  }

  // .mbox: its parts read as one stream; g is the position in it.
  const sizes = cursor.sizes ?? [];
  const total = sizes.reduce((n, s) => n + s, 0);
  let g = cursor.g ?? 0;
  const starts = sizes.map((_, k) => sizes.slice(0, k).reduce((n, s) => n + s, 0));
  const read = async (from: number, to: number) => {
    const out: Uint8Array[] = [];
    for (let k = 0; k < sizes.length; k += 1) {
      const a = Math.max(from, starts[k]);
      const z = Math.min(to, starts[k] + sizes[k]);
      if (a < z) out.push(await download(admin, job.file_paths[k], a - starts[k], z - starts[k]));
    }
    const buf = new Uint8Array(out.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of out) {
      buf.set(p, o);
      o += p.length;
    }
    return buf;
  };

  while (g < total && timeLeft(b)) {
    let size = 8 * 1024 * 1024;
    let win = await read(g, Math.min(total, g + size));
    // A message larger than the window: widen it (up to 64 MB) until its end is in view.
    while (indexOf(win, FROM_LINE, 1) < 0 && g + win.length < total && size < 64 * 1024 * 1024) {
      size *= 2;
      win = await read(g, Math.min(total, g + size));
    }
    let pos = 0;
    let progressed = false;
    while (timeLeft(b)) {
      const next = indexOf(win, FROM_LINE, pos + 1);
      const atEnd = g + win.length >= total;
      if (next < 0 && !atEnd) break;                      // the rest of this message is in the next window
      const end = next < 0 ? win.length : next + 1;
      const chunk = win.subarray(pos, end);
      // Drop mbox's own "From …" line; the message proper starts after it.
      const nl = chunk.indexOf(10);
      let raw = chunk.subarray(nl >= 0 ? nl + 1 : 0);
      while (raw.length && (raw[raw.length - 1] === 10 || raw[raw.length - 1] === 13)) raw = raw.subarray(0, raw.length - 1);
      if (raw.length > 20) {
        t.found += 1;
        const key = await importKey(raw);
        const have = await seenKeys(admin, job.mailbox_id, [key]);
        if (have.has(key)) {
          t.skipped += 1;
        } else {
          b.messages -= 1;
          const place = takeoutPlace(raw, job);
          try {
            await importRaw(admin, job, raw, place.folder, { read: place.read, flagged: place.flagged, key }, t);
          } catch (err) {
            if ((err as Error).message.startsWith("The mailbox is full")) throw err;
            t.failed += 1;
          }
        }
      }
      pos = end;
      progressed = true;
      if (next < 0) break;
    }
    if (!progressed && g + win.length < total) {
      // One message bigger than 64 MB: skip past it.
      t.failed += 1;
      const skip = indexOf(await read(g + win.length - 6, Math.min(total, g + win.length + 64 * 1024 * 1024)), FROM_LINE, 0);
      pos = skip < 0 ? win.length : win.length - 6 + skip + 1;
    }
    g += pos;
    // Parts read to the end are deleted.
    for (let k = 0; k < sizes.length; k += 1) {
      if (starts[k] + sizes[k] <= g && sizes[k] > 0) {
        await admin.storage.from("mail-imports").remove([job.file_paths[k]]);
      }
    }
  }
  // An Outlook .pst still being read in someone's browser keeps getting parts
  // (cursor.open); it is done only when the browser says the file is finished.
  if (cursor.open && g >= total && cursor.appended_at && Date.now() - Date.parse(cursor.appended_at) > 2 * 60 * 60 * 1000) {
    throw new Error("The .pst stopped coming in (the page was closed before the end). Start it again: what came across is kept and skipped next time.");
  }
  return { cursor: { ...cursor, sizes, g }, done: g >= total && !cursor.open };
}

// --- Microsoft 365 (Graph, the school's admin approval) ------------------------------------
interface MsFolder {
  id: string;
  folder: Folder;
  name: string;
  page?: string | null;     // the page being worked through
  done?: boolean;
}
const GRAPH = "https://graph.microsoft.com/v1.0";
const WELL_KNOWN: [string, Folder][] = [["inbox", "inbox"], ["sentitems", "sent"], ["drafts", "drafts"], ["junkemail", "junk"], ["deleteditems", "deleted"], ["archive", "archive"]];

export async function microsoftToken(tenant: string, clientId: string, secret: string) {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Microsoft 365 refused: ${body.error_description || body.error || res.status}`);
  return String(body.access_token);
}

async function graph<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error?.message || `Microsoft 365 answered ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return await res.json() as T;
}

export async function runMicrosoft(admin: AdminClient, job: Job, t: Tally, b: Budget, token: string): Promise<Turn> {
  const cursor = { ...job.cursor } as { user?: string; folders?: MsFolder[] };
  // The person's Microsoft 365 account, by address.
  if (!cursor.user) {
    const who = job.source_user ?? job.mailbox_address;
    try {
      const u = await graph<{ id: string }>(token, `/users/${encodeURIComponent(who)}?$select=id`);
      cursor.user = u.id;
    } catch {
      const found = await graph<{ value: { id: string }[] }>(token, `/users?$select=id&$filter=mail eq '${who.replace(/'/g, "''")}'`);
      if (!found.value.length) throw new Error(`No Microsoft 365 account for ${who}.`);
      cursor.user = found.value[0].id;
    }
  }
  const user = cursor.user as string;

  if (!cursor.folders) {
    const known = new Map<string, Folder>();
    for (const [name, folder] of WELL_KNOWN) {
      try {
        const f = await graph<{ id: string }>(token, `/users/${user}/mailFolders/${name}?$select=id`);
        known.set(f.id, folder);
      } catch { /* not every mailbox has an Archive */ }
    }
    const all: MsFolder[] = [];
    const walk = async (url: string, depth: number) => {
      let next: string | null = url;
      while (next) {
        const page: { value: { id: string; displayName: string; childFolderCount?: number }[]; "@odata.nextLink"?: string } = await graph(token, next);
        for (const f of page.value) {
          if (/^(sync issues|conversation history|rss (feeds|subscriptions)|outbox|clutter)$/i.test(f.displayName)) continue;
          all.push({ id: f.id, name: f.displayName, folder: known.get(f.id) ?? "archive" });
          if ((f.childFolderCount ?? 0) > 0 && depth < 5) await walk(`/users/${user}/mailFolders/${f.id}/childFolders?$top=100&$select=id,displayName,childFolderCount`, depth + 1);
        }
        next = page["@odata.nextLink"] ?? null;
      }
    };
    await walk(`/users/${user}/mailFolders?$top=100&$select=id,displayName,childFolderCount`, 0);
    cursor.folders = all.sort((x, y) => ORDER.indexOf(x.folder) - ORDER.indexOf(y.folder));
  }

  for (const f of cursor.folders) {
    if (f.done) continue;
    if (!timeLeft(b)) break;
    let page: string | null = f.page ??
      `/users/${user}/mailFolders/${f.id}/messages?$select=id,isRead,flag,internetMessageId&$top=25&$orderby=receivedDateTime asc` +
      (job.since ? `&$filter=receivedDateTime ge ${new Date(job.since).toISOString()}` : "");
    while (page && timeLeft(b)) {
      const res: { value: { id: string; isRead: boolean; flag?: { flagStatus?: string }; internetMessageId?: string }[]; "@odata.nextLink"?: string } = await graph(token, page);
      const keys = res.value.map((m) => (m.internetMessageId ? `imp:${m.internetMessageId.slice(0, 400)}` : ""));
      const have = await seenKeys(admin, job.mailbox_id, keys.filter(Boolean));
      let finishedPage = true;
      for (let i = 0; i < res.value.length; i += 1) {
        if (!timeLeft(b)) {
          finishedPage = false;
          break;
        }
        const m = res.value[i];
        if (keys[i] && have.has(keys[i])) {
          t.found += 1;
          t.skipped += 1;
          continue;
        }
        t.found += 1;
        b.messages -= 1;
        try {
          const mime = await fetch(`${GRAPH}/users/${user}/messages/${m.id}/$value`, { headers: { Authorization: `Bearer ${token}` } });
          if (!mime.ok) throw new Error(String(mime.status));
          await importRaw(admin, job, new Uint8Array(await mime.arrayBuffer()), f.folder,
            { read: m.isRead, flagged: m.flag?.flagStatus === "flagged", key: keys[i] || undefined }, t);
        } catch (err) {
          if ((err as Error).message.startsWith("The mailbox is full")) throw err;
          t.failed += 1;
        }
      }
      // A page left halfway is read again next turn; what was done is skipped.
      if (!finishedPage) break;
      page = res["@odata.nextLink"] ?? null;
      f.page = page;
      if (!page) f.done = true;
    }
  }
  return { cursor, done: cursor.folders.every((f) => f.done) };
}
