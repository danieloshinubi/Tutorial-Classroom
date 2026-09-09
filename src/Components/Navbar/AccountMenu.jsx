import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { user as userIcon } from "react-icons-kit/feather/user";
import { chevronDown } from "react-icons-kit/feather/chevronDown";
import { logOut } from "react-icons-kit/feather/logOut";
import { settings as settingsIcon } from "react-icons-kit/feather/settings";
import { users as usersIcon } from "react-icons-kit/feather/users";
import { award } from "react-icons-kit/feather/award";
import { creditCard } from "react-icons-kit/feather/creditCard";
import { home } from "react-icons-kit/feather/home";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { schoolUrl } from "../../lib/tenant";
import { displayName, initials } from "../UI";

// Everything about the signed-in person, behind one avatar.
//
// The name, role and a sign-out button used to sit in the header. That was
// fine with four modules and stopped being fine at nine — the name was the
// part that got squeezed to nothing, which is the one thing a person wants to
// see to know whose session they are in. Collapsing it into a menu gives the
// modules room and the account somewhere it can be read properly.
const AccountMenu = () => {
  const { user, profile, signOut } = useAuth();
  const { school, memberships, role, roles, isAdmin, isParent } = useSchool();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);

  // Click anywhere else, or press Escape, and it closes.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const person = profile || { email: user?.email };
  const name = displayName(person);

  // Account-level destinations, not the module navigation. A parent gets
  // their children, a student their own results, an administrator the school.
  const items = [
    { to: "/Profile", label: "My profile", icon: userIcon },
    isParent
      ? { to: "/Reports", label: "My children", icon: usersIcon }
      : roles.includes("student")
      ? { to: `/Reports/${user?.id}`, label: "My results", icon: award }
      : null,
    isParent || roles.includes("student")
      ? { to: "/Fees", label: "Fees and payments", icon: creditCard }
      : null,
    isAdmin ? { to: "/School", label: "School settings", icon: settingsIcon } : null,
  ].filter(Boolean);

  const others = memberships.filter((m) => m.schools && m.schools.id !== school?.id);

  return (
    <div className="account" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name ? `Account: ${name}` : "Account"}
        onClick={() => setOpen((value) => !value)}
      >
        {profile?.avatar_url ? (
          <img className="nav-avatar" src={profile.avatar_url} alt="" />
        ) : (
          <span className="nav-avatar brand-mark">{initials(person)}</span>
        )}
        <Icon icon={chevronDown} size={15} className={`account-caret${open ? " up" : ""}`} />
      </button>

      {open ? (
        <div className="account-menu" role="menu">
          <div className="account-who">
            <div className="account-name">{name}</div>
            <div className="account-email">{user?.email}</div>
            {role ? <div className="account-role">{roles.join(" · ")}</div> : null}
          </div>

          <div className="account-items">
            {items.map((item) => (
              <Link
                key={item.to + item.label}
                to={item.to}
                role="menuitem"
                className="account-item"
                onClick={() => setOpen(false)}
              >
                <Icon icon={item.icon} size={16} />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>

          {/* Someone with a child at two schools, or who teaches at one and
              administers another, switches host from here rather than editing
              the address bar. */}
          {others.length ? (
            <div className="account-items account-section">
              <div className="account-heading">{"Your other schools"}</div>
              {others.map((m) => (
                <button
                  key={m.schools.id}
                  type="button"
                  role="menuitem"
                  className="account-item"
                  onClick={() => {
                    window.location.href = schoolUrl(m.schools.slug);
                  }}
                >
                  <Icon icon={home} size={16} />
                  <span>{m.schools.name}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="account-items account-section">
            <button
              type="button"
              role="menuitem"
              className="account-item danger"
              onClick={signOut}
            >
              <Icon icon={logOut} size={16} />
              <span>{"Log out"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AccountMenu;
