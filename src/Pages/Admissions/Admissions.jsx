import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchApplications,
  fetchAdmissionsSummary,
  fetchSessions,
  setSessionApplicationsOpen,
  APPLICATION_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
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

// Everything still waiting on somebody — the default view, because that is
// what an admissions officer opens this page for.
const OPEN = ["submitted", "screening", "offered", "accepted"];

// The queue.
const Admissions = () => {
  const { schoolId, school, labelFor, isAdmin } = useSchool();

  const [applications, setApplications] = useState([]);
  const [counts, setCounts] = useState({});
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("open");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [rows, summary, sess] = await Promise.all([
        fetchApplications({ schoolId }),
        fetchAdmissionsSummary(schoolId).catch(() => ({})),
        fetchSessions(schoolId).catch(() => []),
      ]);
      setApplications(rows);
      setCounts(summary);
      setSessions(sess);
    } catch (err) {
      setError(err.message || "Could not load applications.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return applications.filter((a) => {
      if (status === "open" && !OPEN.includes(a.status)) return false;
      if (status !== "open" && status !== "all" && a.status !== status) return false;
      if (!needle) return true;
      return [a.reference, a.first_name, a.surname, a.guardian_name, a.guardian_email]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [applications, status, query]);

  const openCount = OPEN.reduce((n, s) => n + (counts[s] || 0), 0);
  const acceptingSession = sessions.find((s) => s.applications_open);

  const toggleOpen = async (session, open) => {
    setBusy(true);
    setError("");
    try {
      await setSessionApplicationsOpen({ sessionId: session.id, open });
      load();
    } catch (err) {
      setError(err.message || "Could not change that.");
    } finally {
      setBusy(false);
    }
  };

  const applyUrl = school ? `${window.location.origin}/Apply` : "/Apply";

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Admissions"
        subtitle={loading ? "" : `${openCount} awaiting a decision`}
        action={
          <a href="/Apply" target="_blank" rel="noreferrer noopener">
            <Button variant="secondary">{"View the public form"}</Button>
          </a>
        }
      >
        <Notice tone="error">{error}</Notice>

        {/* Whether the school is taking applications at all — the first thing
            to check when the queue is unexpectedly empty. */}
        <Card style={{ marginBottom: 20 }}>
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div>
              <strong>
                {acceptingSession
                  ? `Accepting applications for ${acceptingSession.name}`
                  : "Not accepting applications"}
              </strong>
              <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-3)" }}>
                {acceptingSession
                  ? "The public form is live and anyone with the link can apply."
                  : "The public form will turn people away until a session is open."}
              </p>
            </div>
            {isAdmin && sessions.length ? (
              <div className="btn-row">
                {acceptingSession ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => toggleOpen(acceptingSession, false)}
                  >
                    {"Close applications"}
                  </Button>
                ) : (
                  sessions.slice(0, 3).map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      disabled={busy}
                      onClick={() => toggleOpen(s, true)}
                    >
                      {`Open for ${s.name}`}
                    </Button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {acceptingSession ? (
            <div className="file-chip" style={{ marginTop: 14, maxWidth: 460 }}>
              <span style={{ flex: 1, fontFamily: "monospace", fontSize: 13 }}>
                {applyUrl}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(applyUrl).catch(() => {})}
              >
                {"Copy link"}
              </Button>
            </div>
          ) : null}

          {!sessions.length ? (
            <Notice tone="error">
              {"There are no sessions yet. Add one under School → Calendar before opening admissions."}
            </Notice>
          ) : null}
        </Card>

        <div className="btn-row" style={{ marginBottom: 16 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="Search name, reference or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="select"
            style={{ width: "auto" }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">{`Needs a decision (${openCount})`}</option>
            <option value="all">{`Everything (${applications.length})`}</option>
            {APPLICATION_STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {`${label} (${counts[value] || 0})`}
              </option>
            ))}
          </select>
        </div>

        {loading ? <Empty>{"Loading applications..."}</Empty> : null}

        {!loading && applications.length === 0 ? (
          <Empty>
            {"No applications yet. Share the link above and they will appear here."}
          </Empty>
        ) : null}

        {!loading && applications.length > 0 && filtered.length === 0 ? (
          <Empty>{"Nothing matches that filter."}</Empty>
        ) : null}

        {filtered.length > 0 ? (
          <Card className="pad-0" style={{ padding: "4px 14px" }}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{"Reference"}</th>
                    <th>{"Applicant"}</th>
                    <th>{"Class"}</th>
                    <th>{"Guardian"}</th>
                    <th>{"Status"}</th>
                    <th>{"Received"}</th>
                    <th>{""}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id}>
                      <td style={{ whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 13 }}>
                        {a.reference}
                      </td>
                      <td>
                        <strong>{`${a.first_name} ${a.surname}`}</strong>
                        {a.date_of_birth ? (
                          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                            {`Born ${formatDate(a.date_of_birth, { withTime: false })}`}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {a.applying_for_level == null
                          ? "—"
                          : labelFor(a.applying_for_level)}
                      </td>
                      <td>
                        {a.guardian_name}
                        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                          {a.guardian_phone || a.guardian_email}
                        </div>
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[a.status]}>
                          {STATUS_LABEL[a.status]}
                        </Badge>
                      </td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                        {formatDate(a.created_at, { withTime: false })}
                      </td>
                      <td>
                        <Link to={`/Admissions/${a.id}`}>
                          <Button variant="secondary" size="sm">{"Open"}</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </Page>
    </div>
  );
};

export default Admissions;
