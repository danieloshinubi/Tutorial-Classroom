import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Surfaced as a banner by ConfigNotice so a missing .env is obvious in the UI
// rather than showing up as a stack of failed network calls.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "Supabase is not configured. Copy .env.example to .env and set " +
      "REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY, then restart the dev server."
  );
}

// Which third-party providers this project has switched on. signInWithOAuth
// navigates the browser rather than validating first, so a disabled provider
// would dump the user on a Supabase error page — asking up front lets the UI
// simply not offer it.
export const fetchEnabledProviders = async () => {
  if (!isSupabaseConfigured) return {};
  const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: supabaseAnonKey },
  });
  if (!response.ok) return {};
  const settings = await response.json();
  return settings.external || {};
};

// Placeholders keep createClient from throwing when the env vars are absent,
// so the app still renders and can explain what is missing.
export const supabase = createClient(
  supabaseUrl || "http://localhost:54321",
  supabaseAnonKey || "public-anon-key-placeholder",
  {
    db: { schema: "classroom" },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
