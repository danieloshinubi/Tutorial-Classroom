// Which school is this browser tab looking at?
//
// Production:  your-school.schoolivio.com   → "your-school"
// Local dev:   your-school.localhost:3000   → "your-school"   (Chrome resolves this)
//              localhost:3000 or an IP      → falls back to REACT_APP_DEFAULT_SCHOOL
//              (a reserved name such as app.schoolivio.com is the marketing
//              site instead: isMarketingHost)
//
// Reserved names are the platform's own hosts, not tenants.
const RESERVED = new Set(["www", "app", "api", "admin", "static", "cdn", "mail"]);

const FALLBACK = process.env.REACT_APP_DEFAULT_SCHOOL || "jane-nath";

const isIp = (host: string): boolean => /^\d+\.\d+\.\d+\.\d+$/.test(host);

// An address with no room for a school's name (an IP address, as when
// testing on a phone over Wi-Fi, or plain localhost) names the school with
// ?school=<slug> instead, remembered for the rest of that tab.
const OVERRIDE_KEY = "schoolivio.devSchool";
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const overrideSlug = (): string | null => {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("school");
    if (fromQuery && SLUG.test(fromQuery.toLowerCase())) {
      window.sessionStorage.setItem(OVERRIDE_KEY, fromQuery.toLowerCase());
      return fromQuery.toLowerCase();
    }
    const saved = window.sessionStorage.getItem(OVERRIDE_KEY);
    return saved && SLUG.test(saved) ? saved : null;
  } catch {
    return null;
  }
};

export const resolveSlug = (hostname: string = window.location.hostname): string => {
  const host = hostname.toLowerCase().split(":")[0];

  // An IP address is never a subdomain.
  if (isIp(host) || host === "localhost") return overrideSlug() || FALLBACK;

  const parts = host.split(".");

  // "localhost" alone, or a bare apex like "schoolivio.com".
  if (parts.length < 2) return FALLBACK;
  if (parts.length === 2 && parts[1] !== "localhost") return FALLBACK;

  const candidate = parts[0];
  if (!candidate || RESERVED.has(candidate)) return FALLBACK;
  return candidate;
};

// The school named by the address itself ("charismartin-intl" in
// charismartin-intl.schoolivio.com), or null when the address names none and
// resolveSlug falls back to the default (plain localhost, an IP address).
// Only a named school can be wrong, so only this is checked for "no such
// school" (TenantGate).
export const slugFromHost = (hostname: string = window.location.hostname): string | null => {
  const slug = resolveSlug(hostname);
  const first = hostname.toLowerCase().split(":")[0].split(".")[0];
  return slug === first ? slug : null;
};

// Where a given school lives, used when switching between them.
export const schoolUrl = (slug: string): string => {
  const { protocol, hostname, port } = window.location;
  const host = hostname.toLowerCase();
  const parts = host.split(".");

  // No subdomains on an IP address: the school goes in the query instead.
  if (isIp(host)) return `${protocol}//${host}${port ? `:${port}` : ""}/?school=${encodeURIComponent(slug)}`;

  const base =
    host.endsWith("localhost") || host === "localhost"
      ? "localhost"
      : parts.slice(-2).join(".");

  return `${protocol}//${slug}.${base}${port ? `:${port}` : ""}`;
};

// The platform console's own host.
//
//   admin.schoolivio.com    → the console
//   admin.localhost:3000    → the console, locally
//
// Only "admin". "app" stays a reserved name that falls back to a tenant, so
// nobody lands in the console by typing a host that merely sounds like it.
export const isPlatformHost = (hostname: string = window.location.hostname): boolean => {
  const first = hostname.toLowerCase().split(":")[0].split(".")[0];
  return first === "admin";
};

// Where the console lives, from wherever you are now.
export const platformUrl = (): string => {
  const { protocol, hostname, port } = window.location;
  const host = hostname.toLowerCase();
  const parts = host.split(".");
  const base =
    host.endsWith("localhost") || host === "localhost"
      ? "localhost"
      : parts.slice(-2).join(".");
  return `${protocol}//admin.${base}${port ? `:${port}` : ""}`;
};

// The bare apex — schoolivio.com itself (or www.schoolivio.com), never a
// tenant subdomain. This is the public marketing site and self-serve trial
// signup, not a school. Deliberately does NOT match bare "localhost" — local
// dev's existing fallback to REACT_APP_DEFAULT_SCHOOL (see resolveSlug
// above) stays untouched, so every existing dev workflow keeps working.
// Visit /Welcome on any host to preview the marketing site locally instead.
export const isMarketingHost = (hostname: string = window.location.hostname): boolean => {
  const host = hostname.toLowerCase().split(":")[0];
  const parts = host.split(".");
  if (parts.length === 2 && parts[1] !== "localhost") return true; // schoolivio.com
  if (parts[0] === "www" && parts.length > 2) return true; // www.schoolivio.com
  // app., api., mail.schoolivio.com and the other reserved names are no
  // school: the site, not whichever school a developer set as the default.
  if (parts.length > 2 && parts[parts.length - 1] !== "localhost" && RESERVED.has(parts[0]) && parts[0] !== "admin") return true;
  return false;
};
