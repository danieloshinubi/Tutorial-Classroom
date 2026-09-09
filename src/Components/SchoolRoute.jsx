import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { canUseModule, homeFor } from "../lib/modules";
import { Page, Card, Notice } from "./UI";
import Navbar from "./Navbar/Navbar";

// Gate for everything behind a school role.
//
// Prefer `module`: it reads lib/modules.js, the same list the navbar is built
// from, so a module missing from somebody's navigation is also an address
// they cannot reach by typing it. `require` is the older coarse form — admin,
// staff or admissions — kept for the routes that predate the registry.
//
// Neither is the real boundary. Row level security decides what the database
// will hand over, and it applies whatever the router allows.
const SchoolRoute = ({ require = "admin", module: moduleId }) => {
  const { school, role, roles, isAdmin, isStaff, loading, error, slug } = useSchool();

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

  const allowed = moduleId
    ? canUseModule(moduleId, roles)
    : require === "staff"
    ? isStaff
    : require === "admissions"
    ? isAdmin || role === "admissions"
    : isAdmin;

  // Somewhere they can actually use, rather than a Dashboard their role may
  // not even have.
  if (!allowed) return <Navigate to={homeFor(roles)} replace />;

  return <Outlet />;
};

export default SchoolRoute;
