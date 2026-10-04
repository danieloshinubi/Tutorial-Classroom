import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { grid } from "react-icons-kit/feather/grid";
import { bookOpen } from "react-icons-kit/feather/bookOpen";
import { users as usersIcon } from "react-icons-kit/feather/users";
import { creditCard } from "react-icons-kit/feather/creditCard";
import { shoppingBag } from "react-icons-kit/feather/shoppingBag";
import { pieChart } from "react-icons-kit/feather/pieChart";
import { briefcase } from "react-icons-kit/feather/briefcase";
import { award } from "react-icons-kit/feather/award";
import { checkSquare } from "react-icons-kit/feather/checkSquare";
import { calendar as calendarIcon } from "react-icons-kit/feather/calendar";
import { fileText } from "react-icons-kit/feather/fileText";
import { settings as settingsIcon } from "react-icons-kit/feather/settings";
import { bell } from "react-icons-kit/feather/bell";
import { helpCircle } from "react-icons-kit/feather/helpCircle";
import { messageSquare } from "react-icons-kit/feather/messageSquare";
import { user as userIcon } from "react-icons-kit/feather/user";
import { chevronsLeft } from "react-icons-kit/feather/chevronsLeft";
import { chevronsRight } from "react-icons-kit/feather/chevronsRight";
import { menu as menuIcon } from "react-icons-kit/feather/menu";
import { x as xIcon } from "react-icons-kit/feather/x";
import { useSchool } from "../../context/SchoolContext";
import Notifications from "../Notifications";
import AccountMenu from "./AccountMenu";
import GlobalSearch from "../GlobalSearch";
import Logo from "../Logo";
import PushPrompt from "../PushPrompt";
import Assistant from "../Assistant/Assistant";
import { modulesFor, groupModules } from "../../lib/modules";
import { useNavData } from "../../context/NavDataContext";

// The application shell: a sidebar of modules on the left, a slim bar across
// the top for search and the account.
//
// It replaced a horizontal strip of links, which had run out of room at ten
// modules — a sidebar has as much vertical space as it needs, keeps the
// current section visible while you work, and gives the groups in
// lib/modules.js somewhere to actually show as headings rather than being
// flattened into a row.
//
// Every page already renders <Navbar /> inside .shell, so laying the shell
// out here means all of them move at once.

const ICONS = {
  dashboard: grid,
  news: bell,
  chat: messageSquare,
  courses: bookOpen,
  teach: bookOpen,
  results: award,
  bursary: creditCard,
  fees: creditCard,
  store: shoppingBag,
  accounts: pieChart,
  payroll: briefcase,
  admissions: fileText,
  attendance: checkSquare,
  timetable: calendarIcon,
  reports: fileText,
  tutors: usersIcon,
  school: settingsIcon,
};

const Navbar = () => {
  const { school, roles, disabledModules, moduleGrants } = useSchool();
  const location = useLocation();

  // Unread chats and the "waiting for you" dots live in NavDataProvider, so
  // they survive page changes instead of reloading with every Navbar.
  const { chatUnread, attention } = useNavData();

  // Remembered between visits: someone on a laptop who collapses it once
  // should not have to do it again every time they open the app.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("schoolivio-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);

  // "Collapse to icons-only" is a desktop-sidebar concept — on a phone the
  // sidebar is already a full-screen drawer over the page, not a column
  // sharing space with content, so shrinking it to icons just leaves a
  // useless sliver of a drawer still covering the screen (confirmed live:
  // exactly the "makes the site look stupid" result). The same top-left
  // button instead closes that drawer outright on mobile, matching what
  // it visually looks like it should do there.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("schoolivio-sidebar", collapsed ? "collapsed" : "open");
    } catch {
      /* a private window will not have it; the default is fine */
    }
  }, [collapsed]);

  // `collapsed` is remembered across visits AND across screen sizes, so
  // anyone who collapsed the sidebar once on a laptop would otherwise open
  // the phone drawer straight into icons-only — a narrow, unlabelled sliver
  // covering the page, which is the exact "looks stupid" result the button
  // behaviour above was meant to end. Collapsing is desktop-only, so the
  // preference is kept but simply not applied while on a phone.
  const showCollapsed = collapsed && !isMobile;

  // Close the mobile drawer whenever the route changes, so it never covers
  // the page you just navigated to.
  useEffect(() => setOpen(false), [location.pathname]);

  const groups = groupModules(modulesFor(roles, disabledModules, moduleGrants));
  // On a phone the menu is closed behind its button, so the button carries
  // the dot whenever any module in it has one.
  const anyWaiting = groups.some((g) =>
    g.modules.some((m) => (m.id === "chat" ? chatUnread > 0 : Number(attention[m.id]) > 0))
  );

  return (
    <>
      {/* Asks once per device to turn on instant notifications. */}
      <PushPrompt />
      {/* The drawer's backdrop on small screens. */}
      {open ? <button type="button" className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}

      <aside className={`side${showCollapsed ? " collapsed" : ""}${open ? " open" : ""}`}>
        <div className="side-head">
          <Link to="/Dashboard" className="side-brand" title="Schoolivio">
            {school?.logo_url ? (
              <img src={school.logo_url} alt="" className="side-logo" />
            ) : (
              <Logo size={28} showName={false} />
            )}
            {showCollapsed ? null : (
              <span className="side-brand-text">
                <span className="side-school">{school ? school.name : "Schoolivio"}</span>
                <span className="side-product">{"Schoolivio"}</span>
              </span>
            )}
          </Link>

          <button
            type="button"
            className="side-collapse"
            aria-label={isMobile ? "Close menu" : collapsed ? "Expand menu" : "Collapse menu"}
            title={isMobile ? "Close" : collapsed ? "Expand" : "Collapse"}
            onClick={() => (isMobile ? setOpen(false) : setCollapsed((v) => !v))}
          >
            <Icon icon={isMobile ? xIcon : collapsed ? chevronsRight : chevronsLeft} size={16} />
          </button>
        </div>

        <nav className="side-nav">
          {groups.map((group) => (
            <div key={group.name} className="side-group">
              {showCollapsed ? <div className="side-rule" /> : (
                <div className="side-group-name">{group.name}</div>
              )}
              {group.modules.map((module) => {
                const unread = module.id === "chat" ? chatUnread : 0;
                const waiting = module.id === "chat" ? 0 : Number(attention[module.id]) || 0;
                return (
                  <NavLink
                    key={module.path}
                    to={module.path}
                    title={
                      unread > 0
                        ? `${module.label} (${unread} unread)`
                        : waiting > 0
                        ? `${module.label} (${waiting} waiting for you)`
                        : module.label
                    }
                    className={({ isActive }) => `side-link${isActive ? " active" : ""}`}
                  >
                    <Icon icon={ICONS[module.id] || grid} size={17} />
                    {showCollapsed ? null : <span>{module.label}</span>}
                    {/* Teams' own unread indicator on its left rail is a
                        plain dot, not a numbered bubble — the count is
                        still there for anyone who needs it, in the title
                        tooltip above ("Chat (3 unread)"), just not
                        competing with the icon and label for space. */}
                    {unread > 0 || waiting > 0 ? <span className="side-link-dot" aria-hidden="true" /> : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Outside .side-nav's own scroll region on purpose — Account
            settings/Support used to sit inside that scrolling <nav>, so a
            school with enough modules to need scrolling would scroll them
            out of view. As a direct flex sibling of .side-nav they always
            stay visible at the foot of the sidebar. */}
        <div className="side-group side-others">
          {showCollapsed ? <div className="side-rule" /> : (
            <div className="side-group-name">{"Others"}</div>
          )}
          <NavLink
            to="/Profile"
            title="Account settings"
            className={({ isActive }) => `side-link${isActive ? " active" : ""}`}
          >
            <Icon icon={userIcon} size={17} />
            {showCollapsed ? null : <span>{"Account settings"}</span>}
          </NavLink>
          <a
            href="mailto:support@schoolivio.com"
            className="side-link"
            title="Support"
          >
            <Icon icon={helpCircle} size={17} />
            {showCollapsed ? null : <span>{"Support"}</span>}
          </a>
        </div>
      </aside>

      <header className="topbar">
        <button
          type="button"
          className="topbar-burger"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon icon={menuIcon} size={18} />
          {anyWaiting ? <span className="topbar-burger-dot" aria-hidden="true" /> : null}
        </button>

        <GlobalSearch />

        <span className="topbar-spacer" />
        <Assistant />
        <Notifications />
        <AccountMenu />
      </header>
    </>
  );
};

export default Navbar;
