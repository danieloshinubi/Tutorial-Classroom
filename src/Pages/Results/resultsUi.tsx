import React from "react";
import type { Status } from "../../lib/resultsApi";

// Small pieces shared by the Results screens (Tailwind, tw- prefix).

export const card = "tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-shadow-1";

export const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const I = {
  chevron: "m9 18 6-6-6-6",
  back: "m15 18-6-6 6-6",
  send: "m22 2-7 20-4-9-9-4ZM22 2 11 13",
  check: "M20 6 9 17l-5-5",
  undo: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
  paste: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6v4H9z",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};

export type Tone = "good" | "bad" | "warn" | "brand" | "muted";
export const statusTone = (s: Status): Tone =>
  s === "released" ? "good" : s === "approved" ? "brand" : s === "submitted" ? "warn" : s === "returned" ? "bad" : "muted";

export const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span
    className={`tw-inline-flex tw-items-center tw-whitespace-nowrap tw-rounded-full tw-px-2.5 tw-py-0.5 tw-text-[12px] tw-font-semibold ${
      tone === "good"
        ? "tw-bg-success-soft tw-text-success"
        : tone === "bad"
        ? "tw-bg-danger-soft tw-text-danger"
        : tone === "warn"
        ? "tw-bg-warn-soft tw-text-warn-ink"
        : tone === "brand"
        ? "tw-bg-brand-soft tw-text-brand"
        : "tw-bg-bg tw-text-ink-2"
    }`}
  >
    {children}
  </span>
);

export const btn = (kind: "primary" | "secondary" | "danger" = "secondary") =>
  `tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-px-4 tw-py-2 tw-text-[13.5px] tw-font-semibold tw-cursor-pointer tw-transition-colors disabled:tw-cursor-not-allowed disabled:tw-opacity-50 [font-family:inherit] ${
    kind === "primary"
      ? "tw-border-0 tw-bg-brand tw-text-white hover:tw-opacity-90"
      : kind === "danger"
      ? "tw-border tw-border-solid tw-border-danger-soft tw-bg-surface tw-text-danger hover:tw-bg-danger-soft"
      : "tw-border tw-border-solid tw-border-line tw-bg-surface tw-text-ink hover:tw-border-brand hover:tw-text-brand"
  }`;
