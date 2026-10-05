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
