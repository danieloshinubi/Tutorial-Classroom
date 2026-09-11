import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  fetchMaterials,
  createMaterial,
  deleteMaterial,
  updateMaterial,
  uploadMaterialFile,
  deleteMaterialFile,
} from "../../lib/api";
import { Card, Button, Field, Notice, Empty, formatDate } from "../UI";
import { useDocumentPreview } from "../DocumentPreview";

const MAX_BYTES = 50 * 1024 * 1024;

const humanSize = (bytes) => {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

const MaterialsTab = ({ courseId, canManage }) => {
  const { user } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", url: "" });
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [showForm, setShowForm] = useState(false);
  // The id being edited, or null. Editing reuses the same form.
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const preview = useDocumentPreview();
  const fileInput = useRef(null);

  const load = () => {
    setLoading(true);
    fetchMaterials(courseId)
      .then(setMaterials)
      .catch((err) => setError(err.message || "Could not load materials."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [courseId]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const chooseFile = (chosen) => {
    if (!chosen) return;
    if (chosen.size > MAX_BYTES) {
      setError(`That file is ${humanSize(chosen.size)}. The limit is 50 MB.`);
      return;
    }
    setError("");
    setFile(chosen);
    // Save a bit of typing: an untitled material takes the filename.
    setForm((current) =>
      current.title ? current : { ...current, title: chosen.name.replace(/\.[^.]+$/, "") }
    );
  };

  const startEdit = (material) => {
    setEditingId(material.id);
    setShowForm(true);
    setFile(null);
    setError("");
    setForm({
      title: material.title || "",
      description: material.description || "",
      url: material.url || "",
    });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFile(null);
    setForm({ title: "", description: "", url: "" });
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");

    if (!form.title.trim()) {
      setError("Give the material a title.");
      return;
    }
    // An existing material may already carry a file, so only a new one needs
    // something attached.
    const existing = materials.find((m) => m.id === editingId);
    if (!file && !form.url.trim() && !existing?.file_path) {
      setError("Attach a file or paste a link.");
      return;
    }

    setSaving(true);
    try {
      let fileFields = {};
      if (file) fileFields = await uploadMaterialFile({ courseId, file });

      if (editingId) {
        await updateMaterial(editingId, {
          title: form.title.trim(),
          description: form.description.trim() || null,
          url: form.url.trim() || null,
          ...fileFields,
        });
      } else {
        await createMaterial({
          course_id: courseId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          url: form.url.trim() || null,
          created_by: user.id,
          ...fileFields,
        });
      }

      cancelForm();
      load();
    } catch (err) {
      // Uploads fail loudly until the bucket exists; links keep working, so
      // say which half is missing rather than showing a raw storage error.
      const message = String(err.message || "");
      if (/bucket|not found/i.test(message)) {
        setError(
          "File uploads are not set up yet — create the \"course-materials\" bucket in Supabase (Storage → New bucket, public off). You can still add a link."
        );
      } else {
        setError(message || "Could not add that material.");
      }
    } finally {
      setSaving(false);
    }
  };

  const openFile = (material) => {
    setError("");
    preview.open(material.file_path, material.file_name);
  };

  const handleDelete = async (material) => {
    if (!window.confirm(`Delete "${material.title}"?`)) return;
    setError("");
    try {
      if (material.file_path) {
        await deleteMaterialFile(material.file_path).catch(() => {
          // A missing object should not block removing the row.
        });
      }
      await deleteMaterial(material.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that material.");
    }
  };

  return (
    <>
      {canManage ? (
        <div style={{ marginBottom: 16 }}>
          <Button
            variant={showForm ? "secondary" : "primary"}
            onClick={() => (showForm ? cancelForm() : setShowForm(true))}
          >
            {showForm ? "Cancel" : "Add material"}
          </Button>
        </div>
      ) : null}

      {canManage && showForm ? (
        <Card style={{ marginBottom: 18, maxWidth: 640 }}>
          <form onSubmit={handleCreate}>
            <Field label="Title">
              <input className="input" value={form.title} onChange={update("title")} />
            </Field>
            <Field label="Description">
              <textarea
                className="textarea"
                style={{ minHeight: 80 }}
                value={form.description}
                onChange={update("description")}
              />
            </Field>

            <Field
              label="File"
              hint={
                editingId
                  ? "Choose a file only if you want to replace the one already attached."
                  : "Up to 50 MB. PDF, slides, documents, images, audio or video."
              }
            >
              {file ? (
                <div className="file-chip">
                  <span style={{ flex: 1 }}>
                    {file.name}
                    <span className="file-meta">{` · ${humanSize(file.size)}`}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFile(null)}
                  >
                    {"Remove"}
                  </Button>
                </div>
              ) : (
                <div
                  className={`dropzone${dragging ? " over" : ""}`}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    chooseFile(e.dataTransfer.files?.[0]);
                  }}
                >
                  {"Drop a file here, or click to choose one"}
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={(e) => chooseFile(e.target.files?.[0])}
              />
            </Field>

            <Field label="Or a link" hint="A video, an article, anything on the web.">
              <input
                className="input"
                value={form.url}
                onChange={update("url")}
                placeholder="https://..."
              />
            </Field>

            <Notice tone="error">{error}</Notice>

            <Button type="submit" disabled={saving}>
              {saving
                ? file
                  ? "Uploading..."
                  : "Saving..."
                : editingId
                ? "Save changes"
                : "Add material"}
            </Button>
          </form>
        </Card>
      ) : null}

      {!showForm ? <Notice tone="error">{error}</Notice> : null}
      {loading ? <Empty>{"Loading materials..."}</Empty> : null}
      {!loading && materials.length === 0 ? (
        <Empty>{"No materials have been posted for this course yet."}</Empty>
      ) : null}

      {materials.map((material) => (
        <Card key={material.id} style={{ marginBottom: 12 }}>
          <div className="page-head" style={{ marginBottom: 6 }}>
            <div>
              <strong>{material.title}</strong>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
                {formatDate(material.created_at)}
                {material.file_size ? ` · ${humanSize(material.file_size)}` : ""}
              </div>
            </div>
            {canManage ? (
              <span className="btn-row">
                <Button variant="secondary" size="sm" onClick={() => startEdit(material)}>
                  {"Edit"}
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(material)}>
                  {"Delete"}
                </Button>
              </span>
            ) : null}
          </div>

          {material.description ? (
            <p style={{ color: "var(--ink-2)" }}>{material.description}</p>
          ) : null}

          <div className="btn-row">
            {material.file_path ? (
              <Button variant="secondary" size="sm" onClick={() => openFile(material)}>
                {`View ${material.file_name || "file"}`}
              </Button>
            ) : null}
            {material.url ? (
              <a
                href={material.url}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-secondary btn-sm"
              >
                {"Open link"}
              </a>
            ) : null}
          </div>
        </Card>
      ))}
      {preview.node}
    </>
  );
};

export default MaterialsTab;
