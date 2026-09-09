import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSchool } from "../context/SchoolContext";
import { Page, Card, Notice } from "./UI";
import Navbar from "./Navbar/Navbar";

// Gate for the school-administration area.
//
// Deliberately separate from RoleRoute: that one reads the legacy
// profiles.role which still drives the classroom, while this reads the role on
// the membership of the school in the current subdomain. Both exist during the
// tenancy transition, and the classroom keeps behaving exactly as it did.
const SchoolRoute = ({ require = "admin" }) => {
  const { school, isAdmin, isStaff, isPlatformAdmin, loading, error, slug } = useSchool();

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
    require === "platform" ? isPlatformAdmin : require === "staff" ? isStaff : isAdmin;
  if (!allowed) return <Navigate to="/Dashboard" replace />;

  return <Outlet />;
};

export default SchoolRoute;
