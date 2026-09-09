import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchStudentReport,
  fetchStudentMarks,
  fetchReportableStudents,
  fetchGuardiansOf,
} from "../../lib/api";
import { analyse, marksAsSeries, bandFor } from "../../lib/analysis";
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
      const [report, marksRows, people, guardianRows] = await Promise.all([
        fetchStudentReport(studentId),
        fetchStudentMarks(studentId),
        fetchReportableStudents(schoolId),
        fetchGuardiansOf(studentId).catch(() => []),
      ]);
      setRows(report);
      setMarks(marksRows);
      setGuardians(guardianRows);
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

  if (!report.hasData) {
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

  const participation = report.courses
    .filter((c) => c.messages_sent > 0)
    .map((c) => ({ label: c.course_code, value: c.messages_sent }));

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={name}
        subtitle={`Report across ${report.courses.length} course${report.courses.length === 1 ? "" : "s"}`}
        action={
          <Button variant="secondary" onClick={() => window.print()}>
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
              value: report.totalMessages,
              note: "posts across all streams",
            },
          ]}
        />

        {/* The judgement comes before the charts: a parent wants to know what
            to do, and only then the evidence behind it. */}
        {report.findings.length ? (
          <section className="section" style={{ marginTop: 8 }}>
            <h2>{"What this shows"}</h2>
            {report.findings.map((f) => (
              <Finding key={f.title} finding={f} />
            ))}
          </section>
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
