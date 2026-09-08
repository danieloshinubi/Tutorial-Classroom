import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import {
  fetchAssignment,
  fetchMySubmission,
  submitWork,
  fetchSubmissionsForAssignment,
  gradeSubmission,
} from "../../lib/api";
import {
  Page,
  Card,
  Button,
  Field,
  Badge,
  Notice,
  Empty,
  displayName,
  formatDate,
} from "../../Components/UI";

// The student's own view: submit work, then see the grade once it lands.
const SubmitPanel = ({ assignment, userId }) => {
  const [submission, setSubmission] = useState(null);
  const [form, setForm] = useState({ body: "", url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    fetchMySubmission({ assignmentId: assignment.id, userId })
      .then((data) => {
        if (!active) return;
        setSubmission(data);
        if (data) setForm({ body: data.body || "", url: data.url || "" });
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load your submission.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [assignment.id, userId]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!form.body.trim() && !form.url.trim()) {
      setError("Add your work as text, a link, or both.");
      return;
    }

    setSaving(true);
    try {
      const saved = await submitWork({
        assignmentId: assignment.id,
        userId,
        body: form.body.trim() || null,
        url: form.url.trim() || null,
      });
      setSubmission(saved);
      setNotice("Work submitted.");
    } catch (err) {
      setError(err.message || "Could not submit your work.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Empty>{"Loading your submission..."}</Empty>;

  const isGraded = submission && submission.grade !== null;

  return (
    <Card style={{ maxWidth: "640px" }}>
      <h3 style={{ marginTop: 0 }}>{"Your work"}</h3>

      {submission ? (
        <p style={{ color: "#666", fontSize: "14px" }}>
          {`Submitted ${formatDate(submission.submitted_at)}`}
        </p>
      ) : null}

      {isGraded ? (
        <Card style={{ background: "#f6fbf7", marginBottom: "16px" }}>
          <strong>{`Grade: ${submission.grade} / ${assignment.points}`}</strong>
          {submission.feedback ? (
            <p style={{ marginBottom: 0 }}>{submission.feedback}</p>
          ) : null}
        </Card>
      ) : null}

      <form onSubmit={handleSubmit}>
        <Field label="Answer">
          <textarea
            className="textarea"
            value={form.body}
            onChange={update("body")}
          />
        </Field>
        <Field label="Link" hint="A document, repository or drive link.">
          <input
            className="input"
            value={form.url}
            onChange={update("url")}
            placeholder="https://..."
          />
        </Field>

        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{notice}</Notice>

        {/* Resubmitting replaces the previous attempt and clears the grade,
            so say that before they click. */}
        {isGraded ? (
          <Notice>
            {"Resubmitting will replace your graded work and clear the grade."}
          </Notice>
        ) : null}

        <Button type="submit" disabled={saving}>
          {saving ? "Submitting..." : submission ? "Resubmit" : "Submit work"}
        </Button>
      </form>
    </Card>
  );
};

// The tutor's view: every submission, each with a grade box.
const GradePanel = ({ assignment, graderId }) => {
  const [submissions, setSubmissions] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchSubmissionsForAssignment(assignment.id)
      .then((data) => {
        setSubmissions(data);
        setDrafts(
          Object.fromEntries(
            data.map((row) => [
              row.id,
              {
                grade: row.grade === null ? "" : String(row.grade),
                feedback: row.feedback || "",
              },
            ])
          )
        );
      })
      .catch((err) => setError(err.message || "Could not load submissions."))
      .finally(() => setLoading(false));
  }, [assignment.id]);

  useEffect(load, [load]);

  const updateDraft = (id, field) => (event) =>
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], [field]: event.target.value },
    }));

  const handleGrade = async (submission) => {
    const draft = drafts[submission.id];
    setError("");

    const grade = draft.grade === "" ? null : Number(draft.grade);
    if (grade !== null && (Number.isNaN(grade) || grade < 0 || grade > assignment.points)) {
      setError(`Grade must be a number between 0 and ${assignment.points}.`);
      return;
    }

    setSavingId(submission.id);
    try {
      await gradeSubmission({
        id: submission.id,
        grade,
        feedback: draft.feedback.trim() || null,
        graderId,
      });
      load();
    } catch (err) {
      setError(err.message || "Could not save that grade.");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <Empty>{"Loading submissions..."}</Empty>;

  return (
    <>
      <h3>{`Submissions (${submissions.length})`}</h3>
      <Notice tone="error">{error}</Notice>
      {submissions.length === 0 ? <Empty>{"Nobody has submitted yet."}</Empty> : null}

      {submissions.map((submission) => (
        <Card key={submission.id} style={{ marginBottom: "14px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <strong>{displayName(submission.profiles)}</strong>
            <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {submission.grade !== null ? (
                <Badge tone="success">{`${submission.grade} / ${assignment.points}`}</Badge>
              ) : (
                <Badge>{"ungraded"}</Badge>
              )}
              <span style={{ fontSize: "13px", color: "#777" }}>
                {formatDate(submission.submitted_at)}
              </span>
            </span>
          </div>

          {submission.body ? (
            <p style={{ whiteSpace: "pre-wrap", color: "#333" }}>{submission.body}</p>
          ) : null}
          {submission.url ? (
            <a
              href={submission.url}
              target="_blank"
              rel="noreferrer noopener"
              style={{ wordBreak: "break-all" }}
            >
              {submission.url}
            </a>
          ) : null}

          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "flex-end",
              flexWrap: "wrap",
              marginTop: "12px",
            }}
          >
            <div style={{ width: "110px" }}>
              <Field label="Grade">
                <input
                  type="number"
                  min="0"
                  max={assignment.points}
                  className="input"
                  value={drafts[submission.id]?.grade ?? ""}
                  onChange={updateDraft(submission.id, "grade")}
                />
              </Field>
            </div>
            <div style={{ flex: "1 1 240px" }}>
              <Field label="Feedback">
                <input
                  className="input"
                  value={drafts[submission.id]?.feedback ?? ""}
                  onChange={updateDraft(submission.id, "feedback")}
                />
              </Field>
            </div>
            <Button
              onClick={() => handleGrade(submission)}
              disabled={savingId === submission.id}
              style={{ marginBottom: "14px" }}
            >
              {savingId === submission.id ? "Saving..." : "Save grade"}
            </Button>
          </div>
        </Card>
      ))}
    </>
  );
};

const AssignmentDetail = () => {
  const { assignmentId } = useParams();
  const { user, profile } = useAuth();

  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetchAssignment(assignmentId)
      .then((data) => {
        if (!active) return;
        if (!data) {
          setError("That assignment no longer exists.");
          return;
        }
        setAssignment(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load the assignment.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [assignmentId]);

  const canManage =
    profile?.role === "admin" ||
    (assignment?.courses?.owner_id && assignment.courses.owner_id === user?.id);

  return (
    <>
      <Navbar />
      <Page title={assignment?.title || "Assignment"}>
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {assignment ? (
          <>
            <p style={{ color: "#666", marginTop: 0 }}>
              <Link
                to={`/Levels/${assignment.courses.level_year}/Courses/${assignment.courses.code}`}
                style={{ color: "inherit" }}
              >
                {assignment.courses.code}
              </Link>
              {` · Due ${formatDate(assignment.due_at)} · ${assignment.points} points`}
            </p>

            {assignment.description ? (
              <Card style={{ marginBottom: "22px", maxWidth: "640px" }}>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {assignment.description}
                </p>
              </Card>
            ) : null}

            {canManage ? (
              <GradePanel assignment={assignment} graderId={user.id} />
            ) : (
              <SubmitPanel assignment={assignment} userId={user.id} />
            )}
          </>
        ) : null}
      </Page>
    </>
  );
};

export default AssignmentDetail;
