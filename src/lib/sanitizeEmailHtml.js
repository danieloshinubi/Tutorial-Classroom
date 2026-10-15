import DOMPurify from "dompurify";

// Cleans message HTML (chat, help-desk tickets) before it is put on the page.
//
// DOMPurify's defaults remove scripts but keep <style>, <form>, <input> and
// friends, which in a message are an attack, not formatting (security
// review, 2026-10-15): a global <style> could restyle or hide the whole app,
// and a form could show a fake "sign in again" box that posts a password
// somewhere else. Those tags are removed, links may only be web or email
// links and always open safely in a new tab, and inline styles cannot lift
// part of a message over the rest of the screen.
//
// A blanket FORBID_ATTR on "style" was tried first and caused a second bug:
// it also strips the width/height an icon or logo relies on to render small,
// falling back to the source image's real (often huge) resolution — capping
// that after the fact only trades "gigantic" for "still too big", since we
// no longer know what size was actually intended. Stripping only the
// declarations that cause trouble leaves an image's own sizing alone.

const FORBID_TAGS = [
  "style", "form", "input", "button", "textarea", "select", "option", "optgroup", "fieldset",
  "iframe", "frame", "frameset", "object", "embed", "link", "meta", "base", "svg", "math", "dialog",
];
const FORBID_ATTR = ["action", "formaction", "srcset", "ping", "autofocus"];

// Font sizing (a signature outsizing the message), positioning (a message
// covering the screen) and anything that loads from elsewhere.
const UNSAFE_STYLE = /^\s*(font-size|font-family|line-height|position|z-index|top|left|right|bottom|inset|transform|clip-path|filter)\s*:/i;
const SAFE_LINK = /^(https?:|mailto:|tel:|#)/i;

let hooked = false;
const ensureHook = () => {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") return;
    data.attrValue = data.attrValue
      .split(";")
      .filter((decl) => !UNSAFE_STYLE.test(decl) && !/url\s*\(|expression\s*\(/i.test(decl))
      .join(";");
  });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A") return;
    const href = node.getAttribute("href");
    if (href && !SAFE_LINK.test(href.trim())) node.removeAttribute("href");
    if (node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
};

export const sanitizeEmailHtml = (html) => {
  ensureHook();
  return DOMPurify.sanitize(html || "", { FORBID_TAGS, FORBID_ATTR });
};
