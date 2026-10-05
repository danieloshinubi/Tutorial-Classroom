import { db, fail } from "./db";
import { supabase } from "./supabaseClient";
import type { DnsRecord } from "./mailSettingsApi";

// Console → Mail (supabase/239): every school's mail at a glance, the Vercel
// token for schoolivio.com's DNS, and adding a schoolivio.com school's mail
// records in one click (platform-mail Edge Function).

export interface SchoolMail {
  school_id: string;
  name: string;
  slug: string;
  domain: string | null;
  /** own: the school's own domain; schoolivio: <slug>.schoolivio.com; none: not set up. */
  kind: "own" | "schoolivio" | "none";
  has_key: boolean;
  domain_status: string;
  sending_enabled: boolean;
  receiving_enabled: boolean;
  receiving_status: string;
  reports_on: boolean;
  checked_at: string | null;
  platform_dns_at: string | null;
  last_error: string | null;
  dns_records: DnsRecord[];
  needs_dns: boolean;
  mailboxes: number;
  used_bytes: number;
  waiting: number;
  failed_week: number;
  sent_week: number;
  received_week: number;
}

export interface MailOverview {
  vercel_connected: boolean;
  vercel_team_id: string | null;
  schools: SchoolMail[];
}

export const mailOverview = async (): Promise<MailOverview> => {
  const { data, error } = await db.rpc("platform_mail_overview");
  if (error) fail(error, "Could not load the schools' mail.");
  return data as unknown as MailOverview;
};

const call = async (body: Record<string, unknown>, fallback: string) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  const { data, error } = await supabase.functions.invoke("platform-mail", {
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
  return data as { ok: boolean; added?: number; pinned?: number; status?: string };
};

export const saveVercelToken = (token: string, teamId: string) => call({ action: "vercel", token, teamId }, "Could not save the Vercel token.");
export const addSchoolDns = (schoolId: string) => call({ action: "dns", schoolId }, "Could not add the DNS records.");

/** Tekktopia's Microsoft app for Microsoft 365 imports (supabase/240). */
export const microsoftApp = async (): Promise<{ client_id: string | null; ready: boolean }> => {
  const { data, error } = await db.rpc("platform_microsoft");
  if (error) fail(error, "Could not load the Microsoft settings.");
  return (data as unknown as { client_id: string | null; ready: boolean }) ?? { client_id: null, ready: false };
};
export const saveMicrosoftApp = (clientId: string, secret: string) => call({ action: "microsoft", clientId, secret }, "Could not save the Microsoft app.");
