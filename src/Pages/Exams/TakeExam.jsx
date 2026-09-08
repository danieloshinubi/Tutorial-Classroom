import React, { useCallback, useEffect, useRef, useState } from "react";
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
} from "../../lib/api";
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
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}:${pad(s)}`;
};

const TakeExam = () => {
  const { examId } = useParams();
  const { user } = useAuth();

  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [remaining, setRemaining] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Guards the timer from firing submit twice.
  const submittedRef = useRef(false);

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
          const saved = await fetchAnswers(attemptRow.id);
          if (!active) return;
          setAnswers(
            Object.fromEntries(
              saved.map((row) => [
                row.question_id,
                { optionId: row.selected_option_id, text: row.answer_text || "" },
              ])
            )
          );
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

  const handleSubmit = useCallback(async () => {
    if (submittedRef.current || !attempt) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await submitAttempt(attempt.id);
      setAttempt(result);
    } catch (err) {
      setError(err.message || "Could not submit your paper.");
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [attempt]);

  // Countdown. The deadline is derived from started_at so refreshing the page
  // cannot buy extra time.
  useEffect(() => {
    if (!attempt || attempt.submitted_at || !exam?.duration_mins) return undefined;

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
  }, [attempt, exam, handleSubmit]);

  const handleStart = async () => {
    setStarting(true);
    setError("");
    try {
      setAttempt(await startAttempt({ examId, userId: user.id }));
    } catch (err) {
      setError(err.message || "Could not start the exam.");
    } finally {
      setStarting(false);
    }
  };

  // Answers are written as they are made, so a crash or a closed tab does not
  // lose the paper.
  const recordAnswer = async (questionId, patch) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: { ...current[questionId], ...patch },
    }));
    try {
      const next = { ...answers[questionId], ...patch };
      await saveAnswer({
        attemptId: attempt.id,
        questionId,
        optionId: next.optionId,
        text: next.text,
      });
    } catch (err) {
      setError(err.message || "Could not save that answer.");
    }
  };

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
    ? `/Levels/${exam.courses.level_year}/Courses/${exam.courses.code}`
    : "/Dashboard";

  const closed = exam.closes_at && new Date(exam.closes_at) < new Date();
  const answered = questions.filter((q) => {
    const answer = answers[q.id];
    return answer && (answer.optionId || answer.text?.trim());
  }).length;

  /* ------------------------------------------------------------ finished */
  if (attempt?.submitted_at) {
    const showScore = exam.show_results && attempt.total_score !== null;
    return (
      <div className="shell">
        <Navbar />
        <Page title={exam.title} subtitle={exam.courses?.code}>
          <Card style={{ textAlign: "center", padding: 34 }}>
            <h2 style={{ marginBottom: 18 }}>{"Paper submitted"}</h2>
            {showScore ? (
              <>
                <div style={{ display: "grid", placeItems: "center", marginBottom: 16 }}>
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
              <Notice tone="muted">
                {"Your tutor will release the results."}
              </Notice>
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
          <Card style={{ maxWidth: 640 }}>
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

            {closed ? (
              <Notice tone="error">{"This exam has closed."}</Notice>
            ) : (
              <Notice tone="muted">
                {exam.duration_mins
                  ? "The timer starts as soon as you begin and keeps running if you close the page. You get one attempt."
                  : "You get one attempt."}
              </Notice>
            )}

            <Notice tone="error">{error}</Notice>

            <Button onClick={handleStart} disabled={starting || closed}>
              {starting ? "Starting..." : "Start exam"}
            </Button>
          </Card>
        </Page>
      </div>
    );
  }

  /* --------------------------------------------------------- in progress */
  return (
    <div className="shell">
      <Navbar />
      <Page title={exam.title} subtitle={exam.courses?.code}>
        <div className={`exam-timer${remaining !== null && remaining < 120 ? " urgent" : ""}`}>
          <span>{`${answered} of ${questions.length} answered`}</span>
          {remaining !== null ? (
            <span className="exam-clock">{clock(remaining)}</span>
          ) : (
            <span className="exam-clock">{"No limit"}</span>
          )}
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </div>

        <Notice tone="error">{error}</Notice>

        {questions.map((question, index) => {
          const answer = answers[question.id] || {};
          const options = [...(question.exam_options || [])].sort(
            (a, b) => a.position - b.position
          );

          return (
            <div className="q-card" key={question.id}>
              <div className="q-head">
                <span className="q-num">{`Question ${index + 1}`}</span>
                <Badge>{`${question.points} pt`}</Badge>
              </div>
              <p style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{question.prompt}</p>

              {question.kind === "short_answer" ? (
                <textarea
                  className="textarea"
                  value={answer.text || ""}
                  placeholder="Your answer"
                  onChange={(e) => recordAnswer(question.id, { text: e.target.value })}
                />
              ) : (
                options.map((option) => (
                  <label
                    key={option.id}
                    className={`opt${answer.optionId === option.id ? " selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      checked={answer.optionId === option.id}
                      onChange={() => recordAnswer(question.id, { optionId: option.id })}
                    />
                    <span>{option.body}</span>
                  </label>
                ))
              )}
            </div>
          );
        })}

        <div className="btn-row" style={{ marginTop: 20 }}>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit paper"}
          </Button>
        </div>
      </Page>
    </div>
  );
};

export default TakeExam;
