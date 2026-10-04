import { db } from "./db";
import { resolveSlug } from "./tenant";

// Sign-in takes an email or a username (supabase/229). A username is looked
// up for this school only, among its active members, and turned into the
// address the account signs in with. An email goes through unchanged.
export const signInEmailFor = async (entered: string): Promise<string | null> => {
  const value = entered.trim();
  if (value.includes("@")) return value;
  const slug = resolveSlug();
  if (!slug) return null;
  const { data, error } = await db.rpc("sign_in_email", { school_slug: slug, username_in: value });
  if (error) throw new Error("Could not check that username. Try again, or use your email address.");
  return (data as string | null) || null;
};
