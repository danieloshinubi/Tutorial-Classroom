import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchExams, updateExam, deleteExam } from "../../lib/api";
import { Card, Button, Badge, Notice, Empty, formatDate } from "../UI";

const ExamsTab = ({ courseId, canManage }) => {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    fetchExams(courseId)
      .then(setExams)
      .catch((err) => setError(err.message || "Could not load exams."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [courseId]);

  const togglePublished = async (exam) => {
    setError("");
    try {
      await updateExam(exam.id, { published: !exam.published });
      load();
    } catch (err) {
      setError(err.message || "Could not update that exam.");
    }
  };

  const handleDelete = async (exam) => {
    if (
      !window.confirm(
        `Delete "${exam.title}"? Every question and every student attempt goes with it.`
      )
    ) {
      return;
    }
    setError("");
    try {
      await deleteExam(exam.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that exam.");
    }
  };

  const windowLabel = (exam) => {
    const parts = [];
    if (exam.duration_mins) parts.push(`${exam.duration_mins} min`);
    if (exam.closes_at) parts.push(`closes ${formatDate(exam.closes_at)}`);
    return parts.join(" · ") || "No time limit";
  };

  return (
    <>
      {canManage ? (
        <div style={{ marginBottom: 16 }}>
          <Link to={`/Courses/${courseId}/Exams/New`}>
            <Button>{"Create exam"}</Button>
          </Link>
        </div>
      ) : null}

      <Notice tone="error">{error}</Notice>
      {loading ? <Empty>{"Loading exams..."}</Empty> : null}
      {!loading && exams.length === 0 ? (
        <Empty>
          {canManage
            ? "No exams yet — create one to get started."
            : "No exams or tests have been set for this course."}
        </Empty>
      ) : null}

      {exams.map((exam) => (
        <Card key={exam.id} style={{ marginBottom: 12 }}>
          <div className="page-head" style={{ marginBottom: 8 }}>
            <div>
              <strong style={{ fontSize: 16 }}>{exam.title}</strong>
              <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
                {windowLabel(exam)}
              </p>
            </div>
            <div className="btn-row">
              {exam.published ? (
                <Badge tone="success">{"published"}</Badge>
              ) : (
                <Badge tone="warn">{"draft"}</Badge>
              )}
            </div>
          </div>

          <div className="btn-row">
            {canManage ? (
              <>
                <Link to={`/Exams/${exam.id}/Results`}>
                  <Button variant="secondary" size="sm">{"Results"}</Button>
                </Link>
                <Button variant="secondary" size="sm" onClick={() => togglePublished(exam)}>
                  {exam.published ? "Unpublish" : "Publish"}
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(exam)}>
                  {"Delete"}
                </Button>
              </>
            ) : (
              <Link to={`/Exams/${exam.id}`}>
                <Button size="sm">{"Open"}</Button>
              </Link>
            )}
          </div>
        </Card>
      ))}
    </>
  );
};

export default ExamsTab;
