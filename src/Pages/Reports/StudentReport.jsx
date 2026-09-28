import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { printer } from "react-icons-kit/feather/printer";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchStudentReport,
  fetchStudentMarks,
  fetchReportableStudents,
  fetchGuardiansOf,
  fetchStudentClassAttendance,
  fetchSchoolAttendanceRecords,
} from "../../lib/api";
import { analyse, marksAsSeries, bandFor, analyseAttendance } from "../../lib/analysis";
import { TrendLine, ParticipationDonut } from "../../Components/Charts";
import {
  Page,
  Badge,
  Notice,
  Button,
  SkeletonStatRow,
  SkeletonCards,
  displayName,
  formatDate,
} from "../../Components/UI";

// One student's report, laid out like a report card rather than a column of
// charts.
//
// What changed, and why:
//   * The four headline figures sit in one strip at the top, each with the
//     one piece of context that makes it readable — the grade band beside the
//     average, a bar beside "handed in".
//   * The per-course breakdown is visible by default. It used to be split
//     between a bar chart and a table hidden behind "Show table", so the most
//     useful part of the report was the part nobody saw. The rows are text,
//     so they are also the accessible version of every chart on the page.
//   * Evidence (attendance, participation, who the guardians are) moves to a
//     side column beside the judgement, instead of trailing below it. The
//     guardians were at the very bottom.
//   * Printing produces the report on A4 without the app around it (see the
//     .sr-shell print rules). Before, the app's fixed-height window meant
//     Print sent the sidebar and only the first screenful.
//   * Removed the footnote saying fees were not included because "the
//     bursary module is still to be built" — it has been built.

// Concerns first, then things to watch, then strengths: a parent reading this
// wants to know what to act on before what is going well.
const FINDING_ORDER = { concern: 0, watch: 1, strength: 2 };
const FINDING_GROUP = { concern: "Needs attention", watch: "Worth watching", strength: "Going well" };

const handInTone = (pct) => (pct === null ? "" : pct >= 90 ? "success" : pct >= 70 ? "brand" : "warn");

const Stat = ({ label, value, muted, children }) => (
  <div className="sr-stat">
    <div className="sr-stat-label">{label}</div>
    <div className={`sr-stat-value${muted ? " muted" : ""}`}>{value}</div>
    {children ? <div className="sr-stat-note">{children}</div> : null}
  </div>
);

const Bar = ({ pct, tone }) => (
  <span className="sr-bar" aria-hidden="true">
    <span className={`sr-bar-fill tone-${tone || "none"}`} style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%` }} />
  </span>
);

const CourseRow = ({ c, labelFor }) => {
  const band = bandFor(c.score);
  const turnIn = c.assignments_set ? Math.round((c.assignments_done / c.assignments_set) * 100) : null;
  return (
    <div className="sr-course" role="listitem">
      <div className="sr-course-id">
        <div className="sr-course-code">{c.course_code}</div>
        <div className="sr-course-title">
          {[c.course_title, c.level_year ? labelFor(c.level_year) : null].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div className="sr-course-score">
        <span className={`sr-course-figure${c.score === null ? " muted" : ""}`}>
          {c.score === null ? "—" : `${c.score}%`}
        </span>
        <Badge tone={band.tone}>{band.label}</Badge>
      </div>

      <dl className="sr-course-facts">
        <div>
          <dt>{"Assignments"}</dt>
          <dd>
            {c.assignments_set ? (
              <>
                <span>{`${c.assignments_done} of ${c.assignments_set} in`}</span>
                <Bar pct={turnIn} tone={handInTone(turnIn)} />
              </>
            ) : (
              <span className="muted">{"None set"}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{"Assignment marks"}</dt>
          <dd>{c.assignmentPct === null ? <span className="muted">{"Not marked"}</span> : `${c.assignmentPct}%`}</dd>
        </div>
        <div>
          <dt>{"Exams"}</dt>
          <dd>
            {c.exams_sat ? (
              `${c.exam_score} / ${c.exam_max}${c.examPct !== null ? ` · ${c.examPct}%` : ""}`
            ) : (
              <span className="muted">{"None sat"}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{"On time"}</dt>
          <dd>{c.punctualityPct === null ? <span className="muted">{"—"}</span> : `${c.punctualityPct}%`}</dd>
        </div>
        <div>
          <dt>{"Last active"}</dt>
          <dd>
            {c.last_activity ? (
              formatDate(c.last_activity, { withTime: false })
            ) : (
              <span className="muted">{"Not yet"}</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
};

const StudentReport = () => {
  const { studentId } = useParams();
  const { user } = useAuth();
  const { schoolId, labelFor } = useSchool();

  const [student, setStudent] = useState(null);
  const [rows, setRows] = useState([]);
  const [marks, setMarks] = useState([]);
  const [guardians, setGuardians] = useState([]);
  const [classAttendance, setClassAttendance] = useState([]);
  const [schoolAttendance, setSchoolAttendance] = useState([]);
  const [showAttendanceDetail, setShowAttendanceDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    // Waiting for the school: without this the query goes out with
    // school_id=eq.null and Postgres rejects "null" as a uuid.
    if (!studentId || !schoolId) return;
    setLoading(true);
    setError("");
    try {
      const [report, marksRows, people, guardianRows, classAttendanceRows, schoolAttendanceRows] = await Promise.all([
        fetchStudentReport(studentId, schoolId),
        fetchStudentMarks(studentId, schoolId),
        fetchReportableStudents(schoolId),
        fetchGuardiansOf(studentId, schoolId).catch(() => []),
        fetchStudentClassAttendance(studentId, schoolId).catch(() => []),
        fetchSchoolAttendanceRecords({ schoolId, personId: studentId }).catch(() => []),
      ]);
      setRows(report);
      setMarks(marksRows);
      setGuardians(guardianRows);
      setClassAttendance(classAttendanceRows);
      setSchoolAttendance(schoolAttendanceRows);
      setStudent(
        people.find((p) => p.student_id === studentId) ||
          (studentId === user?.id ? { student_id: user.id, email: user.email } : null)
      );
    } catch (err) {
      setError(err.message || "Could not build this report.");
    } finally {
      setLoading(false);
    }
  }, [studentId, schoolId, user]);

  useEffect(() => {
    load();
  }, [load]);

  const report = useMemo(() => analyse(rows, marks), [rows, marks]);
  const series = useMemo(() => marksAsSeries(marks), [marks]);
  const attendance = useMemo(
    () => analyseAttendance(classAttendance, schoolAttendance),
    [classAttendance, schoolAttendance]
  );

  const person = student
    ? { first_name: student.first_name, surname: student.surname, email: student.email }
    : null;
  const name = person ? displayName(person) : "Student";

  // The year groups the courses belong to — "JSS 2", or "JSS 2, JSS 3" for a
  // student taking a course above their year.
  const levels = [...new Set(report.courses.map((c) => c.level_year).filter(Boolean))]
    .sort((a, b) => a - b)
    .map((y) => labelFor(y));

  const findings = [...report.findings, ...attendance.findings].sort(
    (a, b) => (FINDING_ORDER[a.kind] ?? 3) - (FINDING_ORDER[b.kind] ?? 3)
  );

  const participation = report.courses
    .filter((c) => c.contribution > 0)
    .map((c) => ({ label: c.course_code, value: Math.round(c.contribution * 10) / 10 }));

  const records = [
    ...classAttendance.map((r) => ({
      id: `class-${r.id}`,
      at: r.session_at,
      kind: r.classes?.name || "Class",
      detail: r.status === "present" ? "Present" : "Absent",
      absent: r.status !== "present",
    })),
    ...schoolAttendance.map((r) => ({
      id: `school-${r.id}`,
      at: r.resumed_at,
      kind: "Arrived at school",
      detail: r.source === "manual" ? "Logged by staff" : "Card or fingerprint",
      absent: false,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const shellClass = "shell sr-shell";

  const backLink = (
    <Link to="/Reports" className="sr-back sr-no-print">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {"All reports"}
    </Link>
  );

  if (loading) {
    return (
      <div className={shellClass}>
        <Navbar />
        <Page title="Report" subtitle="Building the report...">
          <SkeletonStatRow count={4} />
          <SkeletonCards count={3} lines={3} />
        </Page>
      </div>
    );
  }

  if (error) {
    return (
      <div className={shellClass}>
        <Navbar />
        <Page title="Report">
          {backLink}
          <Notice tone="error">{error}</Notice>
        </Page>
      </div>
    );
  }

  if (!report.hasData && !attendance.hasData) {
    return (
      <div className={shellClass}>
        <Navbar />
        <Page title={name} subtitle="Student report">
          {backLink}
          <div className="sr-empty">
            <strong>{"Nothing to report yet"}</strong>
            <span>{"This student is not on any course and has no attendance recorded, so there is nothing to show."}</span>
          </div>
        </Page>
      </div>
    );
  }

  const band = bandFor(report.average);
  const courseCount = report.courses.length;

  return (
    <div className={shellClass}>
      <Navbar />
      <Page
        title={name}
        subtitle={[
          levels.join(", ") || null,
          `${courseCount} course${courseCount === 1 ? "" : "s"}`,
          `Report as of ${formatDate(new Date().toISOString(), { withTime: false })}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Button className="sr-no-print" variant="secondary" onClick={() => window.print()} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon icon={printer} size={16} />
            {"Print"}
          </Button>
        }
      >
        {backLink}

        <div className="sr-stats">
          <Stat
            label="Overall average"
            value={report.average === null ? "—" : `${report.average}%`}
            muted={report.average === null}
          >
            <Badge tone={band.tone}>{band.label}</Badge>
          </Stat>
          <Stat
            label="Work handed in"
            value={report.totalSet ? `${report.totalDone} of ${report.totalSet}` : "—"}
            muted={!report.totalSet}
          >
            {report.totalSet ? (
              <>
                <Bar pct={report.turnIn} tone={handInTone(report.turnIn)} />
                <span>{`${report.turnIn}% of assignments set`}</span>
              </>
            ) : (
              <span>{"No assignments set yet"}</span>
            )}
          </Stat>
          <Stat
            label="On time"
            value={report.punctuality === null ? "—" : `${report.punctuality}%`}
            muted={report.punctuality === null}
          >
            <span>{report.punctuality === null ? "Nothing handed in yet" : "of the work handed in"}</span>
          </Stat>
          {attendance.hasData ? (
            <Stat
              label="Class attendance"
              value={attendance.classAttendanceRate === null ? "—" : `${attendance.classAttendanceRate}%`}
              muted={attendance.classAttendanceRate === null}
            >
              <Badge tone={attendance.classBand.tone}>{attendance.classBand.label}</Badge>
            </Stat>
          ) : (
            <Stat label="Class contributions" value={report.totalContribution} muted={!report.totalContribution}>
              <span>
                {report.totalReactions > 0
                  ? `${report.totalMessages} posts, ${report.totalReactions} reactions`
                  : `${report.totalMessages} posts on class streams`}
              </span>
            </Stat>
          )}
        </div>

        <div className="sr-body">
          <div className="sr-main">
            {findings.length ? (
              <section className="sr-card">
                <h2 className="sr-card-title">{"What this shows"}</h2>
                {findings.map((f, i) => (
                  <React.Fragment key={`${f.kind}-${f.title}`}>
                    {i === 0 || findings[i - 1].kind !== f.kind ? (
                      <div className="sr-finding-group">{FINDING_GROUP[f.kind] || "Notes"}</div>
                    ) : null}
                    <div className={`finding ${f.kind}`}>
                      <div>
                        <div className="finding-title">{f.title}</div>
                        <div className="finding-detail">{f.detail}</div>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </section>
            ) : null}

            {courseCount ? (
              <section className="sr-card">
                <div className="sr-card-head">
                  <h2 className="sr-card-title">{"Courses"}</h2>
                  <span className="sr-card-hint">
                    {"Score blends assignments and exams, 40 / 60. Only marked work counts."}
                  </span>
                </div>
                <div className="sr-courses" role="list">
                  {report.courses.map((c) => (
                    <CourseRow key={c.course_id} c={c} labelFor={labelFor} />
                  ))}
                </div>
              </section>
            ) : null}

            {series.length >= 2 ? (
              <section className="sr-card">
                <div className="sr-card-head">
                  <h2 className="sr-card-title">{"Marks over time"}</h2>
                  <span className="sr-card-hint">
                    {"Every marked assignment and exam, in order. The dashed line is 50%."}
                  </span>
                </div>
                <TrendLine points={series} />
              </section>
            ) : null}
          </div>

          <aside className="sr-aside">
            {attendance.hasData ? (
              <section className="sr-card">
                <h2 className="sr-card-title">{"Attendance"}</h2>
                <div className="sr-att">
                  <div className="sr-att-row">
                    <span className="sr-att-label">{"In class"}</span>
                    <span className="sr-att-value">
                      {attendance.classAttendanceRate === null ? "—" : `${attendance.classAttendanceRate}%`}
                    </span>
                    <Badge tone={attendance.classBand.tone}>{attendance.classBand.label}</Badge>
                  </div>
                  <div className="sr-att-note">
                    {attendance.sessionsRecorded === 0
                      ? "No class sessions marked yet."
                      : `Present at ${attendance.presentCount} of ${attendance.sessionsRecorded} recorded sessions.`}
                  </div>
                  <div className="sr-att-row">
                    <span className="sr-att-label">{"At school"}</span>
                    <span className="sr-att-value">
                      {attendance.schoolAttendanceRate === null ? "—" : `${attendance.schoolAttendanceRate}%`}
                    </span>
                    <Badge tone={attendance.schoolBand.tone}>{attendance.schoolBand.label}</Badge>
                  </div>
                  <div className="sr-att-note">
                    {attendance.averageResumptionTime
                      ? `Usually arrives around ${attendance.averageResumptionTime}.`
                      : "No arrival scans recorded yet."}
                  </div>
                </div>

                {records.length ? (
                  <>
                    <button
                      type="button"
                      className="sr-link sr-no-print"
                      onClick={() => setShowAttendanceDetail((v) => !v)}
                      aria-expanded={showAttendanceDetail}
                    >
                      {showAttendanceDetail ? "Hide records" : `Show all ${records.length} records`}
                    </button>
                    {showAttendanceDetail ? (
                      <ul className="sr-records">
                        {records.map((r) => (
                          <li key={r.id}>
                            <span className="sr-record-when">{formatDate(r.at)}</span>
                            <span className="sr-record-what">
                              {r.kind}
                              {" · "}
                              <span className={r.absent ? "sr-absent" : undefined}>{r.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}

            {participation.length ? (
              <section className="sr-card">
                <h2 className="sr-card-title">{"Where they take part"}</h2>
                <p className="sr-card-hint" style={{ margin: "0 0 12px" }}>
                  {report.totalReactions > 0
                    ? `${report.totalMessages} posts and ${report.totalReactions} reactions across class streams. Four reactions count as one post.`
                    : `${report.totalMessages} posts across class streams.`}
                </p>
                <ParticipationDonut rows={participation} />
              </section>
            ) : null}

            <section className="sr-card">
              <h2 className="sr-card-title">{guardians.length === 1 ? "Guardian" : "Guardians"}</h2>
              {guardians.length ? (
                <ul className="sr-people">
                  {guardians.map((g) => (
                    <li key={g.id}>
                      <span className="sr-person-name">{displayName(g.guardian)}</span>
                      <span className="sr-person-meta">
                        {[g.relationship, g.guardian?.email].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sr-card-hint" style={{ margin: 0 }}>
                  {"No guardian is linked to this student. The school office links them under School admin → Parents & children."}
                </p>
              )}
            </section>
          </aside>
        </div>
      </Page>
    </div>
  );
};

export default StudentReport;
