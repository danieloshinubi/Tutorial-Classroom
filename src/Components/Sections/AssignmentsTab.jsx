import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  fetchAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from "../../lib/api";
import {
  Card,
  Button,
  Field,
  Notice,
  Empty,
  Badge,
  formatDate,
} from "../UI";

const AssignmentsTab = ({ courseId, canManage }) => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState({
    title: "",
    description: "",
    points: "100",
    due_at: "",
  });
  const [showForm, setShowForm] = useState(false);
  // Set while correcting an existing assignment rather than writing a new one.
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    fetchAssignments(courseId)
      .then(setAssignments)
      .catch((err) => setError(err.message || "Could not load assignments."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [courseId]);

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
    });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ title: "", description: "", points: "100", due_at: "" });
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
        // datetime-local gives a value with no timezone; let the browser
        // interpret it locally, then store UTC.
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      };

      if (editingId) {
        // Editing leaves existing submissions and marks alone — only the
        // wording, points and deadline change.
        await updateAssignment(editingId, fields);
      } else {
        await createAssignment({ ...fields, course_id: courseId, created_by: user.id });
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
      await deleteAssignment(assignment.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that assignment.");
    }
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
              <input
                type="datetime-local"
                className="input"
                value={form.due_at}
                onChange={update("due_at")}
              />
            </Field>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : editingId
                ? "Save changes"
                : "Create assignment"}
            </Button>
          </form>
        </Card>
      ) : null}

      <Notice tone="error">{error}</Notice>
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
            <div>
              <Link
                to={`/Assignments/${assignment.id}`}
                style={{ color: "inherit", fontWeight: 600 }}
              >
                {assignment.title}
              </Link>
              <div style={{ fontSize: "13px", color: "#777", marginTop: "4px" }}>
                {`Due ${formatDate(assignment.due_at)} · ${assignment.points} points`}
              </div>
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
    </>
  );
};

export default AssignmentsTab;
