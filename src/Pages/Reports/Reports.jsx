import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { fetchReportOverview } from "../../lib/api";
import { analyse, bandFor } from "../../lib/analysis";
import { useActionFeedback } from "../../Components/Toast";
import {
  Page,
  Button,
  Badge,
  Select,
  SkeletonTable,
  displayName,
  initials,
  formatDate,
} from "../../Components/UI";

// Everyone this viewer may report on — a parent their children, a tutor the
// students on their courses, an administrator the school — and how each is
// actually doing.
//
// This page used to be a grid of name-and-email cards under "How your
// students are progressing", with no progress anywhere on it: to find who was
// struggling you opened every student in turn. Now each row carries the
// figures from that student's own report — the average and its grade band,
// how much work is handed in, how much arrives on time, when they were last
// active — computed by the same analyse() the report page uses, over the same
// per-course rows (report_overview in supabase/179), so the two always agree.
//
// The filters across the top are the questions a teacher or head actually
// asks — who needs attention, who has work missing, who has not been marked
// yet — each with its count, so the answer is visible before clicking.

// A week without any activity is worth noticing; a month is worth acting on.
const DAY = 24 * 60 * 60 * 1000;
const since = (value) => {
  if (!value) return { text: "No activity yet", days: Infinity };
  const days = Math.floor((Date.now() - new Date(value).getTime()) / DAY);
  let text;
  if (days <= 0) text = "Today";
  else if (days === 1) text = "Yesterday";
  else if (days < 14) text = `${days} days ago`;
  else if (days < 60) text = `${Math.floor(days / 7)} weeks ago`;
  else text = formatDate(value, { withTime: false });
  return { text, days };
};

// Each filter carries what to say when it is empty, because an empty
// "Needs attention" is good news and should read like it.
const FILTERS = [
  {
    id: "all",
    label: "Everyone",
    test: () => true,
    clear: ["Nobody here", "No students to show."],
  },
  {
    id: "attention",
    label: "Needs attention",
    test: (s) => s.report.findings.some((f) => f.kind === "concern"),
    clear: ["No one needs attention", "No student has a concern flagged on their report."],
  },
  {
    id: "missing",
    label: "Missing work",
    test: (s) => s.missing > 0,
    clear: ["No work missing", "Every student has handed in everything set so far."],
  },
  {
    id: "unmarked",
    label: "Not yet marked",
    test: (s) => s.report.hasData && !s.report.hasMarks,
    clear: ["Everyone has marks", "Every student on a course has at least one mark."],
  },
  {
    id: "nocourses",
    label: "Not on a course",
    test: (s) => !s.report.hasData,
    clear: ["Everyone is on a course", "No student is missing a course."],
  },
];

const SORTS = [
  { value: "name", label: "Sort: name" },
  { value: "score", label: "Sort: lowest average first" },
  { value: "missing", label: "Sort: most work missing" },
  { value: "quiet", label: "Sort: longest since active" },
];

// Unmarked students sort after marked ones when sorting by score: "no score"
// is not the same as "the lowest score", and putting them first would bury
// the students who are genuinely struggling.
const compare = {
  name: (a, b) => a.name.localeCompare(b.name),
  score: (a, b) => (a.report.average ?? 101) - (b.report.average ?? 101) || a.name.localeCompare(b.name),
  missing: (a, b) => b.missing - a.missing || a.name.localeCompare(b.name),
  quiet: (a, b) => b.idle.days - a.idle.days || a.name.localeCompare(b.name),
};

// Colour for the hand-in bar, on the same thresholds analyse() raises a
// concern at (under 70% handed in).
const handInTone = (pct) => (pct === null ? "" : pct >= 90 ? "success" : pct >= 70 ? "brand" : "warn");

const Avatar = ({ student }) =>
  student.avatar_url ? (
    <img className="rp-avatar" src={student.avatar_url} alt="" />
  ) : (
    <span className="rp-avatar brand-mark" aria-hidden="true">
      {initials(student)}
    </span>
  );

const Chevron = () => (
  <svg className="rp-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const StudentRow = ({ s }) => {
  const { report } = s;
  const band = bandFor(report.average);
  const concern = report.findings.find((f) => f.kind === "concern");
  const courses = report.courses.length;

  return (
    <Link to={`/Reports/${s.student_id}`} className="rp-row">
      <span className="rp-who">
        <Avatar student={s} />
        <span className="rp-who-text">
          <span className="rp-name">{s.name}</span>
          <span className="rp-meta">
            {[
              s.relationship,
              s.class_name,
              courses ? `${courses} course${courses === 1 ? "" : "s"}` : "No courses yet",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {/* The one line from the report that says what to do about it. */}
          {concern ? <span className="rp-concern">{concern.title}</span> : null}
        </span>
      </span>

      <span className="rp-cell rp-score" data-label="Average">
        <span className={`rp-figure${report.average === null ? " none" : ""}`}>
          {report.average === null ? "—" : `${report.average}%`}
        </span>
        <Badge tone={band.tone}>{band.label}</Badge>
      </span>

      <span className="rp-cell" data-label="Handed in">
        {report.totalSet ? (
          <>
            <span className="rp-small">{`${report.totalDone} of ${report.totalSet}`}</span>
            <span className="rp-bar" aria-hidden="true">
              <span
                className={`rp-bar-fill tone-${handInTone(report.turnIn) || "none"}`}
                style={{ width: `${Math.min(100, report.turnIn || 0)}%` }}
              />
            </span>
          </>
        ) : (
          <span className="rp-small muted">{"Nothing set"}</span>
        )}
      </span>

      <span className="rp-cell" data-label="On time">
        <span className={`rp-small${report.punctuality === null ? " muted" : report.punctuality < 60 ? " warn" : ""}`}>
          {report.punctuality === null ? "—" : `${report.punctuality}%`}
        </span>
      </span>

      <span className="rp-cell" data-label="Last active">
        <span className={`rp-small${s.idle.days >= 30 && s.idle.days !== Infinity ? " warn" : ""}${s.idle.days === Infinity ? " muted" : ""}`}>
          {s.idle.text}
        </span>
      </span>

      <Chevron />
    </Link>
  );
};

const RowList = ({ rows }) => (
  <div className="rp-list" role="list">
    <div className="rp-head" aria-hidden="true">
      <span>{"Student"}</span>
      <span>{"Average"}</span>
      <span>{"Handed in"}</span>
      <span>{"On time"}</span>
      <span>{"Last active"}</span>
      <span />
    </div>
    {rows.map((s) => (
      <StudentRow key={s.student_id} s={s} />
    ))}
  </div>
);

const Reports = () => {
  const { user } = useAuth();
  const { schoolId, isParent, isAdmin } = useSchool();

  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [klass, setKlass] = useState("");
  const [sort, setSort] = useState("name");
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  const load = useCallback(async () => {
    // Waiting for the school: without this the query goes out with
    // school_id=eq.null and Postgres rejects "null" as a uuid.
    if (!schoolId || !user) return;
    setLoading(true);
    try {
      setRows(await fetchReportOverview(schoolId));
    } catch (err) {
      setError(err.message || "Could not load students.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, user, setError]);

  useEffect(() => {
    load();
  }, [load]);

  // Analysed once per load, not per render: each student's figures come from
  // the same analyse() the report page runs.
  const students = useMemo(
    () =>
      rows.map((row) => {
        const report = analyse(row.courses || []);
        const lastActivity = (row.courses || [])
          .map((c) => c.last_activity)
          .filter(Boolean)
          .sort()
          .pop();
        return {
          ...row,
          name: displayName(row),
          report,
          missing: Math.max(0, report.totalSet - report.totalDone),
          idle: since(lastActivity),
        };
      }),
    [rows]
  );

  const children = students.filter((s) => s.is_my_child);
  const others = students.filter((s) => !s.is_my_child);

  const classes = useMemo(
    () => [...new Set(others.map((s) => s.class_name).filter(Boolean))].sort(),
    [others]
  );

  // Counts reflect the search and class already chosen, so each chip says how
  // many it will actually show.
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return others.filter((s) => {
      if (klass && s.class_name !== klass) return false;
      if (!needle) return true;
      return [s.name, s.email, s.class_name]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [others, query, klass]);

  const countFor = (id) => scoped.filter(FILTERS.find((f) => f.id === id).test).length;

  const shown = useMemo(() => {
    const test = (FILTERS.find((f) => f.id === filter) || FILTERS[0]).test;
    return scoped.filter(test).sort(compare[sort] || compare.name);
  }, [scoped, filter, sort]);

  const nothingAtAll = !loading && students.length === 0;
  const activeFilter = FILTERS.find((f) => f.id === filter) || FILTERS[0];

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Reports"
        subtitle={isParent ? "How your children are doing" : "How your students are progressing"}
      >
        {loading ? <SkeletonTable rows={5} cols={5} /> : null}

        {nothingAtAll ? (
          <div className="rp-empty-page">
            <strong>{isParent ? "No children linked yet" : "No students to report on yet"}</strong>
            <span>
              {isParent
                ? "Ask the school office to link your children to your account."
                : "Students appear here once they join a course you teach."}
            </span>
            {/* A student looking for their own progress. */}
            {!isParent && !isAdmin ? (
              <Link to={`/Reports/${user?.id}`}>
                <Button variant="secondary">{"See my own report"}</Button>
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Children first — a parent who also teaches should not have to hunt
            for their own child in a list of students. */}
        {!loading && children.length ? (
          <section className="rp-section">
            <h2 className="rp-title">{children.length === 1 ? "Your child" : "Your children"}</h2>
            <RowList rows={children} />
          </section>
        ) : null}

        {!loading && others.length ? (
          <section className="rp-section">
            <div className="panel-top rp-controls">
              <div className="rp-controls-row">
                <h2 className="rp-title">{isAdmin ? "All students" : "Your students"}</h2>
                <div className="rp-tools">
                  <input
                    className="input"
                    placeholder="Search students"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {classes.length > 1 ? (
                    <Select
                      className="select"
                      value={klass}
                      onChange={setKlass}
                      options={[
                        { value: "", label: "Every class" },
                        ...classes.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                  ) : null}
                  <Select className="select" value={sort} onChange={setSort} options={SORTS} />
                </div>
              </div>

              <div className="rp-filters" role="tablist" aria-label="Show">
                {FILTERS.map((f) => {
                  const count = countFor(f.id);
                  // "Not on a course" only appears when it applies; the
                  // others always show, so a zero reads as good news.
                  if (f.id === "nocourses" && count === 0 && filter !== f.id) return null;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={filter === f.id}
                      className={`rp-filter${filter === f.id ? " active" : ""}${f.id === "attention" && count ? " alert" : ""}`}
                      onClick={() => setFilter(f.id)}
                    >
                      <span>{f.label}</span>
                      <span className="rp-filter-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {shown.length ? (
              <RowList rows={shown} />
            ) : (
              <div className="rp-empty">
                <strong>{query || klass ? "Nobody matches" : activeFilter.clear[0]}</strong>
                <span>
                  {query || klass
                    ? "Try another name, or clear the class filter."
                    : activeFilter.clear[1]}
                </span>
              </div>
            )}
          </section>
        ) : null}
      </Page>
    </div>
  );
};

export default Reports;
