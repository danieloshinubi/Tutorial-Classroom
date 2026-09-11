import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { useAuth } from "../../context/AuthContext";
import {
  fetchApplicationWorkspace,
  prepareScreeningItems,
  setScreeningItemStatus,
  verifyDocument,
  rejectDocument,
  waiveDocument,
  assignReview,
  recordReview,
  scheduleInterview,
  recordInterviewOutcome,
  requestApplicationCorrection,
  decideApplication,
  verifyApplicationPayment,
  verifyAcceptancePayment,
  fetchSchoolMembers,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Notice,
  Badge,
  Empty,
  formatDate,
} from "../../Components/UI";
import { useLiveApplicationUpdates, LiveUpdateBanner } from "../../Components/LiveUpdateBanner";

// Phase 2 staff workspace. Reads application_workspace() in one call and
// exposes each domain (screening, documents, review, interview, decision)
// as its own panel. Every write goes through the SECURITY DEFINER function
// for that domain; the client never touches state columns directly.
const AdmissionsWorkspace = () => {
  const { applicationId } = useParams();
  const { schoolId, role, isAdmin, isPrincipal } = useSchool();
  const { user } = useAuth();

  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useLiveApplicationUpdates(applicationId);

  const load = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    try {
      const [ws, mems] = await Promise.all([
        fetchApplicationWorkspace(applicationId),
        fetchSchoolMembers(schoolId).catch(() => []),
      ]);
      setWorkspace(ws);
      setMembers(mems);
    } catch (err) {
      setError(err.message || "Could not load the workspace.");
    } finally {
      setLoading(false);
    }
  }, [applicationId, schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, label) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message || `Could not ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page>
          <Empty>{"Loading workspace..."}</Empty>
        </Page>
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Application">
          <Notice tone="error">{error}</Notice>
          <Link to="/AdmissionsWorkspace">
            <Button variant="secondary">{"Back to workspace"}</Button>
          </Link>
        </Page>
      </div>
    );
  }

  const app = workspace?.application;
  const screening = workspace?.screening || [];
  const documents = workspace?.documents || [];
  const reviews = workspace?.reviews || [];
  const interviews = workspace?.interviews || [];
  const events = workspace?.events || [];
  const config = workspace?.config || {};
  const offer = workspace?.offer || null;
  const applicationInvoice = workspace?.application_invoice || null;
  const acceptanceInvoice = workspace?.acceptance_invoice || null;

  const canFinalise = isAdmin || isPrincipal || role === "owner";
  const activeReview = reviews.find((r) => !r.completed_at);
  const isAssignedReviewer = activeReview && activeReview.reviewer_id === user?.id;

  const stateBadge = (label, value, tone) => (
    <div className="state-cell">
      <div className="state-label">{label}</div>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={`${app.reference} — ${app.first_name} ${app.surname}`}
        subtitle="Admissions workspace"
      >
        <LiveUpdateBanner count={live.count} onReload={() => { live.reset(); load(); }} />
        <Notice tone="error">{error}</Notice>

        {/* State strip — the whole application at a glance */}
        <Card style={{ marginBottom: 16 }}>
          <div className="state-grid">
            {stateBadge("Status", app.status, "brand")}
            {stateBadge("Form", app.form_state,
              app.form_state === "action_required" ? "warn" : "muted")}
            {stateBadge("Payment", app.payment_state,
              app.payment_state === "verified" ? "success" :
              app.payment_state === "processing" ? "brand" :
              app.payment_state === "rejected" ? "danger" : "muted")}
            {stateBadge("Documents", app.documents_state,
              app.documents_state === "complete" ? "success" :
              app.documents_state === "rejected" ? "danger" : "warn")}
            {stateBadge("Screening", app.screening_state,
              app.screening_state === "passed" ? "success" :
              app.screening_state === "failed" ? "danger" : "muted")}
            {stateBadge("Review", app.review_state, "muted")}
            {config?.require_interview
              ? stateBadge("Interview", app.interview_state, "muted")
              : null}
            {stateBadge("Decision", app.decision_state,
              app.decision_state === "admit" ? "success" :
              app.decision_state === "reject" ? "danger" :
              app.decision_state === "waitlist" ? "warn" : "muted")}
          </div>
        </Card>

        {/* Application fee — the first payment gate, raised the moment the
            applicant started their application. Manual (proof-upload)
            payments sit here awaiting a bursar/admissions officer's
            approval; online payments settle themselves automatically. */}
        {applicationInvoice?.invoice ? (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ marginTop: 0, marginBottom: 0 }}>{"Application fee"}</h3>
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{applicationInvoice.invoice.reference}</span>
            </div>
            {applicationInvoice.payments.length === 0 ? (
              <Empty>{"No payment recorded against it yet."}</Empty>
            ) : (
              <ul className="doc-list">
                {applicationInvoice.payments.map((p) => (
                  <li key={p.id} className="doc-row">
                    <div>
                      {`${p.amount} · ${p.method} · ${formatDate(p.paid_on, { withTime: false })}`}
                      {p.reference ? <div className="doc-note">{p.reference}</div> : null}
                    </div>
                    <div className="doc-actions">
                      <Badge tone={
                        p.status === "approved" ? "success" :
                        p.status === "rejected" ? "danger" : "warn"
                      }>{p.status === "submitted" ? "being checked" : p.status}</Badge>
                      {p.status === "submitted" ? (
                        <Button size="sm" variant="secondary" disabled={busy}
                          onClick={() => run(() => verifyApplicationPayment({ paymentId: p.id }), "verify payment")}>
                          {"Verify payment"}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {/* Documents panel */}
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{"Documents"}</h3>
          {documents.length === 0 ? (
            <Empty>{"No documents required for this application yet."}</Empty>
          ) : (
            <ul className="doc-list">
              {documents.map((d) => (
                <li key={d.id} className="doc-row">
                  <div>
                    <strong>{d.requirement?.label || "Unnamed document"}</strong>
                    {d.requirement?.is_required ? (
                      <span className="doc-req"> · required</span>
                    ) : (
                      <span className="doc-req"> · optional</span>
                    )}
                    {d.decision_note ? (
                      <div className="doc-note">{d.decision_note}</div>
                    ) : null}
                  </div>
                  <div className="doc-actions">
                    <Badge tone={
                      d.status === "verified" ? "success" :
                      d.status === "rejected" ? "danger" :
                      d.status === "waived" ? "muted" :
                      d.status === "uploaded" ? "brand" : "warn"
                    }>{d.status}</Badge>
                    {d.file?.file_path ? (
                      <span className="doc-actions">
                        <Button size="sm" variant="secondary"
                          disabled={busy || d.status === "verified"}
                          onClick={() => run(() => verifyDocument({ docId: d.id }), "verify")}>
                          {"Verify"}
                        </Button>
                        <Button size="sm" variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt("Why is this being rejected?");
                            if (reason) run(() => rejectDocument({ docId: d.id, reason }), "reject");
                          }}>
                          {"Reject"}
                        </Button>
                        {(isAdmin || isPrincipal) ? (
                          <Button size="sm" variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt("Why is this being waived?");
                              if (reason) run(() => waiveDocument({ docId: d.id, reason }), "waive");
                            }}>
                            {"Waive"}
                          </Button>
                        ) : null}
                      </span>
                    ) : <span style={{ color: "var(--ink-3)" }}>{"Nothing uploaded"}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Screening panel */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>{"Screening"}</h3>
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => run(() => prepareScreeningItems(app.id), "prepare screening")}>
              {"Prepare items from config"}
            </Button>
          </div>
          {screening.length === 0 ? (
            <Empty>{"No screening items yet. Configure requirements or press the button above."}</Empty>
          ) : (
            <ul className="screen-list">
              {screening.map((item) => (
                <li key={item.id} className="screen-row">
                  <div>
                    <strong>{item.label}</strong>
                    {item.is_required ? <span className="doc-req"> · required</span> : null}
                    {item.decision_note ? <div className="doc-note">{item.decision_note}</div> : null}
                  </div>
                  <div className="doc-actions">
                    <Badge tone={
                      item.status === "passed" ? "success" :
                      item.status === "failed" ? "danger" :
                      item.status === "waived" ? "muted" :
                      item.status === "correction_required" ? "warn" : "muted"
                    }>{item.status}</Badge>
                    <Button size="sm" variant="secondary" disabled={busy}
                      onClick={() => run(() => setScreeningItemStatus({ itemId: item.id, status: "passed" }), "pass")}>
                      {"Pass"}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy}
                      onClick={() => {
                        const note = window.prompt("Reason?");
                        if (note) run(() => setScreeningItemStatus({ itemId: item.id, status: "failed", note }), "fail");
                      }}>
                      {"Fail"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => {
                        const note = window.prompt("Waiver reason?");
                        if (note) run(() => setScreeningItemStatus({ itemId: item.id, status: "waived", note }), "waive");
                      }}>
                      {"Waive"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Correction request */}
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{"Request correction"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 0 }}>
            {"Return the application to the applicant for correction of one or more sections."}
          </p>
          <CorrectionForm applicationId={app.id} disabled={busy}
            onDone={load} onError={setError} />
        </Card>

        {/* Review */}
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{"Review"}</h3>
          {activeReview ? (
            <div>
              <p>Assigned to <strong>{
                members.find((m) => m.user_id === activeReview.reviewer_id)?.email
                || activeReview.reviewer_id
              }</strong> on {formatDate(activeReview.assigned_at)}</p>
              {isAssignedReviewer ? (
                <ReviewForm applicationId={app.id} disabled={busy}
                  onDone={load} onError={setError} />
              ) : (
                <Notice tone="muted">{"Only the assigned reviewer can record this recommendation."}</Notice>
              )}
            </div>
          ) : (
            <AssignReviewForm applicationId={app.id} members={members}
              disabled={busy} onDone={load} onError={setError} />
          )}
          {reviews.filter((r) => r.completed_at).map((r) => (
            <div key={r.id} className="past-review">
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {formatDate(r.completed_at)} · {members.find((m) => m.user_id === r.reviewer_id)?.email}
              </div>
              <strong>{r.recommendation}</strong>
              {r.notes ? <p style={{ margin: "4px 0 0" }}>{r.notes}</p> : null}
            </div>
          ))}
        </Card>

        {/* Interview */}
        {config?.require_interview ? (
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{"Interview"}</h3>
            <InterviewForm applicationId={app.id} members={members} disabled={busy}
              onDone={load} onError={setError} />
            {interviews.map((iv) => (
              <div key={iv.id} className="past-review">
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {formatDate(iv.scheduled_at)} · {iv.location || "—"}
                </div>
                <Badge tone={
                  iv.status === "completed" ? "success" :
                  iv.status === "cancelled" ? "danger" : "brand"
                }>{iv.status}</Badge>
                {iv.outcome ? <span> · {iv.outcome}</span> : null}
                {iv.status === "scheduled" ? (
                  <div style={{ marginTop: 8 }}>
                    <Button size="sm" variant="secondary" disabled={busy}
                      onClick={() => {
                        const outcome = window.prompt("Outcome (pass, fail, inconclusive)?");
                        if (outcome) run(() => recordInterviewOutcome({
                          interviewId: iv.id, status: "completed", outcome
                        }), "record outcome");
                      }}>
                      {"Record outcome"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </Card>
        ) : null}

        {/* Final decision — the form is finaliser-only; everyone else still
            sees why, rather than the section vanishing with no explanation. */}
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{"Final decision"}</h3>
          {canFinalise ? (
            <DecisionForm application={app} disabled={busy}
              onDone={load} onError={setError} />
          ) : (
            <Notice tone="muted">
              {"Only owner/admin/principal can make the final admission decision. Screening, review and interview can still be recorded above."}
            </Notice>
          )}
        </Card>

        {/* Offer & acceptance */}
        {offer ? (
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{"Offer"}</h3>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <Badge tone={
                offer.status === "accepted" ? "success" :
                offer.status === "declined" ? "danger" :
                offer.status === "expired" ? "muted" : "brand"
              }>{offer.status}</Badge>
              {offer.expires_at ? (
                <Badge tone={offer.status === "issued" && new Date(offer.expires_at) < new Date() ? "danger" : undefined}>
                  {`expires ${formatDate(offer.expires_at, { withTime: false })}`}
                </Badge>
              ) : null}
            </div>
            {offer.conditions ? <p style={{ marginTop: 0 }}>{offer.conditions}</p> : null}
            {offer.status === "issued" ? (
              <Notice tone="muted">{"Waiting on the applicant to accept or decline from their own dashboard."}</Notice>
            ) : null}
            {offer.status === "declined" ? (
              <Notice tone="warn">
                {offer.decline_reason ? `Declined — ${offer.decline_reason}` : "Declined."}
              </Notice>
            ) : null}

            {offer.status === "accepted" && acceptanceInvoice?.invoice ? (
              <div style={{ marginTop: 14 }}>
                <h4 style={{ marginBottom: 6 }}>{"Acceptance fee"}</h4>
                <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 13.5 }}>
                  {`Invoice ${acceptanceInvoice.invoice.reference}`}
                </p>
                {acceptanceInvoice.payments.length === 0 ? (
                  <Empty>{"No payment recorded against it yet."}</Empty>
                ) : (
                  <ul className="doc-list">
                    {acceptanceInvoice.payments.map((p) => (
                      <li key={p.id} className="doc-row">
                        <div>
                          {`${p.amount} · ${p.method} · ${formatDate(p.paid_on, { withTime: false })}`}
                          {p.reference ? <div className="doc-note">{p.reference}</div> : null}
                        </div>
                        <div className="doc-actions">
                          <Badge tone={
                            p.status === "approved" ? "success" :
                            p.status === "rejected" ? "danger" : "warn"
                          }>{p.status === "submitted" ? "being checked" : p.status}</Badge>
                          {p.status === "submitted" ? (
                            <Button size="sm" variant="secondary" disabled={busy}
                              onClick={() => run(() => verifyAcceptancePayment({ paymentId: p.id }), "verify payment")}>
                              {"Verify payment"}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* Timeline */}
        <Card>
          <h3 style={{ marginTop: 0 }}>{"Application timeline"}</h3>
          <ul className="timeline">
            {events.map((event) => (
              <li key={event.id}>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {formatDate(event.created_at, { withTime: true })} · {event.actor_label || "System"}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>
                  {event.note || `${event.status_from || "–"} → ${event.status_to}`}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </Page>
    </div>
  );
};

// Small child forms live inline for locality — kept short so the workspace
// reads as one file rather than five.

const CorrectionForm = ({ applicationId, disabled, onDone, onError }) => {
  const [sections, setSections] = useState({
    personal: false, education: false, exams: false,
    next_of_kin: false, referees: false, documents: false,
  });
  const [reason, setReason] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    const list = Object.keys(sections).filter((k) => sections[k]);
    if (list.length === 0) return onError("Choose at least one section.");
    if (!reason.trim()) return onError("Give the applicant a reason.");
    try {
      await requestApplicationCorrection({
        applicationId, sections: list, reason: reason.trim(),
      });
      setReason(""); setSections({});
      onDone();
    } catch (err) {
      onError(err.message || "Could not request correction.");
    }
  };
  return (
    <form onSubmit={submit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {Object.keys(sections).map((k) => (
          <label key={k} style={{ display: "flex", gap: 6 }}>
            <input type="checkbox" checked={sections[k]}
              onChange={(e) => setSections((s) => ({ ...s, [k]: e.target.checked }))} />
            {k.replace(/_/g, " ")}
          </label>
        ))}
      </div>
      <Field label="Reason">
        <textarea className="textarea" value={reason}
          onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={disabled}>
        {"Request correction"}
      </Button>
    </form>
  );
};

const AssignReviewForm = ({ applicationId, members, disabled, onDone, onError }) => {
  const [reviewerId, setReviewerId] = useState("");
  const eligible = members.filter((m) =>
    ["owner", "admin", "principal", "admissions"].includes(m.role));
  const submit = async (e) => {
    e.preventDefault();
    if (!reviewerId) return onError("Choose a reviewer.");
    try {
      await assignReview({ applicationId, reviewerId });
      onDone();
    } catch (err) {
      onError(err.message || "Could not assign the review.");
    }
  };
  return (
    <form onSubmit={submit}>
      <Field label="Reviewer">
        <select className="select" value={reviewerId}
          onChange={(e) => setReviewerId(e.target.value)}>
          <option value="">{"Choose an admissions member"}</option>
          {eligible.map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.email} · {m.role}</option>
          ))}
        </select>
      </Field>
      <Button type="submit" disabled={disabled}>{"Assign review"}</Button>
    </form>
  );
};

const ReviewForm = ({ applicationId, disabled, onDone, onError }) => {
  const [recommendation, setRecommendation] = useState("");
  const [notes, setNotes] = useState("");
  const [academicScore, setAcademicScore] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (!recommendation) return onError("Choose a recommendation.");
    try {
      await recordReview({
        applicationId, recommendation, notes,
        academicScore: academicScore ? Number(academicScore) : null,
      });
      onDone();
    } catch (err) {
      onError(err.message || "Could not record review.");
    }
  };
  return (
    <form onSubmit={submit}>
      <Field label="Recommendation">
        <select className="select" value={recommendation}
          onChange={(e) => setRecommendation(e.target.value)}>
          <option value="">{"Choose"}</option>
          <option value="recommend_admit">{"Recommend admit"}</option>
          <option value="recommend_reject">{"Recommend reject"}</option>
          <option value="recommend_waitlist">{"Recommend waitlist"}</option>
          <option value="recommend_correction">{"Request correction"}</option>
          <option value="recommend_defer">{"Recommend defer"}</option>
        </select>
      </Field>
      <Field label="Academic score">
        <input className="input" type="number" value={academicScore}
          onChange={(e) => setAcademicScore(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" value={notes}
          onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Button type="submit" disabled={disabled}>{"Record recommendation"}</Button>
    </form>
  );
};

const InterviewForm = ({ applicationId, members, disabled, onDone, onError }) => {
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [interviewerId, setInterviewerId] = useState("");
  const eligible = members.filter((m) =>
    ["owner", "admin", "principal", "admissions", "teacher"].includes(m.role));
  const submit = async (e) => {
    e.preventDefault();
    if (!when) return onError("Choose a date and time.");
    try {
      await scheduleInterview({
        applicationId, when: new Date(when).toISOString(),
        location, meetingLink, interviewerId: interviewerId || null,
      });
      setWhen(""); setLocation(""); setMeetingLink(""); setInterviewerId("");
      onDone();
    } catch (err) {
      onError(err.message || "Could not schedule the interview.");
    }
  };
  return (
    <form onSubmit={submit}>
      <Field label="Date and time">
        <input className="input" type="datetime-local"
          value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label="Location">
        <input className="input" value={location}
          onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <Field label="Meeting link">
        <input className="input" type="url" value={meetingLink}
          onChange={(e) => setMeetingLink(e.target.value)} />
      </Field>
      <Field label="Interviewer">
        <select className="select" value={interviewerId}
          onChange={(e) => setInterviewerId(e.target.value)}>
          <option value="">{"No interviewer set"}</option>
          {eligible.map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.email} · {m.role}</option>
          ))}
        </select>
      </Field>
      <Button type="submit" disabled={disabled}>{"Schedule interview"}</Button>
    </form>
  );
};

const DecisionForm = ({ application, disabled, onDone, onError }) => {
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [expires, setExpires] = useState("");
  const [conditions, setConditions] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (!decision) return onError("Choose a decision.");
    try {
      await decideApplication({
        id: application.id,
        status: decision,
        note,
        offerExpires: expires ? new Date(expires).toISOString() : null,
        conditions: decision === "offered" ? conditions : null,
      });
      onDone();
    } catch (err) {
      onError(err.message || "Could not record the decision.");
    }
  };
  return (
    <form onSubmit={submit}>
      <Notice tone="muted">
        {"The database enforces every prerequisite: fee, form, documents, screening, interview where required. If any of those is unsatisfied the decision will be refused."}
      </Notice>
      <Field label="Decision">
        <select className="select" value={decision}
          onChange={(e) => setDecision(e.target.value)}>
          <option value="">{"Choose"}</option>
          <option value="offered">{"Admit (offer)"}</option>
          <option value="rejected">{"Reject"}</option>
          <option value="waitlisted">{"Waitlist"}</option>
          <option value="deferred">{"Defer"}</option>
        </select>
      </Field>
      <Field label="Note">
        <textarea className="textarea" value={note}
          onChange={(e) => setNote(e.target.value)} />
      </Field>
      {decision === "offered" ? (
        <>
          <Field label="Offer expires">
            <input className="input" type="datetime-local"
              value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
          <Field label="Conditions" hint="Optional — shown to the applicant on their offer.">
            <textarea className="textarea" value={conditions}
              onChange={(e) => setConditions(e.target.value)} />
          </Field>
        </>
      ) : null}
      <Button type="submit" disabled={disabled}>{"Record decision"}</Button>
    </form>
  );
};

export default AdmissionsWorkspace;
