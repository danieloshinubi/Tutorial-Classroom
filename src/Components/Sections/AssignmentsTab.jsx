import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  uploadCourseFile,
  deleteMaterialFile,
} from "../../lib/api";
import {
  Card,
  Button,
  Field,
  Empty,
  Badge,
  DateTimePicker,
  formatDate,
} from "../UI";
import { useDocumentPreview } from "../DocumentPreview";
import { useActionFeedback } from "../Toast";

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

const AssignmentsTab = ({ courseId, canManage }) => {
  const { user } = useAuth();
  const { schoolId } = useSchool();
  const [assignments, setAssignments] = useState([]);
  // The form. attachment holds an already-uploaded file's metadata; keeping
  // uploads out of the form's plain fields makes them easier to reason about.
  const [form, setForm] = useState({
    title: "",
    description: "",
    points: "100",
    due_at: "",
    link_url: "",
    attachment: null,
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { setError } = useActionFeedback();
  const preview = useDocumentPreview();
  const fileInputRef = useRef(null);

  const load = () => {
    setLoading(true);
    fetchAssignments(courseId)
      .then(setAssignments)
      .catch((err) => setError(err.message || "Could not load assignments."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [courseId, setError]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const toLocalInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  };

  const startEdit = (assignment) => {
    setEditingId(assignment.id);
    setShowForm(true);
    setError("");
    setForm({
      title: assignment.title,
      description: assignment.description || "",
      points: String(assignment.points),
      due_at: toLocalInput(assignment.due_at),
      link_url: assignment.link_url || "",
      attachment: assignment.file_path
        ? {
            file_path: assignment.file_path,
            file_name: assignment.file_name,
            file_size: assignment.file_size,
            mime_type: assignment.mime_type,
          }
        : null,
    });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({
      title: "",
      description: "",
      points: "100",
      due_at: "",
      link_url: "",
      attachment: null,
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Uploaded as soon as the file is picked, so a slow network shows its
  // progress here rather than at the moment the teacher hits Save. The
  // upload landing before the assignment row means an abandoned upload
  // stays in the bucket, so removeAttachment() takes it back out again.
  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That file is over 50 MB — split it, compress it, or paste a link instead.");
      event.target.value = "";
      return;
    }
    setError("");
    setUploading(true);
    try {
      const saved = await uploadCourseFile({
        courseId,
        file,
        prefix: "assignments/",
      });
      setForm((current) => ({ ...current, attachment: saved }));
    } catch (err) {
      setError(err.message || "Could not upload that file.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = async () => {
    const { attachment } = form;
    if (!attachment) return;
    setForm((current) => ({ ...current, attachment: null }));
    // Best-effort: if the storage call fails the row is still cleared, so a
    // teacher is not stuck with an attachment they cannot remove.
    deleteMaterialFile(attachment.file_path).catch(() => {});
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.title.trim()) {
      setError("Give the assignment a title.");
      return;
    }

    setSaving(true);
    try {
      const fields = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        points: Number(form.points) || 100,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        link_url: form.link_url.trim() || null,
        file_path: form.attachment?.file_path || null,
        file_name: form.attachment?.file_name || null,
        file_size: form.attachment?.file_size || null,
        mime_type: form.attachment?.mime_type || null,
      };

      if (editingId) {
        // Editing leaves existing submissions and marks alone — only the
        // wording, points, deadline and attachment change.
        await updateAssignment(editingId, fields, courseId);
      } else {
        await createAssignment({ ...fields, course_id: courseId, created_by: user.id, schoolId });
      }
      cancelForm();
      load();
    } catch (err) {
      setError(
        err.message ||
          `Could not ${editingId ? "save" : "create"} that assignment.`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (assignment) => {
    if (
      !window.confirm(
        `Delete "${assignment.title}"? Every submission for it is deleted too.`
      )
    ) {
      return;
    }
    setError("");
    try {
      // The attached brief goes with the row so the bucket does not grow
      // orphaned files every time a teacher removes an assignment.
      if (assignment.file_path) {
        deleteMaterialFile(assignment.file_path).catch(() => {});
      }
      await deleteAssignment({ id: assignment.id, schoolId });
      load();
    } catch (err) {
      setError(err.message || "Could not delete that assignment.");
    }
  };

  const openAttachment = (assignment) => {
    preview.open(assignment.file_path, assignment.file_name);
  };

  const isOverdue = (dueAt) => dueAt && new Date(dueAt) < new Date();

  return (
    <>
      {canManage ? (
        <div style={{ marginBottom: "16px" }}>
          <Button
            variant={showForm ? "secondary" : "primary"}
            onClick={() => (showForm ? cancelForm() : setShowForm(true))}
          >
            {showForm ? "Cancel" : "Create assignment"}
          </Button>
        </div>
      ) : null}

      {canManage && showForm ? (
        <Card style={{ marginBottom: "18px", maxWidth: "620px" }}>
          <h3 style={{ marginTop: 0 }}>
            {editingId ? "Edit assignment" : "New assignment"}
          </h3>
          {editingId ? (
            <p style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 0 }}>
              {"Submissions and marks already given are not affected."}
            </p>
          ) : null}
          <form onSubmit={handleCreate}>
            <Field label="Title">
              <input className="input" value={form.title} onChange={update("title")} />
            </Field>
            <Field label="Instructions">
              <textarea
                className="textarea"
                value={form.description}
                onChange={update("description")}
              />
            </Field>

            {/* The brief itself. A file, an outside link, or nothing at all. */}
            <Field
              label="Brief"
              hint="Optional. Attach a document up to 50 MB, or paste a link."
            >
              {form.attachment ? (
                <div className="tf-attachment">
                  <div>
                    <strong>{form.attachment.file_name}</strong>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {humanSize(form.attachment.file_size)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeAttachment}
                  >
                    {"Remove"}
                  </Button>
                </div>
              ) : (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFile}
                    disabled={uploading}
                  />
                  {uploading ? (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                      }}
                    >
                      {"Uploading..."}
                    </div>
                  ) : null}
                </div>
              )}
            </Field>

            <Field label="Or a link" hint="A Google Doc, an article, a video.">
              <input
                type="url"
                className="input"
                placeholder="https://..."
                value={form.link_url}
                onChange={update("link_url")}
              />
            </Field>

            <Field label="Points">
              <input
                type="number"
                min="0"
                className="input"
                value={form.points}
                onChange={update("points")}
              />
            </Field>
            <Field label="Due" hint="Leave blank for no deadline.">
              <DateTimePicker value={form.due_at} onChange={(v) => setForm((current) => ({ ...current, due_at: v }))} />
            </Field>
            <Button type="submit" disabled={saving || uploading}>
              {saving
                ? "Saving..."
                : editingId
                ? "Save changes"
                : "Create assignment"}
            </Button>
          </form>
        </Card>
      ) : null}

      {loading ? <Empty>{"Loading assignments..."}</Empty> : null}
      {!loading && assignments.length === 0 ? (
        <Empty>{"No assignments yet."}</Empty>
      ) : null}

      {assignments.map((assignment) => (
        <Card key={assignment.id} style={{ marginBottom: "12px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <Link
                to={`/Assignments/${assignment.id}`}
                style={{ color: "inherit", fontWeight: 600 }}
              >
                {assignment.title}
              </Link>
              <div style={{ fontSize: "13px", color: "#777", marginTop: "4px" }}>
                {`Due ${formatDate(assignment.due_at)} · ${assignment.points} points`}
              </div>

              {/* The brief the teacher attached, right on the card so
                  students see it without opening the assignment. */}
              {assignment.file_path || assignment.link_url ? (
                <div className="tf-brief-row">
                  {assignment.file_path ? (
                    <button
                      type="button"
                      className="tf-brief-link"
                      onClick={() => openAttachment(assignment)}
                    >
                      {`📎 ${assignment.file_name || "Brief"}`}
                      {assignment.file_size ? (
                        <span style={{ color: "var(--ink-3)" }}>
                          {` · ${humanSize(assignment.file_size)}`}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                  {assignment.link_url ? (
                    <a
                      className="tf-brief-link"
                      href={assignment.link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {"🔗 Open link"}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>

            <span style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              {isOverdue(assignment.due_at) ? <Badge tone="danger">{"past due"}</Badge> : null}
              <Link to={`/Assignments/${assignment.id}`}>
                <Button variant="secondary" style={{ padding: "6px 12px", fontSize: "14px" }}>
                  {canManage ? "Review" : "Open"}
                </Button>
              </Link>
              {canManage ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => startEdit(assignment)}
                    style={{ padding: "6px 12px", fontSize: "14px" }}
                  >
                    {"Edit"}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => handleDelete(assignment)}
                    style={{ padding: "6px 12px", fontSize: "14px" }}
                  >
                    {"Delete"}
                  </Button>
                </>
              ) : null}
            </span>
          </div>
        </Card>
      ))}
      {preview.node}
    </>
  );
};

export default AssignmentsTab;
