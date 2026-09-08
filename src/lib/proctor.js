// Browser-side exam lockdown.
//
// Everything here is a DETERRENT. A student who opens devtools can disable any
// of it, which is why the rules that decide marks — the deadline, the single
// attempt, disqualification — live in Postgres instead. What this layer buys is
// that casual cheating becomes hard and, more importantly, noisy: every attempt
// is reported to the server and written to an append-only log.

const KEY_BLOCKED = new Set(["c", "v", "x", "a", "p", "s", "u", "f", "j", "i"]);

/**
 * Locks down the page and reports violations.
 *
 * @param {object} options
 * @param {(kind: string, detail?: string) => void} options.onViolation
 * @param {boolean} options.blockCopyPaste
 * @param {boolean} options.requireFullscreen
 * @returns {() => void} teardown
 */
export const startProctoring = ({
  onViolation,
  blockCopyPaste = true,
  requireFullscreen = true,
}) => {
  const listeners = [];
  const on = (target, event, handler, opts) => {
    target.addEventListener(event, handler, opts);
    listeners.push(() => target.removeEventListener(event, handler, opts));
  };

  const report = (kind, detail) => {
    try {
      onViolation(kind, detail);
    } catch {
      // Never let reporting break the exam itself.
    }
  };

  /* ---------------------------------------------------------- clipboard */
  if (blockCopyPaste) {
    ["copy", "cut"].forEach((event) =>
      on(document, event, (e) => {
        e.preventDefault();
        report("clipboard_copy", `Blocked ${event}`);
      })
    );

    on(document, "paste", (e) => {
      e.preventDefault();
      report("clipboard_paste", "Blocked paste");
    });

    // Dragging text out of (or into) an answer box is another route around
    // the clipboard.
    on(document, "dragstart", (e) => e.preventDefault());
    on(document, "drop", (e) => {
      e.preventDefault();
      report("drop", "Blocked drag-and-drop into the paper");
    });
  }

  /* ------------------------------------------------------- context menu */
  on(document, "contextmenu", (e) => {
    e.preventDefault();
    report("context_menu", "Right-click blocked");
  });

  /* ---------------------------------------------------------- shortcuts */
  on(
    document,
    "keydown",
    (e) => {
      const key = (e.key || "").toLowerCase();

      // Devtools and view-source.
      if (
        key === "f12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(key))
      ) {
        e.preventDefault();
        report("devtools", `Blocked ${e.key}`);
        return;
      }

      // Copy / paste / print / save / select-all / find.
      if ((e.ctrlKey || e.metaKey) && KEY_BLOCKED.has(key)) {
        // Ctrl+A inside an answer box is legitimate editing, so allow it there.
        const inField =
          e.target instanceof HTMLElement &&
          ["INPUT", "TEXTAREA"].includes(e.target.tagName);
        if (key === "a" && inField) return;

        e.preventDefault();
        report("shortcut", `Blocked ${e.ctrlKey ? "Ctrl" : "Cmd"}+${e.key}`);
        return;
      }

      // PrintScreen cannot truly be blocked, but it can be recorded.
      if (key === "printscreen") {
        report("print_screen", "PrintScreen pressed");
      }
    },
    true
  );

  /* -------------------------------------------------------- leaving the page */
  on(document, "visibilitychange", () => {
    if (document.hidden) report("tab_hidden", "Switched tab or minimised");
  });

  on(window, "blur", () => report("window_blur", "Window lost focus"));

  // Native "leave site?" prompt on refresh or close.
  on(window, "beforeunload", (e) => {
    e.preventDefault();
    e.returnValue = "";
    return "";
  });

  /* ------------------------------------------------------------ fullscreen */
  if (requireFullscreen) {
    on(document, "fullscreenchange", () => {
      if (!document.fullscreenElement) {
        report("fullscreen_exit", "Left fullscreen");
      }
    });
  }

  /* ------------------------------------------------------ text selection */
  const previousSelect = document.body.style.userSelect;
  if (blockCopyPaste) {
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
  }

  return () => {
    listeners.forEach((off) => off());
    document.body.style.userSelect = previousSelect;
    document.body.style.webkitUserSelect = previousSelect;
  };
};

export const requestFullscreen = async () => {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
      return true;
    }
    return Boolean(document.fullscreenElement);
  } catch {
    return false;
  }
};

export const exitFullscreen = async () => {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    // Nothing useful to do if the browser refuses.
  }
};

// Deterministic shuffle: the same attempt always sees the same order, so a
// refresh does not rearrange the paper, but two students get different orders.
export const seededShuffle = (items, seed) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const next = () => {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    return hash / 4294967296;
  };

  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// Human-readable labels for the invigilator's log.
export const VIOLATION_LABELS = {
  clipboard_copy: "Tried to copy",
  clipboard_paste: "Tried to paste",
  context_menu: "Right-clicked",
  devtools: "Tried to open developer tools",
  shortcut: "Used a blocked shortcut",
  print_screen: "Pressed PrintScreen",
  tab_hidden: "Switched away from the exam",
  window_blur: "Left the exam window",
  fullscreen_exit: "Left fullscreen",
  drop: "Dragged content into the paper",
  started: "Started the exam",
  submitted: "Submitted the paper",
};
