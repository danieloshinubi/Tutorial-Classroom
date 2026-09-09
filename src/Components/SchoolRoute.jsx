import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { Page, Card, Notice } from "./UI";
import Navbar from "./Navbar/Navbar";

// Gate for everything behind a school role.
//
// "require" names the least privileged role that may pass: admin (owner or
// administrator), staff (anyone who works there), admissions (officers plus
// administrators), or platform (the vendor). The role comes from the caller's
// membership of the school in the current subdomain, and row level security
// enforces the same rule again in the database.
const SchoolRoute = ({ require = "admin" }) => {
  const { school, role, isAdmin, isStaff, isPlatformAdmin, loading, error, slug } = useSchool();

  if (loading) {
    return <p style={{ textAlign: "center", marginTop: "15%" }}>{"Loading school..."}</p>;
  }

  // No membership of this subdomain's school — say which school, since the URL
  // is the only thing that decides it.
  if (!school && require !== "platform") {
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

  const allowed =
    require === "platform"
      ? isPlatformAdmin
      : require === "staff"
      ? isStaff
      : require === "admissions"
      ? isAdmin || role === "admissions"
      : isAdmin;
  if (!allowed) return <Navigate to="/Dashboard" replace />;

  return <Outlet />;
};

export default SchoolRoute;
