import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";

// A received email, shown the way a mail client shows it: in its own frame.
//
// Email HTML is written as a whole standalone page (nested tables, fixed
// 600px widths, spacer rows sized with font-size and line-height). Dropped
// straight into the ticket page, the app's own styles land on its tables and
// images, and sanitizeEmailHtml's font-size/line-height stripping (right for
// a short reply, where a signature must not outsize the message) collapses
// those spacer rows, so blocks overlapped and logos were cut off. Inside a
// frame the email's styles apply exactly as sent and none of ours reach it.
//
// Safety: sanitised here too (scripts, forms and embeds removed), and the
// frame's sandbox has no allow-scripts, so nothing in it can run even if
// something slipped through. allow-same-origin is what lets this component
// read the content's height to size the frame; without scripts it gives the
// email nothing. Links open in a new tab (allow-popups).

// Its own DOMPurify instance: the shared one carries sanitizeEmailHtml's hook
// that strips font sizes, which is the very thing breaking these layouts.
const purifier = DOMPurify(window);

const FRAME_STYLE = `
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #2b2f38; overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  a { color: inherit; }
  blockquote { margin: 0 0 0 10px; padding-left: 10px; border-left: 3px solid #d9dce3; color: #5b6170; }
`;

const buildDocument = (html) => {
  const clean = purifier.sanitize(html || "", {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base"],
    FORBID_ATTR: ["srcset"],
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  const base = doc.createElement("base");
  base.setAttribute("target", "_blank");
  const style = doc.createElement("style");
  style.textContent = FRAME_STYLE;
  // Ours first, so the email's own <style> still wins where it sets something.
  doc.head.prepend(style);
  doc.head.prepend(base);
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  doc.head.prepend(charset);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
};

const EmailFrame = ({ html, title = "Email" }) => {
  const frameRef = useRef(null);
  const [height, setHeight] = useState(80);
  const srcDoc = useMemo(() => buildDocument(html), [html]);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    const next = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0));
    if (next > 0) setHeight(next);
  }, []);

  const onLoad = () => {
    measure();
    // Pictures arrive after the text and push the email taller.
    const doc = frameRef.current?.contentDocument;
    doc?.querySelectorAll("img").forEach((img) => {
      if (!img.complete) {
        img.addEventListener("load", measure);
        img.addEventListener("error", measure);
      }
    });
  };

  // A narrower pane (a phone turned, the window resized) re-wraps the text.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return undefined;
    // Width only: the frame's own height change would re-trigger this, and an
    // email sized to 100% of its window would then grow without end.
    let lastWidth = frame.clientWidth;
    const observer = new ResizeObserver(() => {
      if (frame.clientWidth === lastWidth) return;
      lastWidth = frame.clientWidth;
      measure();
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <iframe
      ref={frameRef}
      className="email-frame"
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={onLoad}
      style={{ height }}
    />
  );
};

export default EmailFrame;
