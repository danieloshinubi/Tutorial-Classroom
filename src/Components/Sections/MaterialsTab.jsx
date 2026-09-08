import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { fetchMaterials, createMaterial, deleteMaterial } from "../../lib/api";
import {
  Card,
  Button,
  Field,
  Notice,
  Empty,
  formatDate,
} from "../UI";

const MaterialsTab = ({ courseId, canManage }) => {
  const { user } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", url: "" });
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.title.trim()) {
      setError("Give the material a title.");
      return;
    }

    setSaving(true);
    try {
      await createMaterial({
        course_id: courseId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        url: form.url.trim() || null,
        created_by: user.id,
      });
      setForm({ title: "", description: "", url: "" });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message || "Could not add that material.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (material) => {
    if (!window.confirm(`Delete "${material.title}"?`)) return;
    setError("");
    try {
      await deleteMaterial(material.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that material.");
    }
  };

  return (
    <>
      {canManage ? (
        <div style={{ marginBottom: "16px" }}>
          <Button
            variant={showForm ? "secondary" : "primary"}
            onClick={() => setShowForm((open) => !open)}
          >
            {showForm ? "Cancel" : "Add material"}
          </Button>
        </div>
      ) : null}

      {canManage && showForm ? (
        <Card style={{ marginBottom: "18px", maxWidth: "620px" }}>
          <form onSubmit={handleCreate}>
            <Field label="Title">
              <input className="input" value={form.title} onChange={update("title")} />
            </Field>
            <Field label="Description">
              <textarea
                className="textarea"
                value={form.description}
                onChange={update("description")}
              />
            </Field>
            <Field label="Link" hint="A URL to slides, a reading, or a video.">
              <input
                className="input"
                value={form.url}
                onChange={update("url")}
                placeholder="https://..."
              />
            </Field>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Add material"}
            </Button>
          </form>
        </Card>
      ) : null}

      <Notice tone="error">{error}</Notice>
      {loading ? <Empty>{"Loading materials..."}</Empty> : null}
      {!loading && materials.length === 0 ? (
        <Empty>{"No materials have been posted for this course yet."}</Empty>
      ) : null}

      {materials.map((material) => (
        <Card key={material.id} style={{ marginBottom: "12px" }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}
          >
            <div>
              <strong>{material.title}</strong>
              <div style={{ fontSize: "13px", color: "#777", marginTop: "2px" }}>
                {formatDate(material.created_at)}
              </div>
            </div>
            {canManage ? (
              <Button
                variant="danger"
                onClick={() => handleDelete(material)}
                style={{ padding: "6px 12px", fontSize: "14px", alignSelf: "flex-start" }}
              >
                {"Delete"}
              </Button>
            ) : null}
          </div>

          {material.description ? (
            <p style={{ color: "#555" }}>{material.description}</p>
          ) : null}

          {material.url ? (
            <a
              href={material.url}
              target="_blank"
              rel="noreferrer noopener"
              style={{ wordBreak: "break-all" }}
            >
              {material.url}
            </a>
          ) : null}
        </Card>
      ))}
    </>
  );
};

export default MaterialsTab;
