import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabaseClient";
import { joinSchool } from "../lib/api";
import { resolveSlug } from "../lib/tenant";
import { useAuth } from "./AuthContext";

const SchoolContext = createContext(null);

export const useSchool = () => {
  const context = useContext(SchoolContext);
  if (!context) throw new Error("useSchool must be used inside a SchoolProvider");
  return context;
};

// Resolves the tenant from the subdomain and the signed-in user's membership
// of it. Everything downstream scopes its queries with `school.id`; row level
// security is what actually enforces the boundary.
export const SchoolProvider = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const slug = useMemo(() => resolveSlug(), []);

  const [school, setSchool] = useState(null);
  const [membership, setMembership] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) {
      setSchool(null);
      setMembership(null);
      setMemberships([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data: schoolRow, error: schoolError } = await supabase
        .from("schools")
        .select("id, name, slug, logo_url, timezone, currency, plan, is_active")
        .eq("slug", slug)
        .maybeSingle();

      if (schoolError) throw schoolError;

      // RLS hides schools you do not belong to, so "not found" and "not a
      // member" arrive the same way. Say so plainly rather than guessing.
      if (!schoolRow) {
        setSchool(null);
        setError(`You do not have access to ${slug}.schoolivio.com.`);
        return;
      }
      setSchool(schoolRow);

      const [{ data: mine }, { data: all }, { data: platform }] = await Promise.all([
        supabase
          .from("school_members")
          .select("id, role, is_active")
          .eq("school_id", schoolRow.id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("school_members")
          .select("role, schools ( id, name, slug )")
          .eq("user_id", user.id)
          .eq("is_active", true),
        supabase
          .from("platform_admins")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      // The school's own class names — "JSS 1", "Year 7", whatever they use.
      const { data: levelRows } = await supabase
        .from("levels")
        .select("year, label")
        .eq("school_id", schoolRow.id)
        .order("year");
      setLevels(levelRows || []);

      // A person who signed themselves up has no membership yet. Ask the
      // database to add them as a student — it refuses if the school is
      // invitation-only, which is the right answer.
      let membershipRow = mine;
      if (!membershipRow) {
        membershipRow = await joinSchool(slug).catch(() => null);
      }

      setMembership(membershipRow || null);
      setMemberships((all || []).filter((row) => row.schools));
      setIsPlatformAdmin(Boolean(platform));
    } catch (err) {
      setError(err.message || "Could not load this school.");
    } finally {
      setLoading(false);
    }
  }, [user, slug]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  const role = membership?.role || null;

  const value = useMemo(
    () => ({
      slug,
      school,
      levels,
      // Falls back to the raw number only if a class was deleted out from
      // under a course that still references it.
      labelFor: (year) =>
        levels.find((row) => String(row.year) === String(year))?.label ?? String(year),
      reloadLevels: load,
      schoolId: school?.id || null,
      membership,
      memberships,
      role,
      isPlatformAdmin,
      // Convenience predicates so pages don't repeat role arrays.
      isAdmin: role === "owner" || role === "admin" || isPlatformAdmin,
      isStaff: ["owner", "admin", "teacher", "bursar", "admissions"].includes(role) || isPlatformAdmin,
      isTeacher: role === "teacher",
      isParent: role === "parent",
      loading: loading || authLoading,
      error,
      reload: load,
    }),
    [slug, school, levels, membership, memberships, role, isPlatformAdmin, loading, authLoading, error, load]
  );

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
};

export default SchoolContext;
