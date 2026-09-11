import React, { useCallback, useEffect, useState } from "react";
import { signedMaterialUrl } from "../lib/api";

const isPdfPath = (path) => /\.pdf($|\?)/i.test(path || "");
const isImagePath = (path) => /\.(png|jpe?g|gif|webp|heic|bmp|svg)($|\?)/i.test(path || "");

const nameFromPath = (path) => (path || "").split("/").pop().replace(/^[0-9a-f-]{20,}-/i, "");

// One in-page viewer, used everywhere a document used to open in a new
// browser tab pointed at a raw Supabase storage URL. A family or officer
// reviewing several documents in a row should never leave the page they
// were on to do it.
const DocumentPreviewModal = ({ url, path, name, onClose }) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const kind = isPdfPath(path) ? "pdf" : isImagePath(path) ? "image" : "other";
  const label = name || nameFromPath(path) || "Document";

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="docprev-backdrop" onClick={onClose}>
      <div className="docprev-shell" onClick={(e) => e.stopPropagation()}>
        <div className="docprev-bar">
          <div className="docprev-title">{label}</div>
          <div className="docprev-tools">
            {kind === "image" ? (
              <>
                <button type="button" className="docprev-btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} aria-label="Zoom out">{"−"}</button>
                <span className="docprev-zoom">{`${Math.round(zoom * 100)}%`}</span>
                <button type="button" className="docprev-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in">{"+"}</button>
                <button type="button" className="docprev-btn" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotate">{"⟳"}</button>
              </>
            ) : null}
            <a className="docprev-btn docprev-download" href={url} download={label} target="_blank" rel="noopener noreferrer">
              {"Download"}
            </a>
            <button type="button" className="docprev-btn docprev-close" onClick={onClose} aria-label="Close">{"✕"}</button>
          </div>
        </div>
        <div className="docprev-body">
          {kind === "image" ? (
            <img
              src={url}
              alt={label}
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
              className="docprev-image"
            />
          ) : kind === "pdf" ? (
            <iframe src={url} title={label} className="docprev-frame" />
          ) : (
            <div className="docprev-fallback">
              <p>{"This file type can't be previewed here."}</p>
              <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer">{"Open it"}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Shared by every page that used to do
//   const url = await signedMaterialUrl(path); window.open(url, "_blank");
// Swap that for:
//   const preview = useDocumentPreview();
//   ...
//   onClick={() => preview.open(path, name)}
//   ...
//   {preview.node}
export const useDocumentPreview = () => {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");

  const open = useCallback(async (path, name) => {
    setError("");
    try {
      const url = await signedMaterialUrl(path);
      setState({ url, path, name });
    } catch (err) {
      setError(err.message || "Could not open that file.");
    }
  }, []);

  const close = useCallback(() => setState(null), []);

  const node = state ? (
    <DocumentPreviewModal url={state.url} path={state.path} name={state.name} onClose={close} />
  ) : null;

  return { open, close, node, error };
};

export default DocumentPreviewModal;
