// One branded email shell for every outbound email the platform sends —
// password reset, parent verification, admissions decisions, staff
// messages, announcements, notifications. A school's own logo and colour
// (deriveBrandPalette) are the only things that change between them; the
// structure, the escaping and the responsive behaviour are all here once.
import { deriveBrandPalette } from "./brand.ts";

export type EmailSchool = {
  name: string;
  slug: string;
  logoUrl?: string | null;
  themeColor?: string | null;
};

export type EmailBadgeTone = "brand" | "muted";

// Schoolivio's own product font, same as src/styles/theme.css's `body`
// rule. Most webmail clients strip the @font-face below and fall back
// silently to the system stack that follows it — that's fine and expected;
// the handful that do render embedded fonts (Apple Mail, Outlook desktop,
// some webmail) then match the product exactly instead of the email
// looking like a different, unrelated product wrote it.
const FONT_STACK = "'Poppins', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export type BuildEmailInput = {
  school: EmailSchool;
  preheader: string;
  badge: string;
  badgeTone?: EmailBadgeTone;
  heading: string;
  /** Already-safe HTML (short paragraphs, <strong>, <br/> only) — callers
   *  are responsible for escaping any untrusted text before it reaches here
   *  (see escapeHtml below). */
  bodyHtml: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  footNote?: string;
};

// The only untrusted strings that ever reach a template (a staff-composed
// message, a guardian's own name) go through this first — nothing here
// trusts the caller to have already escaped it.
export const escapeHtml = (value: string) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Plain-text alternative for clients that don't render HTML — strips tags
// rather than hand-maintaining a second copy of every template's copy.
export const toPlainText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function buildEmail(input: BuildEmailInput): { html: string; text: string } {
  const { school, preheader, badge, heading, bodyHtml, ctaLabel, ctaUrl, footNote } = input;
  const badgeTone = input.badgeTone || "brand";
  const pal = deriveBrandPalette(school.themeColor);
  const badgeColor = badgeTone === "muted" ? "#6b7280" : pal.brand;
  const badgeBg = badgeTone === "muted" ? "#f1f2f4" : pal.brandSoft;
  const schoolName = escapeHtml(school.name);
  const initial = escapeHtml(school.name.trim().charAt(0).toUpperCase() || "S");

  const logoCell = school.logoUrl
    ? `<img src="${escapeHtml(school.logoUrl)}" width="38" height="38" alt="${schoolName}" style="width:38px;height:38px;border-radius:10px;object-fit:cover;display:block;" />`
    : `<div style="width:38px;height:38px;border-radius:10px;background:${pal.brand};text-align:center;line-height:38px;font-family:${FONT_STACK};color:#ffffff;font-size:16px;font-weight:700;">${initial}</div>`;

  // A fluid-hybrid layout: a table with a max-width (Outlook, which ignores
  // max-width, still gets a usable fixed 560px; every other client honours
  // the percentage width and shrinks to fit a phone) plus a real @media
  // block for the clients that support it (everything but Outlook desktop)
  // to tighten padding and bump the CTA to full width below 480px.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="x-apple-disable-message-reformatting" />
<title>${schoolName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;750&display=swap');
  body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  img { -ms-interpolation-mode: bicubic; }
  a { text-decoration: none; }
  @media only screen and (max-width: 480px) {
    .sv-wrap { width: 100% !important; }
    .sv-pad { padding-left: 22px !important; padding-right: 22px !important; }
    .sv-heading { font-size: 19px !important; }
    .sv-cta { display: block !important; text-align: center !important; }
    .sv-cta a { display: block !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef0f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#eef0f4;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f4;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" class="sv-wrap" style="width:560px;max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e8e8ee;font-family:${FONT_STACK};">

<tr><td style="background:linear-gradient(135deg, ${pal.brand}, ${pal.brandDark});height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>

<tr><td class="sv-pad" style="padding:28px 36px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td>${logoCell}</td>
    <td style="padding-left:11px;font-family:${FONT_STACK};font-size:14.5px;font-weight:700;color:#191623;">${schoolName}</td>
  </tr></table>
</td></tr>

<tr><td class="sv-pad" style="padding:26px 36px 0;">
  <span style="display:inline-block;background:${badgeBg};color:${badgeColor};font-family:${FONT_STACK};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${escapeHtml(badge)}</span>
</td></tr>

<tr><td class="sv-pad" style="padding:14px 36px 0;">
  <h1 class="sv-heading" style="margin:0;font-family:${FONT_STACK};font-size:21px;line-height:1.3;color:#191623;font-weight:750;">${escapeHtml(heading)}</h1>
</td></tr>

<tr><td class="sv-pad" style="padding:14px 36px 0;font-family:${FONT_STACK};font-size:14.5px;line-height:1.65;color:#464054;word-break:break-word;">
  ${bodyHtml}
</td></tr>

${ctaLabel && ctaUrl ? `<tr><td class="sv-pad" style="padding:26px 36px 4px;">
  <table role="presentation" cellpadding="0" cellspacing="0" class="sv-cta"><tr>
    <td style="border-radius:10px;background:${pal.brand};">
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 26px;font-family:${FONT_STACK};font-size:14px;font-weight:650;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
    </td>
  </tr></table>
</td></tr>` : ""}

<tr><td class="sv-pad" style="padding:30px 36px 28px;">
  <div style="border-top:1px solid #efeef3;padding-top:16px;font-family:${FONT_STACK};font-size:12px;line-height:1.7;color:#9a94a8;">
    ${footNote ? escapeHtml(footNote) + "<br/>" : ""}
    ${schoolName} &middot; <a href="https://${escapeHtml(school.slug)}.schoolivio.com" style="color:#9a94a8;">${escapeHtml(school.slug)}.schoolivio.com</a>
  </div>
</td></tr>

</table>
<div style="font-family:${FONT_STACK};font-size:11px;color:#b3aec2;margin-top:16px;">Sent via Schoolivio on behalf of ${schoolName}</div>
</td></tr>
</table>
</body>
</html>`;

  const text = `${heading}\n\n${toPlainText(bodyHtml)}${ctaLabel && ctaUrl ? `\n\n${ctaLabel}: ${ctaUrl}` : ""}\n\n${footNote ? footNote + "\n" : ""}${school.name} · ${school.slug}.schoolivio.com`;

  return { html, text };
}
