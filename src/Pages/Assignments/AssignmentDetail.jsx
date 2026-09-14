import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchAssignment,
  fetchMySubmission,
  submitWork,
  fetchSubmissionsForAssignment,
  gradeSubmission,
  uploadSubmissionFile,
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
import { useDocumentPreview } from "../../Components/DocumentPreview";

// Nice size line, so a phone user knows what they are about to download.
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

// Assignment briefs are often pasted from a document, and the paste keeps
// the option-marker glyphs (○, •, -, a), b)) but drops the line breaks that
// would separate them. This formatter parses that shape into proper blocks
// so a student sees one question per card and one option per line, even
// when the source is a single unformatted paragraph.
const parseBrief = (text) => {
  if (!text || typeof text !== "string") return null;

  // Give every question and option a line of its own. Break BEFORE each
  // marker so the terminating letters/punctuation stay with the previous
  // token. Regex is tolerant of "Question 1", "Question 1 (1pt)",
  // "1.", and the common option glyphs.
  const normalised = text
    .replace(/\r\n?/g, "\n")
    // A Question header always starts a new block.
    .replace(/(?<!^)(?<!\n)\s*(Question\s+\d+)/gi, "\n$1")
    // Each option marker begins a new line.
    .replace(/\s*([○◯⚪⬜☐•▢])/g, "\n$1")
    // Numeric option markers (a) b) c)) at the start of an option run.
    .replace(/\s+([a-eA-E]\))/g, "\n$1")
    .trim();

  const blocks = normalised.split(/\n(?=Question\s+\d+)/i);

  return blocks.map((block, index) => {
    // First line is the header ("Question 3   1pt"), second line the body,
    // remaining lines the options — but any of those may be missing if the
    // brief is just plain prose. When there is no "Question" header, render
    // as plain paragraphs.
    const lines = block.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!/^Question\s+\d+/i.test(lines[0])) {
      return (
        <p key={index} className="brief-paragraph">
          {lines.join(" ")}
        </p>
      );
    }

    const header = lines[0];
    const rest = lines.slice(1);
    const optionRegex = /^([○◯⚪⬜☐•▢]|[a-eA-E]\))\s*/;
    const options = rest.filter((line) => optionRegex.test(line));
    const bodyLines = rest.filter((line) => !optionRegex.test(line));

    return (
      <div key={index} className="brief-question">
        <div className="brief-q-head">{header}</div>
        {bodyLines.length ? (
          <p className="brief-q-body">{bodyLines.join(" ")}</p>
        ) : null}
        {options.length ? (
          <ul className="brief-q-options">
            {options.map((line, ix) => (
              <li key={ix}>{line.replace(optionRegex, "")}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  });
};

// The student's own view: submit work, then see the grade once it lands.
const SubmitPanel = ({ assignment, userId }) => {
  const { schoolId } = useSchool();
  const [submission, setSubmission] = useState(null);
  const [form, setForm] = useState({ body: "", url: "" });
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const preview = useDocumentPreview();
  const fileInput = useRef(null);

  useEffect(() => {
    let active = true;

    fetchMySubmission({ assignmentId: assignment.id, userId })
      .then((data) => {
        if (!active) return;
        setSubmission(data);
        if (data) {
          setForm({ body: data.body || "", url: data.url || "" });
          if (data.file_path) {
            setAttachment({ path: data.file_path, name: data.file_name, size: data.file_size });
          }
        }
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

  const attachFile = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("That file is over 20MB.");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const uploaded = await uploadSubmissionFile({ assignmentId: assignment.id, userId, file });
      setAttachment({ path: uploaded.file_path, name: uploaded.file_name, size: uploaded.file_size });
    } catch (err) {
      setError(err.message || "Could not attach that file.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!form.body.trim() && !form.url.trim() && !attachment) {
      setError("Add your work as text, a link, a file, or any combination.");
      return;
    }

    setSaving(true);
    try {
      const saved = await submitWork({
        assignmentId: assignment.id,
        userId,
        schoolId,
        body: form.body.trim() || null,
        url: form.url.trim() || null,
        filePath: attachment?.path || null,
        fileName: attachment?.name || null,
        fileSize: attachment?.size || null,
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

        <Field label="File" hint="Optional — a document, spreadsheet, or a photo of written work.">
          {attachment ? (
            <div className="tf-brief-row">
              <button type="button" className="tf-brief-link" onClick={() => preview.open(attachment.path, attachment.name)}>
                {`📎 ${attachment.name}`}
                {attachment.size ? <span style={{ color: "var(--ink-3)" }}>{` · ${humanSize(attachment.size)}`}</span> : null}
              </button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAttachment(null)}>
                {"Remove"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Uploading..." : "Attach a file"}
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={(e) => {
              attachFile(e.target.files?.[0]);
              e.target.value = "";
            }}
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

        <Button type="submit" disabled={saving || uploading}>
          {saving ? "Submitting..." : submission ? "Resubmit" : "Submit work"}
        </Button>
      </form>
      {preview.node}
    </Card>
  );
};

// The tutor's view: every submission, each with a grade box.
const GradePanel = ({ assignment, graderId }) => {
  const { schoolId } = useSchool();
  const [submissions, setSubmissions] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const preview = useDocumentPreview();

  const load = useCallback(() => {
    setLoading(true);
    fetchSubmissionsForAssignment({ assignmentId: assignment.id, schoolId })
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
  }, [assignment.id, schoolId]);

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
        schoolId,
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
          {submission.file_path ? (
            <button
              type="button"
              className="tf-brief-link"
              onClick={() => preview.open(submission.file_path, submission.file_name)}
            >
              {`📎 ${submission.file_name || "Attached file"}`}
              {submission.file_size ? (
                <span style={{ color: "var(--ink-3)" }}>{` · ${humanSize(submission.file_size)}`}</span>
              ) : null}
            </button>
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
      {preview.node}
    </>
  );
};

const AssignmentDetail = () => {
  const { assignmentId } = useParams();
  const { user } = useAuth();
  const { isAdmin, schoolId } = useSchool();

  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const briefPreview = useDocumentPreview();

  useEffect(() => {
    if (!schoolId) return undefined;
    let active = true;

    fetchAssignment({ schoolId, id: assignmentId })
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
  }, [assignmentId, schoolId]);

  const canManage =
    isAdmin ||
    (assignment?.courses?.owner_id && assignment.courses.owner_id === user?.id);

  return (
    <div className="shell">
      <Navbar />
      <Page title={assignment?.title || "Assignment"}>
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {assignment ? (
          <>
            <p style={{ color: "#666", marginTop: 0 }}>
              <Link
                to={`/Courses/${assignment.courses.code}`}
                style={{ color: "inherit" }}
              >
                {assignment.courses.code}
              </Link>
              {` · Due ${formatDate(assignment.due_at)} · ${assignment.points} points`}
            </p>

            {assignment.description || assignment.file_path || assignment.link_url ? (
              <Card style={{ marginBottom: "22px", maxWidth: "720px" }}>
                {assignment.description ? (
                  <div className="brief-body">
                    {parseBrief(assignment.description)}
                  </div>
                ) : null}

                {/* The brief itself, one row per source, with sensible
                    spacing when a description sits above them. */}
                {assignment.file_path || assignment.link_url ? (
                  <div
                    className="tf-brief-row"
                    style={{ marginTop: assignment.description ? 12 : 0 }}
                  >
                    {assignment.file_path ? (
                      <button
                        type="button"
                        className="tf-brief-link"
                        onClick={() => briefPreview.open(assignment.file_path, assignment.file_name)}
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
      {briefPreview.node}
    </div>
  );
};

export default AssignmentDetail;
