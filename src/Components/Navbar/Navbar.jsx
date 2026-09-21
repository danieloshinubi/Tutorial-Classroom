import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { grid } from "react-icons-kit/feather/grid";
import { bookOpen } from "react-icons-kit/feather/bookOpen";
import { users as usersIcon } from "react-icons-kit/feather/users";
import { creditCard } from "react-icons-kit/feather/creditCard";
import { award } from "react-icons-kit/feather/award";
import { checkSquare } from "react-icons-kit/feather/checkSquare";
import { fileText } from "react-icons-kit/feather/fileText";
import { settings as settingsIcon } from "react-icons-kit/feather/settings";
import { bell } from "react-icons-kit/feather/bell";
import { helpCircle } from "react-icons-kit/feather/helpCircle";
import { messageSquare } from "react-icons-kit/feather/messageSquare";
import { user as userIcon } from "react-icons-kit/feather/user";
import { chevronsLeft } from "react-icons-kit/feather/chevronsLeft";
import { chevronsRight } from "react-icons-kit/feather/chevronsRight";
import { menu as menuIcon } from "react-icons-kit/feather/menu";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import Notifications from "../Notifications";
import AccountMenu from "./AccountMenu";
import GlobalSearch from "../GlobalSearch";
import Logo from "../Logo";
import { modulesFor, groupModules } from "../../lib/modules";
import { fetchChatOverview, subscribeToMyChannels } from "../../lib/api";

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
  admissions: fileText,
  attendance: checkSquare,
  reports: fileText,
  tutors: usersIcon,
  school: settingsIcon,
};

const Navbar = () => {
  const { user } = useAuth();
  const { school, roles, schoolId } = useSchool();
  const location = useLocation();

  // Every chat's own unread_count, summed — the same "how many are waiting
  // on me" a phone's app-icon badge shows, surfaced next to the sidebar
  // link since Chat has no other permanently-visible spot for it.
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    if (!user?.id || !schoolId) { setChatUnread(0); return undefined; }
    const load = () =>
      fetchChatOverview(schoolId)
        .then((rows) => setChatUnread(rows.reduce((sum, r) => sum + (r.unread_count || 0), 0)))
        .catch(() => {});
    load();
    // Own topic suffix — ChatPage's own thread view watches the same rows
    // under the default topic, and two callers on one topic would collide
    // (see subscribeToMyChannels in api.js).
    const channel = subscribeToMyChannels(user.id, load, "chat_channels_nav");
    return () => channel.unsubscribe();
  }, [user?.id, schoolId]);

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

  useEffect(() => {
    try {
      localStorage.setItem("schoolivio-sidebar", collapsed ? "collapsed" : "open");
    } catch {
      /* a private window will not have it; the default is fine */
    }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes, so it never covers
  // the page you just navigated to.
  useEffect(() => setOpen(false), [location.pathname]);

  const groups = groupModules(modulesFor(roles));

  return (
    <>
      {/* The drawer's backdrop on small screens. */}
      {open ? <button type="button" className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}

      <aside className={`side${collapsed ? " collapsed" : ""}${open ? " open" : ""}`}>
        <div className="side-head">
          <Link to="/Dashboard" className="side-brand" title="Schoolivio">
            {school?.logo_url ? (
              <img src={school.logo_url} alt="" className="side-logo" />
            ) : (
              <Logo size={28} showName={false} />
            )}
            {collapsed ? null : (
              <span className="side-brand-text">
                <span className="side-school">{school ? school.name : "Schoolivio"}</span>
                <span className="side-product">{"Schoolivio"}</span>
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
          {groups.map((group) => (
            <div key={group.name} className="side-group">
              {collapsed ? <div className="side-rule" /> : (
                <div className="side-group-name">{group.name}</div>
              )}
              {group.modules.map((module) => {
                const unread = module.id === "chat" ? chatUnread : 0;
                return (
                  <NavLink
                    key={module.path}
                    to={module.path}
                    title={unread > 0 ? `${module.label} (${unread} unread)` : module.label}
                    className={({ isActive }) => `side-link${isActive ? " active" : ""}`}
                  >
                    <Icon icon={ICONS[module.id] || grid} size={17} />
                    {collapsed ? null : <span>{module.label}</span>}
                    {unread > 0 ? (
                      <span className="bell-count side-link-badge">{unread > 9 ? "9+" : unread}</span>
                    ) : null}
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
          {collapsed ? <div className="side-rule" /> : (
            <div className="side-group-name">{"Others"}</div>
          )}
          <NavLink
            to="/Profile"
            title="Account settings"
            className={({ isActive }) => `side-link${isActive ? " active" : ""}`}
          >
            <Icon icon={userIcon} size={17} />
            {collapsed ? null : <span>{"Account settings"}</span>}
          </NavLink>
          <a
            href="mailto:support@schoolivio.com"
            className="side-link"
            title="Support"
          >
            <Icon icon={helpCircle} size={17} />
            {collapsed ? null : <span>{"Support"}</span>}
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
        </button>

        <GlobalSearch />

        <span className="topbar-spacer" />
        <Notifications />
        <AccountMenu />
      </header>
    </>
  );
};

export default Navbar;
