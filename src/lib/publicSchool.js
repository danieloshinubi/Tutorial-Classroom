import { supabase } from "./supabaseClient";

// A school's public details (public_school), looked up once per page load
// and shared. The address check, the sign-in page, the route guard and the
// admissions pages all ask for the same school as the page opens; each used
// to send its own request. Same { data, error } shape as supabase.rpc. A
// failed lookup is not kept, so the next caller tries again.
const lookups = new Map();

export const fetchPublicSchool = (slug) => {
  const key = String(slug || "").toLowerCase();
  if (!lookups.has(key)) {
    const pending = Promise.resolve(supabase.rpc("public_school", { target_slug: key })).then((result) => {
      if (result.error) lookups.delete(key);
      return result;
    }, (err) => {
      lookups.delete(key);
      throw err;
    });
    lookups.set(key, pending);
  }
  return lookups.get(key);
};
