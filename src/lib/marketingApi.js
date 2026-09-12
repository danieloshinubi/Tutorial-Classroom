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

export const startTrialSchool = async ({ name, slug }) => {
  const { data, error } = await supabase.rpc("start_trial_school", {
    school_name: name,
    school_slug: slug,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};
