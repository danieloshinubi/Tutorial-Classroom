// One tenant, one accent colour. A school admin picks a single hex value in
// SchoolAdmin's settings panel; this derives every shade the CSS actually
// needs (a darker hover, a soft tint for chips/focus rings, lighter/darker
// gradient stops) so the whole product recolours from that one choice
// instead of asking for seven.
//
// Lightness is clamped to a mid band regardless of what was picked — the UI
// puts white text over --brand in a lot of places (hero banners, primary
// buttons, badges), and a swatch that's too light or too dark would make
// that text unreadable. The hue and saturation chosen are kept exactly;
// only how light or dark the base swatch can go is bounded.

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function hexToHsl(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

// The complete set of {--brand, --brand-dark, ...} theme.css expects,
// derived from one admin-picked colour. Returns null for anything that
// doesn't parse as a #rrggbb hex colour, so a caller can fall back cleanly.
export function deriveBrandPalette(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const { h, s } = hsl;
  const l = Math.min(0.62, Math.max(0.3, hsl.l));
  return {
    "--brand": hslToHex(h, s, l),
    "--brand-dark": hslToHex(h, s, Math.max(0.18, l - 0.14)),
    "--brand-darker": hslToHex(h, Math.min(1, s + 0.05), Math.max(0.14, l - 0.24)),
    "--brand-light": hslToHex(h, Math.min(1, s + 0.05), Math.min(0.68, l + 0.1)),
    "--brand-lighter": hslToHex(h, Math.min(1, s + 0.1), Math.min(0.72, l + 0.17)),
    "--brand-glow": hslToHex(h, s, Math.min(0.68, l + 0.08)),
    "--brand-soft": hslToHex(h, Math.min(1, s + 0.3), 0.95),
  };
}

const BRAND_CSS_VARS = [
  "--brand",
  "--brand-dark",
  "--brand-darker",
  "--brand-light",
  "--brand-lighter",
  "--brand-glow",
  "--brand-soft",
];


// Read back by the inline script in public/index.html before the first paint,
// so a refresh shows the school rather than Schoolivio while the app loads.
// Bump v if the shape changes; the boot script ignores anything else.
const CACHE_KEY = "schoolivio:brand";

// This tab's <link rel="icon"/apple-touch-icon> elements, captured once
// exactly as index.html shipped them (one is the .png, one the .svg) — so
// reverting to "no custom logo" restores each tag's own real default
// instead of collapsing both onto one hardcoded path.
let originalIcons = null;
const captureOriginalIcons = () => {
  if (originalIcons || typeof document === "undefined") return;
  // The boot script in index.html may already have swapped these for a saved
  // school logo, in which case what index.html really shipped is in the
  // data-default-* attributes it left behind. Reading only the live href
  // would record the school's logo as the "default" and make removing a logo
  // impossible to undo.
  const original = (el, attr) =>
    el.hasAttribute(`data-default-${attr}`)
      ? el.getAttribute(`data-default-${attr}`)
      : el.getAttribute(attr);
  originalIcons = {
    favicons: Array.from(document.querySelectorAll('link[rel="icon"]')).map((el) => ({
      el,
      href: original(el, "href"),
      type: original(el, "type"),
    })),
    touchIcon: (() => {
      const el = document.querySelector('link[rel="apple-touch-icon"]');
      return el ? { el, href: original(el, "href") } : null;
    })(),
    themeColor: (() => {
      const el = document.querySelector('meta[name="theme-color"]');
      return el ? { el, content: original(el, "content") } : null;
    })(),
  };
};

// Applies one school's branding to the page currently rendering it: the
// theme colour (as CSS variables on the root element), the browser tab's
// icon, and its title. Called from every place in the app that resolves a
// school — SchoolContext for the signed-in staff/student/parent app, and
// each pre-sign-in or applicant-only surface (Login, the public Apply
// forms, the applicant's own portal) that resolves one independently of
// membership. Safe to call repeatedly with the same values; it only ever
// touches the DOM, no state of its own.
export function applyTenantBranding({ name, logoUrl, themeColor } = {}) {
  if (typeof document === "undefined") return;
  // No school yet means "not loaded yet", never "this school has no
  // branding". Every public page (sign-in, the Apply forms, the applicant
  // portal) calls this once on mount with nothing, before its lookup
  // returns. Treating that as a reset repainted the page in Schoolivio's
  // purple for a moment on every visit, AND deleted the saved branding the
  // boot script in index.html relies on, so the next refresh flashed too.
  if (!name) return;
  captureOriginalIcons();

  const root = document.documentElement;
  const palette = themeColor ? deriveBrandPalette(themeColor) : null;
  if (palette) {
    Object.entries(palette).forEach(([prop, value]) => root.style.setProperty(prop, value));
  } else {
    BRAND_CSS_VARS.forEach((prop) => root.style.removeProperty(prop));
  }

  if (originalIcons) {
    if (logoUrl) {
      originalIcons.favicons.forEach(({ el }) => {
        el.setAttribute("href", logoUrl);
        // The uploaded logo's real format isn't known here (PNG/JPEG/WebP
        // are all accepted) — dropping `type` lets the browser sniff it
        // rather than risk a mismatched declared type getting it ignored.
        el.removeAttribute("type");
      });
      if (originalIcons.touchIcon) originalIcons.touchIcon.el.setAttribute("href", logoUrl);
    } else {
      originalIcons.favicons.forEach(({ el, href, type }) => {
        el.setAttribute("href", href);
        if (type) el.setAttribute("type", type);
        else el.removeAttribute("type");
      });
      if (originalIcons.touchIcon) {
        originalIcons.touchIcon.el.setAttribute("href", originalIcons.touchIcon.href);
      }
    }
  }

  // The browser's own bar — the strip Safari on an iPhone tints to match the
  // page. index.html ships Schoolivio's purple and nothing used to change it,
  // so every school's app sat under a Schoolivio-coloured bar.
  if (originalIcons?.themeColor) {
    originalIcons.themeColor.el.setAttribute(
      "content",
      palette ? palette["--brand"] : originalIcons.themeColor.content
    );
  }

  document.title = `${name} · Schoolivio`;

  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        v: 1,
        title: document.title,
        palette,
        icon: logoUrl || null,
        themeColor: palette ? palette["--brand"] : null,
      })
    );
  } catch {
    // Storage unavailable (private browsing, blocked cookies). Nothing is
    // lost: the next load brands itself once the school arrives, as before.
  }

  revealPage();
}

// index.html hides a school's page on a device that has never seen that
// school, so nothing shows in Schoolivio's colours before the school's own
// arrive. Branding lifts it; so does a lookup that finds no school (call
// this then), and index.html's own few-second safety timer.
export function revealPage() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove("brand-pending");
}

// The school's public details (name, logo, colour, address), saved on this
// device so the sign-in page can show the right school on its very first
// paint instead of a generic one while the lookup is in flight. Each school
// is its own subdomain, so each has its own storage; the slug is checked
// anyway, since plain localhost serves every school in development.
const SCHOOL_KEY = "schoolivio:public-school";

export function cachedPublicSchool(slug) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SCHOOL_KEY) || "null");
    return saved && saved.slug === slug ? saved : null;
  } catch {
    return null;
  }
}

export function rememberPublicSchool(school) {
  try {
    if (school?.slug) window.localStorage.setItem(SCHOOL_KEY, JSON.stringify(school));
  } catch {
    // Not saved; the page just waits for the lookup next time.
  }
}
