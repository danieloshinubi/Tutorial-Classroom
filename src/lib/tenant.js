// Which school is this browser tab looking at?
//
// Production:  jane-nath.schoolivio.com     → "jane-nath"
// Local dev:   jane-nath.localhost:3000     → "jane-nath"   (Chrome resolves this)
//              localhost:3000               → falls back to REACT_APP_DEFAULT_SCHOOL
//
// Reserved names are the platform's own hosts, not tenants.
const RESERVED = new Set(["www", "app", "api", "admin", "static", "cdn", "mail"]);

const FALLBACK = process.env.REACT_APP_DEFAULT_SCHOOL || "jane-nath";

export const resolveSlug = (hostname = window.location.hostname) => {
  const host = hostname.toLowerCase().split(":")[0];

  // An IP address is never a subdomain.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return FALLBACK;

  const parts = host.split(".");

  // "localhost" alone, or a bare apex like "schoolivio.com".
  if (parts.length < 2) return FALLBACK;
  if (parts.length === 2 && parts[1] !== "localhost") return FALLBACK;

  const candidate = parts[0];
  if (!candidate || RESERVED.has(candidate)) return FALLBACK;
  return candidate;
};

// Where a given school lives, used when switching between them.
export const schoolUrl = (slug) => {
  const { protocol, hostname, port } = window.location;
  const host = hostname.toLowerCase();
  const parts = host.split(".");

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
export const isPlatformHost = (hostname = window.location.hostname) => {
  const first = hostname.toLowerCase().split(":")[0].split(".")[0];
  return first === "admin";
};

// Where the console lives, from wherever you are now.
export const platformUrl = () => {
  const { protocol, hostname, port } = window.location;
  const host = hostname.toLowerCase();
  const parts = host.split(".");
  const base =
    host.endsWith("localhost") || host === "localhost"
      ? "localhost"
      : parts.slice(-2).join(".");
  return `${protocol}//admin.${base}${port ? `:${port}` : ""}`;
};
