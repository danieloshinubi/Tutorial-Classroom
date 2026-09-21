import React, { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSchool } from "../context/SchoolContext";
import { supabase } from "../lib/supabaseClient";
import { resolveSlug } from "../lib/tenant";
import { fetchMyApplicantAccount, createApplicantAccount } from "../lib/api";
import { useActionFeedback } from "./Toast";

// Reachable with no school_members row at this tenant — an applicant's own
// portal, and basic account management every signed-in person needs
// regardless of membership.
const MEMBERSHIP_NOT_REQUIRED = ["/Applications", "/Apply/Start", "/Profile", "/Set-Password"];

// How long "no membership yet" has to hold steady before it's trusted. The
// instant right after signing in, SchoolContext can report loading:false
// with membership still null for one settle cycle — not because there
// really is no membership, but because its own fetch for the newly
// available user id hasn't started yet (confirmed live over several
// reproductions: a real member's own sign-in occasionally got bounced to
// /Applications, with the correctly-resolved membership arriving only a
// couple hundred ms too late to stop it). A real applicant's "no
// membership" stays true well past this window; a settling real member's
// doesn't, so waiting this long tells the two apart without ever showing
// a real member their Dashboard's broken-if-wrong fallback.
const CONFIRM_DELAY_MS = 700;

const ProtectedRoute = () => {
  const { session, profile, loading, signOut } = useAuth();
  const { membership, loading: schoolLoading } = useSchool();
  const location = useLocation();
  const { setError } = useActionFeedback();

  // An applicant account (created only through /Apply/Account, never given
  // a school_members row) has no home anywhere else in here — Dashboard,
  // Fees, Chat, all of it assumes a real membership and just hangs
  // ("Loading your courses...", confirmed live) instead of failing loudly.
  // Signing out and back in with no login-flow "send them to /Applications"
  // context (Login.jsx's own redirect defaults to /Dashboard) dropped an
  // applicant straight onto that broken student dashboard. Catching it here
  // covers every way of arriving at a member-only route, not just fresh
  // sign-in — a bookmark, the back button, a stale tab, all the same.
  //
  // Deliberately NOT gated on `school` being truthy — SchoolContext's own
  // `schools` read is itself membership-RLS'd ("not found" and "not a
  // member" arrive the same way, per its own comment), so a true
  // zero-membership applicant always has school === null too. Requiring it
  // here silently defeated this whole check (confirmed live: the redirect
  // never fired for exactly the account it exists for).
  const needsMembership = !MEMBERSHIP_NOT_REQUIRED.some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`)
  );
  const noMembershipSignal = !loading && !!session && !schoolLoading && !membership && needsMembership;

  const [confirmedNoMembership, setConfirmedNoMembership] = useState(false);
  useEffect(() => {
    if (!noMembershipSignal) {
      setConfirmedNoMembership(false);
      return undefined;
    }
    const timer = setTimeout(() => setConfirmedNoMembership(true), CONFIRM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [noMembershipSignal]);

  // "No membership" alone isn't enough to land here — a real member's own
  // account signing into a DIFFERENT, unrelated tenant is also "no
  // membership" and has no more business on that tenant's /Applications
  // than a total stranger would. Confirmed once, a second check asks
  // whether this account is actually an applicant AT THIS SCHOOL
  // (applicant_accounts), with the same first-time-signup allowance
  // ApplicantLogin.jsx uses (pending_applicant_school_id) for someone who
  // just signed up here and hasn't caught up to a real row yet. Anyone
  // left over — no membership, no applicant relationship, no pending
  // signup for this school — gets signed out rather than shown the
  // "Create your applicant account" empty state, which is not this
  // account's to see.
  const [applicantStatus, setApplicantStatus] = useState("unknown");
  useEffect(() => {
    if (!confirmedNoMembership || !session) {
      setApplicantStatus("unknown");
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("public_school", { target_slug: resolveSlug() });
      const schoolId = data?.length ? data[0].id : null;
      if (!schoolId) {
        if (!cancelled) setApplicantStatus("none");
        return;
      }
      let account = await fetchMyApplicantAccount(schoolId, session.user.id).catch(() => null);
      if (!account && session.user.user_metadata?.pending_applicant_school_id === schoolId) {
        const { data: row } = await supabase
          .from("profiles")
          .select("first_name, surname")
          .eq("id", session.user.id)
          .maybeSingle();
        account = await createApplicantAccount({
          schoolId,
          firstName: row?.first_name || "",
          surname: row?.surname || "",
          email: session.user.email,
        }).catch(() => null);
      }
      if (!cancelled) setApplicantStatus(account ? "applicant" : "none");
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmedNoMembership, session]);

  useEffect(() => {
    if (applicantStatus !== "none") return;
    setError("That account has no relationship with this school. Sign in with the correct account, or create an applicant account.");
    signOut().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicantStatus]);

  if (loading) {
    return <p style={{ textAlign: "center", marginTop: "20%" }}>{"Loading..."}</p>;
  }

  if (!session) {
    return <Navigate to="/Login" replace state={{ from: location }} />;
  }

  // Signed in on a password an administrator issued. Nothing else opens until
  // it has been replaced.
  if (profile?.must_change_password && location.pathname !== "/Set-Password") {
    return <Navigate to="/Set-Password" replace />;
  }

  if (confirmedNoMembership) {
    if (applicantStatus === "applicant") {
      return <Navigate to="/Applications" replace />;
    }
    // "none" is being signed out by the effect above — session will drop
    // and the `!session` branch takes over. "unknown" is still checking.
    // Either way, render nothing rather than the member-only page.
    return <p style={{ textAlign: "center", marginTop: "20%" }}>{"Loading..."}</p>;
  }

  // Still within the settle window — render nothing rather than the
  // member-only page underneath, which is exactly the broken state this
  // whole check exists to avoid ever showing.
  if (noMembershipSignal) {
    return <p style={{ textAlign: "center", marginTop: "20%" }}>{"Loading..."}</p>;
  }

  return <Outlet />;
};

export default ProtectedRoute;
