import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchChildCourses, fetchChildTeachers } from "../../lib/api";
import { useActionFeedback } from "../../Components/Toast";
import {
  Card,
  Badge,
  Button,
  Empty,
  SkeletonList,
  displayName,
  initials,
  formatDate,
} from "../../Components/UI";

// A metric, sized so three of them read as a set.
//
// Deliberately not a mark. Turn-in and punctuality say whether the work is
// going in; they say nothing about how it was scored, which is the school's to
// publish when it releases results.
const Metric = ({ label, value, suffix, tone }) => (
  <div className={`metric${tone ? ` ${tone}` : ""}`}>
    <div className="metric-value">
      {value === null || value === undefined ? "—" : `${value}${suffix || ""}`}
    </div>
    <div className="metric-label">{label}</div>
  </div>
);

const toneFor = (pct) => {
  if (pct === null || pct === undefined) return undefined;
  if (pct >= 80) return "good";
  if (pct >= 50) return "fair";
  return "poor";
};

const CourseRow = ({ course }) => (
  <div className="child-course">
    <div style={{ minWidth: 0 }}>
      <div className="child-course-head">
        <strong>{course.course_code}</strong>
        {course.session_name ? (
          <span className="child-course-session">{course.session_name}</span>
        ) : null}
      </div>
      <div className="child-course-title">
        {course.course_title || "No title yet"}
        {course.teacher_name ? (
          <span style={{ color: "var(--ink-3)" }}>{` · ${course.teacher_name}`}</span>
        ) : null}
      </div>
    </div>

    <div className="child-metrics">
      <Metric
        label="Work in"
        value={course.turn_in_pct}
        suffix="%"
        tone={toneFor(Number(course.turn_in_pct))}
      />
      <Metric
        label="On time"
        value={course.on_time_pct}
        suffix="%"
        tone={toneFor(Number(course.on_time_pct))}
      />
      <Metric label="Posts" value={course.posts} />
      <Metric label="Tests sat" value={course.exams_sat} />
    </div>
  </div>
);

// One child's courses and teachers, for a parent.
const ChildOverview = ({ child, relationship, schoolId }) => {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    if (!child?.id || !schoolId) return;
    setLoading(true);
    try {
      const [c, t] = await Promise.all([
        fetchChildCourses(child.id, schoolId),
        fetchChildTeachers(child.id, schoolId).catch(() => []),
      ]);
      setCourses(c);
      setTeachers(t);
    } catch (err) {
      setError(err.message || "Could not load this child's courses.");
    } finally {
      setLoading(false);
    }
  }, [child, schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const now = courses.filter((c) => c.is_current);
  const before = courses.filter((c) => !c.is_current);

  // Across everything they are doing this session.
  const setTotal = now.reduce((sum, c) => sum + Number(c.assignments_set || 0), 0);
  const doneTotal = now.reduce((sum, c) => sum + Number(c.assignments_done || 0), 0);
  const lateTotal = now.reduce((sum, c) => sum + Number(c.assignments_late || 0), 0);
  const overall = setTotal ? Math.round((doneTotal * 100) / setTotal) : null;
  const punctual = doneTotal
    ? Math.round(((doneTotal - lateTotal) * 100) / doneTotal)
    : null;
  const lastActive = courses
    .map((c) => c.last_active)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <Card style={{ marginBottom: 18 }}>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          {child.avatar_url ? (
            <img
              src={child.avatar_url}
              alt=""
              style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <span
              className="brand-mark"
              style={{ width: 44, height: 44, borderRadius: "50%", fontSize: 15 }}
            >
              {initials(child)}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 16 }}>{displayName(child)}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {relationship || "Your child"}
              {lastActive ? ` · last active ${formatDate(lastActive)}` : " · not active yet"}
            </div>
          </div>
        </div>

        <Link to={`/Reports/${child.id}`}>
          <Button variant="secondary" size="sm">
            {"Full report"}
          </Button>
        </Link>
      </div>

      {loading ? <SkeletonList rows={3} avatar={false} /> : null}

      {!loading && courses.length === 0 ? (
        <Empty>{"Not enrolled in any course yet."}</Empty>
      ) : null}

      {now.length ? (
        <>
          <div className="child-summary">
            <Metric label="Work handed in" value={overall} suffix="%" tone={toneFor(overall)} />
            <Metric label="On time" value={punctual} suffix="%" tone={toneFor(punctual)} />
            <Metric label="Courses now" value={now.length} />
          </div>

          <h4 className="child-heading">{"This session"}</h4>
          {now.map((c) => (
            <CourseRow key={c.course_id} course={c} />
          ))}
        </>
      ) : null}

      {before.length ? (
        <>
          <h4 className="child-heading">
            {"Earlier"}
            <button
              type="button"
              className="comment-toggle"
              style={{ marginLeft: 10, marginTop: 0 }}
              onClick={() => setShowPast((v) => !v)}
            >
              {showPast
                ? "Hide"
                : `${before.length} past course${before.length === 1 ? "" : "s"}`}
            </button>
          </h4>
          {showPast ? before.map((c) => <CourseRow key={c.course_id} course={c} />) : null}
        </>
      ) : null}

      {teachers.length ? (
        <>
          <h4 className="child-heading">{"Who teaches them"}</h4>
          <div className="teacher-list">
            {teachers.map((t) => (
              <div key={t.teacher_id} className="teacher-chip">
                {t.avatar_url ? (
                  <img src={t.avatar_url} alt="" className="nav-avatar" />
                ) : (
                  <span className="nav-avatar brand-mark">
                    {initials({ email: t.email, first_name: t.teacher_name })}
                  </span>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="teacher-name">
                    {t.teacher_name}
                    <Badge tone={t.teaching_now ? "success" : undefined}>
                      {t.teaching_now ? "now" : "before"}
                    </Badge>
                  </div>
                  <div className="teacher-courses">{t.courses}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {!loading && courses.length > 0 ? (
        <p className="child-foot">
          {"These are attendance-to-work figures, not marks. Termly results appear once the school releases them."}
        </p>
      ) : null}
    </Card>
  );
};

export default ChildOverview;
