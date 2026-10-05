import { db, fail } from "./db";
import { supabase } from "./supabaseClient";

// Schoolivio Mail (supabase/235): the caller's mailbox, its folders and
// conversations, drafts and their attachments, and sending. Mail between
// Schoolivio addresses is delivered inside Schoolivio; anything else goes out
// through the school's own Resend account (supabase/236), waiting in the
// Outbox until the school has set that up.

export type Folder = "inbox" | "drafts" | "sent" | "outbox" | "archive" | "junk" | "deleted";
export type Importance = "low" | "normal" | "high";

export interface Address {
  name: string;
  address: string;
}

export interface Mailbox {
  id: string;
  school_id: string;
  address: string;
  display_name: string;
  signature_html: string;
  quota_bytes: number;
  used_bytes: number;
  /** Settings (supabase/241). */
  undo_seconds: number;
  notify_opens: boolean;
  autoreply_enabled: boolean;
  autoreply_start: string | null;
  autoreply_end: string | null;
  autoreply_html: string;
  autoreply_outside: boolean;
}

export interface MailSummary {
  id: string;
  envelope_id: string;
  thread_id: string;
  message_id: string;
  folder: Folder;
  from_address: string;
  from_name: string;
  to_list: Address[];
  cc_list: Address[];
  subject: string;
  snippet: string;
  importance: Importance;
  has_attachments: boolean;
  is_read: boolean;
  is_flagged: boolean;
  is_pinned: boolean;
  sent_at: string | null;
  created_at: string;
  external_pending: number;
  /** A draft set to go later (supabase/241). */
  scheduled_at: string | null;
  recalled_at: string | null;
}

export interface MailMessage extends MailSummary {
  bcc_list: Address[];
  /** Where the sender asked replies to go (received mail, supabase/238). */
  reply_to: Address[];
  body_html: string;
  in_reply_to: string | null;
  previous_folder: string | null;
  size_bytes: number;
  track_opens: boolean;
  read_receipt: boolean;
  is_auto: boolean;
}

export interface Attachment {
  id: string;
  envelope_id: string;
  mailbox_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface DirectoryEntry {
  address: string;
  name: string;
  job_title: string | null;
  avatar_url: string | null;
}

const SUMMARY =
  "id, envelope_id, thread_id, message_id, folder, from_address, from_name, to_list, cc_list, subject, snippet, importance, has_attachments, is_read, is_flagged, is_pinned, sent_at, created_at, external_pending, scheduled_at, recalled_at";

export const FOLDERS: { id: Folder; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "drafts", label: "Drafts" },
  { id: "sent", label: "Sent" },
  { id: "outbox", label: "Outbox" },
  { id: "archive", label: "Archive" },
  { id: "junk", label: "Junk" },
  { id: "deleted", label: "Deleted" },
];

export const myMailbox = async (schoolId: string): Promise<Mailbox> => {
  const { data, error } = await db.rpc("mail_my_mailbox", { target_school: schoolId });
  if (error) fail(error, "Could not open your mailbox.");
  return data as unknown as Mailbox;
};

export const listFolder = async (mailboxId: string, folder: Folder, search = ""): Promise<MailSummary[]> => {
  let q = db.from("mail_messages").select(SUMMARY).eq("mailbox_id", mailboxId).eq("folder", folder);
  const needle = search.trim().replace(/[%,()]/g, " ");
  if (needle) q = q.or(`subject.ilike.%${needle}%,from_name.ilike.%${needle}%,from_address.ilike.%${needle}%,snippet.ilike.%${needle}%`);
  const { data, error } = await q.order("sent_at", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false }).limit(300);
  if (error) fail(error, "Could not load that folder.");
  return (data || []) as unknown as MailSummary[];
};

/** Every message of a conversation in this mailbox, oldest first (Deleted left out unless that is where you are). */
export const loadThread = async (mailboxId: string, threadId: string, includeDeleted: boolean): Promise<MailMessage[]> => {
  let q = db.from("mail_messages").select("*").eq("mailbox_id", mailboxId).eq("thread_id", threadId);
  if (!includeDeleted) q = q.neq("folder", "deleted");
  const { data, error } = await q.neq("folder", "drafts").order("sent_at", { ascending: true, nullsFirst: false });
  if (error) fail(error, "Could not open that conversation.");
  return (data || []) as unknown as MailMessage[];
};

export const loadMessage = async (id: string): Promise<MailMessage> => {
  const { data, error } = await db.from("mail_messages").select("*").eq("id", id).single();
  if (error) fail(error, "Could not open that message.");
  return data as unknown as MailMessage;
};

export const unreadCounts = async (mailboxId: string): Promise<Partial<Record<Folder, number>>> => {
  const { data } = await db.from("mail_messages").select("folder").eq("mailbox_id", mailboxId).eq("is_read", false).in("folder", ["inbox", "junk", "archive"]);
  const out: Partial<Record<Folder, number>> = {};
  (data || []).forEach((r: { folder: string }) => (out[r.folder as Folder] = (out[r.folder as Folder] || 0) + 1));
  const { count } = await db.from("mail_messages").select("id", { count: "exact", head: true }).eq("mailbox_id", mailboxId).eq("folder", "drafts");
  if (count) out.drafts = count;
  const { count: outbox } = await db.from("mail_messages").select("id", { count: "exact", head: true }).eq("mailbox_id", mailboxId).eq("folder", "outbox");
  if (outbox) out.outbox = outbox;
  return out;
};

export interface DraftInput {
  id?: string;
  mailboxId: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  importance: Importance;
  inReplyTo?: string | null;
  threadId?: string | null;
  envelopeId?: string;
  trackOpens?: boolean;
  readReceipt?: boolean;
}

/** Saves a draft (new or existing); returns its id and envelope. */
export const saveDraft = async (d: DraftInput): Promise<{ id: string; envelope_id: string }> => {
  const fields = {
    to_list: d.to as never,
    cc_list: d.cc as never,
    bcc_list: d.bcc as never,
    subject: d.subject,
    body_html: d.html,
    snippet: d.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
    importance: d.importance,
    in_reply_to: d.inReplyTo || null,
    track_opens: !!d.trackOpens,
    read_receipt: !!d.readReceipt,
  };
  if (d.id) {
    const { error } = await db.from("mail_messages").update(fields).eq("id", d.id);
    if (error) fail(error, "Could not save the draft.");
    return { id: d.id, envelope_id: d.envelopeId as string };
  }
  const { data, error } = await db
    .from("mail_messages")
    .insert({ ...fields, mailbox_id: d.mailboxId, folder: "drafts", ...(d.threadId ? { thread_id: d.threadId } : {}) })
    .select("id, envelope_id")
    .single();
  if (error) fail(error, "Could not save the draft.");
  return data as { id: string; envelope_id: string };
};

export interface SendResult {
  delivered: number;
  waiting: number;
  refused: number;
  /** Whether the school's outside mail is on (waiting mail goes now). */
  sending_on: boolean;
}

export const sendDraft = async (draftId: string): Promise<SendResult> => {
  const { data, error } = await db.rpc("mail_send", { target_draft: draftId });
  if (error) fail(error, "Could not send that message.");
  return data as unknown as SendResult;
};

export type DeliveryStatus = "pending" | "sending" | "sent" | "delayed" | "delivered" | "bounced" | "complained" | "failed";

export interface Delivery {
  id: string;
  message_id: string;
  recipient: string;
  kind: "to" | "cc" | "bcc";
  status: DeliveryStatus;
  detail: string | null;
  attempts: number;
  sent_at: string | null;
  updated_at: string;
}

/** How mail to each outside address went, for the sender's own copies. */
export const deliveriesFor = async (messageIds: string[]): Promise<Delivery[]> => {
  if (!messageIds.length) return [];
  const { data, error } = await db
    .from("mail_outbound")
    .select("id, message_id, recipient, kind, status, detail, attempts, sent_at, updated_at")
    .in("message_id", messageIds)
    .order("created_at");
  if (error) fail(error, "Could not load the delivery reports.");
  return (data || []) as unknown as Delivery[];
};

/** Whether the school's outside mail is on, and its domain. */
export const outsideMail = async (schoolId: string): Promise<{ domain: string; sending_enabled: boolean }> => {
  const { data, error } = await db.rpc("mail_settings_get", { target_school: schoolId });
  if (error) fail(error, "Could not load the mail settings.");
  return data as unknown as { domain: string; sending_enabled: boolean };
};

export const setFlags = async (ids: string[], patch: Partial<Pick<MailMessage, "is_read" | "is_flagged" | "is_pinned">>) => {
  if (!ids.length) return;
  const { error } = await db.from("mail_messages").update(patch).in("id", ids);
  if (error) fail(error, "Could not update those messages.");
};

/** Moves messages to a folder; Deleted remembers where each came from, for Restore. */
export const moveTo = async (messages: { id: string; folder: Folder }[], folder: Folder) => {
  for (const m of messages) {
    const { error } = await db
      .from("mail_messages")
      .update({ folder, previous_folder: folder === "deleted" ? m.folder : null })
      .eq("id", m.id);
    if (error) fail(error, "Could not move that message.");
  }
};

export const deleteForever = async (ids: string[]) => {
  if (!ids.length) return;
  const { error } = await db.from("mail_messages").delete().in("id", ids);
  if (error) fail(error, "Could not delete those messages.");
};

export const attachmentsFor = async (envelopeIds: string[]): Promise<Attachment[]> => {
  if (!envelopeIds.length) return [];
  const { data, error } = await db.from("mail_attachments").select("*").in("envelope_id", envelopeIds).order("created_at");
  if (error) return [];
  return (data || []) as unknown as Attachment[];
};

export const uploadAttachment = async (mailboxId: string, envelopeId: string, file: File): Promise<Attachment> => {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`);
  const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
  const path = `${mailboxId}/${envelopeId}/${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await supabase.storage.from("mail").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (upErr) throw new Error(upErr.message || `Could not attach ${file.name}.`);
  const { data, error } = await db
    .from("mail_attachments")
    .insert({ envelope_id: envelopeId, mailbox_id: mailboxId, file_path: path, file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size })
    .select("*")
    .single();
  if (error) {
    await supabase.storage.from("mail").remove([path]);
    fail(error, `Could not attach ${file.name}.`);
  }
  return data as unknown as Attachment;
};

export const removeAttachment = async (a: Attachment) => {
  await db.from("mail_attachments").delete().eq("id", a.id);
  await supabase.storage.from("mail").remove([a.file_path]);
};

/** Carries a received message's files onto a forward. */
export const copyAttachments = async (from: Attachment[], mailboxId: string, envelopeId: string): Promise<Attachment[]> => {
  const out: Attachment[] = [];
  for (const a of from) {
    const path = `${mailboxId}/${envelopeId}/${crypto.randomUUID()}-${a.file_name.replace(/[^\w.\- ]+/g, "_").slice(-120)}`;
    const { error } = await supabase.storage.from("mail").copy(a.file_path, path);
    if (error) continue;
    const { data } = await db
      .from("mail_attachments")
      .insert({ envelope_id: envelopeId, mailbox_id: mailboxId, file_path: path, file_name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes })
      .select("*")
      .single();
    if (data) out.push(data as unknown as Attachment);
  }
  return out;
};

export const openAttachment = async (a: Attachment) => {
  const { data, error } = await supabase.storage.from("mail").createSignedUrl(a.file_path, 60, { download: a.file_name });
  if (error || !data?.signedUrl) throw new Error("Could not open that file.");
  window.open(data.signedUrl, "_blank", "noopener");
};

export const directory = async (schoolId: string): Promise<DirectoryEntry[]> => {
  const { data } = await db.rpc("mail_directory", { target_school: schoolId });
  return (data || []) as unknown as DirectoryEntry[];
};

export const saveSignature = async (mailboxId: string, html: string) => {
  const { error } = await db.from("mail_mailboxes").update({ signature_html: html, updated_at: new Date().toISOString() }).eq("id", mailboxId);
  if (error) fail(error, "Could not save your signature.");
};

export const formatBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

export const addressLabel = (a: Address) => (a.name ? `${a.name} <${a.address}>` : a.address);

/* -------------------------------------------------------------------------- */
/* Outlook essentials (supabase/241)                                          */
/* -------------------------------------------------------------------------- */

export type MailSettingsPatch = Partial<Pick<Mailbox,
  "undo_seconds" | "notify_opens" | "autoreply_enabled" | "autoreply_start" | "autoreply_end" | "autoreply_html" | "autoreply_outside">>;

export const saveMailboxSettings = async (mailboxId: string, patch: MailSettingsPatch) => {
  const { error } = await db.from("mail_mailboxes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", mailboxId);
  if (error) fail(error, "Could not save your mail settings.");
};

/** Send a draft later (null: not any more). */
export const scheduleDraft = async (draftId: string, at: string | null) => {
  const { error } = await db.rpc("mail_schedule", { target_draft: draftId, at_in: at as string });
  if (error) fail(error, "Could not schedule it.");
};

export interface RecallResult {
  removed: string[];
  stopped: string[];
  already_read: string[];
  outside: string[];
}
export const recallMessage = async (messageId: string): Promise<RecallResult> => {
  const { data, error } = await db.rpc("mail_recall", { target_message: messageId });
  if (error) fail(error, "Could not recall it.");
  return data as unknown as RecallResult;
};

export interface MessageStatus {
  track_opens: boolean;
  read_receipt: boolean;
  recalled_at: string | null;
  inside: { name: string; address: string; delivered_at: string; read: boolean }[];
  opens: { recipient: string; via: "inside" | "picture"; first_at: string; last_at: string; times: number }[];
}
export const messageStatus = async (messageId: string): Promise<MessageStatus> => {
  const { data, error } = await db.rpc("mail_message_status", { target_message: messageId });
  if (error) fail(error, "Could not load who has it.");
  return data as unknown as MessageStatus;
};

/** Groups to offer while typing: the school's (all staff, each role) and your own. */
export interface MailGroup {
  address: string;      // group:all, group:role:<role>, group:mine:<id>
  name: string;
  members: number;
  kind: "school" | "mine";
}
export const mailGroups = async (schoolId: string): Promise<MailGroup[]> => {
  const { data, error } = await db.rpc("mail_groups", { target_school: schoolId });
  if (error) fail(error, "Could not load the groups.");
  return (data || []) as unknown as MailGroup[];
};
export const isGroup = (address: string) => address.startsWith("group:");

export interface Contact {
  id: string;
  mailbox_id: string;
  name: string;
  address: string;
  phone: string;
  company: string;
  notes: string;
}
export interface ContactGroup {
  id: string;
  mailbox_id: string;
  name: string;
  members: Address[];
}

export const listContacts = async (mailboxId: string): Promise<Contact[]> => {
  const { data, error } = await db.from("mail_contacts").select("id, mailbox_id, name, address, phone, company, notes").eq("mailbox_id", mailboxId).order("name");
  if (error) fail(error, "Could not load your contacts.");
  return (data || []) as unknown as Contact[];
};
export const saveContact = async (c: Partial<Contact> & { mailbox_id: string; address: string }) => {
  const row = { mailbox_id: c.mailbox_id, name: (c.name || "").trim(), address: c.address.trim().toLowerCase(), phone: c.phone || "", company: c.company || "", notes: c.notes || "", updated_at: new Date().toISOString() };
  const { error } = c.id
    ? await db.from("mail_contacts").update(row).eq("id", c.id)
    : await db.from("mail_contacts").upsert(row, { onConflict: "mailbox_id,address" });
  if (error) fail(error, /check/i.test(error.message) ? "Enter a valid email address." : "Could not save the contact.");
};
export const deleteContact = async (id: string) => {
  const { error } = await db.from("mail_contacts").delete().eq("id", id);
  if (error) fail(error, "Could not delete the contact.");
};

export const listContactGroups = async (mailboxId: string): Promise<ContactGroup[]> => {
  const { data, error } = await db.from("mail_contact_groups").select("id, mailbox_id, name, members").eq("mailbox_id", mailboxId).order("name");
  if (error) fail(error, "Could not load your groups.");
  return (data || []) as unknown as ContactGroup[];
};
export const saveContactGroup = async (g: { id?: string; mailbox_id: string; name: string; members: Address[] }) => {
  const row = { mailbox_id: g.mailbox_id, name: g.name.trim(), members: g.members as never, updated_at: new Date().toISOString() };
  const { error } = g.id ? await db.from("mail_contact_groups").update(row).eq("id", g.id) : await db.from("mail_contact_groups").insert(row);
  if (error) fail(error, "Could not save the group.");
};
export const deleteContactGroup = async (id: string) => {
  const { error } = await db.from("mail_contact_groups").delete().eq("id", id);
  if (error) fail(error, "Could not delete the group.");
};
