import React from "react";
import { displayName, initials, bandClass } from "../../../Components/UI";
import { usePresence as usePresenceJs } from "../../../context/PresenceContext";
import { ROLES as ROLES_JS, ROLE_LABEL as ROLE_LABEL_JS } from "../../../lib/roles";
import type { PersonProfile } from "./peopleTypes";

// Small pieces shared by the People list and the person panel, styled with
// Tailwind (tw- prefix, tailwind.config.js).

export const ROLES = ROLES_JS as unknown as [string, string][];
export const ROLE_LABEL = ROLE_LABEL_JS as unknown as Record<string, string>;

export interface Presence {
  status: (id: string) => "online" | "away" | "offline" | string;
  lastSignIn: (id: string) => string | null;
}
export const usePresence = () => usePresenceJs() as unknown as Presence;

// Role colours, the same grouping as lib/roles.js toneFor.
export const roleTone = (role: string) =>
  role === "owner" || role === "admin" || role === "principal"
    ? "tw-bg-danger-soft tw-text-danger"
    : role === "teacher"
      ? "tw-bg-brand-soft tw-text-brand"
      : role === "bursar" || role === "admissions"
        ? "tw-bg-warn-soft tw-text-warn-ink"
        : "tw-bg-bg tw-text-ink-2";

export const RolePill = ({ role }: { role: string }) => (
  <span className={`tw-inline-flex tw-items-center tw-rounded-full tw-px-2.5 tw-py-0.5 tw-text-[12px] tw-font-semibold tw-whitespace-nowrap ${roleTone(role)}`}>
    {ROLE_LABEL[role] || role}
  </span>
);

export const Avatar = ({ p, size = 36, presence }: { p: PersonProfile; size?: number; presence?: string }) => (
  <span className="tw-relative tw-inline-flex tw-shrink-0" style={{ width: size, height: size }}>
    {p.avatar_url ? (
      <img src={p.avatar_url} alt="" className="tw-rounded-full tw-object-cover" style={{ width: size, height: size }} />
    ) : (
      <span
        className={`${bandClass(p.id || displayName(p))} tw-inline-flex tw-items-center tw-justify-center tw-rounded-full tw-font-semibold tw-text-white`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      >
        {initials(p)}
      </span>
    )}
    {presence && presence !== "offline" ? (
      <span
        className={`tw-absolute tw-bottom-0 tw-right-0 tw-rounded-full tw-border-2 tw-border-solid tw-border-white ${presence === "away" ? "tw-bg-[#f59e0b]" : "tw-bg-success"}`}
        style={{ width: Math.max(9, size * 0.28), height: Math.max(9, size * 0.28) }}
        title={presence === "away" ? "Away" : "Online"}
      />
    ) : null}
  </span>
);

export const Chip = ({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "danger" | "warn" | "success" | "brand" }) => {
  const tones = {
    muted: "tw-bg-bg tw-text-ink-2",
    danger: "tw-bg-danger-soft tw-text-danger",
    warn: "tw-bg-warn-soft tw-text-warn-ink",
    success: "tw-bg-success-soft tw-text-success",
    brand: "tw-bg-brand-soft tw-text-brand",
  };
  return (
    <span className={`tw-inline-flex tw-items-center tw-rounded-full tw-px-2 tw-py-[1px] tw-text-[11.5px] tw-font-semibold tw-whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
};

/** A text-style command button, like Microsoft 365's command bar. */
export const Command = ({
  icon,
  children,
  onClick,
  disabled,
  danger,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border-0 tw-bg-transparent tw-px-2.5 tw-py-1.5 tw-text-[13.5px] tw-font-medium tw-cursor-pointer tw-transition-colors [font-family:inherit] hover:tw-bg-bg disabled:tw-cursor-not-allowed disabled:tw-opacity-40 ${danger ? "tw-text-danger" : "tw-text-ink"}`}
  >
    {icon ? <span className={danger ? "tw-text-danger" : "tw-text-brand"}>{icon}</span> : null}
    {children}
  </button>
);

/**
 * Text that stays on one line: it shrinks (down to `min` px) until it fits
 * its box, and only then ends with "…", with the whole text on hover. For
 * email addresses, which otherwise break mid-word.
 */
export const FitText = ({ text, size = 14, min = 11, className = "" }: { text: string; size?: number; min?: number; className?: string }) => {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = React.useState(size);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      let next = size;
      el.style.fontSize = `${next}px`;
      while (next > min && el.scrollWidth > el.clientWidth) {
        next -= 0.5;
        el.style.fontSize = `${next}px`;
      }
      setFontSize(next);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text, size, min]);
  return (
    <span ref={ref} title={text} className={`tw-block tw-min-w-0 tw-overflow-hidden tw-text-ellipsis tw-whitespace-nowrap ${className}`} style={{ fontSize }}>
      {text}
    </span>
  );
};

/** A small copy button, as Teams and Outlook put beside an address. */
export const CopyButton = ({ value, label = "Copy" }: { value: string; label?: string }) => {
  const [copied, setCopied] = React.useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers: copy through a temporary field.
      const field = document.createElement("textarea");
      field.value = value;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : `${label} ${value}`}
      aria-label={copied ? "Copied" : `${label} ${value}`}
      className={`tw-inline-flex tw-h-7 tw-shrink-0 tw-items-center tw-gap-1 tw-rounded-md tw-border-0 tw-px-1.5 tw-text-[12px] tw-font-semibold tw-cursor-pointer tw-transition-colors [font-family:inherit] ${
        copied ? "tw-bg-success-soft tw-text-success" : "tw-bg-transparent tw-text-ink-3 hover:tw-bg-bg hover:tw-text-brand"
      }`}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? "Copied" : null}
    </button>
  );
};

/** An email address on one line, with its copy button. */
export const EmailLine = ({ email, size = 14 }: { email: string; size?: number }) => (
  <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
    <FitText text={email} size={size} />
    <CopyButton value={email} label="Copy" />
  </span>
);
