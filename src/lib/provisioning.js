import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

// Creating an account for someone else, without the service_role key.
//
// The obvious way — supabase.auth.admin.createUser — needs the service_role
// key, which can never ship to a browser, which is why it normally lives in an
// Edge Function. This does it from the client instead:
//
//   1. A throwaway Supabase client with persistSession off signs the new
//      person up. Because it keeps no session, the administrator stays signed
//      in as themselves.
//   2. The password is random, generated here and never shown to anyone. The
//      administrator does not know it and cannot know it.
//   3. A reset email lets the new person set their own.
//
// No privilege is gained: anyone can already register themselves at /Signup.
// What an administrator adds is the school membership, and that insert is
// still guarded by row level security.

const url = process.env.REACT_APP_SUPABASE_URL;
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// A separate storage key as well as persistSession:false, so this client can
// never touch the tokens the real session is using.
const provisioningClient = () =>
  createClient(url, anonKey, {
    db: { schema: "classroom" },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "schoolivio-provisioning",
    },
  });

const randomPassword = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Registers a person and returns their user id.
 * Returns { userId, existed } — existed is true when the email already had an
 * account, which is normal for a parent with children at two schools.
 */
export const createAuthUser = async ({ email, firstName, surname }) => {
  const client = provisioningClient();

  const { data, error } = await client.auth.signUp({
    email,
    password: randomPassword(),
    options: {
      data: { first_name: firstName || "", surname: surname || "" },
    },
  });

  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      return { userId: null, existed: true };
    }
    throw error;
  }

  // Supabase deliberately hides whether an address is already taken: rather
  // than erroring, it returns a decoy user with an empty identities array.
  // Treating that id as real would attach the membership to the wrong person,
  // so it is caught here.
  const user = data.user;
  if (!user || (Array.isArray(user.identities) && user.identities.length === 0)) {
    return { userId: null, existed: true };
  }

  // With email confirmation on there is a user but no session, which is what
  // we want anyway — the administrator stays signed in as themselves.
  return { userId: user.id, existed: false };
};

// Sends the "set your password" email. Failure here is not fatal: the account
// exists, and the person can use Forgot Password themselves.
export const invitePasswordSetup = async (email) => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/Reset-Password`,
  });
  if (error) throw error;
};
