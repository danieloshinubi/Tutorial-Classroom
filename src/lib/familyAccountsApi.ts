import { supabase } from "./supabaseClient";
import { db } from "./db";

// IT making a newly admitted pupil's account and their parent's from the
// "New pupil account" ticket (supabase/229, Edge Function
// create-family-accounts).

export interface FamilyRequest {
  application_id: string;
  reference: string;
  status: string;
  school_name: string;
  slug: string;
  first_name: string;
  middle_name: string | null;
  surname: string;
  pupil_email: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
  guardian_relation: string | null;
  applied_with: string | null;
  student_account_id: string | null;
  student_username: string | null;
  parent_linked: boolean;
}

export interface FamilyResult {
  username: string;
  pupilEmail: string | null;
  parentEmail: string;
  parentNew: boolean;
  emailedTo: string | null;
  /** Only when nobody could be emailed: shown once for IT to pass on. */
  credentials: { pupilPassword: string; parentPassword: string | null } | null;
}

/** The request behind a ticket, or null when it is not one or the viewer is not IT. */
export const fetchFamilyRequest = async (ticketId: string): Promise<FamilyRequest | null> => {
  const { data, error } = await db.rpc("family_accounts_request", { target_ticket: ticketId });
  if (error) return null;
  return (data as unknown as FamilyRequest) || null;
};

export const createFamilyAccounts = async (input: { ticketId: string; username: string; pupilEmail: string }): Promise<FamilyResult> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  const { data, error } = await supabase.functions.invoke("create-family-accounts", {
    body: input,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    let detail = "";
    try {
      detail = (await (error as { context?: Response }).context?.json())?.error || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || "Could not create the accounts.");
  }
  if (data?.error) throw new Error(data.error);
  return data as FamilyResult;
};

/** The suggested username, as the server would make it. */
export const suggestUsername = (first: string, surname: string) =>
  [first, surname]
    .map((s) =>
      String(s || "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
    )
    .filter(Boolean)
    .join(".");
