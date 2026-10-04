import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "react-icons-kit";
import { zap } from "react-icons-kit/feather/zap";
import { useSchoolIfAny } from "../context/SchoolContext";
import { composeText, type ComposeAction } from "../lib/compose";

// "Write with AI" on every note and message box in the app (supabase/228).
// Mounted once: whenever someone clicks into a text box, a small button
// appears at its corner. It drafts the text from a sentence of what they
// want, or improves, shortens, formalises or corrects what they have typed,
// using the box's label and the page as context, and puts the result in the
// box only when they press "Use this".
//
// Not on exam or assignment answers (data-no-ai on those boxes), and not for
// students at all: it is for staff and parents writing notes and messages,
// never for doing schoolwork. Any box can opt out with data-no-ai.

const QUICK: { action: ComposeAction; label: string }[] = [
  { action: "improve", label: "Improve" },
  { action: "shorter", label: "Shorter" },
  { action: "formal", label: "More formal" },
  { action: "friendly", label: "Friendlier" },
  { action: "fix", label: "Fix spelling" },
];

const eligible = (el: Element | null): el is HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement &&
  !el.disabled &&
  !el.readOnly &&
  !el.closest("[data-no-ai]") &&
  !el.closest(".ca-panel");

// What the box is for, from what the page already says about it.
const describe = (el: HTMLTextAreaElement) => {
  const fieldLabel = el.closest(".field")?.querySelector(".label")?.textContent?.trim();
  const labelled = el.id ? document.querySelector(`label[for="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id}"]`)?.textContent?.trim() : "";
  const field = fieldLabel || labelled || el.getAttribute("aria-label") || el.name || "";
  const heading = (root: Element | null | undefined, tags: string[]) =>
    tags.map((t) => root?.getElementsByTagName(t)[0]?.textContent?.trim()).find(Boolean) || "";
  const dialog = heading(el.closest("[role=dialog]"), ["h2", "h3"]);
  const card = heading(el.closest(".card"), ["h3", "h2"]);
  const page = heading(document.querySelector(".page-head"), ["h1"]) || heading(document.body, ["h1"]) || document.title;
  // What the writer can see around the box, so the text names the right
  // person and gets references, dates and statuses right: the dialog the box
  // is in (with its "Emailed to …" line) and the page's main content.
  const dialogText = el.closest("[role=dialog]")?.textContent || "";
  const main = document.querySelector("main") || document.querySelector(".page") || document.body;
  const visible = (node: Element) => ((node as HTMLElement).innerText || node.textContent || "").replace(/\n{2,}/g, "\n");
  const details = [dialogText ? `In this window: ${dialogText.replace(el.value, "").slice(0, 800)}` : "", visible(main).slice(0, 4000)]
    .filter(Boolean)
    .join("\n\n");
  return {
    field,
    page,
    details,
    context: [dialog, card, el.placeholder ? `Example given: ${el.placeholder}` : ""].filter(Boolean).join(" · "),
  };
};

// Put text in a React-controlled box the way typing would, so its onChange runs.
const fill = (el: HTMLTextAreaElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(text.length, text.length);
};

const ComposeAssist = () => {
  const school = useSchoolIfAny();
  const schoolId = school?.schoolId || null;
  const allowed = Boolean(schoolId && school?.membership && !(school.roles || []).every((r) => r === "student"));

  const [target, setTarget] = useState<HTMLTextAreaElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState<ComposeAction | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const reset = () => {
    setOpen(false);
    setRequest("");
    setResult("");
    setError("");
    setBusy(null);
  };

  // Follow focus into and out of text boxes.
  useEffect(() => {
    if (!allowed) return undefined;
    const onIn = (e: FocusEvent) => {
      const el = e.target as Element;
      if (eligible(el)) {
        setTarget((current) => {
          if (current !== el) {
            setOpen(false);
            setResult("");
            setError("");
          }
          return el;
        });
      }
    };
    const onOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (openRef.current) return;
        if (active && (panelRef.current?.contains(active) || pillRef.current?.contains(active))) return;
        if (!eligible(active)) setTarget(null);
      }, 150);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [allowed]);

  // Keep the button on the box's corner while the page scrolls or resizes.
  const measure = useCallback(() => {
    if (!target || !target.isConnected) {
      setTarget(null);
      setOpen(false);
      return;
    }
    setRect(target.getBoundingClientRect());
  }, [target]);
  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    if (!target) return undefined;
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    const watch = new ResizeObserver(measure);
    watch.observe(target);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      watch.disconnect();
    };
  }, [target, measure]);

  // Esc or a click elsewhere closes the panel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        reset();
        target?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (panelRef.current?.contains(node) || pillRef.current?.contains(node) || target?.contains(node)) return;
      reset();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, target]);

  const run = async (action: ComposeAction) => {
    if (!target || !schoolId) return;
    setBusy(action);
    setError("");
    try {
      const text = await composeText({ schoolId, action, request, draft: target.value, ...describe(target) });
      setResult(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!allowed || !target || !rect) return null;
  const viewW = document.documentElement.clientWidth;
  const viewH = window.visualViewport?.height || window.innerHeight;
  if (rect.bottom < 0 || rect.top > viewH) return null;

  // The button sits just above the box's top-right corner, clear of the text.
  const pillTop = Math.max(4, rect.top - 30);
  const pillRight = Math.max(8, viewW - rect.right);

  // The panel opens under the box, or above it when there is more room there.
  const width = Math.min(440, viewW - 16);
  const left = Math.min(Math.max(8, rect.right - width), viewW - width - 8);
  const below = viewH - rect.bottom;
  const above = rect.top;
  const panelStyle: React.CSSProperties =
    below >= 300 || below >= above
      ? { top: Math.min(rect.bottom + 6, viewH - 120), left, width, maxHeight: Math.max(160, below - 14) }
      : { bottom: viewH - rect.top + 36, left, width, maxHeight: Math.max(160, above - 44) };
  const hasDraft = Boolean(target.value.trim());

  return createPortal(
    <>
      <button
        ref={pillRef}
        type="button"
        className={`ca-pill${open ? " is-open" : ""}`}
        style={{ top: pillTop, right: pillRight }}
        // Pressing it must not take focus from the box being written in.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? reset() : setOpen(true))}
        aria-expanded={open}
        aria-label="Write with AI"
      >
        <Icon icon={zap} size={12} />
        <span>{"Write with AI"}</span>
      </button>

      {open ? (
        <div ref={panelRef} className="ca-panel" role="dialog" aria-label="Write with AI" style={panelStyle} data-no-ai>
          {result ? (
            <>
              <div className="ca-title">{"Suggested text"}</div>
              <div className="ca-result">{result}</div>
              <div className="ca-row">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    fill(target, result);
                    reset();
                  }}
                >
                  {"Use this"}
                </button>
                {hasDraft ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      fill(target, `${target.value.trimEnd()}\n\n${result}`);
                      reset();
                    }}
                  >
                    {"Add below mine"}
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResult("")}>
                  {"Try again"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="ca-title">{"Write with AI"}</div>
              <textarea
                className="textarea ca-ask"
                rows={2}
                autoFocus
                placeholder={hasDraft ? "Or say what to change, e.g. mention the deadline is Friday" : "What should it say? e.g. ask them to upload a clearer transcript by Friday"}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && request.trim()) {
                    e.preventDefault();
                    run("write");
                  }
                }}
              />
              <div className="ca-row">
                <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy) || (!request.trim() && !hasDraft)} onClick={() => run("write")}>
                  {busy === "write" ? "Writing…" : hasDraft && !request.trim() ? "Rewrite mine" : "Write it"}
                </button>
              </div>
              {hasDraft ? (
                <div className="ca-chips" aria-label="Change what I wrote">
                  {QUICK.map((q) => (
                    <button key={q.action} type="button" className="ca-chip" disabled={Boolean(busy)} onClick={() => run(q.action)}>
                      {busy === q.action ? "…" : q.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
          {error ? <p className="ca-error" role="alert">{error}</p> : null}
          <p className="ca-note">{"Check it before you send: AI can get details wrong."}</p>
        </div>
      ) : null}
    </>,
    document.body
  );
};

export default ComposeAssist;
