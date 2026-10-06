import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { confirmDialog } from "./Confirm";

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
//
// Mail (supabase/243): outside pictures can be held back (blockRemote) until
// the reader allows them, which also stops senders learning when it was
// opened; and a link that is not what it seems (its text shows one site but
// it goes to another, a bare IP address, a look-alike or shortened address)
// asks before it opens (warnLinks).

// Its own DOMPurify instance: the shared one carries sanitizeEmailHtml's hook
// that strips font sizes, which is the very thing breaking these layouts.
const purifier = DOMPurify(window);

const FRAME_STYLE = `
  html, body { margin: 0; padding: 0; background: transparent; }
  body { display: flow-root; }
  body {
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #2b2f38; overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  a { color: inherit; }
  blockquote { margin: 0 0 0 10px; padding-left: 10px; border-left: 3px solid #d9dce3; color: #5b6170; }
`;

const REMOTE = /^(https?:)?\/\//i;

const buildDocument = (html, blockRemote) => {
  const clean = purifier.sanitize(html || "", {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    // Video and sound would fetch from the sender's server too (and give away
    // the opening), so they go when outside pictures are held back.
    FORBID_TAGS: ["script", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base", ...(blockRemote ? ["video", "audio", "source", "track"] : [])],
    FORBID_ATTR: ["srcset"],
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  let blocked = 0;
  if (blockRemote) {
    doc.querySelectorAll("[src], [poster]").forEach((el) => {
      ["src", "poster"].forEach((attr) => {
        const src = el.getAttribute(attr) || "";
        if (REMOTE.test(src)) {
          el.setAttribute(`data-blocked-${attr}`, src);
          el.removeAttribute(attr);
          if (el.tagName === "IMG") el.setAttribute("alt", el.getAttribute("alt") || "");
          blocked += 1;
        }
      });
    });
    doc.querySelectorAll("[background]").forEach((el) => {
      if (REMOTE.test(el.getAttribute("background") || "")) {
        el.removeAttribute("background");
        blocked += 1;
      }
    });
    const noRemoteUrls = (css) => css
      // @import "https://…" (without url()) fetches too.
      .replace(/@import[^;]*;?/gi, () => {
        blocked += 1;
        return "";
      })
      .replace(/url\(\s*(['"]?)(https?:)?\/\/[^)]*\)/gi, () => {
      blocked += 1;
      return "none";
    });
    doc.querySelectorAll("[style]").forEach((el) => el.setAttribute("style", noRemoteUrls(el.getAttribute("style") || "")));
    doc.querySelectorAll("style").forEach((el) => {
      el.textContent = noRemoteUrls(el.textContent || "");
    });
  }
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
  return { srcDoc: `<!doctype html>${doc.documentElement.outerHTML}`, blocked };
};

const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|ow\.ly|shorturl\.at|tiny\.cc)$/i;
const siteOf = (host) => host.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");

// Why a link might not be what it seems, or null when it looks fine.
export const linkRisk = (href, text) => {
  let url;
  try {
    url = new URL(href, "https://invalid.local");
  } catch {
    return "This link is not a normal web address.";
  }
  if (/^(mailto|tel):$/i.test(url.protocol)) return null;
  if (!/^https?:$/i.test(url.protocol)) return `This link uses ${url.protocol.replace(":", "")}:, not a normal web address.`;
  const host = url.hostname;
  if (url.username || url.password) return `This link hides its real destination: it goes to ${host}.`;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return `This link goes to a bare internet address (${host}), not a named website.`;
  if (host.split(".").some((p) => p.startsWith("xn--"))) return `This link goes to ${host}, which uses look-alike letters.`;
  const shown = (text || "").trim().match(/^(https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/|$|\s)/i);
  if (shown && siteOf(shown[2]) !== siteOf(host)) return `This link shows ${shown[2]} but really goes to ${host}.`;
  if (SHORTENERS.test(host)) return `This is a shortened link (${host}): where it ends up is hidden.`;
  return null;
};

const EmailFrame = ({ html, title = "Email", blockRemote = false, onBlocked, warnLinks = false }) => {
  const frameRef = useRef(null);
  const [height, setHeight] = useState(80);
  const built = useMemo(() => buildDocument(html, blockRemote), [html, blockRemote]);
  const srcDoc = built.srcDoc;
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  useEffect(() => {
    onBlockedRef.current?.(built.blocked);
  }, [built.blocked]);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    // The content's own height (body is a flow-root, so margins count). The
    // document is never shorter than the frame, so measuring it could only
    // ever grow the frame, never shrink it after a phone is turned.
    const next = Math.ceil(doc.body ? doc.body.getBoundingClientRect().height : doc.documentElement.scrollHeight);
    if (next > 0) setHeight(next);
  }, []);

  const onLoad = () => {
    measure();
    // A risky link asks first.
    if (warnLinks) {
      frameRef.current?.contentDocument?.addEventListener("click", async (e) => {
        const a = e.target?.closest?.("a[href]");
        if (!a) return;
        const href = a.getAttribute("href") || "";
        const risk = linkRisk(href, a.textContent);
        if (!risk) return;
        e.preventDefault();
        if (await confirmDialog({ title: "Check this link", body: `${risk} Open it anyway?`, confirmLabel: "Open anyway", tone: "danger" })) {
          window.open(href, "_blank", "noopener,noreferrer");
        }
      });
    }
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
