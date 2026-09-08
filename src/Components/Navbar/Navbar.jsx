import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { displayName, initials } from "../UI";

const linksFor = (role) => {
  const links = [
    { to: "/Dashboard", label: "Dashboard" },
    { to: "/Levels", label: "Courses" },
    { to: "/Tutors", label: "Tutors" },
  ];
  if (role === "tutor" || role === "admin") links.push({ to: "/Teach", label: "Teach" });
  if (role === "admin") links.push({ to: "/Admin", label: "Admin" });
  return links;
};

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Close the drawer whenever the route changes, so it never covers the page
  // you just navigated to.
  useEffect(() => setOpen(false), [location.pathname]);

  const links = linksFor(profile?.role);
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

          <Link to="/Dashboard" className="brand">
            <span className="brand-mark">{"TC"}</span>
            <span>{"Classroom"}</span>
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

          <Link to="/Profile" className="nav-user" title={user?.email || ""}>
            {profile?.avatar_url ? (
              <img className="nav-avatar" src={profile.avatar_url} alt="" />
            ) : (
              <span className="nav-avatar brand-mark">{initials(profile || { email: user?.email })}</span>
            )}
            <span style={{ minWidth: 0 }}>
              <div className="nav-name">{name}</div>
              {profile?.role ? <div className="nav-role">{profile.role}</div> : null}
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
