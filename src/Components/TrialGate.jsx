import React from "react";
import { useSchool } from "../context/SchoolContext";
import { useAuth } from "../context/AuthContext";
import { Page, Card, Button, formatDate } from "./UI";

// Blocks the routed app once a self-serve trial has lapsed — a hard stop
// rather than letting every write fail one RLS rejection at a time. Sits
// below the Navbar (so signing out still works) and above every route.
const TrialGate = ({ children }) => {
  const { school, trialExpired, loading, isAdmin } = useSchool();
  const { signOut } = useAuth();

  if (loading || !trialExpired) return children;

  return (
    <div className="shell">
      <Page title="Your trial has ended">
        <Card style={{ maxWidth: 560 }}>
          <p style={{ marginTop: 0 }}>
            {`${school?.name || "Your school"}'s 45-day trial ended on ${
              school?.trial_ends_at ? formatDate(school.trial_ends_at, { withTime: false }) : "its due date"
            }. Everything you set up is still here — it just isn't reachable until the school moves to a plan.`}
          </p>
          {isAdmin ? (
            <p style={{ color: "var(--ink-2)" }}>
              {"As the school's owner or administrator, contact "}
              <a href="mailto:hello@schoolivio.com">hello@schoolivio.com</a>
              {" to continue."}
            </p>
          ) : (
            <p style={{ color: "var(--ink-2)" }}>
              {"Ask your school's administrator to get in touch with Schoolivio to continue."}
            </p>
          )}
          <Button variant="secondary" onClick={signOut}>{"Sign out"}</Button>
        </Card>
      </Page>
    </div>
  );
};

export default TrialGate;
