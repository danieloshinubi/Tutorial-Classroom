import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { allCountries } from "country-region-data";
import { ApplicantShell } from "../../Components/ApplicantShell";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
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
  fetchMyOffer,
  acceptOffer,
  declineOffer,
  fetchMyClearance,
  fetchMyApplicationDocuments,
  uploadMyApplicationDocument,
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
  DatePicker,
  Select,
} from "../../Components/UI";
import { useLiveApplicationUpdates, LiveUpdateBanner } from "../../Components/LiveUpdateBanner";

// country-region-data ships each country as a [name, isoCode, regions] tuple
// (regions themselves [name, isoCode] pairs) rather than the {countryName,
// ...} shape its own README shows — that shape is from an older major
// version. Names, not codes, are stored: nationality/state_of_origin were
// plain free-text before this, so anything already saved (and anywhere
// downstream that just displays the string) keeps working unchanged.
const COUNTRY_OPTIONS = allCountries
  .map(([name]) => ({ value: name, label: name }))
  .sort((a, b) => a.label.localeCompare(b.label));

const regionOptionsFor = (countryName) => {
  const country = allCountries.find(([name]) => name === countryName);
  if (!country) return [];
  return country[2].map(([name]) => ({ value: name, label: name }));
};

// Start/end year of a school stint — a plain text box invites "202" or
// "20204", and this app already has a real calendar picker for actual
// dates, so a school year (a bare number, no month/day) gets the same
// "pick, don't type" treatment via a year list instead. Most recent first,
// since that's the common case; one year ahead covers someone entering a
// programme that starts before this calendar year ends.
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1959 }, (_, i) => {
  const year = CURRENT_YEAR + 1 - i;
  return { value: String(year), label: String(year) };
});

// Humanises applications.status for this screen specifically. api.js's own
// STATUS_LABEL/STATUS_TONE cover only a subset of the enum — an accounted
// application can sit in draft/in_progress/waitlisted/deferred/under_review
// too, none of which are in that map, and a blank status word reads as a bug
// to an applicant watching their own record.
const STATUS_META = {
  draft: ["Draft", "muted"],
  in_progress: ["In progress", "muted"],
  ready_to_submit: ["Ready to submit", "muted"],
  submitted: ["Submitted", "warn"],
  screening: ["Screening", "brand"],
  under_review: ["Under review", "brand"],
  document_review: ["Document review", "brand"],
  interview_required: ["Interview required", "brand"],
  interview_completed: ["Interview completed", "brand"],
  offered: ["Offer extended", "brand"],
  accepted: ["Accepted", "success"],
  enrolled: ["Enrolled", "success"],
  declined: ["Declined", "muted"],
  rejected: ["Not admitted", "danger"],
  waitlisted: ["Waitlisted", "warn"],
  deferred: ["Deferred", "warn"],
  withdrawn: ["Withdrawn", "muted"],
};

// A section of the applicant's form. Collapses to a one-line summary once
// it's locked (already submitted, or not yet the flagged correction target)
// instead of staying open at full height — five long forms stacked and
// permanently expanded was the single biggest source of scroll fatigue on
// this page for anyone past the fill-in stage.
const Section = ({ title, description, value, onSave, disabled, fields, defaultOpen }) => {
  const [draft, setDraft] = useState(value || {});
  const [open, setOpen] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => setDraft(value || {}), [value]);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);

  const update = (name) => (event) =>
    setDraft((current) => ({
      ...current,
      [name]: event.target.value,
    }));

  // DatePicker's/Select's onChange hands back the value directly, not an
  // event — same string a native input's event.target.value would have
  // held, just not wrapped in one.
  const updateValue = (name) => (value) =>
    setDraft((current) => ({
      ...current,
      [name]: value,
    }));

  // Changing a "country" field clears any "region" field that depends on
  // it — its old value (a state/province of whichever country was picked
  // before) almost certainly doesn't belong to the new one, and leaving it
  // in the draft would save a state under the wrong country.
  const updateCountry = (name) => (value) =>
    setDraft((current) => {
      const next = { ...current, [name]: value };
      fields.forEach((f) => {
        if (f.type === "region" && f.dependsOn === name) next[f.name] = "";
      });
      return next;
    });

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

  const filled = fields.filter((f) => String(value?.[f.name] || "").trim()).length;

  return (
    <div className="appdash-form-section">
      <button
        type="button"
        className="appdash-section-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <h3>{title}</h3>
        <span className={`appdash-section-caret${open ? " open" : ""}`} aria-hidden="true">
          {"›"}
        </span>
      </button>

      {open ? (
        <>
          {description ? (
            <p style={{ color: "var(--ink-3)", fontSize: 13.5, margin: "6px 0 0" }}>
              {description}
            </p>
          ) : null}
          <form onSubmit={save} style={{ marginTop: 12 }}>
            {fields.map((field) => (
              <Field key={field.name} label={field.label} hint={field.hint}>
                {field.type === "textarea" ? (
                  <textarea
                    className="textarea"
                    value={draft[field.name] || ""}
                    disabled={disabled}
                    onChange={update(field.name)}
                  />
                ) : field.type === "date" ? (
                  <DatePicker
                    value={draft[field.name] || ""}
                    disabled={disabled}
                    onChange={updateValue(field.name)}
                  />
                ) : field.type === "country" ? (
                  <Select
                    value={draft[field.name] || ""}
                    disabled={disabled}
                    placeholder="Select a country"
                    options={COUNTRY_OPTIONS}
                    onChange={updateCountry(field.name)}
                  />
                ) : field.type === "region" ? (
                  <Select
                    value={draft[field.name] || ""}
                    disabled={disabled || !draft[field.dependsOn]}
                    placeholder={draft[field.dependsOn] ? "Select a state / region" : "Choose a country first"}
                    options={regionOptionsFor(draft[field.dependsOn])}
                    onChange={updateValue(field.name)}
                  />
                ) : field.type === "year" ? (
                  <Select
                    value={draft[field.name] || ""}
                    disabled={disabled}
                    placeholder="Select a year"
                    options={YEAR_OPTIONS}
                    onChange={updateValue(field.name)}
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

            {disabled ? null : (
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save section"}
              </Button>
            )}
          </form>
        </>
      ) : (
        <p className="appdash-section-summary">
          {filled === 0
            ? "Nothing entered yet."
            : `${filled} of ${fields.length} fields filled.`}
          {disabled ? " · locked" : ""}
        </p>
      )}
    </div>
  );
};

const AppStep = ({ step }) => {
  const glyph =
    step.state === "done" ? "✓" : step.state === "current" ? "•" : "";
  return (
    <li className={`appdash-step ${step.state}`}>
      <span className="appdash-step-glyph" aria-hidden="true">{glyph}</span>
      <span>{step.step_label}</span>
    </li>
  );
};

const ApplicationDashboard = () => {
  const { applicationId } = useParams();
  const navigate = useNavigate();

  // Not useSchool() — that resolves the school through a membership-gated
  // policy, and an applicant is never a school_members row. This is the
  // same non-member-safe lookup the anonymous /Apply form already uses.
  const [school, setSchool] = useState(null);
  useEffect(() => {
    supabase
      .rpc("public_school", { target_slug: resolveSlug() })
      .then(({ data }) => {
        if (data?.length) setSchool(data[0]);
      })
      .catch(() => {});
  }, []);

  const [application, setApplication] = useState(null);
  const [steps, setSteps] = useState([]);
  const [config, setConfig] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [offer, setOffer] = useState(null);
  const [acceptanceInvoice, setAcceptanceInvoice] = useState(null);
  const [clearance, setClearance] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [declaration, setDeclaration] = useState(false);
  const [decliningOffer, setDecliningOffer] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [uploadingDocId, setUploadingDocId] = useState(null);
  const [docError, setDocError] = useState("");
  const live = useLiveApplicationUpdates(applicationId);

  const load = useCallback(async () => {
    if (!applicationId || !school?.id) return;
    setLoading(true);
    try {
      const [apps, workflow] = await Promise.all([
        fetchMyApplications(school.id),
        fetchApplicationWorkflowSteps(applicationId).catch(() => []),
      ]);
      const app = apps.find((a) => a.id === applicationId);
      if (!app) {
        setError("This application could not be found on your account.");
        return;
      }
      setApplication(app);
      setSteps(workflow);

      const [cfg, inv, ev, off, docs] = await Promise.all([
        fetchAdmissionConfig({ schoolId: app.school_id, sessionId: app.session_id }),
        fetchMyApplicationInvoice(app.id, "application_fee", school?.id).catch(() => null),
        fetchApplicationEvents(app.id, app.school_id).catch(() => []),
        fetchMyOffer(app.id, school?.id).catch(() => null),
        fetchMyApplicationDocuments(app.id).catch(() => []),
      ]);
      setConfig(cfg);
      setInvoice(inv);
      setEvents(ev);
      setOffer(off);
      setDocuments(docs);
      setAcceptanceInvoice(
        off?.status === "accepted"
          ? await fetchMyApplicationInvoice(app.id, "acceptance_fee", school?.id).catch(() => null)
          : null
      );
      setClearance(
        off?.status === "accepted"
          ? await fetchMyClearance(app.id, app.school_id).catch(() => [])
          : []
      );
    } catch (err) {
      setError(err.message || "Could not load your application.");
    } finally {
      setLoading(false);
    }
  }, [applicationId, school?.id]);

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

  // Once an offer is accepted, payment_state is repurposed for the
  // acceptance fee (see the offer card below) — the application fee was
  // already resolved to reach this point, so its own card retires.
  const feeVisible =
    config?.application_fee_enabled &&
    application &&
    application.payment_state !== "not_required" &&
    application.offer_state !== "accepted";

  const feeBadge =
    application?.payment_state === "verified" ? "success" :
    application?.payment_state === "processing" ? "brand" :
    application?.payment_state === "rejected" ? "danger" :
    "warn";

  // The form genuinely locks now (075_application_section_fee_gate.sql
  // added the same check to save_application_section) — this just makes
  // the UI match what the database already enforces, rather than showing
  // an editable section that would fail on save.
  const feeLocked = feeVisible && application?.payment_state !== "verified";

  const goToFee = async () => {
    if (!application) return;
    // Move the row to processing before handing off, so a reload cannot
    // present the Pay again button while the gateway confirms. The same
    // function and the same payment_state column are reused for the
    // acceptance fee below — pay_application_fee_initiated only ever
    // touches applications.payment_state, so it has no idea which fee it is.
    try {
      await markApplicationPaymentInitiated(application.id);
    } catch {
      /* not fatal — the fees page runs the same guard */
    }
    navigate(`/Fees?application=${application.id}`);
  };

  const acceptTheOffer = async () => {
    if (!offer) return;
    setSubmitting(true);
    setError("");
    try {
      const app = await acceptOffer(offer.id);
      setApplication(app);
      const [workflow, off, acc, clr] = await Promise.all([
        fetchApplicationWorkflowSteps(app.id).catch(() => []),
        fetchMyOffer(app.id, school?.id).catch(() => null),
        fetchMyApplicationInvoice(app.id, "acceptance_fee", school?.id).catch(() => null),
        fetchMyClearance(app.id, app.school_id).catch(() => []),
      ]);
      setSteps(workflow);
      setOffer(off);
      setAcceptanceInvoice(acc);
      setClearance(clr);
    } catch (err) {
      setError(err.message || "Could not accept this offer.");
    } finally {
      setSubmitting(false);
    }
  };

  const declineTheOffer = async () => {
    if (!offer) return;
    setSubmitting(true);
    setError("");
    try {
      const app = await declineOffer({ offerId: offer.id, reason: declineReason.trim() || null });
      setApplication(app);
      const [workflow, off] = await Promise.all([
        fetchApplicationWorkflowSteps(app.id).catch(() => []),
        fetchMyOffer(app.id, school?.id).catch(() => null),
      ]);
      setSteps(workflow);
      setOffer(off);
      setDecliningOffer(false);
      setDeclineReason("");
    } catch (err) {
      setError(err.message || "Could not decline this offer.");
    } finally {
      setSubmitting(false);
    }
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

  const uploadDoc = (doc) => async (file) => {
    if (!file) return;
    setUploadingDocId(doc.id);
    setDocError("");
    try {
      await uploadMyApplicationDocument({
        schoolId: application.school_id,
        applicationId: application.id,
        requirementId: doc.id,
        file,
        kind: doc.requirement?.kind,
      });
      setDocuments(await fetchMyApplicationDocuments(application.id).catch(() => documents));
    } catch (err) {
      setDocError(err.message || "Could not upload that file.");
    } finally {
      setUploadingDocId(null);
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
      <>
        <ApplicantShell school={school} />
        <Page>
          <Empty>{"Loading your application..."}</Empty>
        </Page>
      </>
    );
  }

  // Only a genuine load failure (nothing to show at all) replaces the whole
  // page. An error from an action taken further down — a declined submit, a
  // failed accept — belongs inline, next to the thing that failed, not as a
  // reason to throw away everything the applicant can already see.
  if (!application) {
    return (
      <>
        <ApplicantShell school={school} />
        <Page title="Application">
          <Notice tone="error">{error}</Notice>
          <Link to="/Applications">
            <Button variant="secondary">{"Back to my applications"}</Button>
          </Link>
        </Page>
      </>
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

  const [statusLabel, statusTone] = STATUS_META[application.status] || [application.status, "muted"];

  const heroTone =
    ["offered", "accepted", "enrolled"].includes(application.status) ? "good" :
    ["rejected", "declined"].includes(application.status) ? "somber" :
    "";

  // One plain-language line telling the applicant exactly what today's
  // situation is and what, if anything, they should do about it — the
  // single most-asked question this whole page exists to answer.
  const heroMessage = needsCorrection
    ? "The school asked you to fix something — see “Action required” below."
    : offer?.status === "issued"
    ? "Congratulations! Review your offer below and let the school know your decision."
    : offer?.status === "accepted" && application.payment_state !== "verified" && acceptanceInvoice
    ? "You accepted your offer — next, settle the acceptance fee below."
    : offer?.status === "accepted"
    ? "You're all set. The school will be in touch about next steps."
    : offer?.status === "declined"
    ? "You declined this offer."
    : application.status === "rejected"
    ? "This application was not successful this time."
    : feeVisible && application.payment_state !== "verified"
    ? "Pay the application fee below to unlock the rest of your form."
    : canSubmit
    ? "Fill in every section below, then submit when you're ready."
    : isReadonly
    ? "Your application is with the school. This page updates as things move — no need to keep checking back."
    : "Let's get your application started.";

  return (
    <>
      <ApplicantShell school={school} />
      <Page
        title={application.reference}
        subtitle={school ? `Application to ${school.name}` : "Application"}
      >
        <LiveUpdateBanner count={live.count} onReload={() => { live.reset(); load(); }} />
        <Notice tone="error">{error}</Notice>

        <div className={`appdash-hero ${heroTone}`}>
          <div>
            <div className="appdash-hero-ref">{application.reference}</div>
            <h2 className="appdash-hero-title">{statusLabel}</h2>
            <p className="appdash-hero-sub">{heroMessage}</p>
          </div>
          <div className="appdash-hero-status">
            <Badge tone={statusTone}>{statusLabel}</Badge>
            {application.submitted_at ? (
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {`Submitted ${formatDate(application.submitted_at, { withTime: false })}`}
              </span>
            ) : null}
          </div>
        </div>

        {/* The workflow tracker — steps come from the database, so a session
            with no fees, no interview and no referees doesn't show them. */}
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{"Progress"}</h3>
          <ul className="appdash-steps">
            {steps.map((step) => (
              <AppStep key={step.step_key} step={step} />
            ))}
          </ul>
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

        {documents.length > 0 ? (
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{"Documents"}</h3>
            <Notice tone="error">{docError}</Notice>
            <ul className="doc-list">
              {documents.map((d) => {
                const canUpload = ["not_uploaded", "rejected", "resubmission_required"].includes(d.status);
                const uploading = uploadingDocId === d.id;
                return (
                  <li key={d.id} className="doc-row">
                    <div>
                      <strong>{d.requirement?.label || "Document"}</strong>
                      {d.requirement?.is_required ? (
                        <span className="doc-req"> · required</span>
                      ) : (
                        <span className="doc-req"> · optional</span>
                      )}
                      {d.decision_note ? <div className="doc-note">{d.decision_note}</div> : null}
                      {d.file?.file_name ? (
                        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
                          {d.file.file_name}
                        </div>
                      ) : null}
                    </div>
                    <div className="doc-actions">
                      <Badge tone={
                        d.status === "verified" ? "success" :
                        d.status === "rejected" ? "danger" :
                        d.status === "waived" ? "muted" :
                        (d.status === "uploaded" || d.status === "under_review") ? "brand" : "warn"
                      }>{d.status.replace(/_/g, " ")}</Badge>
                      {canUpload ? (
                        <label className="btn btn-secondary btn-sm" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
                          {uploading ? "Uploading..." : d.status === "not_uploaded" ? "Upload" : "Re-upload"}
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*"
                            style={{ display: "none" }}
                            disabled={uploading}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) uploadDoc(d)(file);
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        {offer ? (
          <Card
            className={`appdash-offer ${offer.status}`}
            style={{ marginBottom: 16 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <h3 style={{ margin: 0 }}>
                {offer.status === "issued" ? "You have an offer!" : "Your offer"}
              </h3>
              <Badge tone={
                offer.status === "accepted" ? "success" :
                offer.status === "declined" ? "danger" :
                offer.status === "expired" ? "muted" : "brand"
              }>{offer.status}</Badge>
            </div>
            {offer.conditions ? <p>{offer.conditions}</p> : null}
            {offer.expires_at ? (
              <p style={{ color: "var(--ink-3)", fontSize: 13.5 }}>
                {offer.status === "issued" && new Date(offer.expires_at) < new Date()
                  ? `This offer expired ${formatDate(offer.expires_at, { withTime: false })}.`
                  : `Valid until ${formatDate(offer.expires_at, { withTime: false })}.`}
              </p>
            ) : null}

            {offer.status === "issued" ? (
              decliningOffer ? (
                <div>
                  <Field label="Reason" hint="Optional, but it helps the school.">
                    <textarea className="textarea" value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)} />
                  </Field>
                  <div className="btn-row">
                    <Button variant="danger" disabled={submitting} onClick={declineTheOffer}>
                      {submitting ? "Sending..." : "Confirm decline"}
                    </Button>
                    <Button variant="ghost" disabled={submitting} onClick={() => setDecliningOffer(false)}>
                      {"Back"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="btn-row">
                  <Button disabled={submitting} onClick={acceptTheOffer}>
                    {submitting ? "Accepting..." : "Accept offer"}
                  </Button>
                  <Button variant="secondary" disabled={submitting} onClick={() => setDecliningOffer(true)}>
                    {"Decline"}
                  </Button>
                </div>
              )
            ) : null}

            {offer.status === "declined" ? (
              <Notice tone="muted">{"You declined this offer."}</Notice>
            ) : null}

            {offer.status === "accepted" && acceptanceInvoice ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <strong>{"Acceptance fee"}</strong>
                  <Badge tone={feeBadge}>{application.payment_state}</Badge>
                </div>
                <p style={{ margin: "6px 0" }}>{`Invoice ${acceptanceInvoice.reference}`}</p>
                {application.payment_state === "processing" ? (
                  <Notice tone="brand">
                    {"We are confirming your payment with the bank. You do not need to pay again."}
                  </Notice>
                ) : null}
                {application.payment_state === "verified" ? (
                  <Notice tone="success">{"Your acceptance fee has been received."}</Notice>
                ) : (
                  <Button onClick={goToFee}>
                    {application.payment_state === "processing" ? "View payment" : "Pay acceptance fee"}
                  </Button>
                )}
              </div>
            ) : null}
          </Card>
        ) : null}

        {offer?.status === "accepted" && clearance.length > 0 ? (
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{"Clearance"}</h3>
            <p style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 0 }}>
              {"Departments the school checks before you register. This updates as each one signs off — no action is needed from you here."}
            </p>
            <ul className="doc-list">
              {clearance.map((item) => (
                <li key={item.id} className="doc-row">
                  <div>
                    <strong>{item.department?.name || "Department"}</strong>
                    {item.decision_note && item.status === "rejected" ? (
                      <div className="doc-note">{item.decision_note}</div>
                    ) : null}
                  </div>
                  <Badge tone={
                    item.status === "cleared" ? "success" :
                    item.status === "rejected" ? "danger" :
                    item.status === "waived" ? "muted" :
                    item.status === "in_progress" ? "brand" : "warn"
                  }>{item.status === "pending" ? "not started" : item.status}</Badge>
                </li>
              ))}
            </ul>
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

        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>{"Application form"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 13.5, marginTop: 0, marginBottom: 4 }}>
            {"Tap a section to open it."}
          </p>

          <Section
            title="Personal information"
            value={application.personal_info}
            disabled={!editable.personal || feeLocked}
            defaultOpen={!!editable.personal && !feeLocked}
            onSave={saveSection("personal")}
            fields={[
              { name: "first_name", label: "First name" },
              { name: "middle_name", label: "Middle name" },
              { name: "surname", label: "Surname" },
              { name: "date_of_birth", label: "Date of birth", type: "date" },
              { name: "gender", label: "Gender" },
              { name: "nationality", label: "Nationality", type: "country" },
              { name: "state_of_origin", label: "State of origin", type: "region", dependsOn: "nationality" },
              { name: "address", label: "Home address", type: "textarea" },
              { name: "phone", label: "Phone" },
              { name: "email", label: "Email", type: "email" },
            ]}
          />

          <Section
            title="Education history"
            description="Where you have studied so far, most recent first."
            value={application.education_history}
            disabled={!editable.education || feeLocked}
            defaultOpen={!!editable.education && !feeLocked}
            onSave={saveSection("education")}
            fields={[
              { name: "school_name", label: "School name" },
              { name: "country", label: "Country", type: "country" },
              { name: "start_year", label: "Start year", type: "year" },
              { name: "end_year", label: "End year", type: "year" },
              { name: "qualification", label: "Qualification" },
            ]}
          />

          <Section
            title="Examination results"
            description="Your exam results — WAEC/NECO/NABTEB/JAMB or whatever your school runs."
            value={application.exam_results}
            disabled={!editable.exams || feeLocked}
            defaultOpen={!!editable.exams && !feeLocked}
            onSave={saveSection("exams")}
            fields={[
              { name: "exam_type", label: "Exam" },
              { name: "exam_number", label: "Exam number" },
              { name: "exam_year", label: "Exam year", type: "year" },
              { name: "subjects", label: "Subjects and grades", type: "textarea", hint: "One per line, e.g. Mathematics — B3" },
            ]}
          />

          {config?.require_next_of_kin !== false ? (
            <Section
              title="Next of kin"
              value={application.next_of_kin}
              disabled={!editable.next_of_kin || feeLocked}
              defaultOpen={!!editable.next_of_kin && !feeLocked}
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
              disabled={!editable.referees || feeLocked}
              defaultOpen={!!editable.referees && !feeLocked}
              onSave={saveSection("referees")}
              fields={[
                { name: "referee_1_name", label: "Referee 1 — name" },
                { name: "referee_1_email", label: "Referee 1 — email", type: "email" },
                { name: "referee_2_name", label: "Referee 2 — name" },
                { name: "referee_2_email", label: "Referee 2 — email", type: "email" },
              ]}
            />
          ) : null}
        </Card>

        {canSubmit ? (
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{"Submit"}</h3>
            {feeLocked ? (
              <Notice tone="warn">{"Pay the application fee above before you can submit."}</Notice>
            ) : (
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
            )}
            <div style={{ marginTop: 12 }}>
              <Button
                disabled={!declaration || submitting || feeLocked}
                onClick={submit}
              >
                {submitting ? "Submitting..." : "Submit application"}
              </Button>
            </div>
          </Card>
        ) : null}

        {/* Timeline — every event the database recorded, in reverse
            chronological order. This is the audit trail. */}
        <Card>
          <h3 style={{ marginTop: 0 }}>{"Application timeline"}</h3>
          {events.length === 0 ? (
            <Empty>{"Nothing recorded yet."}</Empty>
          ) : (
            <ul className="appdash-timeline">
              {[...events].reverse().map((event) => (
                <li key={event.id}>
                  <span className="appdash-timeline-dot" aria-hidden="true" />
                  <div>
                    <div className="appdash-timeline-meta">
                      {formatDate(event.created_at, { withTime: true })} · {event.actor_label || "System"}
                    </div>
                    <div className="appdash-timeline-note">
                      {event.note || `${event.status_from || "–"} → ${event.status_to}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Page>
    </>
  );
};

export default ApplicationDashboard;
