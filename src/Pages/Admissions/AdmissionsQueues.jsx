import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchAdmissionsQueues,
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
  Grid,
  Notice,
  Empty,
  Badge,
  Button,
  Select,
  formatDate,
} from "../../Components/UI";
import { useLiveApplicationsListUpdates, LiveUpdateBanner } from "../../Components/LiveUpdateBanner";

// The staff dashboard. Every queue the admissions team acts on — payment,
// documents, screening, action-required, review, interview, decision,
// clearance — comes back from admissions_queues() in one call, so the page
// shows work in the order the operations team wants to see it. Below that,
// the session controls (open/close the public form) and the full roster
// (every application, any status, searchable) live on this same page too —
// this is the one door into admissions; nobody has to be told a route.
const LABELS = {
  payment:   "Payment verification",
  documents: "Documents to verify",
  screening: "Screening",
  action:    "Awaiting applicant action",
  review:    "Reviews in progress",
  interview: "Interviews scheduled",
  decision:  "Decision queue",
  clearance: "Clearance in progress",
};

// Applications still in flight — the default filter on the roster below,
// because that is what an admissions officer opens the roster looking for.
const OPEN_STATUSES = [
  "submitted", "screening", "under_review", "document_review",
  "interview_required", "interview_completed", "offered", "accepted",
];

const AdmissionsQueues = () => {
  const { schoolId, school, isAdmin } = useSchool();
  const [groups, setGroups] = useState({});
  const [applications, setApplications] = useState([]);
  const [counts, setCounts] = useState({});
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [error, setError] = useState("");

  const [rosterStatus, setRosterStatus] = useState("open");
  const [rosterQuery, setRosterQuery] = useState("");

  const live = useLiveApplicationsListUpdates(schoolId);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [q, rows, summary, sess] = await Promise.all([
        fetchAdmissionsQueues(schoolId),
        fetchApplications({ schoolId }),
        fetchAdmissionsSummary(schoolId).catch(() => ({})),
        fetchSessions(schoolId).catch(() => []),
      ]);
      setGroups(q);
      setApplications(rows);
      setCounts(summary);
      setSessions(sess);
    } catch (err) {
      setError(err.message || "Could not load the queues.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalOpen = Object.values(groups).reduce(
    (n, rows) => n + (rows?.length || 0),
    0
  );

  const acceptingSession = sessions.find((s) => s.applications_open);
  const applyUrl = school ? `${window.location.origin}/Apply` : "/Apply";

  const toggleSessionOpen = async (session, open) => {
    setSessionBusy(true);
    setError("");
    try {
      await setSessionApplicationsOpen({ sessionId: session.id, schoolId, open });
      load();
    } catch (err) {
      setError(err.message || "Could not change that.");
    } finally {
      setSessionBusy(false);
    }
  };

  const openRosterCount = OPEN_STATUSES.reduce((n, s) => n + (counts[s] || 0), 0);

  const filteredRoster = useMemo(() => {
    const needle = rosterQuery.trim().toLowerCase();
    return applications.filter((a) => {
      if (rosterStatus === "open" && !OPEN_STATUSES.includes(a.status)) return false;
      if (rosterStatus !== "open" && rosterStatus !== "all" && a.status !== rosterStatus) return false;
      if (!needle) return true;
      return [a.reference, a.first_name, a.surname, a.guardian_name, a.guardian_email]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [applications, rosterStatus, rosterQuery]);

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Admissions workspace"
        subtitle={school ? `Operations at ${school.name}` : "Operations"}
        action={
          <a href="/Apply" target="_blank" rel="noreferrer noopener">
            <Button variant="secondary">{"View the public form"}</Button>
          </a>
        }
      >
        <LiveUpdateBanner
          count={live.count}
          onReload={() => { live.reset(); load(); }}
          label={`${live.count} new update${live.count === 1 ? "" : "s"} on admissions`}
        />
        <Notice tone="error">{error}</Notice>

        {/* Whether the school is taking applications at all — the first
            thing to check when the queue is unexpectedly empty. Pinned
            below the header so it stays in view while scrolling through
            the queues and the full application roster underneath it. */}
        <div className="panel-top">
        <Card style={{ marginBottom: 0 }}>
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
                    disabled={sessionBusy}
                    onClick={() => toggleSessionOpen(acceptingSession, false)}
                  >
                    {"Close applications"}
                  </Button>
                ) : (
                  sessions.slice(0, 3).map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      disabled={sessionBusy}
                      onClick={() => toggleSessionOpen(s, true)}
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
        </div>

        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {!loading && totalOpen === 0 ? (
          <Empty>{"Queues are empty. Nothing needs action right now."}</Empty>
        ) : null}

        {Object.keys(LABELS).map((bucket) =>
          groups[bucket]?.length ? (
            <section key={bucket} className="section">
              <div className="page-head" style={{ marginBottom: 10 }}>
                <h2>{LABELS[bucket]}</h2>
                <Badge>{`${groups[bucket].length} waiting`}</Badge>
              </div>
              <Grid>
                {groups[bucket].map((row) => (
                  <Link
                    key={`${bucket}-${row.application_id}`}
                    to={`/AdmissionsWorkspace/${row.application_id}`}
                    className="card-link"
                  >
                    <Card style={{ height: "100%" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{row.reference}</strong>
                        <Badge tone="brand">{row.status}</Badge>
                      </div>
                      <p style={{ margin: "6px 0 0" }}>{row.applicant}</p>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
                        {[
                          row.form_state !== "submitted" && row.form_state,
                          row.payment_state !== "not_required" && `pay ${row.payment_state}`,
                          row.documents_state !== "pending" && `docs ${row.documents_state}`,
                          row.screening_state !== "not_started" && `screening ${row.screening_state}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </Card>
                  </Link>
                ))}
              </Grid>
            </section>
          ) : null
        )}

        {/* Every application, any status — the index a queue can't be,
            since a queue only ever shows what's currently in flight. This
            is where a rejected/withdrawn/enrolled application still lives
            once it's dropped out of every queue above. */}
        <section className="section" style={{ marginTop: 28 }}>
          <div className="page-head" style={{ marginBottom: 10 }}>
            <h2>{"All applications"}</h2>
          </div>

          <div className="btn-row" style={{ marginBottom: 16 }}>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Search name, reference or email"
              value={rosterQuery}
              onChange={(e) => setRosterQuery(e.target.value)}
            />
            <Select
              className="select"
              value={rosterStatus}
              onChange={setRosterStatus}
              options={[
                { value: "open", label: `Needs a decision (${openRosterCount})` },
                { value: "all", label: `Everything (${applications.length})` },
                ...APPLICATION_STATUSES.map(([value, label]) => ({
                  value,
                  label: `${label} (${counts[value] || 0})`,
                })),
              ]}
            />
          </div>

          {!loading && applications.length === 0 ? (
            <Empty>{"No applications yet. Share the link above and they will appear here."}</Empty>
          ) : null}

          {!loading && applications.length > 0 && filteredRoster.length === 0 ? (
            <Empty>{"Nothing matches that filter."}</Empty>
          ) : null}

          {filteredRoster.length > 0 ? (
            <Card className="pad-0" style={{ padding: "4px 14px" }}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{"Reference"}</th>
                      <th>{"Applicant"}</th>
                      <th>{"Guardian"}</th>
                      <th>{"Status"}</th>
                      <th>{"Received"}</th>
                      <th>{""}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRoster.map((a) => (
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
                          {a.guardian_name}
                          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                            {a.guardian_phone || a.guardian_email}
                          </div>
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[a.status]}>
                            {STATUS_LABEL[a.status] || a.status}
                          </Badge>
                        </td>
                        <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                          {formatDate(a.created_at, { withTime: false })}
                        </td>
                        <td>
                          <Link to={`/AdmissionsWorkspace/${a.id}`}>
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
        </section>
      </Page>
    </div>
  );
};

export default AdmissionsQueues;
