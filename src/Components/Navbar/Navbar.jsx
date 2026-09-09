import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useSchool } from "../../context/SchoolContext";
import Notifications from "../Notifications";
import AccountMenu from "./AccountMenu";
import MoreMenu from "./MoreMenu";
import { navFor } from "../../lib/modules";

// The navigation is whatever this person's roles are for, and nothing else —
// a bursar has no use for a class stream, a parent none for a staff
// directory. lib/modules.js holds the mapping, and the route guards read the
// same list, so a link that is absent here is also an address that cannot be
// typed. The platform console is not in it at all: that lives on its own
// host, admin.schoolivio.com, and is not part of any school.

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const { school, roles } = useSchool();
  const location = useLocation();

  // Close the drawer whenever the route changes, so it never covers the page
  // you just navigated to.
  useEffect(() => setOpen(false), [location.pathname]);

  // Six across the top at most; the rest go behind More, grouped. See
  // lib/modules.js — the split is by priority and differs per role, so a
  // bursar's header is not a teacher's.
  const { primary, more } = navFor(roles);

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <button
            type="button"
            className="nav-burger"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span />
          </button>

          <Link to="/Dashboard" className="brand" title={school ? school.name : "Schoolivio"}>
            {school?.logo_url ? (
              <img
                src={school.logo_url}
                alt=""
                className="brand-mark"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <span className="brand-mark">{"S"}</span>
            )}
            <span className="brand-name">{school ? school.name : "Schoolivio"}</span>
          </Link>

          <nav className="nav-links">
            {primary.map((module) => (
              <NavLink
                key={module.path}
                to={module.path}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                {module.label}
              </NavLink>
            ))}
            <MoreMenu modules={more} />
          </nav>

          <span className="nav-spacer" />

          <Notifications />
          <AccountMenu />
        </div>
      </header>

      {open ? (
        <div className="nav-drawer">
          {[...primary, ...more].map((module) => (
            <NavLink
              key={module.path}
              to={module.path}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {module.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </>
  );
};

export default Navbar;
