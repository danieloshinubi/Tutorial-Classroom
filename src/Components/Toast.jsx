import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// A floating, self-dismissing notification — the same "pop" pattern
// LiveUpdateBanner already uses for "N updates — reload", generalised to any
// success/error feedback from an action. Exists so a person acting near the
// bottom of a long workspace (recording a decision, verifying a document)
// sees the result right where they are, instead of a message landing at the
// top of the page that they'd have to scroll up to notice.
const ToastContext = createContext(null);

let idSeq = 0;

const DEFAULT_DURATION = { error: 7000, success: 4500, warn: 6000, muted: 4500 };

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    window.clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const notify = useCallback((message, { tone = "muted", duration } = {}) => {
    if (!message) return null;
    const id = ++idSeq;
    setToasts((current) => [...current, { id, message, tone }]);
    timers.current[id] = window.setTimeout(
      () => dismiss(id),
      duration ?? DEFAULT_DURATION[tone] ?? 5000
    );
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ notify, dismiss }}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.tone}`}
            role="alert"
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// Falls back to a no-op notify rather than throwing when used outside the
// provider (e.g. a component rendered in a test harness) — feedback that
// silently doesn't pop is a much smaller problem than a page that won't
// render at all.
const NOOP = { notify: () => null, dismiss: () => {} };

export const useToast = () => useContext(ToastContext) || NOOP;

// The near-universal per-page idiom this codebase used before toasts
// existed: a local `error`/`notice` string, set after an action, printed as
// <Notice tone="error">{error}</Notice> / <Notice tone="success">{notice}
// </Notice> right under the page header — meant to be read immediately,
// not to persist, so a person acting further down the page had to scroll up
// to ever see it. Swap the plain useState calls for this hook and delete
// those two inline <Notice> lines, and the exact same setError(...)/
// setNotice(...) call sites throughout that file keep working unchanged —
// the message now pops instead of printing into the page.
export const useActionFeedback = () => {
  const { notify } = useToast();
  const [error, setErrorState] = useState("");
  const [notice, setNoticeState] = useState("");
  const setError = useCallback((message) => {
    setErrorState(message);
    if (message) notify(message, { tone: "error" });
  }, [notify]);
  const setNotice = useCallback((message) => {
    setNoticeState(message);
    if (message) notify(message, { tone: "success" });
  }, [notify]);
  return { error, setError, notice, setNotice };
};
