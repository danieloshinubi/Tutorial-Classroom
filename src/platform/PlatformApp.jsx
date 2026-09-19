import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  Link,
  NavLink,
  useNavigate,
} from "react-router-dom";
import { Icon } from "react-icons-kit";
import { grid } from "react-icons-kit/feather/grid";
import { layers } from "react-icons-kit/feather/layers";
import { users as usersIcon } from "react-icons-kit/feather/users";
import { clipboard } from "react-icons-kit/feather/clipboard";
import { creditCard } from "react-icons-kit/feather/creditCard";
import { mail } from "react-icons-kit/feather/mail";
import { dollarSign } from "react-icons-kit/feather/dollarSign";
import { clock } from "react-icons-kit/feather/clock";
import { logOut } from "react-icons-kit/feather/logOut";
import { search as searchIcon } from "react-icons-kit/feather/search";
import { chevronsLeft } from "react-icons-kit/feather/chevronsLeft";
import { chevronsRight } from "react-icons-kit/feather/chevronsRight";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { amIPlatformAdmin, platformSearch } from "../lib/platformApi";
import ConfigNotice from "../Components/ConfigNotice";
import PlatformLogin from "./PlatformLogin";
import Overview from "./Overview";
import Tenants from "./Tenants";
import TenantDetail from "./TenantDetail";
import PlatformTeam from "./PlatformTeam";
import PlatformAuditLog from "./PlatformAuditLog";
import PlatformTrials from "./PlatformTrials";
import PlatformGateways from "./PlatformGateways";
import PlatformMailboxes from "./PlatformMailboxes";
import PlatformBilling from "./PlatformBilling";
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
  { to: "/Trials", label: "Trials", icon: clock, end: false },
  { to: "/Gateways", label: "Gateways", icon: creditCard, end: false },
  { to: "/Mailboxes", label: "Mailboxes", icon: mail, end: false },
  { to: "/Billing", label: "Billing", icon: dollarSign, end: false },
  { to: "/Team", label: "Team", icon: usersIcon, end: false },
  { to: "/AuditLog", label: "Audit log", icon: clipboard, end: false },
];

// "Which school is this person in" is a support-call question the console
// couldn't answer before today except by opening every school in turn —
// platform_search() (144) matches a school's own name/slug or a member's
// name/email and says which school they belong to.
const PlatformSearch = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const handle = setTimeout(() => {
      platformSearch(query.trim())
        .then((rows) => {
          setResults(rows);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const goTo = (row) => {
    setOpen(false);
    setQuery("");
    navigate(`/Tenants/${row.school_id}`);
  };

  return (
    <div className="gsearch" ref={wrapRef}>
      <Icon icon={searchIcon} size={15} className="gsearch-icon" />
      <input
        className="gsearch-input"
        placeholder="Find a school, admin or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
      />
      {open && results.length > 0 ? (
        <div className="gsearch-panel">
          <div className="gsearch-group">
            <div className="account-heading">{"Schools"}</div>
            {results.map((row) => (
              <button
                key={row.school_id}
                type="button"
                className="account-item"
                onClick={() => goTo(row)}
              >
                <strong>{row.school_name}</strong>
                <span style={{ color: "var(--ink-3)" }}>
                  {row.matched_on === "school" ? row.school_slug : row.matched_on}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

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
            {collapsed ? (
              <span className="side-brand-icon">
                <Mark size={18} tone="white" />
              </span>
            ) : (
              <Mark size={28} />
            )}
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
        <PlatformSearch />
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
            <Route path="/Trials" element={<PlatformTrials />} />
            <Route path="/Gateways" element={<PlatformGateways />} />
            <Route path="/Mailboxes" element={<PlatformMailboxes />} />
            <Route path="/Billing" element={<PlatformBilling />} />
            <Route path="/Team" element={<PlatformTeam />} />
            <Route path="/AuditLog" element={<PlatformAuditLog />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </PlatformGate>
    </AuthProvider>
  </Router>
);

export default PlatformApp;
