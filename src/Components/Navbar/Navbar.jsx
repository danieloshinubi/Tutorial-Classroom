import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import Notifications from "../Notifications";
import { schoolUrl } from "../../lib/tenant";
import { displayName, initials } from "../UI";

const linksFor = ({ isStaff, isAdmin, isPlatformAdmin }) => {
  const links = [
    { to: "/Dashboard", label: "Dashboard" },
    { to: "/Levels", label: "Courses" },
    { to: "/Tutors", label: "Tutors" },
    { to: "/Reports", label: "Reports" },
  ];
  if (isStaff) links.push({ to: "/Teach", label: "Teach" });
  if (isAdmin) links.push({ to: "/School", label: "School" });
  if (isPlatformAdmin) links.push({ to: "/Platform", label: "Platform" });
  return links;
};

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const { profile, user, signOut } = useAuth();
  const { school, memberships, role, isAdmin, isStaff, isPlatformAdmin } = useSchool();
  const navigate = useNavigate();
  const location = useLocation();

  // Close the drawer whenever the route changes, so it never covers the page
  // you just navigated to.
  useEffect(() => setOpen(false), [location.pathname]);

  const links = linksFor({ isStaff, isAdmin, isPlatformAdmin });
  const name = profile || user ? displayName(profile || { email: user?.email }) : "";

  const handleSignOut = async () => {
    await signOut();
    navigate("/Login", { replace: true });
  };

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
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <span className="nav-spacer" />

          {memberships.length > 1 ? (
            <select
              className="select school-switch"
              value={school?.slug || ""}
              onChange={(e) => {
                window.location.href = schoolUrl(e.target.value);
              }}
              aria-label="Switch school"
            >
              {memberships.map((m) => (
                <option key={m.schools.id} value={m.schools.slug}>
                  {m.schools.name}
                </option>
              ))}
            </select>
          ) : null}

          <Notifications />

          <Link to="/Profile" className="nav-user" title={user?.email || ""}>
            {profile?.avatar_url ? (
              <img className="nav-avatar" src={profile.avatar_url} alt="" />
            ) : (
              <span className="nav-avatar brand-mark">{initials(profile || { email: user?.email })}</span>
            )}
            <span style={{ minWidth: 0 }}>
              <div className="nav-name">{name}</div>
              {role ? <div className="nav-role">{role}</div> : null}
            </span>
          </Link>

          <button type="button" className="btn btn-secondary btn-sm" onClick={handleSignOut}>
            {"Sign out"}
          </button>
        </div>
      </header>

      {open ? (
        <div className="nav-drawer">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </>
  );
};

export default Navbar;
