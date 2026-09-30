import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  Notice,
  Badge,
  Button,
  Select,
  formatDate,
  SkeletonTable,
} from "../../Components/UI";
import { useLiveApplicationsListUpdates, LiveUpdateBanner } from "../../Components/LiveUpdateBanner";
import { useActionFeedback } from "../../Components/Toast";
import ExportButton from "../../Components/ExportButton";

// The staff dashboard for admissions: one door into every queue the team
// works, plus the full roster.
//
// Laid out like the helpdesk rather than as a stack of card grids. The old
// page showed every queue one under another, each as a grid of tall cards, so
// an application sitting in three queues appeared three times and the page
// ran on for screens. Now the queues are a rail with counts — the whole
// pipeline readable at a glance — and one queue at a time fills the pane
// beside it as a list of rows. The rail and the list scroll independently,
// and the chosen queue is kept in the address (?queue=documents), so opening
// an application and pressing Back returns to the same queue.
//
// Each queue is one bucket of admissions_queues(); the hints below say, in
// the school's terms, exactly what that function puts in each one.
const QUEUES = {
  payment: {
    label: "Payment verification",
    hint: "The applicant says they've paid. Confirm the money arrived.",
  },
  documents: {
    label: "Documents to verify",
    hint: "Submitted documents still to check, incomplete, or sent back.",
  },
  screening: {
    label: "Screening",
    hint: "Applications still to screen, or held at screening.",
  },
  decision: {
    label: "Decision queue",
    hint: "Reviewed and ready for an admission decision.",
  },
  clearance: {
    label: "Clearance in progress",
    hint: "Accepted, with clearance still to finish.",
  },
  action: {
    label: "Awaiting applicant",
    hint: "Returned to the applicant to correct or complete. Nothing to do until they reply.",
  },
  review: {
    label: "Reviews in progress",
    hint: "With a reviewer and not yet finished.",
  },
  interview: {
    label: "Interviews scheduled",
    hint: "Interview booked and not yet held.",
  },
};

// Split by who has to move next. The first group is the team's own work, in
// the order an application reaches it; the second is waiting on an applicant,
// a reviewer or an interview date, so a busy count there is not a backlog.
const NEEDS_TEAM = ["payment", "documents", "screening", "decision", "clearance"];
const WAITING = ["action", "review", "interview"];

// Applications still in flight — the default filter on the roster, because
// that is what an admissions officer opens it looking for.
const OPEN_STATUSES = [
  "submitted", "screening", "under_review", "document_review",
  "interview_required", "interview_completed", "offered", "accepted",
];

// The database's own words, made readable: "correction_required" becomes
// "correction required". The raw values used to be printed as they were.
const words = (value) => String(value || "").replace(/_/g, " ");
const sentence = (value) => {
  const text = words(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// State encoded in colour as well as text, so what needs attention stands out
// in a column of rows. "unpaid" is tested before "paid" on purpose.
const toneFor = (value) => {
  if (/reject|fail/.test(value)) return "danger";
  if (/unpaid|partial|required|processing|correction/.test(value)) return "warn";
  if (/verified|paid|passed|complete|approved|cleared/.test(value)) return "success";
  return "";
};

// Only the states that say something: a state at its starting value is
// already implied by the queue the row is in.
const chipsFor = (row) =>
  [
    row.form_state && row.form_state !== "submitted"
      ? { key: "form", value: row.form_state, text: sentence(row.form_state) }
      : null,
    row.payment_state && row.payment_state !== "not_required"
      ? { key: "pay", value: row.payment_state, text: `Payment ${words(row.payment_state)}` }
      : null,
    row.documents_state && row.documents_state !== "pending"
      ? { key: "docs", value: row.documents_state, text: `Documents ${words(row.documents_state)}` }
      : null,
    row.screening_state && row.screening_state !== "not_started"
      ? { key: "screen", value: row.screening_state, text: `Screening ${words(row.screening_state)}` }
      : null,
  ].filter(Boolean);

// How long since anything happened on the application. A week without
// movement is flagged, because in a queue that is what goes stale unnoticed.
const DAY = 24 * 60 * 60 * 1000;
const age = (value) => {
  if (!value) return { text: "", stale: false };
  const days = Math.floor((Date.now() - new Date(value).getTime()) / DAY);
  let text;
  if (days <= 0) text = "Today";
  else if (days === 1) text = "Yesterday";
  else if (days < 14) text = `${days} days ago`;
  else if (days < 60) text = `${Math.floor(days / 7)} weeks ago`;
  else text = formatDate(value, { withTime: false });
  return { text, stale: days >= 7 };
};

// The Clipboard API only exists on https and localhost. Opened over the local
// network — the way this app is tested on a phone — it is simply missing, and
// the old button failed without a word. Fall back to the older copy command
// before giving up.
const copyText = async (text) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the fallback below
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
};

// What the export carries for the queue on screen, and for the roster: the
// same facts each row shows, in words rather than database values.
const statusText = (status) => STATUS_LABEL[status] || sentence(status);

const QUEUE_COLUMNS = [
  { key: "reference", label: "Reference" },
  { key: (r) => r.applicant || "Unnamed applicant", label: "Applicant" },
  { key: (r) => statusText(r.status), label: "Status" },
  { key: (r) => chipsFor(r).map((c) => c.text).join(", "), label: "Progress" },
  { key: (r) => r.updated_at || r.submitted_at, label: "Last updated", type: "datetime" },
];

const ROSTER_COLUMNS = [
  { key: "reference", label: "Reference" },
  { key: (a) => `${a.first_name} ${a.surname}`, label: "Applicant" },
  { key: "date_of_birth", label: "Date of birth", type: "date" },
  { key: (a) => a.guardian_name || "", label: "Guardian" },
  { key: (a) => a.guardian_phone || a.guardian_email || "", label: "Guardian contact" },
  { key: (a) => statusText(a.status), label: "Status" },
  { key: "created_at", label: "Received", type: "date" },
];

const Chevron = () => (
  <svg className="aq-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const QueueButton = ({ id, label, count, active, urgent, onSelect }) => (
  <button
    type="button"
    className={`aq-queue${active ? " active" : ""}${count ? "" : " empty"}${urgent && count ? " urgent" : ""}`}
    aria-current={active ? "true" : undefined}
    onClick={() => onSelect(id)}
  >
    <span className="aq-queue-label">{label}</span>
    <span className="aq-queue-count">{count}</span>
  </button>
);

const QueueRow = ({ row }) => {
  const when = age(row.updated_at || row.submitted_at);
  const chips = chipsFor(row);
  return (
    <Link to={`/AdmissionsWorkspace/${row.application_id}`} className="aq-row">
      <span className="aq-ref">{row.reference}</span>
      <span className="aq-who">
        <span className="aq-name">{row.applicant || "Unnamed applicant"}</span>
        {chips.length ? (
          <span className="aq-chips">
            {chips.map((c) => (
              <span key={c.key} className={`aq-chip ${toneFor(c.value)}`}>
                {c.text}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="aq-status">
        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status] || sentence(row.status)}</Badge>
      </span>
      <span
        className={`aq-age${when.stale ? " stale" : ""}`}
        title={row.updated_at ? `Last updated ${formatDate(row.updated_at)}` : undefined}
      >
        {when.text}
      </span>
      <Chevron />
    </Link>
  );
};

const AdmissionsQueues = () => {
  const { schoolId, school, isAdmin } = useSchool();
  const [groups, setGroups] = useState({});
  const [applications, setApplications] = useState([]);
  const [counts, setCounts] = useState({});
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const copiedTimer = useRef(null);
  const { setError } = useActionFeedback();

  const [rosterStatus, setRosterStatus] = useState("open");
  const [rosterQuery, setRosterQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

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
  }, [schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const sizeOf = (bucket) => groups[bucket]?.length || 0;

  // The queue in the address wins; otherwise the first of the team's own
  // queues with anything in it, so the page opens on real work rather than
  // on an empty list. Undecided while loading, so it never opens on the
  // roster and then jumps.
  const requested = searchParams.get("queue");
  const firstBusy = [...NEEDS_TEAM, ...WAITING].find((b) => sizeOf(b) > 0) || "all";
  const view =
    requested && (requested === "all" || QUEUES[requested])
      ? requested
      : loading
      ? null
      : firstBusy;

  const selectView = (id) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("queue", id);
        return next;
      },
      { replace: true }
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

  const copyLink = async () => {
    const ok = await copyText(applyUrl);
    setCopied(ok ? "Copied" : "Copy failed");
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(""), 2000);
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

  const queueRows = view && view !== "all" ? groups[view] || [] : [];

  // On a phone the rail is a swipeable strip, and the chosen queue can sit
  // off its edge — opening on Screening, say, with only the first two chips
  // showing. Bring it into view. On a desktop the rail already shows every
  // queue, so this does nothing there. Deferred a frame so it measures after
  // the fonts and counts have settled, as the Tabs component does.
  const railRef = useRef(null);
  useEffect(() => {
    if (!view) return undefined;
    const id = window.requestAnimationFrame(() => {
      railRef.current
        ?.querySelector(".aq-queue.active")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [view]);

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
        <div className="aq-layout">
          <LiveUpdateBanner
            count={live.count}
            onReload={() => { live.reset(); load(); }}
            label={`${live.count} new update${live.count === 1 ? "" : "s"} on admissions`}
          />

          {/* Whether the school is taking applications at all — the first
              thing to check when the queues are unexpectedly empty. */}
          <div className="aq-intake">
            <span className={`aq-intake-dot${acceptingSession ? " on" : ""}`} aria-hidden="true" />
            <div className="aq-intake-text">
              <strong>
                {acceptingSession
                  ? `Accepting applications for ${acceptingSession.name}`
                  : "Not accepting applications"}
              </strong>
              <span>
                {acceptingSession
                  ? "The public form is live. Anyone with the link can apply."
                  : "The public form turns people away until a session is open."}
              </span>
            </div>

            {acceptingSession ? (
              <div className="aq-link">
                <code title={applyUrl}>{applyUrl}</code>
                <button type="button" className="aq-link-copy" onClick={copyLink} aria-live="polite">
                  {copied || "Copy link"}
                </button>
              </div>
            ) : null}

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

          {!loading && !sessions.length ? (
            <Notice tone="error">
              {"There are no sessions yet. Add one under School → Calendar before opening admissions."}
            </Notice>
          ) : null}

          <div className="aq-body">
            <nav className="aq-rail" aria-label="Admissions queues" ref={railRef}>
              <div className="aq-group-label">{"Needs your team"}</div>
              {NEEDS_TEAM.map((id) => (
                <QueueButton
                  key={id}
                  id={id}
                  label={QUEUES[id].label}
                  count={sizeOf(id)}
                  active={view === id}
                  urgent
                  onSelect={selectView}
                />
              ))}

              <div className="aq-group-label">{"Waiting on others"}</div>
              {WAITING.map((id) => (
                <QueueButton
                  key={id}
                  id={id}
                  label={QUEUES[id].label}
                  count={sizeOf(id)}
                  active={view === id}
                  onSelect={selectView}
                />
              ))}

              <div className="aq-rail-sep" aria-hidden="true" />
              <QueueButton
                id="all"
                label="All applications"
                count={applications.length}
                active={view === "all"}
                onSelect={selectView}
              />
            </nav>

            <section className="aq-main" aria-live="polite">
              <header className="aq-main-head">
                <div>
                  <h2>{view === "all" ? "All applications" : view ? QUEUES[view].label : "Queues"}</h2>
                  <p>
                    {view === "all"
                      ? "Every application, open or closed. Closed ones leave the queues but always stay here."
                      : view
                      ? QUEUES[view].hint
                      : "Loading the queues..."}
                  </p>
                </div>
                {!loading && view ? (
                  <div className="btn-row" style={{ flex: "none" }}>
                    <span className="aq-main-count">
                      {view === "all"
                        ? `${filteredRoster.length} of ${applications.length}`
                        : `${queueRows.length} waiting`}
                    </span>
                    {view === "all" ? (
                      <ExportButton
                        roles={["admissions"]}
                        filename="applications"
                        sheetName="All applications"
                        rows={filteredRoster}
                        columns={ROSTER_COLUMNS}
                      />
                    ) : (
                      <ExportButton
                        roles={["admissions"]}
                        filename={`admissions-${view}`}
                        sheetName={QUEUES[view].label}
                        rows={queueRows}
                        columns={QUEUE_COLUMNS}
                      />
                    )}
                  </div>
                ) : null}
              </header>

              {view === "all" ? (
                <div className="aq-toolbar">
                  <input
                    className="input"
                    placeholder="Search name, reference or email"
                    value={rosterQuery}
                    onChange={(e) => setRosterQuery(e.target.value)}
                  />
                  <Select
                    className="select"
                    value={rosterStatus}
                    onChange={setRosterStatus}
                    options={[
                      { value: "open", label: `Still open (${openRosterCount})` },
                      { value: "all", label: `Everything (${applications.length})` },
                      ...APPLICATION_STATUSES.map(([value, label]) => ({
                        value,
                        label: `${label} (${counts[value] || 0})`,
                      })),
                    ]}
                  />
                </div>
              ) : null}

              <div className="aq-scroll">
                {loading ? (
                  <div style={{ padding: "8px 20px" }}>
                    <SkeletonTable rows={5} cols={4} />
                  </div>
                ) : null}

                {!loading && view && view !== "all" ? (
                  queueRows.length ? (
                    queueRows.map((row) => (
                      <QueueRow key={`${view}-${row.application_id}`} row={row} />
                    ))
                  ) : (
                    <div className="aq-empty">
                      <strong>{"Nothing waiting here"}</strong>
                      {WAITING.includes(view)
                        ? "No one is holding anything up in this stage right now."
                        : "This part of admissions is clear."}
                    </div>
                  )
                ) : null}

                {!loading && view === "all" ? (
                  applications.length === 0 ? (
                    <div className="aq-empty">
                      <strong>{"No applications yet"}</strong>
                      {"Share the link above and they will appear here."}
                    </div>
                  ) : filteredRoster.length === 0 ? (
                    <div className="aq-empty">
                      <strong>{"Nothing matches"}</strong>
                      {"Try a different name, or widen the status filter."}
                    </div>
                  ) : (
                    <div className="table-wrap table-wrap-plain">
                      <table className="data aq-roster">
                        <thead>
                          <tr>
                            <th>{"Reference"}</th>
                            <th>{"Applicant"}</th>
                            <th>{"Guardian"}</th>
                            <th>{"Status"}</th>
                            <th>{"Received"}</th>
                            <th aria-label="Open" />
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRoster.map((a) => (
                            <tr key={a.id}>
                              <td className="aq-ref">{a.reference}</td>
                              <td>
                                <strong>{`${a.first_name} ${a.surname}`}</strong>
                                {a.date_of_birth ? (
                                  <div className="aq-sub">
                                    {`Born ${formatDate(a.date_of_birth, { withTime: false })}`}
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                {a.guardian_name}
                                <div className="aq-sub">{a.guardian_phone || a.guardian_email}</div>
                              </td>
                              <td>
                                <Badge tone={STATUS_TONE[a.status]}>
                                  {STATUS_LABEL[a.status] || sentence(a.status)}
                                </Badge>
                              </td>
                              <td className="aq-sub" style={{ whiteSpace: "nowrap" }}>
                                {formatDate(a.created_at, { withTime: false })}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <Link to={`/AdmissionsWorkspace/${a.id}`}>
                                  <Button variant="secondary" size="sm">{"Open"}</Button>
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </Page>
    </div>
  );
};

export default AdmissionsQueues;
