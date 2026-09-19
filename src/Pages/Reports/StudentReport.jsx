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
import {
  StatRow,
  CourseBars,
  TurnInBar,
  TrendLine,
  ParticipationDonut,
} from "../../Components/Charts";
import {
  Page,
  Card,
  Badge,
  Notice,
  Empty,
  Button,
  displayName,
  formatDate,
} from "../../Components/UI";

const Finding = ({ finding }) => (
  <div className={`finding ${finding.kind}`}>
    <div>
      <div className="finding-title">{finding.title}</div>
      <div className="finding-detail">{finding.detail}</div>
    </div>
  </div>
);

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
  const [showTable, setShowTable] = useState(false);
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

  const name = student
    ? displayName({
        first_name: student.first_name,
        surname: student.surname,
        email: student.email,
      })
    : "Student";

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page><Empty>{"Building report..."}</Empty></Page>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Report">
          <Notice tone="error">{error}</Notice>
        </Page>
      </div>
    );
  }

  if (!report.hasData && !attendance.hasData) {
    return (
      <div className="shell">
        <Navbar />
        <Page title={name} subtitle="Student report">
          <Empty>
            {"Not enrolled in any course yet, so there is nothing to report on."}
          </Empty>
        </Page>
      </div>
    );
  }

  const band = bandFor(report.average);

  const courseBars = report.courses.map((c) => ({
    label: c.course_code,
    value: c.score,
    detail: [
      c.course_title || c.course_code,
      c.assignmentPct !== null ? `Assignments ${c.assignmentPct}%` : "No marked assignments",
      c.examPct !== null ? `Exams ${c.examPct}%` : "No exams sat",
      `${c.assignments_done} of ${c.assignments_set} turned in`,
    ],
    color:
      c.score === null
        ? "var(--grid)"
        : c.score < 50
        ? "var(--c3)"
        : "var(--c1)",
  }));

  // Contribution, not raw post count — otherwise a student who takes part by
  // reacting rather than writing disappears from this chart entirely, which
  // is the exact blind spot reactions were added to close.
  const participation = report.courses
    .filter((c) => c.contribution > 0)
    .map((c) => ({
      label: c.course_code,
      value: Math.round(c.contribution * 10) / 10,
    }));

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={name}
        subtitle={`Report across ${report.courses.length} course${report.courses.length === 1 ? "" : "s"}`}
        action={
          <Button onClick={() => window.print()} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon icon={printer} size={16} />
            {"Print"}
          </Button>
        }
      >
        <StatRow
          stats={[
            {
              label: "Overall average",
              value: report.average === null ? "—" : `${report.average}%`,
              note: band?.label,
            },
            {
              label: "Work turned in",
              value: report.turnIn === null ? "—" : `${report.turnIn}%`,
              note: `${report.totalDone} of ${report.totalSet} assignments`,
            },
            {
              label: "On time",
              value: report.punctuality === null ? "—" : `${report.punctuality}%`,
              note: "of what was submitted",
            },
            {
              label: "Class contributions",
              value: report.totalContribution,
              note:
                report.totalReactions > 0
                  ? `${report.totalMessages} posts and ${report.totalReactions} reactions`
                  : "posts across all streams",
            },
          ]}
        />

        {/* The judgement comes before the charts: a parent wants to know what
            to do, and only then the evidence behind it. Academic and
            attendance findings share one list — a parent reading "what this
            shows" should not have to check two separate places for concerns. */}
        {report.findings.length || attendance.findings.length ? (
          <section className="section" style={{ marginTop: 8 }}>
            <h2>{"What this shows"}</h2>
            {[...report.findings, ...attendance.findings].map((f) => (
              <Finding key={f.title} finding={f} />
            ))}
          </section>
        ) : null}

        {attendance.hasData ? (
          <Card style={{ marginTop: 8 }}>
            <div className="page-head" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{"Attendance"}</h3>
              <Button variant="secondary" size="sm" onClick={() => setShowAttendanceDetail((v) => !v)}>
                {showAttendanceDetail ? "Hide details" : "View full details"}
              </Button>
            </div>
            <div className="split">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{"Class attendance"}</span>
                  <Badge tone={attendance.classBand.tone}>{attendance.classBand.label}</Badge>
                </div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {attendance.classAttendanceRate === null ? "—" : `${attendance.classAttendanceRate}%`}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {attendance.sessionsRecorded === 0
                    ? "No class sessions marked yet."
                    : `Present in ${attendance.presentCount} of ${attendance.sessionsRecorded} recorded sessions.`}
                </div>
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{"School attendance"}</span>
                  <Badge tone={attendance.schoolBand.tone}>{attendance.schoolBand.label}</Badge>
                </div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {attendance.schoolAttendanceRate === null ? "—" : `${attendance.schoolAttendanceRate}%`}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {attendance.averageResumptionTime
                    ? `Usually resumes around ${attendance.averageResumptionTime}.`
                    : "No resumption scans recorded yet."}
                </div>
              </div>
            </div>

            {showAttendanceDetail ? (
              <div className="table-wrap" style={{ marginTop: 18 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{"Date & time"}</th>
                      <th>{"Kind"}</th>
                      <th>{"Detail"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...classAttendance.map((r) => ({
                        id: `class-${r.id}`,
                        at: r.session_at,
                        kind: "Class attendance",
                        detail: `${r.classes?.name || "Class"} — ${r.status === "present" ? "Present" : "Absent"}`,
                      })),
                      ...schoolAttendance.map((r) => ({
                        id: `school-${r.id}`,
                        at: r.resumed_at,
                        kind: "School resumption",
                        detail: r.source === "manual" ? "Logged manually" : "Biometric / card scan",
                      })),
                    ]
                      .sort((a, b) => new Date(b.at) - new Date(a.at))
                      .map((row) => (
                        <tr key={row.id}>
                          <td>{formatDate(row.at)}</td>
                          <td>{row.kind}</td>
                          <td>{row.detail}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
        ) : null}

        <div className="split" style={{ marginTop: 30 }}>
          <Card>
            <h3>{"Performance by course"}</h3>
            <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
              {"Assignments and exams combined, weighted 40 / 60. Grey means nothing marked yet."}
            </p>
            {report.hasMarks ? (
              <CourseBars rows={courseBars} />
            ) : (
              <Empty>{"Nothing has been marked yet."}</Empty>
            )}
          </Card>

          <Card>
            <h3>{"Assignments"}</h3>
            {report.totalSet > 0 ? (
              <TurnInBar
                done={report.totalDone}
                missing={report.totalSet - report.totalDone}
              />
            ) : (
              <Empty>{"None set yet."}</Empty>
            )}
          </Card>
        </div>

        {series.length >= 2 ? (
          <Card style={{ marginTop: 20 }}>
            <h3>{"Marks over time"}</h3>
            <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
              {"Every marked assignment and exam, in the order they happened. The dashed line is 50%."}
            </p>
            <TrendLine points={series} />
          </Card>
        ) : null}

        {participation.length ? (
          <Card style={{ marginTop: 20 }}>
            <h3>{"Where they contribute"}</h3>
            <ParticipationDonut rows={participation} />
          </Card>
        ) : null}

        <section className="section">
          <div className="page-head" style={{ marginBottom: 12 }}>
            <h2>{"Course detail"}</h2>
            <Button variant="secondary" size="sm" onClick={() => setShowTable((v) => !v)}>
              {showTable ? "Hide table" : "Show table"}
            </Button>
          </div>

          {/* The table is the accessible equivalent of every chart above. */}
          {showTable ? (
            <Card className="pad-0" style={{ padding: "4px 14px" }}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{"Course"}</th>
                      <th>{"Class"}</th>
                      <th>{"Score"}</th>
                      <th>{"Assignments"}</th>
                      <th>{"On time"}</th>
                      <th>{"Exams"}</th>
                      <th>{"Posts"}</th>
                      <th>{"Last active"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.courses.map((c) => {
                      const courseBand = bandFor(c.score);
                      return (
                        <tr key={c.course_id}>
                          <td>
                            <strong>{c.course_code}</strong>
                            <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
                              {c.course_title}
                            </div>
                          </td>
                          <td>{labelFor(c.level_year)}</td>
                          <td>
                            {c.score === null ? (
                              <span style={{ color: "var(--ink-3)" }}>{"—"}</span>
                            ) : (
                              <Badge tone={courseBand.tone}>{`${c.score}%`}</Badge>
                            )}
                          </td>
                          <td>{`${c.assignments_done} / ${c.assignments_set}`}</td>
                          <td>{c.punctualityPct === null ? "—" : `${c.punctualityPct}%`}</td>
                          <td>{c.exams_sat ? `${c.exam_score} / ${c.exam_max}` : "—"}</td>
                          <td>{c.messages_sent}</td>
                          <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                            {c.last_activity
                              ? formatDate(c.last_activity, { withTime: false })
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </section>

        {guardians.length ? (
          <section className="section">
            <h2>{"Guardians"}</h2>
            <Card>
              {guardians.map((g) => (
                <div key={g.id} style={{ marginBottom: 6 }}>
                  {displayName(g.guardian)}
                  {g.relationship ? (
                    <span style={{ color: "var(--ink-3)" }}>{` · ${g.relationship}`}</span>
                  ) : null}
                  <span style={{ color: "var(--ink-3)" }}>{` · ${g.guardian.email}`}</span>
                </div>
              ))}
            </Card>
          </section>
        ) : null}

        <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 28 }}>
          {"School fees are not part of this report yet — the bursary module is still to be built. "}
          <Link to="/Dashboard">{"Back to dashboard"}</Link>
        </p>
      </Page>
    </div>
  );
};

export default StudentReport;
