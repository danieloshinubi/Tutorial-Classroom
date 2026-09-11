import React, { useEffect, useRef } from "react";

// Thin wrappers over the classes in styles/theme.css. Pages compose these so
// spacing, colour and radius stay consistent without repeating inline styles.

// The page frame.
//
// The heading, its subtitle, the primary action and anything passed as
// `toolbar` — tabs, a filter row, a term picker — stay put while the content
// under them scrolls. On a list of two hundred students you should not have to
// scroll back to the top to change a filter or read which tab you are on.
//
// The main region is the scroll container (see .shell in theme.css), so this
// is sticky within it rather than the window.
export const Page = ({ title, subtitle, action, toolbar, children }) => {
  // Anything inside a page that also wants to stay put — a filter row, an
  // "add" form, a row of totals — has to sit below the page header rather
  // than under it. The header's height is not fixed (a subtitle wraps, a tab
  // strip appears), so it is measured and published as --page-top-h for
  // .panel-top and .panel-aside to use as their sticky offset.
  const pageRef = useRef(null);
  const topRef = useRef(null);

  useEffect(() => {
    const top = topRef.current;
    const page = pageRef.current;
    if (!top || !page || typeof ResizeObserver === "undefined") return undefined;

    const publish = () => {
      page.style.setProperty("--page-top-h", `${top.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(top);
    return () => observer.disconnect();
  });

  return (
  <div className="page" ref={pageRef}>
    {(title || action || toolbar) && (
      <div className="page-top" ref={topRef}>
        {(title || action) && (
          <header className="page-head">
            <div>
              {title ? <h1>{title}</h1> : null}
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            {action}
          </header>
        )}
        {toolbar ? <div className="page-toolbar">{toolbar}</div> : null}
      </div>
    )}
    <div className="page-body">{children}</div>
  </div>
  );
};

export const Card = ({ children, className = "", ...rest }) => (
  <div className={`card ${className}`} {...rest}>
    {children}
  </div>
);

export const Grid = ({ children, wide = false }) => (
  <div className={`grid${wide ? " wide" : ""}`}>{children}</div>
);

export const Section = ({ title, action, children }) => (
  <section className="section">
    {(title || action) && (
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h2>{title}</h2>
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Button = ({ variant = "primary", size, className = "", ...props }) => (
  <button
    {...props}
    className={`btn btn-${variant}${size === "sm" ? " btn-sm" : ""} ${className}`}
  />
);

export const Field = ({ label, hint, children }) => (
  <label className="field">
    {label ? <span className="label">{label}</span> : null}
    {children}
    {hint ? <span className="hint">{hint}</span> : null}
  </label>
);

// A plain number input for an amount of money reads as a wall of digits —
// "3560000" takes a beat to parse as 3.56 million. This shows it with
// thousand separators as it's typed, while the value handed back through
// onChange stays a plain digits-and-one-decimal-point string, exactly what a
// numeric <input> would have given, so nothing downstream needs to change.
const formatMoneyDisplay = (raw) => {
  if (raw === "" || raw === null || raw === undefined) return "";
  const [intPart, ...rest] = String(raw).replace(/[^\d.]/g, "").split(".");
  const withCommas = (intPart || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${withCommas}.${rest.join("")}` : withCommas;
};

export const MoneyInput = ({ value, onChange, className = "input", ...props }) => (
  <input
    {...props}
    type="text"
    inputMode="decimal"
    className={className}
    value={formatMoneyDisplay(value)}
    onChange={(e) => {
      const raw = e.target.value.replace(/,/g, "");
      if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
      onChange(raw);
    }}
  />
);

export const Badge = ({ children, tone }) => (
  <span className={`badge${tone ? ` ${tone}` : ""}`}>{children}</span>
);

export const Notice = ({ tone = "muted", children }) =>
  children ? <p className={`notice ${tone}`}>{children}</p> : null;

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Tabs = ({ tabs, active, onChange }) => (
  <div className="tabs">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        className={`tab${active === tab.id ? " active" : ""}`}
        onClick={() => onChange(tab.id)}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

// Gives each course a stable colour from its code, so tiles look varied
// without being random on every render.
export const bandClass = (seed = "") => {
  const variants = ["", " alt", " alt2", " alt3"];
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  return `tile-band${variants[total % variants.length]}`;
};

// Prefers a real name, then the username, then the local part of the email —
// never the whole address, which used to overflow the header.
export const displayName = (profile) => {
  if (!profile) return "Someone";
  const full = `${profile.first_name || ""} ${profile.surname || ""}`.trim();
  if (full) return full;
  if (profile.username) return profile.username;
  if (profile.email) return profile.email.split("@")[0];
  return "Someone";
};

export const initials = (profile) => {
  const name = displayName(profile);
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
};

export const formatDate = (value, { withTime = true, fallback = "No due date" } = {}) => {
  if (!value) return fallback;
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
};
