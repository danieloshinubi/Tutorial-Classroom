import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

// Creating an account for someone else, without the service_role key.
//
// The obvious way — supabase.auth.admin.createUser — needs the service_role
// key, which can never ship to a browser, which is why it normally lives in an
// Edge Function. This does it from the client instead: a throwaway Supabase
// client with persistSession off registers the new person, so the
// administrator stays signed in as themselves.
//
// The administrator is shown a generated password to pass on, and the account
// is flagged so the person must replace it the moment they sign in. That is
// the Microsoft 365 pattern: the temporary password is only ever good for
// getting in once.
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

// A password somebody has to read off a screen and type once. No 0/O or 1/l,
// because those get mistyped and then the account looks broken.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const LOWER = "abcdefghijkmnpqrstuvwxyz";

const pick = (set, n) => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => set[b % set.length]).join("");
};

export const temporaryPassword = () =>
  `${pick(ALPHABET, 3)}-${pick(LOWER, 4)}-${pick(DIGITS, 3)}`;

/**
 * Registers a person and returns their user id.
 * Returns { userId, existed } — existed is true when the email already had an
 * account, which is normal for a parent with children at two schools.
 */
export const createAuthUser = async ({ email, firstName, surname, password }) => {
  const client = provisioningClient();

  const { data, error } = await client.auth.signUp({
    email,
    password,
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
