import React, { useEffect, useRef, useState } from "react";

// Emoji a student can put into what they write.
//
// Separate from the reaction palette on purpose. Reactions are a fixed set of
// eight because they get counted and aggregated and sit on other people's
// posts; this is somebody's own sentence, so the range is wider and nothing
// here is scored.
const GROUPS = [
  {
    name: "Faces",
    emoji: ["😀", "😄", "😅", "😂", "🙂", "😉", "😍", "🤔", "😴", "😮", "😢", "😭", "😤", "😎", "🤓", "🥳"],
  },
  {
    name: "Hands",
    emoji: ["👍", "👎", "👏", "🙏", "👌", "✌️", "🤝", "💪", "👋", "✍️"],
  },
  {
    name: "School",
    emoji: ["📚", "📖", "✏️", "📝", "📐", "🎓", "🏫", "🔬", "🧪", "💡", "🖥️", "📊", "⏰", "📅", "✅", "❌"],
  },
  {
    name: "Other",
    emoji: ["❤️", "🔥", "🎉", "⭐", "🌟", "💯", "🚀", "⚽", "🎵", "☀️", "🌧️", "🙌"],
  },
];

// Inserts at the cursor rather than appending, and puts the caret after what
// was inserted — appending to the end is maddening when you are editing the
// middle of a sentence.
const EmojiInput = ({ targetRef, value, onChange, title = "Add an emoji" }) => {
  const [open, setOpen] = useState(false);
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

  const insert = (emoji) => {
    const field = targetRef?.current;
    const text = value ?? "";

    if (!field || typeof field.selectionStart !== "number") {
      onChange(text + emoji);
      setOpen(false);
      return;
    }

    const start = field.selectionStart;
    const end = field.selectionEnd;
    onChange(text.slice(0, start) + emoji + text.slice(end));

    // After React has re-rendered with the new value.
    requestAnimationFrame(() => {
      field.focus();
      const at = start + emoji.length;
      field.setSelectionRange(at, at);
    });
    setOpen(false);
  };

  return (
    <div className="emoji" ref={wrapRef}>
      <button
        type="button"
        className="emoji-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {"🙂"}
      </button>

      {open ? (
        <div className="emoji-panel">
          {GROUPS.map((group) => (
            <div key={group.name} className="emoji-group">
              <div className="account-heading">{group.name}</div>
              <div className="emoji-grid">
                {group.emoji.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insert(emoji)}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default EmojiInput;
