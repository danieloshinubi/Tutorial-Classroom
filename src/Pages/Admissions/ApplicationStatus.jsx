import React, { useState } from "react";
import { Link } from "react-router-dom";
import { trackApplication, STATUS_LABEL } from "../../lib/api";
import { Field, Button, Notice, Badge, Card, formatDate } from "../../Components/UI";

// Section keys the staff "Request correction" checklist uses
// (AdmissionsWorkspace.jsx) — plain English for a family reading this, not
// the internal key.
const SECTION_LABEL = {
  personal: "Personal details",
  education: "Education history",
  exams: "Exam results",
  next_of_kin: "Next of kin",
  referees: "Referees",
  documents: "Documents",
};

// What each state means to a family, in their words rather than the system's.
const EXPLAIN = {
  submitted: "Received. The school has not started reviewing it yet.",
  screening: "Being reviewed by the school.",
  offered: "A place has been offered. Contact the school to accept it.",
  accepted: "The offer is accepted. The school will complete enrolment.",
  enrolled: "Enrolled. The pupil now has a place and an account.",
  declined: "The offer was turned down.",
  rejected: "The school was not able to offer a place.",
  withdrawn: "This application was withdrawn.",
};

// Public status check. Requires the reference and the email together, so a
// guessed reference on its own tells nobody anything.
const ApplicationStatus = () => {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setResult(null);
    setChecked(false);

    if (!reference.trim() || !email.trim()) {
      setError("Enter both the reference and the email address you applied with.");
      return;
    }

    setBusy(true);
    try {
      setResult(await trackApplication({ reference: reference.trim(), email: email.trim() }));
      setChecked(true);
    } catch (err) {
      setError(err.message || "Could not check that application.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="apply">
      <header className="apply-head">
        <div className="apply-inner">
          <h1>{"Check an application"}</h1>
          <p className="apply-lede">
            {"Enter the reference you were given and the email address you applied with."}
          </p>
        </div>
      </header>

      <main className="apply-inner">
        <form onSubmit={handleSubmit} className="apply-form" style={{ maxWidth: 460 }}>
          <Field label="Reference">
            <input
              className="input"
              autoFocus
              placeholder="JNC/2026/0007"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Field label="Email you applied with">
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Notice tone="error">{error}</Notice>

          <Button type="submit" disabled={busy}>
            {busy ? "Checking..." : "Check status"}
          </Button>
        </form>

        {/* Nothing found is deliberately not "no such application" — that
            would confirm which references exist. */}
        {checked && !result ? (
          <div className="card" style={{ maxWidth: 460, marginTop: 20 }}>
            <strong>{"No match"}</strong>
            <p style={{ margin: "6px 0 0", color: "var(--ink-2)", fontSize: 14 }}>
              {"That reference and email do not go together. Check both — the email must be the one used on the application."}
            </p>
          </div>
        ) : null}

        {result ? (
          <div className="card" style={{ maxWidth: 520, marginTop: 20 }}>
            <div className="page-head" style={{ marginBottom: 10 }}>
              <div>
                <span className="label">{result.reference}</span>
                <h2 style={{ margin: "4px 0 0" }}>{result.applicant}</h2>
              </div>
              <Badge tone={result.status === "rejected" ? "danger" : "brand"}>
                {STATUS_LABEL[result.status] || result.status}
              </Badge>
            </div>

            <p style={{ color: "var(--ink-2)" }}>{EXPLAIN[result.status]}</p>

            <dl className="apply-facts">
              <div>
                <dt>{"School"}</dt>
                <dd>{result.school_name}</dd>
              </div>
              {result.session_name ? (
                <div>
                  <dt>{"Session"}</dt>
                  <dd>{result.session_name}</dd>
                </div>
              ) : null}
              <div>
                <dt>{"Submitted"}</dt>
                <dd>{formatDate(result.submitted_at, { withTime: false })}</dd>
              </div>
              {result.decided_at ? (
                <div>
                  <dt>{"Last updated"}</dt>
                  <dd>{formatDate(result.decided_at, { withTime: false })}</dd>
                </div>
              ) : null}
              {result.status === "offered" && result.offer_expires_at ? (
                <div>
                  <dt>{"Offer expires"}</dt>
                  <dd>{formatDate(result.offer_expires_at)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        {result && result.form_state === "action_required" ? (
          <Card style={{ maxWidth: 520, marginTop: 16, borderColor: "var(--danger)" }}>
            <h3 style={{ marginTop: 0, color: "var(--danger)" }}>{"Action needed"}</h3>
            <p style={{ color: "var(--ink-2)" }}>{result.correction_reason}</p>
            {result.correction_sections?.length ? (
              <p style={{ color: "var(--ink-3)", fontSize: 13.5 }}>
                {`Sections to fix: ${result.correction_sections.map((s) => SECTION_LABEL[s] || s).join(", ")}`}
              </p>
            ) : null}
            <Link
              to={`/Apply/Claim?reference=${encodeURIComponent(result.reference)}&email=${encodeURIComponent(email.trim())}`}
            >
              <Button size="sm">{"Sign in or create an account to fix this"}</Button>
            </Link>
          </Card>
        ) : null}

        {result && result.form_state !== "action_required" ? (
          <Card style={{ maxWidth: 520, marginTop: 16 }}>
            <strong>{"Manage this application online"}</strong>
            <p style={{ margin: "6px 0 12px", color: "var(--ink-2)", fontSize: 14 }}>
              {"Create an account (or sign in, if you already have one) to see full details, get notified the moment anything changes, and update this application yourself."}
            </p>
            <Link
              to={`/Apply/Claim?reference=${encodeURIComponent(result.reference)}&email=${encodeURIComponent(email.trim())}`}
            >
              <Button size="sm" variant="secondary">{"Create an account or sign in"}</Button>
            </Link>
          </Card>
        ) : null}

        <p style={{ marginTop: 24, fontSize: 14 }}>
          <Link to="/Apply">{"Start a new application"}</Link>
        </p>
      </main>
    </div>
  );
};

export default ApplicationStatus;
