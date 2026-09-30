import React, { useMemo } from "react";
import DOMPurify from "dompurify";

// The assistant answers in markdown: short paragraphs, bold, lists and
// tables. This turns the parts it uses into HTML. Everything is escaped
// first and the result goes through DOMPurify, so nothing in an answer (or in
// a record it quotes) can inject markup into the page.

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inline = (text) =>
  escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^)\s]+)\)/g, (m, label, href) =>
      href.startsWith("/")
        ? `<a href="${href}" data-internal="1">${label}</a>`
        : `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

// Some models group digits with spaces ("₦20 456 000"); money reads with
// commas here, whatever the model wrote.
const moneyCommas = (text) =>
  text.replace(/(₦|NGN\s?|\$|£)(\d{1,3}(?:[   ]\d{3})+)(?=\D|$)/g, (m, sign, digits) => `${sign}${digits.replace(/[   ]/g, ",")}`);

export const renderMarkdown = (source) => {
  const lines = moneyCommas(String(source || "")).replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i += 1;
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && isTableRow(lines[i])) body.push(cells(lines[i++]));
      out.push(
        `<div class="ai-table"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`<h4>${inline(heading[2])}</h4>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ""));
        i += 1;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isDivider(lines[i + 1]))
    ) {
      para.push(inline(lines[i]));
      i += 1;
    }
    out.push(`<p>${para.join("<br/>")}</p>`);
  }
  return DOMPurify.sanitize(out.join(""), { ADD_ATTR: ["target", "data-internal"] });
};

const Markdown = ({ text, onInternalLink }) => {
  const html = useMemo(() => renderMarkdown(text), [text]);
  // Links inside the app open in place, not as a full page reload.
  const onClick = (event) => {
    const a = event.target.closest?.("a[data-internal]");
    if (!a || !onInternalLink) return;
    event.preventDefault();
    onInternalLink(a.getAttribute("href"));
  };
  // eslint-disable-next-line react/no-danger
  return <div className="ai-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
};

export default Markdown;
