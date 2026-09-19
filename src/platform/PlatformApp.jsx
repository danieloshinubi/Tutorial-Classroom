import React, { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Link,
  NavLink,
} from "react-router-dom";
import { Icon } from "react-icons-kit";
import { grid } from "react-icons-kit/feather/grid";
import { layers } from "react-icons-kit/feather/layers";
import { logOut } from "react-icons-kit/feather/logOut";
import { chevronsLeft } from "react-icons-kit/feather/chevronsLeft";
import { chevronsRight } from "react-icons-kit/feather/chevronsRight";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { amIPlatformAdmin } from "../lib/platformApi";
import ConfigNotice from "../Components/ConfigNotice";
import PlatformLogin from "./PlatformLogin";
import Overview from "./Overview";
import Tenants from "./Tenants";
import TenantDetail from "./TenantDetail";
import { Page, Card, Notice, Button } from "../Components/UI";
import { Mark } from "../Components/Logo";

// The console at admin.schoolivio.com.
//
// This is a separate application, not a page inside a school. There is no
// SchoolProvider here and no tenant subdomain to resolve: the console exists
// above every school, so binding it to one would be wrong. Nothing under
// /platform/ imports lib/api.js.

const NAV = [
  { to: "/", label: "Overview", icon: grid, end: true },
  { to: "/Tenants", label: "Schools", icon: layers, end: false },
];

// The same .side + .topbar shell every school's own app already uses
// (Components/Navbar/Navbar.jsx) — a top strip of two links had already run
// out of room once (that's the whole reason the tenant app has a sidebar at
// all), and a console meant to grow past "Overview" and "Schools" shouldn't
// start from the thing that pattern replaced. .shell.platform gives this
// sidebar its own dark, teal-accented palette (theme.css) purely by
// overriding the CSS custom properties every .side-* rule already reads —
// nothing here needed rewriting to look like a distinct console rather than
// a school's own portal.
const PlatformNav = () => {
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <aside className={`side${collapsed ? " collapsed" : ""}`}>
        <div className="side-head">
          <Link to="/" className="side-brand" title="Schoolivio platform">
            <Mark size={28} />
            {collapsed ? null : (
              <span className="side-brand-text">
                <span className="side-school">{"Schoolivio"}</span>
                <span className="side-product">{"Platform"}</span>
              </span>
            )}
          </Link>
          <button
            type="button"
            className="side-collapse"
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => setCollapsed((v) => !v)}
          >
            <Icon icon={collapsed ? chevronsRight : chevronsLeft} size={16} />
          </button>
        </div>

        <nav className="side-nav">
          <div className="side-group">
            {collapsed ? null : <div className="side-group-name">{"Console"}</div>}
            {NAV.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                title={link.label}
                className={({ isActive }) => `side-link${isActive ? " active" : ""}`}
              >
                <Icon icon={link.icon} size={17} />
                {collapsed ? null : <span>{link.label}</span>}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="side-group side-others">
          <button type="button" className="side-link" title="Sign out" onClick={signOut}>
            <Icon icon={logOut} size={17} />
            {collapsed ? null : <span>{"Sign out"}</span>}
          </button>
        </div>
      </aside>

      <header className="topbar">
        <span className="topbar-spacer" />
        <span className="nav-user" title={user?.email || ""}>
          <span className="nav-avatar brand-mark platform-mark">{"SV"}</span>
          <span style={{ minWidth: 0 }}>
            <div className="nav-name">{user?.email}</div>
            <div className="nav-role">{"platform"}</div>
          </span>
        </span>
      </header>
    </>
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
