import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Modal, Button, Field } from "./UI";

// In-app replacements for window.confirm and window.prompt.
//
// The native dialogs are a browser chrome popup: they say "localhost:3000
// says", they cannot be styled or branded, they block the whole tab, and on a
// tenant-branded product they look like the page has broken out of itself.
// This renders the same question as an ordinary modal in the app, in the
// school's own colours.
//
// Deliberately promise-based so a call site changes shape as little as
// possible — the whole migration is:
//
//   if (!window.confirm("Delete this?")) return;
//   if (!(await confirm("Delete this?"))) return;
//
// and the enclosing function becomes async. Anything more elaborate (a
// useState for "which row is pending", a modal rendered per page) would have
// meant rewriting forty-odd call sites instead of editing one line in each.
const ConfirmContext = createContext(null);

const normalise = (input) => (typeof input === "string" ? { body: input } : input || {});

// The provider also publishes itself here, so a call site can just import
// confirmDialog/promptDialog and await it — no hook, no wiring inside the
// component body.
//
// That matters because this replaced ~40 window.confirm/window.prompt calls
// spread over 25 files, many of them in nested helpers and callbacks rather
// than at the top of a component where a hook can legally go. As a hook-only
// API each of those would have needed its own surgery; as a plain function
// each one is a single-line substitution, which is a far smaller change to
// get wrong. It is the same shape react-hot-toast's `toast()` uses.
let live = null;

export const ConfirmProvider = ({ children }) => {
  const [request, setRequest] = useState(null);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  // Reset the field for each new prompt, and focus it, so the dialog behaves
  // like the native one it replaces — type immediately, press Enter.
  useEffect(() => {
    if (!request) return;
    setValue(request.defaultValue ?? "");
    if (request.kind === "prompt") {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [request]);

  const settle = useCallback((result) => {
    setRequest((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const confirm = useCallback(
    (input) => new Promise((resolve) => setRequest({ kind: "confirm", ...normalise(input), resolve })),
    []
  );

  const prompt = useCallback(
    (input) => new Promise((resolve) => setRequest({ kind: "prompt", ...normalise(input), resolve })),
    []
  );

  // Registered on mount so the module-level helpers below reach this instance.
  useEffect(() => {
    live = { confirm, prompt };
    return () => {
      if (live?.confirm === confirm) live = null;
    };
  }, [confirm, prompt]);

  const cancelled = request?.kind === "prompt" ? null : false;

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      {request ? (
        <Modal
          title={request.title || (request.kind === "prompt" ? "Enter a value" : "Are you sure?")}
          onClose={() => settle(cancelled)}
          footer={
            <div className="btn-row">
              <Button variant="secondary" onClick={() => settle(cancelled)}>
                {request.cancelLabel || "Cancel"}
              </Button>
              <Button
                onClick={() => settle(request.kind === "prompt" ? value : true)}
                disabled={request.kind === "prompt" && request.required && !value.trim()}
              >
                {request.confirmLabel || (request.kind === "prompt" ? "OK" : "Yes, continue")}
              </Button>
            </div>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              settle(request.kind === "prompt" ? value : true);
            }}
          >
            {request.body ? <p style={{ marginTop: 0 }}>{request.body}</p> : null}
            {request.kind === "prompt" ? (
              <Field label={request.label || ""}>
                <input
                  ref={inputRef}
                  className="input"
                  value={value}
                  placeholder={request.placeholder || ""}
                  onChange={(e) => setValue(e.target.value)}
                />
              </Field>
            ) : null}
            {/* Lets Enter submit without a visible second button. */}
            <button type="submit" style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
          </form>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
};

// Outside the provider, fall back to the native dialog rather than a no-op.
// A destructive action guarded by a confirmation that silently returns true
// would delete without asking; one that returns false would break the flow.
// The ugly dialog is the least bad of the three.
const FALLBACK = {
  confirm: (input) => Promise.resolve(window.confirm(normalise(input).body || "Are you sure?")),
  prompt: async (input) => {
    const o = normalise(input);
    return Promise.resolve(window.prompt(o.body || o.label || "", o.defaultValue ?? ""));
  },
};

export const useConfirm = () => (useContext(ConfirmContext) || FALLBACK).confirm;
export const usePrompt = () => (useContext(ConfirmContext) || FALLBACK).prompt;

// Await these from anywhere — a handler, a helper, a callback — without a hook.
//   if (!(await confirmDialog("Delete this?"))) return;
//   const reason = await promptDialog({ body: "Why?" });   // null if cancelled
export const confirmDialog = (input) => (live || FALLBACK).confirm(input);
export const promptDialog = (input) => (live || FALLBACK).prompt(input);
