import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchMyApplications,
  fetchApplicationWorkflowSteps,
  fetchAdmissionConfig,
  fetchMyApplicationInvoice,
  saveApplicationSection,
  submitMyApplication,
  markApplicationPaymentInitiated,
  resubmitApplicationCorrection,
  fetchApplicationEvents,
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

// A section of the applicant's form. Kept as a small local component so the
// six sections read the same and share validation/save behaviour.
const Section = ({ title, description, value, onSave, disabled, fields }) => {
  const [draft, setDraft] = useState(value || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => setDraft(value || {}), [value]);

  const update = (name) => (event) =>
    setDraft((current) => ({
      ...current,
      [name]: event.target.value,
    }));

  const save = async (event) => {
    event.preventDefault();
    if (disabled) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await onSave(draft);
      setNotice("Saved.");
    } catch (err) {
      setError(err.message || "Could not save that section.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {description ? (
        <p style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 0 }}>
          {description}
        </p>
      ) : null}
      <form onSubmit={save}>
        {fields.map((field) => (
          <Field key={field.name} label={field.label} hint={field.hint}>
            {field.type === "textarea" ? (
              <textarea
                className="textarea"
                value={draft[field.name] || ""}
                disabled={disabled}
                onChange={update(field.name)}
              />
            ) : (
              <input
                className="input"
                type={field.type || "text"}
                value={draft[field.name] || ""}
                disabled={disabled}
                onChange={update(field.name)}
              />
            )}
          </Field>
        ))}

        <Notice tone="error">{error}</Notice>
        {notice && !error ? <Notice tone="success">{notice}</Notice> : null}

        <Button type="submit" disabled={disabled || saving}>
          {saving ? "Saving..." : "Save section"}
        </Button>
      </form>
    </Card>
  );
};

const StepRow = ({ step }) => {
  const glyph =
    step.state === "done" ? "✓" : step.state === "current" ? "◉" : "○";
  return (
    <li className={`workflow-step workflow-${step.state}`}>
      <span className="workflow-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="workflow-label">{step.step_label}</span>
    </li>
  );
};

const ApplicationDashboard = () => {
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const { school } = useSchool();

  const [application, setApplication] = useState(null);
  const [steps, setSteps] = useState([]);
  const [config, setConfig] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [declaration, setDeclaration] = useState(false);

  const load = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    try {
      const [apps, workflow] = await Promise.all([
        fetchMyApplications(),
        fetchApplicationWorkflowSteps(applicationId).catch(() => []),
      ]);
      const app = apps.find((a) => a.id === applicationId);
      if (!app) {
        setError("This application could not be found on your account.");
        return;
      }
      setApplication(app);
      setSteps(workflow);

      const [cfg, inv, ev] = await Promise.all([
        fetchAdmissionConfig({ schoolId: app.school_id, sessionId: app.session_id }),
        fetchMyApplicationInvoice(app.id).catch(() => null),
        fetchApplicationEvents(app.id).catch(() => []),
      ]);
      setConfig(cfg);
      setInvoice(inv);
      setEvents(ev);
    } catch (err) {
      setError(err.message || "Could not load your application.");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const editable = useMemo(() => {
    if (!application) return {};
    // Section editability depends on state. In draft/in_progress the whole
    // form is open. In action_required only the flagged sections are open.
    // Once submitted, everything is read-only until a correction is invited.
    if (
      ["draft", "in_progress", "ready_to_submit"].includes(application.form_state)
    ) {
      return {
        personal: true,
        education: true,
        exams: true,
        next_of_kin: true,
        referees: true,
      };
    }
    if (application.form_state === "action_required") {
      const list = application.correction_sections || [];
      return list.reduce((acc, name) => {
        acc[name] = true;
        return acc;
      }, {});
    }
    return {};
  }, [application]);

  const saveSection = (section) => async (payload) => {
    const app = await saveApplicationSection({
      applicationId: application.id,
      section,
      payload,
    });
    setApplication(app);
    // Steps depend on which sections are filled, so refresh with the row.
    const workflow = await fetchApplicationWorkflowSteps(app.id).catch(() => []);
    setSteps(workflow);
  };

  const feeVisible =
    config?.application_fee_enabled &&
    application &&
    application.payment_state !== "not_required";

  const feeBadge =
    application?.payment_state === "verified" ? "success" :
    application?.payment_state === "processing" ? "brand" :
    application?.payment_state === "rejected" ? "danger" :
    "warn";

  const goToFee = async () => {
    if (!application) return;
    // Move the row to processing before handing off, so a reload cannot
    // present the Pay again button while the gateway confirms.
    try {
      await markApplicationPaymentInitiated(application.id);
    } catch {
      /* not fatal — the fees page runs the same guard */
    }
    navigate(`/Fees?application=${application.id}`);
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const app = await submitMyApplication({
        applicationId: application.id,
        declarationAccepted: declaration,
      });
      setApplication(app);
      const workflow = await fetchApplicationWorkflowSteps(app.id).catch(() => []);
      setSteps(workflow);
    } catch (err) {
      setError(err.message || "Could not submit your application.");
    } finally {
      setSubmitting(false);
    }
  };

  const resubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const app = await resubmitApplicationCorrection(application.id);
      setApplication(app);
      const workflow = await fetchApplicationWorkflowSteps(app.id).catch(() => []);
      setSteps(workflow);
    } catch (err) {
      setError(err.message || "Could not resubmit your application.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page>
          <Empty>{"Loading your application..."}</Empty>
        </Page>
      </div>
    );
  }

  if (error || !application) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Application">
          <Notice tone="error">{error}</Notice>
          <Link to="/Applications">
            <Button variant="secondary">{"Back to my applications"}</Button>
          </Link>
        </Page>
      </div>
    );
  }

  const isReadonly =
    application.form_state === "submitted" ||
    application.form_state === "resubmitted";
  const canSubmit =
    application.form_state === "in_progress" ||
    application.form_state === "ready_to_submit" ||
    application.form_state === "draft";
  const needsCorrection = application.form_state === "action_required";

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={application.reference}
        subtitle={school ? `Application to ${school.name}` : "Application"}
      >
        {/* The workflow tracker — steps come from the database, so a session
            with no fees, no interview and no referees doesn't show them. */}
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{"Progress"}</h3>
          <ol className="workflow-steps">
            {steps.map((step) => (
              <StepRow key={step.step_key} step={step} />
            ))}
          </ol>
        </Card>

        {needsCorrection ? (
          <Card style={{ marginBottom: 16, borderColor: "var(--danger)" }}>
            <h3 style={{ marginTop: 0, color: "var(--danger)" }}>
              {"Action required"}
            </h3>
            <p>{application.correction_reason}</p>
            <p style={{ color: "var(--ink-3)", fontSize: 13.5 }}>
              {`Sections to correct: ${(application.correction_sections || []).join(", ")}`}
            </p>
            <Button onClick={resubmit} disabled={submitting}>
              {submitting ? "Resubmitting..." : "Resubmit application"}
            </Button>
          </Card>
        ) : null}

        {feeVisible ? (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <h3 style={{ margin: 0 }}>{"Application fee"}</h3>
              <Badge tone={feeBadge}>{application.payment_state}</Badge>
            </div>
            {invoice ? (
              <p style={{ marginBottom: 8 }}>
                {`Invoice ${invoice.reference} · ${config?.currency || "NGN"} ${(
                  config?.application_fee_amount || 0
                ).toLocaleString()}`}
              </p>
            ) : null}
            {application.payment_state === "processing" ? (
              <Notice tone="brand">
                {"We are confirming your payment with the bank. You do not need to pay again."}
              </Notice>
            ) : null}
            {application.payment_state === "verified" ? (
              <Notice tone="success">{"Your fee has been received. The form is unlocked."}</Notice>
            ) : null}
            {application.payment_state !== "verified" ? (
              <Button onClick={goToFee}>
                {application.payment_state === "processing" ? "View payment" : "Pay application fee"}
              </Button>
            ) : null}
          </Card>
        ) : null}

        {/* Form sections — disabled with a clear reason when the section
            cannot be touched, rather than hidden, so an applicant always
            sees what they submitted. */}
        {isReadonly || (feeVisible && application.payment_state !== "verified") ? (
          <Notice tone={isReadonly ? "muted" : "warn"}>
            {isReadonly
              ? "Your application is with the school. Sections are locked; the timeline below records anything that changes."
              : "Complete the fee before the form is unlocked. You can still see the sections but cannot edit them."}
          </Notice>
        ) : null}

        <Section
          title="Personal information"
          value={application.personal_info}
          disabled={!editable.personal}
          onSave={saveSection("personal")}
          fields={[
            { name: "first_name", label: "First name" },
            { name: "middle_name", label: "Middle name" },
            { name: "surname", label: "Surname" },
            { name: "date_of_birth", label: "Date of birth", type: "date" },
            { name: "gender", label: "Gender" },
            { name: "nationality", label: "Nationality" },
            { name: "state_of_origin", label: "State of origin" },
            { name: "address", label: "Home address", type: "textarea" },
            { name: "phone", label: "Phone" },
            { name: "email", label: "Email", type: "email" },
          ]}
        />

        <Section
          title="Education history"
          description="Where you have studied so far, most recent first."
          value={application.education_history}
          disabled={!editable.education}
          onSave={saveSection("education")}
          fields={[
            { name: "school_name", label: "School name" },
            { name: "country", label: "Country" },
            { name: "start_year", label: "Start year" },
            { name: "end_year", label: "End year" },
            { name: "qualification", label: "Qualification" },
          ]}
        />

        <Section
          title="Examination results"
          description="Your exam results — WAEC/NECO/NABTEB/JAMB or whatever your school runs."
          value={application.exam_results}
          disabled={!editable.exams}
          onSave={saveSection("exams")}
          fields={[
            { name: "exam_type", label: "Exam" },
            { name: "exam_number", label: "Exam number" },
            { name: "exam_year", label: "Exam year" },
            { name: "subjects", label: "Subjects and grades", type: "textarea", hint: "One per line, e.g. Mathematics — B3" },
          ]}
        />

        {config?.require_next_of_kin !== false ? (
          <Section
            title="Next of kin"
            value={application.next_of_kin}
            disabled={!editable.next_of_kin}
            onSave={saveSection("next_of_kin")}
            fields={[
              { name: "name", label: "Full name" },
              { name: "relationship", label: "Relationship" },
              { name: "phone", label: "Phone" },
              { name: "email", label: "Email", type: "email" },
              { name: "address", label: "Address", type: "textarea" },
            ]}
          />
        ) : null}

        {config?.require_referees ? (
          <Section
            title="Referees"
            value={application.referees}
            disabled={!editable.referees}
            onSave={saveSection("referees")}
            fields={[
              { name: "referee_1_name", label: "Referee 1 — name" },
              { name: "referee_1_email", label: "Referee 1 — email", type: "email" },
              { name: "referee_2_name", label: "Referee 2 — name" },
              { name: "referee_2_email", label: "Referee 2 — email", type: "email" },
            ]}
          />
        ) : null}

        {canSubmit ? (
          <Card>
            <h3 style={{ marginTop: 0 }}>{"Submit"}</h3>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input
                type="checkbox"
                checked={declaration}
                onChange={(e) => setDeclaration(e.target.checked)}
              />
              <span>
                {"I confirm that the information above is accurate and complete. I understand that providing false information may result in cancellation of my admission."}
              </span>
            </label>
            <div style={{ marginTop: 12 }}>
              <Button
                disabled={!declaration || submitting}
                onClick={submit}
              >
                {submitting ? "Submitting..." : "Submit application"}
              </Button>
            </div>
          </Card>
        ) : null}

        {/* Timeline — every event the database recorded, in reverse
            chronological order. This is the audit trail. */}
        <Card style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>{"Application timeline"}</h3>
          {events.length === 0 ? (
            <Empty>{"Nothing recorded yet."}</Empty>
          ) : (
            <ul className="timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {formatDate(event.created_at, { withTime: true })} · {event.actor_label || "System"}
                  </div>
                  <div>{event.note || `${event.status_from || "–"} → ${event.status_to}`}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Page>
    </div>
  );
};

export default ApplicationDashboard;
