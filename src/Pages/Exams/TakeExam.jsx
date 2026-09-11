import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import {
  fetchExam,
  fetchQuestionsForSitting,
  fetchMyAttempt,
  startAttempt,
  saveAnswer,
  submitAttempt,
  fetchAnswers,
  reportViolation,
  signedMaterialUrl,
} from "../../lib/api";
import {
  startProctoring,
  requestFullscreen,
  exitFullscreen,
  seededShuffle,
  VIOLATION_LABELS,
} from "../../lib/proctor";
import {
  loadLocalAnswers,
  mergeServerAnswers,
  recordLocalAnswer,
  clearLocalAnswers,
  syncAnswers,
  pendingCount,
  isNetworkError,
} from "../../lib/offline";
import ConnectionStatus from "../../Components/ConnectionStatus";
import ScientificCalculator from "../../Components/ScientificCalculator";
import {
  Page,
  Card,
  Button,
  Badge,
  Notice,
  Empty,
  formatDate,
} from "../../Components/UI";

const pad = (n) => String(n).padStart(2, "0");

const clock = (seconds) => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}:${pad(s % 60)}`;
};

// Self-contained so the parent's own hooks/state don't need to know about
// image resolution at all — it just resolves its own signed URL whenever
// the path it's given changes, and shows nothing while there is none.
const QuestionImage = ({ path }) => {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    signedMaterialUrl(path)
      .then((signed) => { if (active) setUrl(signed); })
      .catch(() => { if (active) setUrl(null); });
    return () => { active = false; };
  }, [path]);

  if (!path || !url) return null;
  return <img src={url} alt="" className="exam-q-image" />;
};

const TakeExam = () => {
  const { examId } = useParams();
  const { user } = useAuth();

  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  // Which question the student is on right now. One-at-a-time navigation
  // keeps the paper focused and matches how CBT venues run in the field —
  // no scrolling past everyone else's answers, no accidental double-answer.
  const [currentIndex, setCurrentIndex] = useState(0);
  // Marked-for-review is a per-attempt Set of question ids the student can
  // come back to before submitting. Not persisted server-side; only useful
  // during this sitting.
  const [markedForReview, setMarkedForReview] = useState(() => new Set());
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [remaining, setRemaining] = useState(null);
  const [warning, setWarning] = useState("");
  const [connection, setConnection] = useState("online");
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Guards the timer and the proctor from submitting twice.
  const submittedRef = useRef(false);
  const attemptRef = useRef(null);
  attemptRef.current = attempt;

  useEffect(() => {
    let active = true;

    Promise.all([
      fetchExam(examId),
      fetchQuestionsForSitting(examId),
      fetchMyAttempt({ examId, userId: user.id }),
    ])
      .then(async ([examRow, questionRows, attemptRow]) => {
        if (!active) return;
        setExam(examRow);
        setQuestions(questionRows);
        setAttempt(attemptRow);

        if (attemptRow) {
          // Local drafts win over the server copy: anything still unsynced was
          // typed more recently than whatever was last delivered.
          let store = loadLocalAnswers(attemptRow.id);
          try {
            const saved = await fetchAnswers(attemptRow.id);
            store = mergeServerAnswers(attemptRow.id, saved);
          } catch (err) {
            if (!isNetworkError(err)) throw err;
            setConnection(navigator.onLine ? "slow" : "offline");
          }
          if (!active) return;
          setAnswers(
            Object.fromEntries(
              Object.entries(store).map(([questionId, entry]) => [
                questionId,
                { optionId: entry.optionId, text: entry.text || "" },
              ])
            )
          );
          setPending(pendingCount(attemptRow.id));
        }
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load this exam.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [examId, user.id]);

  // Pushes anything unsynced and reports what the connection is doing.
  const flush = useCallback(async () => {
    const current = attemptRef.current;
    if (!current || current.submitted_at) return true;

    setConnection((state) => (state === "offline" ? state : "syncing"));
    const result = await syncAnswers(current.id, saveAnswer);
    setPending(result.pending);

    if (result.ok) {
      setConnection("online");
      return true;
    }
    // A refused write is a real problem; a failed one is just the network.
    if (isNetworkError(result.error)) {
      setConnection(navigator.onLine ? "slow" : "offline");
    } else {
      setConnection("online");
      setError(
        result.error?.message ||
          "Your answers were refused — your time may be up, or the paper is closed."
      );
    }
    return false;
  }, []);

  const handleSubmit = useCallback(async () => {
    const current = attemptRef.current;
    if (submittedRef.current || !current || current.submitted_at) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      // Deliver every outstanding answer before closing the paper, so nothing
      // typed during an outage is left behind.
      await flush();
      const result = await submitAttempt(current.id);
      setAttempt(result);
      clearLocalAnswers(current.id);
      exitFullscreen();
    } catch (err) {
      if (isNetworkError(err)) {
        setConnection(navigator.onLine ? "slow" : "offline");
        setError(
          "You are offline, so the paper could not be sent. It will submit automatically when the connection returns — keep this page open."
        );
        setPendingSubmit(true);
      } else {
        setError(err.message || "Could not submit your paper.");
      }
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [flush]);

  /* ------------------------------------------------------------ proctoring */
  const handleViolation = useCallback(async (kind, detail) => {
    const current = attemptRef.current;
    if (!current || current.submitted_at) return;

    try {
      const updated = await reportViolation({
        attemptId: current.id,
        kind,
        detail,
      });
      setAttempt(updated);

      if (updated.disqualified) {
        submittedRef.current = true;
        setWarning("");
        exitFullscreen();
        return;
      }

      const label = VIOLATION_LABELS[kind] || "Rule broken";
      setWarning(`${label}. This has been recorded (warning ${updated.violations}).`);
    } catch {
      // A failed report must not interrupt the paper.
    }
  }, []);

  // Only arm the lockdown while a paper is genuinely in progress.
  const sitting = Boolean(attempt && !attempt.submitted_at && !attempt.disqualified);

  useEffect(() => {
    if (!sitting || !exam) return undefined;
    const stop = startProctoring({
      onViolation: handleViolation,
      blockCopyPaste: exam.block_copy_paste,
      requireFullscreen: exam.require_fullscreen,
    });
    return stop;
  }, [sitting, exam, handleViolation]);

  // Background delivery. Retries on a timer and the moment the browser says it
  // is back online, and fires a queued submit once everything has landed.
  useEffect(() => {
    if (!sitting) return undefined;

    const attemptFlush = async () => {
      const delivered = await flush();
      if (delivered && pendingSubmit) {
        setPendingSubmit(false);
        submittedRef.current = false;
        handleSubmit();
      }
    };

    const id = setInterval(attemptFlush, 8000);
    const onOnline = () => attemptFlush();
    const onOffline = () => setConnection("offline");

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (!navigator.onLine) setConnection("offline");

    return () => {
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [sitting, flush, pendingSubmit, handleSubmit]);

  // Countdown. The deadline comes from the server's started_at, so refreshing
  // the page cannot buy extra time.
  useEffect(() => {
    if (!sitting || !exam?.duration_mins || !attempt) return undefined;

    const deadline =
      new Date(attempt.started_at).getTime() + exam.duration_mins * 60000;

    const tick = () => {
      const left = Math.round((deadline - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) handleSubmit();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sitting, exam, attempt, handleSubmit]);

  const handleStart = async () => {
    setStarting(true);
    setError("");
    try {
      if (exam.require_fullscreen) await requestFullscreen();
      setAttempt(await startAttempt({ examId }));
    } catch (err) {
      setError(err.message || "Could not start the exam.");
    } finally {
      setStarting(false);
    }
  };

  // Every answer lands in localStorage first, so a dropped connection cannot
  // lose it. The sync loop below delivers it whenever the network allows.
  const recordAnswer = (questionId, patch) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: { ...current[questionId], ...patch },
    }));
    recordLocalAnswer(attempt.id, questionId, patch);
    setPending(pendingCount(attempt.id));
    flush();
  };

  // Each student gets their own order, stable across refreshes.
  const ordered = useMemo(() => {
    if (!exam || !attempt) return questions;
    const list = exam.shuffle_questions
      ? seededShuffle(questions, attempt.id)
      : questions;
    return list.map((question) => ({
      ...question,
      exam_options: exam.shuffle_options
        ? seededShuffle(question.exam_options || [], attempt.id + question.id)
        : [...(question.exam_options || [])].sort((a, b) => a.position - b.position),
    }));
  }, [questions, exam, attempt]);

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page><Empty>{"Loading exam..."}</Empty></Page>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Exam">
          <Notice tone="error">{error || "That exam is not available."}</Notice>
        </Page>
      </div>
    );
  }

  const backLink = exam.courses
    ? `/Courses/${exam.courses.code}`
    : "/Dashboard";

  const closed = exam.closes_at && new Date(exam.closes_at) < new Date();
  const answered = ordered.filter((q) => {
    const answer = answers[q.id];
    return answer && (answer.optionId || answer.text?.trim());
  }).length;

  /* ----------------------------------------------------------- finished */
  if (attempt?.submitted_at || attempt?.disqualified) {
    const showScore = exam.show_results && attempt.total_score !== null;
    return (
      <div className="shell">
        <Navbar />
        <Page title={exam.title} subtitle={exam.courses?.code}>
          <Card style={{ textAlign: "center", padding: 34 }}>
            <h2 style={{ marginBottom: 14 }}>
              {attempt.disqualified ? "Exam ended" : "Paper submitted"}
            </h2>

            {attempt.disqualified ? (
              <Notice tone="error">{attempt.disqualified_reason}</Notice>
            ) : null}
            {attempt.auto_submitted && !attempt.disqualified ? (
              <Notice tone="muted">{"Submitted automatically when time ran out."}</Notice>
            ) : null}

            {showScore ? (
              <>
                <div style={{ display: "grid", placeItems: "center", margin: "16px 0" }}>
                  <span className="score-ring">
                    {`${attempt.total_score}/${attempt.max_score}`}
                  </span>
                </div>
                {attempt.graded_at ? (
                  <Badge tone="success">{"Marked by your tutor"}</Badge>
                ) : (
                  <Notice tone="muted">
                    {"Auto-marked. Any written answers still need your tutor."}
                  </Notice>
                )}
              </>
            ) : (
              <Notice tone="muted">{"Your tutor will release the results."}</Notice>
            )}

            <div style={{ marginTop: 22 }}>
              <Link to={backLink}>
                <Button variant="secondary">{"Back to course"}</Button>
              </Link>
            </div>
          </Card>
        </Page>
      </div>
    );
  }

  /* -------------------------------------------------------- not started */
  if (!attempt) {
    return (
      <div className="shell">
        <Navbar />
        <Page title={exam.title} subtitle={exam.courses?.code}>
          <Card style={{ maxWidth: 660 }}>
            {exam.instructions ? (
              <p style={{ whiteSpace: "pre-wrap" }}>{exam.instructions}</p>
            ) : null}

            <div className="btn-row" style={{ margin: "14px 0" }}>
              <Badge>{`${questions.length} questions`}</Badge>
              <Badge>
                {exam.duration_mins ? `${exam.duration_mins} minutes` : "No time limit"}
              </Badge>
              {exam.closes_at ? <Badge>{`Closes ${formatDate(exam.closes_at)}`}</Badge> : null}
            </div>

            <Card style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
              <strong style={{ display: "block", marginBottom: 8 }}>
                {"Exam conditions"}
              </strong>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, fontSize: 14 }}>
                <li>{"You get one attempt. The timer keeps running if you close the page."}</li>
                {exam.block_copy_paste ? (
                  <li>{"Copying, pasting and right-clicking are disabled."}</li>
                ) : null}
                {exam.require_fullscreen ? (
                  <li>{"The exam runs fullscreen. Leaving fullscreen is recorded."}</li>
                ) : null}
                <li>{"Switching tabs or windows is recorded and shown to your tutor."}</li>
                {exam.max_violations > 0 ? (
                  <li>
                    <strong>
                      {`After ${exam.max_violations} violations your paper is submitted automatically and you are disqualified.`}
                    </strong>
                  </li>
                ) : null}
              </ul>
            </Card>

            {closed ? (
              <Notice tone="error">
                {`This exam closed on ${formatDate(exam.closes_at)}. Ask your tutor to extend the deadline.`}
              </Notice>
            ) : null}
            <Notice tone="error">{error}</Notice>

            <div style={{ marginTop: 16 }}>
              <Button onClick={handleStart} disabled={starting || closed}>
                {starting ? "Starting..." : "I understand — start exam"}
              </Button>
            </div>
          </Card>
        </Page>
      </div>
    );
  }

  /* --------------------------------------------------------- in progress */
  const violationsLeft = exam.max_violations - (attempt.violations || 0);

  // Bounds-safe access so a stale index (e.g. after questions were re-ordered
  // on the server between mounts) does not crash the render.
  const active = ordered[Math.min(currentIndex, ordered.length - 1)] || ordered[0];
  const activeAnswer = active ? (answers[active.id] || {}) : {};
  const isAnswered = (q) => {
    const a = answers[q.id];
    if (!a) return false;
    if (q.kind === "short_answer") return Boolean(a.text && a.text.trim());
    return Boolean(a.optionId);
  };
  const toggleReview = () => {
    if (!active) return;
    setMarkedForReview((current) => {
      const next = new Set(current);
      if (next.has(active.id)) next.delete(active.id);
      else next.add(active.id);
      return next;
    });
  };
  const jumpTo = (index) => {
    if (index < 0 || index >= ordered.length) return;
    setCurrentIndex(index);
  };

  return (
    <div className="shell">
      <Navbar />
      <Page title={exam.title} subtitle={exam.courses?.code}>
        <ConnectionStatus state={connection} pending={pending} />

        {warning ? (
          <Card style={{ background: "var(--danger-soft)", borderColor: "transparent", marginBottom: 14 }}>
            <strong style={{ color: "var(--danger)" }}>{warning}</strong>
            {exam.max_violations > 0 ? (
              <p style={{ margin: "6px 0 0", fontSize: 14 }}>
                {violationsLeft > 0
                  ? `${violationsLeft} more and your paper is taken away.`
                  : "This was your last warning."}
              </p>
            ) : null}
          </Card>
        ) : null}

        <Notice tone="error">{error}</Notice>

        {/* Two-column: paper on the left, palette + clock on the right. */}
        <div className="exam-layout">
          <div className="exam-paper">
            {active ? (
              <>
                <div className="exam-q-head">
                  <div>
                    <div className="exam-q-eyebrow">
                      {`Question ${currentIndex + 1} of ${ordered.length}`}
                    </div>
                    <p className="exam-q-prompt">{active.prompt}</p>
                  </div>
                  <Badge>{`${active.points} pt`}</Badge>
                </div>

                <QuestionImage path={active.image_path} />

                {active.kind === "short_answer" ? (
                  <textarea
                    className="textarea exam-short"
                    value={activeAnswer.text || ""}
                    placeholder="Your answer"
                    onChange={(e) => recordAnswer(active.id, { text: e.target.value })}
                    onPaste={(e) => e.preventDefault()}
                    onCopy={(e) => e.preventDefault()}
                    spellCheck={false}
                    autoComplete="off"
                  />
                ) : (
                  <ul className="exam-options" role="radiogroup" aria-label="Options">
                    {active.exam_options.map((option, ix) => {
                      const selected = activeAnswer.optionId === option.id;
                      return (
                        <li key={option.id}>
                          <label
                            className={`exam-option${selected ? " selected" : ""}`}
                          >
                            <input
                              type="radio"
                              name={active.id}
                              checked={selected}
                              onChange={() =>
                                recordAnswer(active.id, { optionId: option.id })
                              }
                            />
                            <span className="exam-option-letter">
                              {String.fromCharCode(65 + ix)}
                            </span>
                            <span className="exam-option-body">{option.body}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Bottom control bar — mark, prev/next, and, on the last
                    question, finish. Kept as three visually equal buttons
                    so the primary action is chosen deliberately. */}
                <div className="exam-actions">
                  <Button
                    variant={markedForReview.has(active.id) ? "primary" : "secondary"}
                    onClick={toggleReview}
                  >
                    {markedForReview.has(active.id) ? "Unmark review" : "Mark for review"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={currentIndex === 0}
                    onClick={() => jumpTo(currentIndex - 1)}
                  >
                    {"Previous"}
                  </Button>
                  {currentIndex < ordered.length - 1 ? (
                    <Button onClick={() => jumpTo(currentIndex + 1)}>
                      {"Next question"}
                    </Button>
                  ) : (
                    <Button onClick={handleSubmit} disabled={submitting}>
                      {submitting ? "Submitting..." : "Finish exam"}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <Empty>{"No questions on this paper."}</Empty>
            )}
          </div>

          <aside className="exam-side">
            {/* Summary card: what paper, which question, time left. */}
            <div className="exam-summary">
              <div className="exam-summary-title">{exam.title}</div>
              <div className="exam-summary-row">
                <span>{"Question"}</span>
                <strong>{`${currentIndex + 1} / ${ordered.length}`}</strong>
              </div>
              <div className="exam-summary-row">
                <span>{"Answered"}</span>
                <strong>{`${answered} / ${ordered.length}`}</strong>
              </div>
              <div className={`exam-summary-row exam-clock-row${remaining !== null && remaining < 120 ? " urgent" : ""}`}>
                <span>{"Time left"}</span>
                <strong>{remaining !== null ? clock(remaining) : "No limit"}</strong>
              </div>
            </div>

            {/* Palette — one square per question, coloured by state. Click
                to jump there. Reads left-to-right, five per row like the
                mockup. */}
            <div className="exam-palette">
              <div className="exam-palette-title">
                {"Click to go to that question"}
              </div>
              <div className="exam-palette-grid">
                {ordered.map((q, ix) => {
                  const answered = isAnswered(q);
                  const marked = markedForReview.has(q.id);
                  const current = ix === currentIndex;
                  const cls = current
                    ? "current"
                    : marked && answered
                    ? "reviewed"
                    : marked
                    ? "marked"
                    : answered
                    ? "answered"
                    : "unseen";
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`exam-palette-cell ${cls}`}
                      onClick={() => jumpTo(ix)}
                      aria-label={`Go to question ${ix + 1}${answered ? ", answered" : ""}${marked ? ", marked for review" : ""}`}
                      aria-current={current ? "true" : "false"}
                    >
                      {ix + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Legend so the colours read as meaning, not decoration. */}
            <div className="exam-legend">
              <div><span className="dot current" /> Current</div>
              <div><span className="dot answered" /> Answered</div>
              <div><span className="dot marked" /> For review</div>
              <div><span className="dot reviewed" /> Answered &amp; marked</div>
              <div><span className="dot unseen" /> Not answered</div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-block"
            >
              {submitting ? "Submitting..." : "Finish exam"}
            </Button>
          </aside>
        </div>
      </Page>

      {exam.allow_calculator ? (
        calculatorOpen ? (
          <ScientificCalculator onClose={() => setCalculatorOpen(false)} />
        ) : (
          <button
            type="button"
            className="calc-launcher"
            onClick={() => setCalculatorOpen(true)}
            aria-label="Open calculator"
            title="Calculator"
          >
            {"🖩"}
          </button>
        )
      ) : null}
    </div>
  );
};

export default TakeExam;
