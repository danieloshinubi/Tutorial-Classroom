import React, { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Link,
  NavLink,
} from "react-router-dom";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { amIPlatformAdmin } from "../lib/platformApi";
import ConfigNotice from "../Components/ConfigNotice";
import PlatformLogin from "./PlatformLogin";
import Overview from "./Overview";
import Tenants from "./Tenants";
import TenantDetail from "./TenantDetail";
import { Page, Card, Notice, Button } from "../Components/UI";

// The console at admin.schoolivio.com.
//
// This is a separate application, not a page inside a school. There is no
// SchoolProvider here and no tenant subdomain to resolve: the console exists
// above every school, so binding it to one would be wrong. Nothing under
// /platform/ imports lib/api.js.

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/Tenants", label: "Schools" },
];

const PlatformNav = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand" title="Schoolivio platform">
          <span className="brand-mark platform-mark">{"S"}</span>
          <span className="brand-name">
            {"Schoolivio"}
            <span className="brand-suffix">{"platform"}</span>
          </span>
        </Link>

        <nav className="nav-links">
          {NAV.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <span className="nav-spacer" />

        <span className="nav-user" title={user?.email || ""}>
          <span className="nav-avatar brand-mark platform-mark">{"SV"}</span>
          <span style={{ minWidth: 0 }}>
            <div className="nav-name">{user?.email}</div>
            <div className="nav-role">{"platform"}</div>
          </span>
        </span>

        <button type="button" className="btn btn-secondary btn-sm" onClick={signOut}>
          {"Sign out"}
        </button>
      </div>
    </header>
  );
};

// Being signed in is not enough here. A school's administrator has a perfectly
// good account and no business in this console, so the answer comes from
// classroom.platform_admins rather than from any school membership.
const PlatformGate = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState(null);

  const check = useCallback(() => {
    if (!user) {
      setAllowed(null);
      return;
    }
    amIPlatformAdmin()
      .then(setAllowed)
      .catch(() => setAllowed(false));
  }, [user]);

  useEffect(check, [check]);

  if (authLoading) {
    return <p style={{ textAlign: "center", marginTop: "15%" }}>{"Loading..."}</p>;
  }

  if (!user) return <PlatformLogin />;

  if (allowed === null) {
    return <p style={{ textAlign: "center", marginTop: "15%" }}>{"Checking access..."}</p>;
  }

  if (!allowed) {
    return (
      <div className="shell">
        <Page title="Not a platform administrator">
          <Card style={{ maxWidth: 560 }}>
            <Notice tone="error">
              {"This console is for Schoolivio staff. Your account is not on it."}
            </Notice>
            <p style={{ color: "var(--ink-2)" }}>
              {"If you administer a school, its portal is at your school's own address — "}
              <code>{"yourschool.schoolivio.com"}</code>
              {" — not here."}
            </p>
            <SignOutButton />
          </Card>
        </Page>
      </div>
    );
  }

  return children;
};

const SignOutButton = () => {
  const { signOut } = useAuth();
  return (
    <Button variant="secondary" onClick={signOut}>
      {"Sign out"}
    </Button>
  );
};

const PlatformApp = () => (
  <Router>
    <AuthProvider>
      <ConfigNotice />
      <PlatformGate>
        <div className="shell platform">
          <PlatformNav />
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/Tenants" element={<Tenants />} />
            <Route path="/Tenants/:schoolId" element={<TenantDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </PlatformGate>
    </AuthProvider>
  </Router>
);

export default PlatformApp;
