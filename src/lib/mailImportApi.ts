import { db, fail } from "./db";
import { supabase } from "./supabaseClient";

// Bringing old mail across (supabase/240): from an email account (IMAP), a
// Google Takeout .mbox, .eml files, or (school admin) Microsoft 365 for
// everyone at once. The mail-import Edge Function does the work in the
// background; these are the starts, the progress, catch-up and cancel.

export interface MailImport {
  id: string;
  school_id: string;
  mailbox_id: string;
  source: "imap" | "mbox" | "eml" | "microsoft";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  label: string;
  imap_host: string | null;
  imap_username: string | null;
  since: string | null;
  found: number;
  imported: number;
  skipped: number;
  failed: number;
  bytes: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, school_id, mailbox_id, source, status, label, imap_host, imap_username, since, found, imported, skipped, failed, bytes, last_error, started_at, finished_at, created_at, updated_at";

export const importsFor = async (mailboxId: string): Promise<MailImport[]> => {
  const { data, error } = await db.from("mail_imports").select(COLUMNS).eq("mailbox_id", mailboxId).order("created_at", { ascending: false }).limit(20);
  if (error) fail(error, "Could not load your imports.");
  return (data || []) as unknown as MailImport[];
};

export const schoolImports = async (schoolId: string): Promise<MailImport[]> => {
  const { data, error } = await db.from("mail_imports").select(COLUMNS).eq("school_id", schoolId).order("created_at", { ascending: false }).limit(300);
  if (error) fail(error, "Could not load the school's imports.");
  return (data || []) as unknown as MailImport[];
};

const call = async (body: Record<string, unknown>, fallback: string) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  const { data, error } = await supabase.functions.invoke("mail-import", {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let detail = "";
    try {
      detail = (await (error as { context?: Response }).context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || fallback);
  }
  if (data?.error) throw new Error(data.error);
  return data as { ok: boolean; id?: string; url?: string; started?: number; problems?: string[] };
};

export const startImapImport = (p: { mailboxId: string; host: string; port: number; security: string; username: string; password: string; since?: string | null; label?: string }) =>
  call({ action: "start_imap", ...p }, "Could not start the import.");

// Storage takes files of up to 50 MB, so a .mbox is sent in 45 MB parts and read back as one.
const PART = 45 * 1024 * 1024;

export async function uploadAndImport(p: {
  mailboxId: string;
  kind: "mbox" | "eml";
  files: File[];
  folder?: "inbox" | "sent" | "archive";
  onProgress?: (fraction: number) => void;
}) {
  const batch = crypto.randomUUID();
  const paths: string[] = [];
  const sizes: number[] = [];
  const pieces: { blob: Blob; name: string }[] = [];
  p.files.forEach((f) => {
    if (p.kind === "mbox") {
      for (let start = 0, n = 0; start < f.size; start += PART, n += 1) pieces.push({ blob: f.slice(start, start + PART), name: `${String(n).padStart(4, "0")}.part` });
    } else {
      pieces.push({ blob: f, name: f.name });
    }
  });
  const total = pieces.reduce((n, x) => n + x.blob.size, 0) || 1;
  let sent = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const safe = pieces[i].name.replace(/[^\w.\- ]+/g, "_").slice(0, 100);
    const path = `${p.mailboxId}/${batch}/${String(i).padStart(5, "0")}-${safe}`;
    const { error } = await supabase.storage.from("mail-imports").upload(path, pieces[i].blob, { upsert: false, contentType: "application/octet-stream" });
    if (error) throw new Error(`Could not upload ${p.kind === "mbox" ? "the file" : pieces[i].name}: ${error.message}`);
    paths.push(path);
    sizes.push(pieces[i].blob.size);
    sent += pieces[i].blob.size;
    p.onProgress?.(sent / total);
  }
  return call({
    action: "start_files",
    mailboxId: p.mailboxId,
    kind: p.kind,
    paths,
    sizes,
    folder: p.folder,
    label: p.kind === "mbox" ? p.files[0]?.name || "MBOX file" : `${p.files.length} EML file${p.files.length === 1 ? "" : "s"}`,
  }, "Could not start the import.");
}

export const controlImport = async (id: string, action: "cancel" | "catch_up") => {
  const { error } = await db.rpc("mail_import_control", { target_import: id, action_in: action });
  if (error) fail(error, action === "cancel" ? "Could not stop it." : "Could not catch up.");
};

export const microsoftConsentLink = (schoolId: string, returnTo: string) =>
  call({ action: "microsoft_consent", schoolId, returnTo }, "Could not open Microsoft 365.");
export const microsoftImportEveryone = (schoolId: string, mailboxIds?: string[]) =>
  call({ action: "microsoft_start", schoolId, mailboxIds }, "Could not start the imports.");

// An Outlook .pst read in the browser (src/Pages/Mail/pstImport.ts): the
// import opens, takes each mbox part as it is uploaded, and closes when the
// whole file has been read.
export const startPstImport = (mailboxId: string, label: string) =>
  call({ action: "start_files", mailboxId, kind: "pst", label }, "Could not start the import.");
export const appendPstPart = (importId: string, path: string, size: number) =>
  call({ action: "append_part", importId, path, size }, "Could not add that part.");
export const finishPstParts = (importId: string) => call({ action: "finish_parts", importId }, "Could not finish the import.");

/** How far the server has got with one import (messages looked at). */
export const importFound = async (id: string): Promise<number> => {
  const { data } = await db.from("mail_imports").select("found").eq("id", id).maybeSingle();
  return Number((data as { found?: number } | null)?.found ?? 0);
};
