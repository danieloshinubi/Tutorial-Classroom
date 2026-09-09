import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import {
  fetchExam,
  fetchAttemptsForExam,
  fetchAttemptDetail,
  fetchExamEvents,
  markAnswer,
  recalculateAttempt,
} from "../../lib/api";
import { VIOLATION_LABELS } from "../../lib/proctor";
import {
  Page,
  Card,
  Button,
  Badge,
  Notice,
  Empty,
  displayName,
  formatDate,
} from "../../Components/UI";

// The invigilator's record for one paper. Read-only by design: there is no
// update or delete policy on exam_events, so this log cannot be rewritten.
const ProctorLog = ({ attemptId }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExamEvents(attemptId)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [attemptId]);

  if (loading) return <Empty>{"Loading activity..."}</Empty>;
  if (events.length === 0) return <Empty>{"No activity recorded."}</Empty>;

  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table className="data">
        <thead>
          <tr>
            <th>{"Time"}</th>
            <th>{"Event"}</th>
            <th>{"Detail"}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const benign = ["started", "submitted"].includes(event.kind);
            return (
              <tr key={event.id}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDate(event.created_at)}</td>
                <td>
                  <Badge tone={benign ? undefined : "danger"}>
                    {VIOLATION_LABELS[event.kind] || event.kind}
                  </Badge>
                </td>
                <td style={{ color: "var(--ink-3)" }}>{event.detail || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Expanded view of one student's paper, where written answers get marked.
const AttemptDetail = ({ attempt, onGraded }) => {
  const [rows, setRows] = useState([]);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAttemptDetail(attempt.id)
      .then((data) => {
        const sorted = [...data].sort(
          (a, b) => (a.exam_questions?.position ?? 0) - (b.exam_questions?.position ?? 0)
        );
        setRows(sorted);
        setMarks(
          Object.fromEntries(
            sorted.map((row) => [
              row.id,
              row.awarded_points === null ? "" : String(row.awarded_points),
            ])
          )
        );
      })
      .catch((err) => setError(err.message || "Could not load the paper."))
      .finally(() => setLoading(false));
  }, [attempt.id]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      // Only the rows the tutor actually touched need writing.
      const changed = rows.filter(
        (row) =>
          marks[row.id] !== "" &&
          Number(marks[row.id]) !== row.awarded_points
      );
      for (const row of changed) {
        await markAnswer({ id: row.id, points: Number(marks[row.id]) });
      }
      const updated = await recalculateAttempt(attempt.id);
      onGraded(updated);
    } catch (err) {
      setError(err.message || "Could not save those marks.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Empty>{"Loading paper..."}</Empty>;

  return (
    <div style={{ marginTop: 14 }}>
      {rows.map((row, index) => {
        const question = row.exam_questions || {};
        const needsHand = question.kind === "short_answer";
        return (
          <div className="q-card" key={row.id}>
            <div className="q-head">
              <span className="q-num">{`Q${index + 1} · ${question.points} pt`}</span>
              {needsHand ? <Badge tone="warn">{"written"}</Badge> : <Badge>{"auto"}</Badge>}
            </div>
            <p style={{ marginTop: 0 }}>{question.prompt}</p>

            <p style={{ background: "var(--bg)", padding: 10, borderRadius: 10, margin: "8px 0" }}>
              {row.answer_text || (row.selected_option_id ? "(option selected)" : "— no answer —")}
            </p>

            {question.answer_key ? (
              <p style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {`Answer key: ${question.answer_key}`}
              </p>
            ) : null}

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              {"Marks:"}
              <input
                type="number"
                min="0"
                max={question.points}
                className="input"
                style={{ width: 90 }}
                value={marks[row.id] ?? ""}
                onChange={(e) =>
                  setMarks((current) => ({ ...current, [row.id]: e.target.value }))
                }
              />
              <span style={{ color: "var(--ink-3)" }}>{`/ ${question.points}`}</span>
            </label>
          </div>
        );
      })}

      <Notice tone="error">{error}</Notice>
      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save marks"}
      </Button>
    </div>
  );
};

const ExamResults = () => {
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [logId, setLogId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([fetchExam(examId), fetchAttemptsForExam(examId)])
      .then(([examRow, attemptRows]) => {
        setExam(examRow);
        setAttempts(attemptRows);
      })
      .catch((err) => setError(err.message || "Could not load results."))
      .finally(() => setLoading(false));
  }, [examId]);

  useEffect(load, [load]);

  const submitted = attempts.filter((a) => a.submitted_at);
  const average =
    submitted.length > 0
      ? Math.round(
          submitted.reduce((sum, a) => sum + (a.total_score || 0), 0) / submitted.length
        )
      : null;

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={exam ? exam.title : "Results"}
        subtitle={exam?.courses ? `${exam.courses.code} · ${submitted.length} submitted` : ""}
        action={
          exam?.courses ? (
            <Link to={`/Courses/${exam.courses.code}`}>
              <Button variant="secondary">{"Back to course"}</Button>
            </Link>
          ) : null
        }
      >
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {!loading && attempts.length === 0 ? (
          <Empty>{"Nobody has sat this exam yet."}</Empty>
        ) : null}

        {submitted.length > 0 ? (
          <Card style={{ marginBottom: 18 }}>
            <div className="btn-row">
              <Badge tone="brand">{`${submitted.length} submitted`}</Badge>
              {average !== null ? <Badge>{`Average ${average}`}</Badge> : null}
              <Badge>{`Out of ${submitted[0].max_score ?? "—"}`}</Badge>
            </div>
          </Card>
        ) : null}

        {attempts.map((attempt) => (
          <Card key={attempt.id} style={{ marginBottom: 12 }}>
            <div className="page-head" style={{ marginBottom: 0 }}>
              <div>
                <strong>{displayName(attempt.profiles)}</strong>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
                  {attempt.submitted_at
                    ? `Submitted ${formatDate(attempt.submitted_at)}`
                    : "In progress"}
                </p>
              </div>
              <div className="btn-row">
                {attempt.disqualified ? <Badge tone="danger">{"disqualified"}</Badge> : null}
                {attempt.auto_submitted && !attempt.disqualified ? (
                  <Badge tone="warn">{"auto-submitted"}</Badge>
                ) : null}
                {attempt.submitted_late ? <Badge tone="warn">{"late"}</Badge> : null}
                {attempt.violations > 0 ? (
                  <Badge tone="danger">{`${attempt.violations} violations`}</Badge>
                ) : null}
                {attempt.submitted_at ? (
                  <Badge tone={attempt.graded_at ? "success" : "warn"}>
                    {`${attempt.total_score ?? 0} / ${attempt.max_score ?? 0}`}
                  </Badge>
                ) : (
                  <Badge>{"unsubmitted"}</Badge>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setLogId(logId === attempt.id ? null : attempt.id)}
                >
                  {logId === attempt.id ? "Hide activity" : "Activity"}
                </Button>
                {attempt.submitted_at ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpenId(openId === attempt.id ? null : attempt.id)}
                  >
                    {openId === attempt.id ? "Close" : "Mark"}
                  </Button>
                ) : null}
              </div>
            </div>

            {logId === attempt.id ? <ProctorLog attemptId={attempt.id} /> : null}

            {openId === attempt.id ? (
              <AttemptDetail
                attempt={attempt}
                onGraded={() => {
                  setOpenId(null);
                  load();
                }}
              />
            ) : null}
          </Card>
        ))}
      </Page>
    </div>
  );
};

export default ExamResults;
