import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { createExam, createQuestion, createOptions } from "../../lib/api";
import { Page, Card, Field, Button, Badge, Notice } from "../../Components/UI";

const blankQuestion = (kind = "multiple_choice") => ({
  kind,
  prompt: "",
  points: 1,
  answer_key: "",
  options:
    kind === "true_false"
      ? [
          { body: "True", is_correct: true },
          { body: "False", is_correct: false },
        ]
      : [
          { body: "", is_correct: true },
          { body: "", is_correct: false },
        ],
});

// Builds the whole paper in local state and writes it in one go, so a
// half-finished exam is never visible to students.
const ExamBuilder = () => {
  const { courseId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [exam, setExam] = useState({
    title: "",
    instructions: "",
    duration_mins: "60",
    closes_at: "",
    show_results: true,
  });
  const [questions, setQuestions] = useState([blankQuestion()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setExamField = (field) => (event) => {
    const value =
      event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setExam((current) => ({ ...current, [field]: value }));
  };

  const patchQuestion = (index, patch) =>
    setQuestions((current) =>
      current.map((question, i) => (i === index ? { ...question, ...patch } : question))
    );

  const changeKind = (index, kind) => patchQuestion(index, blankQuestion(kind));

  const patchOption = (qi, oi, patch) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === qi
          ? {
              ...question,
              options: question.options.map((option, j) =>
                j === oi ? { ...option, ...patch } : option
              ),
            }
          : question
      )
    );

  // Exactly one correct option, so picking a new one clears the others.
  const markCorrect = (qi, oi) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === qi
          ? {
              ...question,
              options: question.options.map((option, j) => ({
                ...option,
                is_correct: j === oi,
              })),
            }
          : question
      )
    );

  const addOption = (qi) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === qi
          ? { ...question, options: [...question.options, { body: "", is_correct: false }] }
          : question
      )
    );

  const removeOption = (qi, oi) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === qi
          ? { ...question, options: question.options.filter((_, j) => j !== oi) }
          : question
      )
    );

  const totalPoints = questions.reduce(
    (sum, question) => sum + (Number(question.points) || 0),
    0
  );

  const validate = () => {
    if (!exam.title.trim()) return "Give the exam a title.";
    if (questions.length === 0) return "Add at least one question.";

    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i];
      if (!question.prompt.trim()) return `Question ${i + 1} needs a prompt.`;

      if (question.kind !== "short_answer") {
        const filled = question.options.filter((option) => option.body.trim());
        if (filled.length < 2) return `Question ${i + 1} needs at least two options.`;
        if (!question.options.some((option) => option.is_correct && option.body.trim())) {
          return `Question ${i + 1} needs a correct answer selected.`;
        }
      }
    }
    return "";
  };

  const handleSave = async (publish) => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setError("");
    setSaving(true);
    try {
      const created = await createExam({
        course_id: courseId,
        title: exam.title.trim(),
        instructions: exam.instructions.trim() || null,
        duration_mins: exam.duration_mins ? Number(exam.duration_mins) : null,
        closes_at: exam.closes_at ? new Date(exam.closes_at).toISOString() : null,
        show_results: exam.show_results,
        published: publish,
        created_by: user.id,
      });

      for (let i = 0; i < questions.length; i += 1) {
        const question = questions[i];
        const savedQuestion = await createQuestion({
          exam_id: created.id,
          kind: question.kind,
          prompt: question.prompt.trim(),
          points: Number(question.points) || 1,
          position: i,
          answer_key:
            question.kind === "short_answer" ? question.answer_key.trim() || null : null,
        });

        if (question.kind !== "short_answer") {
          await createOptions(
            question.options
              .filter((option) => option.body.trim())
              .map((option, j) => ({
                question_id: savedQuestion.id,
                body: option.body.trim(),
                is_correct: option.is_correct,
                position: j,
              }))
          );
        }
      }

      navigate(-1);
    } catch (err) {
      setError(err.message || "Could not save the exam.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Create an exam"
        subtitle={`${questions.length} questions · ${totalPoints} points total`}
      >
        <Card style={{ marginBottom: 20 }}>
          <Field label="Title">
            <input
              className="input"
              value={exam.title}
              onChange={setExamField("title")}
              placeholder="Mid-semester test"
            />
          </Field>
          <Field label="Instructions">
            <textarea
              className="textarea"
              value={exam.instructions}
              onChange={setExamField("instructions")}
            />
          </Field>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <Field label="Time limit (minutes)" hint="Leave blank for no limit.">
              <input
                type="number"
                min="1"
                className="input"
                value={exam.duration_mins}
                onChange={setExamField("duration_mins")}
              />
            </Field>
            <Field label="Closes at" hint="Optional deadline.">
              <input
                type="datetime-local"
                className="input"
                value={exam.closes_at}
                onChange={setExamField("closes_at")}
              />
            </Field>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={exam.show_results}
              onChange={setExamField("show_results")}
            />
            {"Show students their score as soon as they submit"}
          </label>
        </Card>

        {questions.map((question, qi) => (
          <div className="q-card" key={qi}>
            <div className="q-head">
              <span className="q-num">{`Question ${qi + 1}`}</span>
              <div className="btn-row">
                <select
                  className="select"
                  style={{ width: "auto" }}
                  value={question.kind}
                  onChange={(e) => changeKind(qi, e.target.value)}
                >
                  <option value="multiple_choice">{"Multiple choice"}</option>
                  <option value="true_false">{"True / false"}</option>
                  <option value="short_answer">{"Short answer"}</option>
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuestions((c) => c.filter((_, i) => i !== qi))}
                  disabled={questions.length === 1}
                >
                  {"Remove"}
                </Button>
              </div>
            </div>

            <Field label="Prompt">
              <textarea
                className="textarea"
                style={{ minHeight: 70 }}
                value={question.prompt}
                onChange={(e) => patchQuestion(qi, { prompt: e.target.value })}
              />
            </Field>

            {question.kind === "short_answer" ? (
              <Field
                label="Answer key"
                hint="Optional. If filled in, matching answers are marked automatically (case and spacing ignored). Otherwise you mark it by hand."
              >
                <input
                  className="input"
                  value={question.answer_key}
                  onChange={(e) => patchQuestion(qi, { answer_key: e.target.value })}
                />
              </Field>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <span className="label" style={{ display: "block", marginBottom: 6, fontSize: 13.5, fontWeight: 550 }}>
                  {"Options — select the correct one"}
                </span>
                {question.options.map((option, oi) => (
                  <div key={oi} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input
                      type="radio"
                      name={`correct-${qi}`}
                      checked={option.is_correct}
                      onChange={() => markCorrect(qi, oi)}
                    />
                    <input
                      className="input"
                      value={option.body}
                      placeholder={`Option ${oi + 1}`}
                      disabled={question.kind === "true_false"}
                      onChange={(e) => patchOption(qi, oi, { body: e.target.value })}
                    />
                    {question.kind === "multiple_choice" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeOption(qi, oi)}
                        disabled={question.options.length <= 2}
                      >
                        {"×"}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {question.kind === "multiple_choice" ? (
                  <Button variant="secondary" size="sm" onClick={() => addOption(qi)}>
                    {"Add option"}
                  </Button>
                ) : null}
              </div>
            )}

            <Field label="Points">
              <input
                type="number"
                min="1"
                className="input"
                style={{ maxWidth: 120 }}
                value={question.points}
                onChange={(e) => patchQuestion(qi, { points: e.target.value })}
              />
            </Field>
          </div>
        ))}

        <div className="btn-row" style={{ marginTop: 16 }}>
          <Button variant="secondary" onClick={() => setQuestions((c) => [...c, blankQuestion()])}>
            {"Add question"}
          </Button>
          <span style={{ flex: 1 }} />
          <Badge>{`${totalPoints} points`}</Badge>
        </div>

        <Notice tone="error">{error}</Notice>

        <div className="btn-row" style={{ marginTop: 18 }}>
          <Button onClick={() => handleSave(true)} disabled={saving}>
            {saving ? "Saving..." : "Save & publish"}
          </Button>
          <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving}>
            {"Save as draft"}
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)} disabled={saving}>
            {"Cancel"}
          </Button>
        </div>
      </Page>
    </div>
  );
};

export default ExamBuilder;
