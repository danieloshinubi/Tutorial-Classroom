// Data access for the public marketing site + self-serve trial signup only.
//
// Kept out of lib/api.js the same way platformApi.js is: this runs before
// any tenant is resolved, for a visitor who isn't a member of anything yet.
import { supabase } from "./supabaseClient";

export const checkSlugAvailable = async (candidate) => {
  const { data, error } = await supabase.rpc("slug_available", { candidate });
  if (error) throw error;
  return Boolean(data);
};

// Schoolivio's plan prices per currency, set in Console → Settings
// (supabase/227). Public, so the pricing section can show them.
export const fetchPlanPrices = async () => {
  const { data, error } = await supabase.from("platform_plan_prices").select("currency, starter, growth");
  if (error) throw error;
  return data || [];
};

export const startTrialSchool = async ({ name, slug, currency, timezone, country }) => {
  const { data, error } = await supabase.rpc("start_trial_school", {
    school_name: name,
    school_slug: slug,
    currency_in: currency || "NGN",
    timezone_in: timezone || "Africa/Lagos",
    country_in: country || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};
