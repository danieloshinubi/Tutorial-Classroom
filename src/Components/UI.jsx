import React from "react";

// Thin wrappers over the classes in styles/theme.css. Pages compose these so
// spacing, colour and radius stay consistent without repeating inline styles.

export const Page = ({ title, subtitle, action, children }) => (
  <div className="page">
    {(title || action) && (
      <header className="page-head">
        <div>
          {title ? <h1>{title}</h1> : null}
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </header>
    )}
    {children}
  </div>
);

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
