/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scoped to only the Chat module for now — this is an incremental
  // migration (see the plan), not a whole-app rewrite. Expand this list
  // module-by-module as later phases convert more of the app.
  content: [
    "./src/Pages/Chat/**/*.{js,jsx}",
    "./src/Components/PersonModal.jsx",
  ],
  // Tailwind decides what to generate by scanning the files above for
  // anything that LOOKS like a class name — which includes ordinary English
  // words in code comments. "a small, fixed set" emitted a real .fixed
  // {position:fixed} rule; the same scan produced .block, .grid, .hidden,
  // .table, .relative, .visible, .transform and .transition. Those load
  // after theme.css, so any one of them that happens to match an existing
  // class name silently overrides it for the WHOLE app, not just Chat
  // (.grid is already defined at theme.css:554 and used by UI.jsx's Grid and
  // Charts.jsx). A prefix makes that collision impossible to write by
  // accident, which matters most while 4,697 lines of hand-written CSS still
  // coexist with these utilities. Drop it once the migration is finished.
  prefix: "tw-",
  theme: {
    screens: {
      // Desktop-first, matching this app's existing @media (max-width: 900px)
      // breakpoint exactly (theme.css has several of these). This REPLACES
      // Tailwind's default min-width screens for the content scoped above,
      // so nobody reaches for a min-width md: here and gets the opposite of
      // what every other @media query in this app already does.
      mobile: { max: "900px" },
    },
    extend: {
      colors: {
        // Every tenant's brand color is computed at runtime (src/lib/
        // branding.js) and set as a CSS custom property on
        // document.documentElement — these are thin wrappers around that
        // live value, never a hardcoded hex. Do not "simplify" these to
        // static colors; that would break per-tenant theming for everyone.
        brand: {
          DEFAULT: "var(--brand)",
          dark: "var(--brand-dark)",
          darker: "var(--brand-darker)",
          light: "var(--brand-light)",
          lighter: "var(--brand-lighter)",
          glow: "var(--brand-glow)",
          soft: "var(--brand-soft)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
        },
        bg: "var(--bg)",
        surface: "var(--surface)",
        line: "var(--line)",
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)",
        },
        success: {
          DEFAULT: "var(--success)",
          soft: "var(--success-soft)",
        },
        warn: {
          soft: "var(--warn-soft)",
          ink: "var(--warn-ink)",
        },
        // .tix-shell (theme.css) already aliases these from the global
        // tokens above at runtime, for Chat and Tickets alike — Tailwind
        // just needs to emit var(--tix-*) references, same as any
        // hand-written rule already does.
        tix: {
          bg: "var(--tix-bg)",
          surface: "var(--tix-surface)",
          "surface-2": "var(--tix-surface-2)",
          line: "var(--tix-line)",
          ink: "var(--tix-ink)",
          "ink-2": "var(--tix-ink-2)",
          "ink-3": "var(--tix-ink-3)",
          brand: "var(--tix-brand)",
          urgent: "var(--tix-urgent)",
          high: "var(--tix-high)",
          medium: "var(--tix-medium)",
          low: "var(--tix-low)",
          new: "var(--tix-new)",
        },
      },
      borderRadius: {
        sm: "var(--r-sm)",
        DEFAULT: "var(--r)",
        lg: "var(--r-lg)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",
      },
    },
  },
  corePlugins: {
    // Tailwind's reset changes global element defaults (box-sizing,
    // heading/list margins, button appearance) app-wide, not just for Chat
    // — the rest of the app was never built against that reset. Keep this
    // off for the whole incremental migration; only reconsider once the
    // entire app has actually been converted.
    preflight: false,
  },
  plugins: [],
};
