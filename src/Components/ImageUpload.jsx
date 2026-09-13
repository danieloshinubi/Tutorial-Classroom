import React, { useRef, useState } from "react";
import { Button, Notice } from "./UI";

const MAX_BYTES = 5 * 1024 * 1024; // a photo or a logo, not a course material
const ACCEPT = "image/png,image/jpeg,image/webp";

// A small image picker with a live preview — for a single logo or avatar,
// where the codebase's other upload patterns (a drag-and-drop zone for a
// list of course materials, a "View image"/modal for an exam question
// diagram) don't quite fit: this is one image, always visible, that people
// expect to see change the moment they pick a new one.
//
// Callers own the actual upload/remove calls (onUpload/onRemove) — this
// component only owns the picking UI, matching how the rest of this app
// keeps API calls in the page and file-picking dumb.
export const ImageUpload = ({ value, onUpload, onRemove, shape = "circle", size = 72 }) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choose = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (PNG, JPEG or WebP).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Keep it under 5MB.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err.message || "Could not upload that image.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await onRemove();
    } catch (err) {
      setError(err.message || "Could not remove that image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: shape === "circle" ? "50%" : 12,
            background: "var(--card, #f2f2f5)",
            overflow: "hidden",
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--line)",
          }}
        >
          {value ? (
            <img src={value} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{"No image"}</span>
          )}
        </div>
        <div className="btn-row">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "Working..." : value ? "Change" : "Upload"}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
              {"Remove"}
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </div>
      <Notice tone="error">{error}</Notice>
    </div>
  );
};

export default ImageUpload;
