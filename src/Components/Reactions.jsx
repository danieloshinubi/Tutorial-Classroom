import React, { useEffect, useRef, useState } from "react";
import { REACTIONS } from "../lib/api";

// The reaction bar under a post.
//
// Shows only the emoji somebody has actually used, plus one button to add a
// new one — a fixed row of eight greyed-out faces under every post is noise,
// and makes an empty stream look like a form to fill in.
//
// `tallies` is { "👍": { count: 3, mine: true }, ... }. The optimistic update
// matters here: a reaction is a one-tap thing and waiting for a round trip
// before the number moves feels broken.
const Reactions = ({ tallies = {}, onToggle, disabled, hint }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const used = REACTIONS.filter((emoji) => tallies[emoji]?.count > 0);

  const tap = async (emoji) => {
    if (disabled || busy) return;
    setBusy(emoji);
    setOpen(false);
    try {
      await onToggle(emoji, Boolean(tallies[emoji]?.mine));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="reactions" ref={wrapRef}>
      {used.map((emoji) => {
        const tally = tallies[emoji];
        return (
          <button
            key={emoji}
            type="button"
            className={`reaction${tally.mine ? " mine" : ""}`}
            disabled={disabled}
            title={tally.mine ? "You reacted — tap to take it back" : "Add your reaction"}
            aria-pressed={tally.mine}
            onClick={() => tap(emoji)}
          >
            <span className="reaction-emoji">{emoji}</span>
            <span className="reaction-count">{tally.count}</span>
          </button>
        );
      })}

      {disabled ? null : (
        <>
          <button
            type="button"
            className="reaction add"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Add a reaction"
            title={hint || "Add a reaction"}
            onClick={() => setOpen((v) => !v)}
          >
            {used.length === 0 ? (
              <>
                <span className="reaction-emoji">{"🙂"}</span>
                <span className="reaction-count">{"React"}</span>
              </>
            ) : (
              <span className="reaction-emoji">{"+"}</span>
            )}
          </button>

          {open ? (
            <div className="reaction-picker" role="menu">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  className={tallies[emoji]?.mine ? "mine" : undefined}
                  onClick={() => tap(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default Reactions;
