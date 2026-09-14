import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  createExam,
  updateExam,
  createQuestion,
  updateQuestion,
  createOptions,
  deleteQuestion,
  deleteOptionsForQuestion,
  fetchExam,
  fetchQuestionsForEditing,
  countAttempts,
  uploadExamQuestionImage,
  removeExamQuestionImage,
} from "../../lib/api";
import { Page, Card, Field, Button, Badge, Notice, Select, DateTimePicker } from "../../Components/UI";
import { useDocumentPreview } from "../../Components/DocumentPreview";

const blankQuestion = (kind = "multiple_choice") => ({
  kind,
  prompt: "",
  image_path: null,
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

const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

// Builds the whole paper in local state and writes it in one go, so a
// half-finished exam is never visible to students. Handles both creating a
// new paper and editing an unpublished one.
const ExamBuilder = () => {
  const { courseId: routeCourseId, examId } = useParams();
  const [searchParams] = useSearchParams();
  const isEditing = Boolean(examId);
  const { user } = useAuth();
  const { schoolId } = useSchool();
  const navigate = useNavigate();
  const imageInputs = useRef({});
  const preview = useDocumentPreview();

  const [courseId, setCourseId] = useState(routeCourseId || null);
  const [loading, setLoading] = useState(isEditing);
  const [attemptCount, setAttemptCount] = useState(0);

  const [exam, setExam] = useState({
    title: "",
    kind: searchParams.get("kind") === "midterm" ? "midterm" : "exam",
    instructions: "",
    duration_mins: "60",
    closes_at: "",
    show_results: true,
    block_copy_paste: true,
    require_fullscreen: true,
    shuffle_questions: true,
    shuffle_options: true,
    max_violations: "3",
    allow_calculator: false,
  });
  const [questions, setQuestions] = useState([blankQuestion()]);
  const [removedIds, setRemovedIds] = useState([]);
  const [imageUploading, setImageUploading] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load an existing paper for editing.
  useEffect(() => {
    if (!isEditing || !schoolId) return;
    let active = true;

    Promise.all([
      fetchExam({ id: examId, schoolId }),
      fetchQuestionsForEditing({ examId, schoolId }),
      countAttempts({ schoolId, examId }),
    ])
      .then(([examRow, questionRows, attempts]) => {
        if (!active) return;
        if (!examRow) {
          setError("That exam no longer exists.");
          return;
        }
        setCourseId(examRow.course_id);
        setAttemptCount(attempts);
        setExam({
          title: examRow.title || "",
          kind: examRow.kind === "midterm" ? "midterm" : "exam",
          instructions: examRow.instructions || "",
          duration_mins: examRow.duration_mins ? String(examRow.duration_mins) : "",
          closes_at: toLocalInput(examRow.closes_at),
          show_results: examRow.show_results,
          block_copy_paste: examRow.block_copy_paste,
          require_fullscreen: examRow.require_fullscreen,
          shuffle_questions: examRow.shuffle_questions,
          shuffle_options: examRow.shuffle_options,
          max_violations: String(examRow.max_violations ?? 3),
          allow_calculator: !!examRow.allow_calculator,
        });
        setQuestions(
          questionRows.length
            ? questionRows.map((row) => ({
                id: row.id,
                kind: row.kind,
                prompt: row.prompt,
                image_path: row.image_path || null,
                points: String(row.points),
                answer_key: row.answer_key || "",
                options: [...(row.exam_options || [])]
                  .sort((a, b) => a.position - b.position)
                  .map((option) => ({
                    id: option.id,
                    body: option.body,
                    is_correct: option.is_correct,
                  })),
              }))
            : [blankQuestion()]
        );
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load the exam.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [examId, isEditing, schoolId]);

  const setExamField = (field) => (event) => {
    const value =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;
    setExam((current) => ({ ...current, [field]: value }));
  };

  const patchQuestion = (index, patch) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === index ? { ...question, ...patch } : question,
      ),
    );

  const changeKind = (index, kind) => patchQuestion(index, blankQuestion(kind));

  const attachQuestionImage = async (index, file) => {
    if (!file || !courseId) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("That image is over 10MB.");
      return;
    }
    setImageUploading((c) => ({ ...c, [index]: true }));
    setError("");
    try {
      const path = await uploadExamQuestionImage({ courseId, file });
      patchQuestion(index, { image_path: path });
    } catch (err) {
      setError(err.message || "Could not attach that image.");
    } finally {
      setImageUploading((c) => ({ ...c, [index]: false }));
    }
  };

  const removeQuestionImage = (index, path) => {
    patchQuestion(index, { image_path: null });
    if (path) removeExamQuestionImage(path);
  };

  const patchOption = (qi, oi, patch) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === qi
          ? {
              ...question,
              options: question.options.map((option, j) =>
                j === oi ? { ...option, ...patch } : option,
              ),
            }
          : question,
      ),
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
          : question,
      ),
    );

  const addOption = (qi) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === qi
          ? {
              ...question,
              options: [...question.options, { body: "", is_correct: false }],
            }
          : question,
      ),
    );

  const removeOption = (qi, oi) =>
    setQuestions((current) =>
      current.map((question, i) =>
        i === qi
          ? {
              ...question,
              options: question.options.filter((_, j) => j !== oi),
            }
          : question,
      ),
    );

  const totalPoints = questions.reduce(
    (sum, question) => sum + (Number(question.points) || 0),
    0,
  );

  const validate = () => {
    if (!exam.title.trim()) return "Give the exam a title.";
    if (questions.length === 0) return "Add at least one question.";

    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i];
      if (!question.prompt.trim()) return `Question ${i + 1} needs a prompt.`;

      if (question.kind !== "short_answer") {
        const filled = question.options.filter((option) => option.body.trim());
        if (filled.length < 2)
          return `Question ${i + 1} needs at least two options.`;
        if (
          !question.options.some(
            (option) => option.is_correct && option.body.trim(),
          )
        ) {
          return `Question ${i + 1} needs a correct answer selected.`;
        }
      }
    }
    return "";
  };

  // A deadline of 00:00 means the very start of that day, which is almost
  // always a mistake — tutors mean the end of it.
  const closesAt = exam.closes_at ? new Date(exam.closes_at) : null;
  const closesInPast = closesAt && closesAt < new Date();
  const closesAtMidnight =
    closesAt && closesAt.getHours() === 0 && closesAt.getMinutes() === 0;

  const closesHint = closesInPast
    ? "This is in the past — students will see the exam as already closed."
    : closesAtMidnight
    ? "12:00 AM is the START of that day. For the end of the day use 11:59 PM."
    : "Optional deadline. Leave blank for no closing time.";

  const handleSave = async (publish) => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    // Rewriting questions discards any answers already given against them, so
    // never do it silently once students have sat the paper.
    if (isEditing && attemptCount > 0) {
      const ok = window.confirm(
        `${attemptCount} student${attemptCount === 1 ? " has" : "s have"} already sat this exam. ` +
          "Changing the questions will discard their answers and scores. Continue?"
      );
      if (!ok) return;
    }

    setError("");
    setSaving(true);
    try {
      const fields = {
        title: exam.title.trim(),
        kind: exam.kind === "midterm" ? "midterm" : "exam",
        instructions: exam.instructions.trim() || null,
        duration_mins: exam.duration_mins ? Number(exam.duration_mins) : null,
        closes_at: exam.closes_at
          ? new Date(exam.closes_at).toISOString()
          : null,
        show_results: exam.show_results,
        block_copy_paste: exam.block_copy_paste,
        require_fullscreen: exam.require_fullscreen,
        shuffle_questions: exam.shuffle_questions,
        shuffle_options: exam.shuffle_options,
        max_violations: Number(exam.max_violations) || 0,
        allow_calculator: exam.allow_calculator,
        published: publish,
      };

      const target = isEditing
        ? await updateExam(examId, fields, schoolId).then(() => ({ id: examId }))
        : await createExam({ ...fields, course_id: courseId, created_by: user.id });

      for (const id of removedIds) {
        await deleteQuestion(id, schoolId);
      }

      for (let i = 0; i < questions.length; i += 1) {
        const question = questions[i];
        const shape = {
          kind: question.kind,
          prompt: question.prompt.trim(),
          image_path: question.image_path || null,
          points: Number(question.points) || 1,
          position: i,
          answer_key:
            question.kind === "short_answer"
              ? question.answer_key.trim() || null
              : null,
        };

        let questionId = question.id;
        if (questionId) {
          await updateQuestion(questionId, shape, schoolId);
          // Options are replaced wholesale — simpler and safer than trying to
          // diff them, and the confirmation above already covered the cost.
          await deleteOptionsForQuestion(questionId, schoolId);
        } else {
          const saved = await createQuestion({ ...shape, exam_id: target.id });
          questionId = saved.id;
        }

        if (question.kind !== "short_answer") {
          await createOptions(
            question.options
              .filter((option) => option.body.trim())
              .map((option, j) => ({
                question_id: questionId,
                body: option.body.trim(),
                is_correct: option.is_correct,
                position: j,
              })),
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

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Edit exam">
          <p>{"Loading exam..."}</p>
        </Page>
      </div>
    );
  }

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={isEditing ? "Edit exam" : "Create an exam"}
        subtitle={`${questions.length} questions · ${totalPoints} points total`}
      >
        {isEditing && attemptCount > 0 ? (
          <Card
            style={{
              marginBottom: 16,
              background: "var(--warn-soft)",
              borderColor: "transparent",
            }}
          >
            <strong>{`${attemptCount} student${attemptCount === 1 ? " has" : "s have"} already sat this exam.`}</strong>
            <p style={{ margin: "6px 0 0", fontSize: 14 }}>
              {"Changing the questions will discard their answers and scores. Editing the title, deadline or settings is safe."}
            </p>
          </Card>
        ) : null}
        <Card style={{ marginBottom: 20 }}>
          <Field label="Title">
            <input
              className="input"
              value={exam.title}
              onChange={setExamField("title")}
              placeholder="Mid-semester test"
            />
          </Field>
          <Field label="Kind" hint="Which list this shows up in on the course page.">
            <Select
              className="select"
              style={{ width: "auto" }}
              value={exam.kind}
              onChange={(v) => setExam((current) => ({ ...current, kind: v }))}
              options={[
                { value: "exam", label: "Exam" },
                { value: "midterm", label: "Mid-exam" },
              ]}
            />
          </Field>
          <Field label="Instructions">
            <textarea
              className="textarea"
              value={exam.instructions}
              onChange={setExamField("instructions")}
            />
          </Field>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            }}
          >
            <Field
              label="Time limit (minutes)"
              hint="Leave blank for no limit."
            >
              <input
                type="number"
                min="1"
                className="input"
                value={exam.duration_mins}
                onChange={setExamField("duration_mins")}
              />
            </Field>
            <Field
              label="Closes at"
              hint={closesHint}
            >
              <DateTimePicker
                value={exam.closes_at}
                onChange={(v) => setExam((current) => ({ ...current, closes_at: v }))}
              />
            </Field>
          </div>
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={exam.show_results}
              onChange={setExamField("show_results")}
            />
            {"Show students their score as soon as they submit"}
          </label>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <h3>{"Exam conditions"}</h3>
          <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 13.5 }}>
            {
              "Browser restrictions are deterrents; the deadline, the single attempt and disqualification are enforced by the database and cannot be bypassed."
            }
          </p>

          {[
            [
              "block_copy_paste",
              "Block copy, paste, right-click and text selection",
            ],
            ["require_fullscreen", "Run fullscreen, and record any exit"],
            ["shuffle_questions", "Shuffle question order per student"],
            ["shuffle_options", "Shuffle answer options per student"],
            ["allow_calculator", "Allow a scientific calculator during the exam"],
          ].map(([field, label]) => (
            <label
              key={field}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                fontSize: 14,
                marginBottom: 10,
              }}
            >
              <input
                type="checkbox"
                checked={exam[field]}
                onChange={setExamField(field)}
              />
              {label}
            </label>
          ))}

          <Field
            label="Violations before disqualification"
            hint="Each blocked action, tab switch or fullscreen exit counts as one. Set to 0 to warn without ever disqualifying."
          >
            <input
              type="number"
              min="0"
              className="input"
              style={{ maxWidth: 120 }}
              value={exam.max_violations}
              onChange={setExamField("max_violations")}
            />
          </Field>
        </Card>

        {questions.map((question, qi) => (
          <div className="q-card" key={qi}>
            <div className="q-head">
              <span className="q-num">{`Question ${qi + 1}`}</span>
              <div className="btn-row">
                <Select
                  className="select"
                  style={{ width: "auto" }}
                  value={question.kind}
                  onChange={(v) => changeKind(qi, v)}
                  options={[
                    { value: "multiple_choice", label: "Multiple choice" },
                    { value: "true_false", label: "True / false" },
                    { value: "short_answer", label: "Short answer" },
                  ]}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Remember saved questions so the edit can delete them.
                    if (question.id) setRemovedIds((ids) => [...ids, question.id]);
                    setQuestions((c) => c.filter((_, i) => i !== qi));
                  }}
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

            <Field label="Image" hint="Optional — a diagram, graph or equation students need to see.">
              {question.image_path ? (
                <div className="btn-row">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => preview.open(question.image_path, `Question ${qi + 1} image`)}
                  >
                    {"View image"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeQuestionImage(qi, question.image_path)}
                  >
                    {"Remove"}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={imageUploading[qi]}
                  onClick={() => imageInputs.current[qi]?.click()}
                >
                  {imageUploading[qi] ? "Uploading..." : "Attach an image"}
                </Button>
              )}
              <input
                ref={(el) => { imageInputs.current[qi] = el; }}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  attachQuestionImage(qi, e.target.files?.[0]);
                  e.target.value = "";
                }}
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
                  onChange={(e) =>
                    patchQuestion(qi, { answer_key: e.target.value })
                  }
                />
              </Field>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <span
                  className="label"
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontSize: 13.5,
                    fontWeight: 550,
                  }}
                >
                  {"Options — select the correct one"}
                </span>
                {question.options.map((option, oi) => (
                  <div
                    key={oi}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
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
                      onChange={(e) =>
                        patchOption(qi, oi, { body: e.target.value })
                      }
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => addOption(qi)}
                  >
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
          <Button
            variant="secondary"
            onClick={() => setQuestions((c) => [...c, blankQuestion()])}
          >
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
          <Button
            variant="secondary"
            onClick={() => handleSave(false)}
            disabled={saving}
          >
            {"Save as draft"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            disabled={saving}
          >
            {"Cancel"}
          </Button>
        </div>
      </Page>
      {preview.node}
    </div>
  );
};

export default ExamBuilder;
