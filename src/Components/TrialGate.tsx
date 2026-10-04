import React, { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { useAuth } from "../context/AuthContext";
import { Page, Card, Button, formatDate } from "./UI";
import { PlanPayCard } from "../Pages/SchoolAdmin/BillingPanel";

// Blocks the routed app once a self-serve trial has lapsed, or a paid month
// ended more than 3 days ago (supabase/225), as a hard stop rather than
// letting every write fail one RLS rejection at a time. Sits below the Navbar
// (so signing out still works) and above every route. Owners and admins can
// pay right here with Paystack, and the school opens again at once.
//
// While the school is still open, owners and admins see a gentle banner in
// the last 5 days of a trial or paid month, as the reminder emails go out.

const daysLeft = (iso: string | null | undefined) => {
  if (!iso) return null;
  const end = new Date(iso.length <= 10 ? `${iso}T23:59:59` : iso).getTime();
  return Math.ceil((end - Date.now()) / 86400000);
};

const EndingBanner = () => {
  const { school, isAdmin } = useSchool();
  const location = useLocation();
  if (!isAdmin || !school) return null;
  const onTrial = school.plan === "trial";
  const ends = (onTrial ? school.trial_ends_at : school.paid_until) as string | null | undefined;
  const left = daysLeft(ends);
  if (left === null || left > 5) return null;
  if (location.pathname === "/School" && location.search.includes("tab=billing")) return null;
  const what = onTrial ? "Your free trial" : "Your Schoolivio plan";
  const when = left <= 0 ? (left === 0 ? "ends today" : `ended ${formatDate(ends, { withTime: false })}`) : left === 1 ? "ends tomorrow" : `ends in ${left} days`;
  return (
    <div className="plan-ending-banner" role="status">
      <span>{`${what} ${when}. Start your monthly payment to keep everything running.`}</span>
      <Link className="btn btn-sm btn-primary" to="/School?tab=billing">
        {"Pay now"}
      </Link>
    </div>
  );
};

const TrialGate = ({ children }: { children?: ReactNode }) => {
  const { school, trialExpired, planLapsed, loading, isAdmin } = useSchool();
  const { signOut } = useAuth();

  if (loading) return <>{children}</>;
  if (!trialExpired) {
    return (
      <>
        <EndingBanner />
        {children}
      </>
    );
  }

  const ended = planLapsed ? (school?.paid_until as string | null) : (school?.trial_ends_at as string | null);
  return (
    <div className="shell">
      <Page title={planLapsed ? "Your plan has ended" : "Your trial has ended"}>
        <Card style={{ maxWidth: 620 }}>
          <p style={{ marginTop: 0 }}>
            {/* No length here: schools that started before 180 had 45 days, then
                30, now 21 (206), and this message reaches all of them. */}
            {`${school?.name || "Your school"}'s ${planLapsed ? "paid month" : "free trial"} ended on ${
              ended ? formatDate(ended, { withTime: false }) : "its due date"
            }. Everything you set up is still here. It just isn't reachable until the school's plan is paid.`}
          </p>
          {isAdmin ? null : (
            <p style={{ color: "var(--ink-2)" }}>{"Ask your school's owner or administrator to pay for the school's plan to continue."}</p>
          )}
          <Button variant="secondary" onClick={signOut}>
            {"Sign out"}
          </Button>
        </Card>
        {isAdmin ? (
          <div style={{ maxWidth: 620 }}>
            <PlanPayCard compact />
          </div>
        ) : null}
      </Page>
    </div>
  );
};

export default TrialGate;
