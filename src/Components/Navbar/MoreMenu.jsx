import React, { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { chevronDown } from "react-icons-kit/feather/chevronDown";
import { groupModules } from "../../lib/modules";

// The modules that did not fit across the top.
//
// Grouped under headings rather than listed flat, because ten items in a
// column with no structure is the same problem as ten items in a row. A
// proprietor is the only person who sees much in here; most roles never see
// the button at all.
const MoreMenu = ({ modules }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const { pathname } = useLocation();

  // Close on navigation, on click-outside, and on Escape.
  useEffect(() => setOpen(false), [pathname]);

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

  if (!modules || modules.length === 0) return null;

  // If you are standing on a page that lives in here, the button says so
  // rather than leaving the header with nothing highlighted.
  const here = modules.find((m) => pathname.startsWith(m.path));

  return (
    <div className="more" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`nav-link more-trigger${here ? " active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{here ? here.label : "More"}</span>
        <Icon icon={chevronDown} size={14} className={`account-caret${open ? " up" : ""}`} />
      </button>

      {open ? (
        <div className="more-menu" role="menu">
          {groupModules(modules).map((group) => (
            <div key={group.name} className="more-group">
              <div className="account-heading">{group.name}</div>
              {group.modules.map((module) => (
                <NavLink
                  key={module.path}
                  to={module.path}
                  role="menuitem"
                  className={({ isActive }) =>
                    `account-item${isActive ? " current" : ""}`
                  }
                >
                  {module.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default MoreMenu;
