import { supabase } from "../lib/supabaseClient";

// Adds someone to the console through the platform-create-admin Edge Function
// (supabase/223): a new account with a temporary password, or console access
// for an existing account, which keeps its own password.
export interface CreatedAdmin {
  email: string;
  name: string;
  /** Shown once; null when they already had an account. */
  password: string | null;
  existed: boolean;
  accessType: "approval" | "breakglass";
}

export const createPlatformAdmin = async (input: {
  email: string;
  firstName: string;
  surname: string;
  /** How they get into schools (supabase/224). */
  accessType: "approval" | "breakglass";
}): Promise<CreatedAdmin> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");

  const { data, error } = await supabase.functions.invoke("platform-create-admin", {
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
    throw new Error(detail || error.message || "Could not add that person.");
  }
  if (data?.error) throw new Error(data.error);
  return data as CreatedAdmin;
};
