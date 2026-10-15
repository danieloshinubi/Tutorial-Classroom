// Only web and email links are ever made clickable from what people type
// (a submission link, a material, an assignment's link). A "javascript:"
// address would otherwise run as the person who clicks it, a teacher
// opening a pupil's work, say (security review, 2026-10-15).
const ALLOWED = new Set(["http:", "https:", "mailto:"]);

export const safeHref = (value: string | null | undefined): string | undefined => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw, window.location.origin);
    return ALLOWED.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

// For saving: a link someone types must be a web address.
export const isWebLink = (value: string | null | undefined) => /^https?:\/\/\S+$/i.test(String(value || "").trim());

// A path inside this app, safe to navigate to after sign-in or from a link
// the assistant wrote: "/Results", never "//evil.com" or "/\evil.com"
// (browsers read both as another website).
export const safeInternalPath = (value: string | null | undefined): string | null => {
  const raw = String(value || "");
  // No backslash and no control characters anywhere in it.
  const hasControl = [...raw].some((ch) => ch.charCodeAt(0) < 32);
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || hasControl) return null;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
};
