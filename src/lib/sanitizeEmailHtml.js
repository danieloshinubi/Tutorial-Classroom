import DOMPurify from "dompurify";

// A blanket FORBID_ATTR on "style" was tried first and caused a second bug:
// it also strips the width/height an icon or logo relies on to render small,
// falling back to the source image's real (often huge) resolution — capping
// that after the fact only trades "gigantic" for "still too big", since we
// no longer know what size was actually intended. Stripping only the
// font-related declarations that caused the original problem (a signature
// block outsizing the message itself) leaves an image's own sizing alone.
let hooked = false;
const ensureHook = () => {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") return;
    data.attrValue = data.attrValue
      .split(";")
      .filter((decl) => !/^\s*(font-size|font-family|line-height)\s*:/i.test(decl))
      .join(";");
  });
};

export const sanitizeEmailHtml = (html) => {
  ensureHook();
  return DOMPurify.sanitize(html || "");
};
