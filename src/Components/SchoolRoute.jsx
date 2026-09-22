import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { canUseModule, homeFor } from "../lib/modules";
import { Page, Card, Notice } from "./UI";
import Navbar from "./Navbar/Navbar";

// Gate for everything behind a school role.
//
// Reads lib/modules.js — the same list the navbar is built from — so a
// module missing from somebody's navigation is also an address they cannot
// reach by typing it. The two used to be able to disagree: a hand-written
// `require` prop (admin/staff/admissions) duplicated the role lists here
// instead of reading them, and drifted — "admissions" forgot principal even
// after modules.js already listed them, and "staff" was wider than any
// module actually granted, letting bursar/admissions reach teaching screens
// whose RLS never intended them to. Every route now reads `module` instead.
//
// Neither this nor the navbar is the real boundary. Row level security
// decides what the database will hand over, and it applies regardless of
// anything here.
const SchoolRoute = ({ module: moduleId }) => {
  const { school, roles, loading, error, slug, disabledModules } = useSchool();

  if (loading) {
    return <p style={{ textAlign: "center", marginTop: "15%" }}>{"Loading school..."}</p>;
  }

  // No membership of this subdomain's school — say which school, since the URL
  // is the only thing that decides it.
  if (!school) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="No access">
          <Card style={{ maxWidth: 560 }}>
            <Notice tone="error">
              {error || `You are not a member of ${slug}.schoolivio.com.`}
            </Notice>
            <p style={{ marginBottom: 0, color: "var(--ink-2)" }}>
              {"Ask an administrator at that school to add you, or check the address in the browser bar."}
            </p>
          </Card>
        </Page>
      </div>
    );
  }

  // Also covers a module the school itself has switched off, so typing the
  // address reaches no further than following a link that is no longer there.
  const allowed = canUseModule(moduleId, roles, disabledModules);

  // Somewhere they can actually use, rather than a Dashboard their role may
  // not even have — or that this school has turned off.
  if (!allowed) return <Navigate to={homeFor(roles, disabledModules)} replace />;

  return <Outlet />;
};

export default SchoolRoute;
