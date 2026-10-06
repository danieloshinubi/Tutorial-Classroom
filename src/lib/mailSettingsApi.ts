import { db, fail } from "./db";
import { supabase } from "./supabaseClient";

// School admin → Mail settings (supabase/236): the school's own domain and
// Resend account, the DNS records to add, and everyone's address. The key
// goes to the mail-settings Edge Function once and is never read back.

export interface DnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  priority: number | null;
  status: string;
  ttl: string | number;
}

export interface MailSettings {
  domain: string | null;
  fallback_domain: string;
  region: string;
  domain_status: string;
  dns_records: DnsRecord[];
  has_key: boolean;
  key_hint: string | null;
  reports_on: boolean;
  sending_enabled: boolean;
  /** Receiving outside mail (supabase/238): switched on in Resend, and its MX record's status. */
  receiving_enabled: boolean;
  receiving_status: string;
  /** Outside messages received in the past 7 days. */
  received_week: number;
  last_error: string | null;
  checked_at: string | null;
  connected_at: string | null;
  /** When Schoolivio last added the records of a <slug>.schoolivio.com school (supabase/239). */
  platform_dns_at: string | null;
  /** Microsoft 365 approved by the school (supabase/240), and whether Schoolivio offers it at all. */
  microsoft_consent_at: string | null;
  microsoft_ready: boolean;
  waiting: number;
}

export interface MailPerson {
  user_id: string;
  name: string;
  job_title: string | null;
  role: string;
  mailbox_id: string | null;
  address: string | null;
  used_bytes: number | null;
  quota_bytes: number | null;
  /** Suspended when false (supabase/242). */
  is_active: boolean | null;
  /** Other addresses that reach this person. */
  aliases: string[] | null;
}

export const getMailSettings = async (schoolId: string): Promise<MailSettings> => {
  const { data, error } = await db.rpc("mail_settings_get", { target_school: schoolId });
  if (error) fail(error, "Could not load the mail settings.");
  return data as unknown as MailSettings;
};

const call = async (body: Record<string, unknown>, fallback: string) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  const { data, error } = await supabase.functions.invoke("mail-settings", {
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
  return data as { ok: boolean; status?: string; warning?: string | null };
};

export const connectMail = (p: { schoolId: string; domain: string; apiKey?: string; region: string }) =>
  call({ action: "connect", ...p }, "Could not connect the school's Resend account.");
export const verifyMailDomain = (schoolId: string) => call({ action: "verify", schoolId }, "Could not check the DNS records.");
export const refreshMailDomain = (schoolId: string) => call({ action: "refresh", schoolId }, "Could not check the domain.");
export const setReceiving = (schoolId: string, enable: boolean) =>
  call({ action: "receiving", schoolId, enable }, "Could not change receiving.");
export const disconnectMail = (schoolId: string) => call({ action: "disconnect", schoolId }, "Could not disconnect.");

export const mailPeople = async (schoolId: string): Promise<MailPerson[]> => {
  const { data, error } = await db.rpc("mail_admin_people", { target_school: schoolId });
  if (error) fail(error, "Could not load the staff's addresses.");
  return ((data || []) as unknown as MailPerson[]).sort((a, b) => a.name.localeCompare(b.name));
};

export const createAllMailboxes = async (schoolId: string): Promise<number> => {
  const { data, error } = await db.rpc("mail_admin_create_all", { target_school: schoolId });
  if (error) fail(error, "Could not create the mailboxes.");
  return Number(data) || 0;
};

export const setMailAddress = async (mailboxId: string, address: string) => {
  const { error } = await db.rpc("mail_admin_set_address", { target_mailbox: mailboxId, new_address: address });
  if (error) fail(error, "Could not change that address.");
};

export const moveAllToDomain = async (schoolId: string): Promise<number> => {
  const { data, error } = await db.rpc("mail_admin_move_to_domain", { target_school: schoolId });
  if (error) fail(error, "Could not move the addresses.");
  return Number(data) || 0;
};

/* -------------------------------------------------------------------------- */
/* The admin's tools (supabase/242)                                           */
/* -------------------------------------------------------------------------- */

export type SharedAccess = "full" | "on_behalf" | "read";

export interface SharedMailbox {
  id: string;
  name: string;
  address: string;
  aliases: string[];
  is_active: boolean;
  used_bytes: number;
  quota_bytes: number;
  members: { user_id: string; access: SharedAccess; name: string }[];
}

export interface GroupAddress {
  id: string;
  name: string;
  address: string;
  allow_outside: boolean;
  members: { mailbox_id: string; name: string; address: string }[];
}

const rpc = async <T,>(fn: string, args: Record<string, unknown>, fallback: string): Promise<T> => {
  const { data, error } = await (db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) fail(error, fallback);
  return data as T;
};

export const sharedMailboxes = (schoolId: string) => rpc<SharedMailbox[]>("mail_admin_shared", { target_school: schoolId }, "Could not load the shared mailboxes.").then((d) => d || []);
export const saveSharedMailbox = (p: { schoolId: string; id?: string | null; name: string; address: string; members: { user_id: string; access: SharedAccess }[] }) =>
  rpc("mail_admin_save_shared", { target_school: p.schoolId, target_mailbox: p.id ?? null, name_in: p.name, address_in: p.address, members: p.members }, "Could not save the shared mailbox.");

export const groupAddresses = (schoolId: string) => rpc<GroupAddress[]>("mail_admin_lists", { target_school: schoolId }, "Could not load the group addresses.").then((d) => d || []);
export const saveGroupAddress = (p: { schoolId: string; id?: string | null; name: string; address: string; allowOutside: boolean; members: string[] }) =>
  rpc<string>("mail_admin_save_list", { target_school: p.schoolId, target_list: p.id ?? null, name_in: p.name, address_in: p.address, allow_outside_in: p.allowOutside, member_mailboxes: p.members }, "Could not save the group address.");
export const deleteGroupAddress = (id: string) => rpc("mail_admin_delete_list", { target_list: id }, "Could not delete the group address.");

export const setMailAliases = (mailboxId: string, aliases: string[]) => rpc("mail_admin_set_aliases", { target_mailbox: mailboxId, aliases }, "Could not save the other addresses.");
export const setMailQuota = (mailboxId: string, gigabytes: number) => rpc("mail_admin_set_quota", { target_mailbox: mailboxId, gigabytes }, "Could not change the storage.");
export const setMailboxActive = (mailboxId: string, active: boolean) => rpc("mail_admin_set_active", { target_mailbox: mailboxId, active }, active ? "Could not resume it." : "Could not suspend it.");
export const convertToShared = (mailboxId: string, members: { user_id: string; access: SharedAccess }[]) =>
  rpc("mail_admin_convert_to_shared", { target_mailbox: mailboxId, members }, "Could not convert it.");
export const deleteMailbox = (schoolId: string, mailboxId: string, confirm: string) =>
  call({ action: "delete_mailbox", schoolId, mailboxId, confirm }, "Could not delete the mailbox.");

/** Safety (supabase/243): sending limits, how long Deleted and Junk keep
 * mail, senders blocked for the whole school, and phishing reports. */
export interface PhishingReport {
  id: string;
  sender: string;
  subject: string;
  copies_moved: number;
  created_at: string;
  reported_by: string | null;
}
export interface MailSafety {
  max_outside_hour: number;
  max_outside_day: number;
  deleted_days: number;
  junk_days: number;
  blocked_senders: string[];
  reports: PhishingReport[];
}
export type MailSafetyPatch = Partial<Omit<MailSafety, "reports">>;
export const mailSafety = (schoolId: string, patch: MailSafetyPatch | null = null) =>
  rpc<MailSafety>("mail_admin_safety", { target_school: schoolId, patch: patch ?? {} }, "Could not load the mail safety settings.");
