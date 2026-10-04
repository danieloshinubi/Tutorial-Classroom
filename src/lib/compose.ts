import { supabase } from "./supabaseClient";

// The writing helper's call to the ai-assistant Edge Function ("compose"
// surface, supabase/228). Returns only the text to put in the box.

export type ComposeAction = "write" | "improve" | "shorter" | "formal" | "friendly" | "fix";

const FUNCTION_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-assistant`;

export const composeText = async (input: {
  schoolId: string;
  action: ComposeAction;
  request: string;
  draft: string;
  field: string;
  page: string;
  context: string;
  /** What the writer can see around the box (page and dialog text), capped. */
  details: string;
}): Promise<string> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  let response: Response;
  try {
    response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.REACT_APP_SUPABASE_ANON_KEY || "",
      },
      body: JSON.stringify({ surface: "compose", ...input }),
    });
  } catch {
    throw new Error("Could not reach the writing helper. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || "It could not write that just now. Try again.");
  if (!data.text) throw new Error("It came back empty. Try saying a little more about what you want.");
  return String(data.text);
};
