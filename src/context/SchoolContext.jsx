import React, {
  createContext,
  useRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabaseClient";
import { joinSchool } from "../lib/api";
import { resolveSlug } from "../lib/tenant";
import { applyTenantBranding } from "../lib/branding";
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
  // The id is stable across token refreshes; the user object is not.
  const userId = user?.id ?? null;
  const slug = useMemo(() => resolveSlug(), []);

  const [school, setSchool] = useState(null);
  const [membership, setMembership] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [levels, setLevels] = useState([]);
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Resets `loading` to true THE MOMENT userId changes, during render
  // rather than from inside the effect below. Without this, the render
  // where userId first flips from null to a real id (right after signing
  // in) still shows the PREVIOUS effect run's settled state — loading:
  // false, membership: null, left over from mounting with no user at all
  // — for one frame before the new effect has even started. That frame is
  // enough for a consumer checking "loading is done and there's no
  // membership" (ProtectedRoute) to act on it as final and navigate away,
  // which is exactly what confirmed live: a real member's own sign-in
  // occasionally got bounced to /Applications, correctly-resolved
  // membership arriving a moment too late to stop it.
  const lastUserIdRef = useRef(undefined);
  if (lastUserIdRef.current !== userId) {
    lastUserIdRef.current = userId;
    if (!loading) setLoading(true);
  }

  const load = useCallback(async () => {
    if (!userId) {
      loadedRef.current = false;
      setSchool(null);
      setMembership(null);
      setMemberships([]);
      setLoading(false);
      return;
    }

    const firstTime = !loadedRef.current;
    if (firstTime) setLoading(true);
    setError("");
    try {
      const { data: schoolRow, error: schoolError } = await supabase
        .from("schools")
        .select(
          // disabled_modules drives the navigation and every route guard
          // (see modulesFor/canUseModule). It is an explicit column list, so
          // leaving it out here does not fail loudly — the school simply
          // loads without it, disabledModules reads as empty, and every
          // module stays visible however the admin sets them.
          `id, name, slug, logo_url, theme_color, email, phone, address, timezone, currency, plan, trial_ends_at, is_active,
           disabled_modules,
           signature_url, signatory_name, signatory_title,
           admission_letter_offer_intro, admission_letter_enrolled_intro, admission_letter_closing`
        )
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
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("school_members")
          .select("role, schools ( id, name, slug )")
          .eq("user_id", userId)
          .eq("is_active", true),
        supabase
          .from("platform_admins")
          .select("user_id")
          .eq("user_id", userId)
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
      loadedRef.current = true;
      setLoading(false);
    }
  }, [userId, slug]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  // Recolours the tab (CSS variables), swaps the favicon and sets the tab
  // title for this tenant — covers every page a signed-in member ever sees,
  // since this provider wraps the whole route tree. The pre-auth and
  // applicant-only surfaces (Login, /Apply*, the applicant's own portal)
  // never reach this membership-gated fetch, so they each call the same
  // applyTenantBranding() from their own independent public_school() lookup.
  //
  // Skipped entirely while `school` is null — not "reset to default",
  // just leave whatever's already applied alone. This context's own
  // membership fetch briefly clearing `school` (e.g. the instant someone
  // signs out, or ApplicantLogin.jsx rejecting a staff account mid-page)
  // used to blank the tenant's colour back to Schoolivio's default purple
  // right on top of whichever page was showing — confirmed live, on
  // ApplicantLogin, which had already applied the correct colour itself
  // moments earlier and was never going to re-fetch and reapply it again
  // to win the argument back.
  useEffect(() => {
    if (!school) return;
    applyTenantBranding({
      name: school.name,
      logoUrl: school.logo_url,
      themeColor: school.theme_color,
    });
  }, [school]);

  // A school stays fully usable while plan === 'trial' and trial_ends_at is
  // in the future (or unset — a school the platform console created
  // directly, never a trial). Once it lapses, App.js's TrialGate blocks the
  // routed app rather than letting every RLS-guarded write fail one at a time.
  const trialExpired = Boolean(
    school?.plan === "trial" &&
      school?.trial_ends_at &&
      new Date(school.trial_ends_at) < new Date()
  );

  const role = membership?.role || null;

  // Every active role this person holds AT THIS SCHOOL. Usually one, but a
  // proprietor who also teaches holds two and should get the union of both
  // sets of modules rather than whichever happened to be read first.
  const roles = useMemo(() => {
    const held = new Set();
    if (role) held.add(role);
    for (const row of memberships) {
      if (row.schools?.id && school?.id && row.schools.id === school.id && row.role) {
        held.add(row.role);
      }
    }
    return [...held];
  }, [role, memberships, school]);

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
      // Modules this school has switched off. Read straight from the school
      // row so navigation and route guards cannot disagree about it, and
      // defaulted to [] for a school row loaded before this column existed.
      disabledModules: school?.disabled_modules || [],
      membership,
      memberships,
      role,
      roles,
      // Platform administration is no longer folded into these. It is not a
      // role at any school — it lives on its own host, admin.schoolivio.com,
      // so granting school powers here would be exactly the mixing-up that
      // separating the console was meant to end.
      isPlatformAdmin,
      trialExpired,
      // Convenience predicates so pages don't repeat role arrays.
      isAdmin: roles.some((r) => r === "owner" || r === "admin"),
      isPrincipal: roles.includes("principal"),
      isBursar: roles.includes("bursar"),
      isStaff: roles.some((r) =>
        ["owner", "admin", "principal", "teacher", "bursar", "admissions"].includes(r)
      ),
      isTeacher: roles.includes("teacher"),
      isParent: roles.includes("parent"),
      loading: loading || authLoading,
      error,
      reload: load,
    }),
    [slug, school, levels, membership, memberships, role, roles, isPlatformAdmin, trialExpired, loading, authLoading, error, load]
  );

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
};

export default SchoolContext;
