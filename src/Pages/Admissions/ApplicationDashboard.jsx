import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { allCountries } from "country-region-data";
import { ApplicantShell } from "../../Components/ApplicantShell";
import { resolveSlug } from "../../lib/tenant";
import {
  fetchMyApplications,
  fetchApplicationWorkflowSteps,
  fetchAdmissionConfig,
  fetchMyApplicationInvoice,
  saveApplicationSection,
  submitMyApplication,
  markApplicationPaymentInitiated,
  cancelApplicationPayment,
  startOnlinePayment,
  declareAdmissionsPayment,
  uploadPaymentProof,
  PAYMENT_METHODS,
  resubmitApplicationCorrection,
  fetchApplicationEvents,
  fetchMyOffer,
  acceptOffer,
  declineOffer,
  fetchMyClearance,
  fetchMyApplicationDocuments,
  uploadMyApplicationDocument,
  fetchMyApplicationScreening,
  fetchMyApplicationLetter,
} from "../../lib/api";
import { openPaystackPayment } from "../../lib/paystack";
import {
  Page,
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
import { useActionFeedback } from "../../Components/Toast";
import AdmissionLetter from "./AdmissionLetter";
import { todayISO } from "../../lib/dates";
import { fetchPublicSchool } from "../../lib/publicSchool";

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

// Education history's "qualification" is whatever certificate/diploma/degree
// the applicant earned at that school, and the name for the very same thing
// differs by country (WASSCE in West Africa, GCSE/A-Level in the UK, a
// Bachelor's degree everywhere) — a free-text box invites a dozen spellings
// of the same qualification. This is a curated spread across the systems an
// applicant is likely to have come through, primary to postgraduate,
// roughly in the order someone would earn them. "Other" plus the free-text
// box it reveals below covers anything genuinely not on the list, and also
// keeps showing whatever was typed in here before this dropdown existed.
const QUALIFICATION_OPTIONS = [
  "Primary School Leaving Certificate (PSLC)",
  "Basic Education Certificate (BECE / JSCE)",
  "General Certificate of Secondary Education (GCSE)",
  "International General Certificate of Secondary Education (IGCSE)",
  "West African Senior School Certificate (WASSCE / SSCE)",
  "National Examination Council Certificate (NECO)",
  "National Business and Technical Examinations Board Certificate (NABTEB)",
  "GCE Ordinary Level (O'Level)",
  "GCE Advanced Level (A'Level)",
  "Kenya Certificate of Secondary Education (KCSE)",
  "Uganda Certificate of Education (UCE)",
  "Uganda Advanced Certificate of Education (UACE)",
  "Senior Secondary Certificate Examination (India — CBSE/ICSE/State Board)",
  "Higher Secondary Certificate (HSC)",
  "Matriculation Certificate (Matric)",
  "High School Diploma",
  "International Baccalaureate (IB) Diploma",
  "Baccalauréat",
  "Abitur",
  "National Certificate in Education (NCE)",
  "Ordinary National Diploma (OND)",
  "National Diploma (ND)",
  "Higher National Diploma (HND)",
  "Associate Degree",
  "Bachelor's Degree (BA / BSc / BEng, etc.)",
  "Postgraduate Diploma (PGD)",
  "Master's Degree (MA / MSc / MBA, etc.)",
  "Doctorate (PhD)",
].map((label) => ({ value: label, label }));
const QUALIFICATION_OTHER = "__other__";
const isKnownQualification = (v) => QUALIFICATION_OPTIONS.some((o) => o.value === v);

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

// What the payment state means to a parent. "processing" only means an online
// payment was started; on its own it read as though money was on its way.
const PAYMENT_LABEL = {
  unpaid: ["Not paid yet", "warn"],
  processing: ["Payment started, not confirmed", "warn"],
  pending: ["Waiting for the school to confirm", "brand"],
  partial: ["Part paid", "warn"],
  verified: ["Paid", "success"],
  rejected: ["Payment not accepted", "danger"],
  not_required: ["Not needed", "muted"],
};

const DOC_STATUS = {
  not_uploaded: ["Not uploaded", "warn"],
  uploaded: ["Uploaded", "brand"],
  under_review: ["Being checked", "brand"],
  verified: ["Accepted", "success"],
  rejected: ["Not accepted", "danger"],
  resubmission_required: ["Please upload again", "danger"],
  waived: ["Not needed", "muted"],
};

// The section keys the school's correction request uses, as the form names them.
const SECTION_TITLE = {
  personal: "Personal information",
  education: "Education history",
  exams: "Examination results",
  next_of_kin: "Next of kin",
  referees: "Referees",
};

// The nineteen workflow steps (application_workflow_steps) in four stages a
// parent can hold in their head.
const STAGES = [
  { key: "apply", label: "Apply", steps: ["account", "programme", "fee_invoice", "fee_paid", "form_personal", "form_education", "form_exams", "form_nok", "form_referees", "documents", "submit"] },
  { key: "review", label: "School review", steps: ["review", "action", "interview"] },
  { key: "decision", label: "Decision", steps: ["decision", "offer", "acceptance_fee"] },
  { key: "enrol", label: "Enrolment", steps: ["clearance", "registration"] },
];

// "A, B and C"
const listOf = (items) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

// Moves to a part of the page, below the sticky header.
const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

// A section of the applicant's form. Collapses to a one-line summary once
// it's locked (already submitted, or not yet the flagged correction target)
// instead of staying open at full height — five long forms stacked and
// permanently expanded was the single biggest source of scroll fatigue on
// this page for anyone past the fill-in stage.
// A "qualification" field is in free-text mode (showing the extra input
// below the Select) whenever it already holds a value that isn't one of the
// preset options — either because the applicant picked "Other", or because
// this is old data saved back when the field was a plain text box.
const computeCustomQual = (fields, value) => {
  const map = {};
  fields.forEach((f) => {
    if (f.type === "qualification") {
      const v = value?.[f.name];
      map[f.name] = !!v && !isKnownQualification(v);
    }
  });
  return map;
};

const Section = ({ id, title, description, value, onSave, disabled, fields, defaultOpen, flagged = false, lockReason = "" }) => {
  const [draft, setDraft] = useState(value || {});
  const [open, setOpen] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);
  const { setError, setNotice } = useActionFeedback();
  const [customQual, setCustomQual] = useState(() => computeCustomQual(fields, value));

  useEffect(() => setDraft(value || {}), [value]);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  useEffect(() => setCustomQual(computeCustomQual(fields, value)), [fields, value]);

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
    <div className={`appdash-form-section${flagged ? " apd-flagged" : ""}`} id={id}>
      <button
        type="button"
        className="appdash-section-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <h3>{title}</h3>
        {flagged ? <Badge tone="danger">{"Needs correcting"}</Badge> : null}
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
          {disabled && lockReason ? <p className="apd-lock-note">{lockReason}</p> : null}
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
                ) : field.type === "qualification" ? (
                  <>
                    <Select
                      value={customQual[field.name] ? QUALIFICATION_OTHER : draft[field.name] || ""}
                      disabled={disabled}
                      placeholder="Select a qualification"
                      options={[...QUALIFICATION_OPTIONS, { value: QUALIFICATION_OTHER, label: "Other" }]}
                      onChange={(next) => {
                        const isOther = next === QUALIFICATION_OTHER;
                        setCustomQual((c) => ({ ...c, [field.name]: isOther }));
                        updateValue(field.name)(isOther ? "" : next);
                      }}
                    />
                    {customQual[field.name] ? (
                      <input
                        className="input"
                        style={{ marginTop: 8 }}
                        placeholder="Type your qualification"
                        value={draft[field.name] || ""}
                        disabled={disabled}
                        onChange={update(field.name)}
                      />
                    ) : null}
                  </>
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
            : `${filled} of ${fields.length} filled.`}
          {disabled && lockReason ? ` · ${lockReason}` : disabled ? " · locked" : ""}
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

const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map(([value, label]) => ({ value, label }));

// The admissions equivalent of Fees.jsx's own "I already paid" disclosure —
// trimmed, since there's no partial-payment concept on a fixed fee: the
// amount is the invoice's own, not something the applicant types in.
const DeclareAdmissionsPayment = ({ invoice, amount, schoolId, onDeclared }) => {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  // The date on the applicant's own calendar, not UTC's (src/lib/dates.js).
  const [paidOn, setPaidOn] = useState(todayISO());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const { setError } = useActionFeedback();

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let proofPath = null;
      if (file) {
        proofPath = await uploadPaymentProof({ schoolId, invoiceId: invoice.id, file });
      }
      await declareAdmissionsPayment({
        invoiceId: invoice.id,
        amount,
        method,
        reference: reference.trim(),
        paidOn,
        proofPath,
      });
      setOpen(false);
      setReference("");
      setFile(null);
      await onDeclared();
    } catch (err) {
      setError(err.message || "Could not send that.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {"Paid by transfer instead?"}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginTop: 0 }}>
        {"Tell the school about a payment you have already made. It is checked against the account before it counts."}
      </p>
      <div className="split">
        <Field label="How you paid">
          <Select value={method} onChange={setMethod} options={PAYMENT_METHOD_OPTIONS} />
        </Field>
        <Field label="When">
          <DatePicker value={paidOn} onChange={setPaidOn} />
        </Field>
      </div>
      <Field label="Teller or transfer reference" hint="Optional, but it speeds the check up.">
        <input
          className="input"
          value={reference}
          placeholder="GTB/8891"
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>
      <Field label="Receipt" hint="A photograph of the teller, or the transfer screenshot.">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </Field>
      <div className="btn-row">
        <Button type="submit" disabled={busy}>
          {busy ? "Sending..." : "Send to the bursary"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {"Cancel"}
        </Button>
      </div>
    </form>
  );
};

const ApplicationDashboard = () => {
  const { applicationId } = useParams();

  // Not useSchool() — that resolves the school through a membership-gated
  // policy, and an applicant is never a school_members row. This is the
  // same non-member-safe lookup the anonymous /Apply form already uses.
  const [school, setSchool] = useState(null);
  useEffect(() => {
    fetchPublicSchool(resolveSlug())
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
  const [screening, setScreening] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();
  const [submitting, setSubmitting] = useState(false);
  const [declaration, setDeclaration] = useState(false);
  const [decliningOffer, setDecliningOffer] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [uploadingDocId, setUploadingDocId] = useState(null);
  const { setError: setDocError } = useActionFeedback();
  const [letterApp, setLetterApp] = useState(null);
  const [letterLoading, setLetterLoading] = useState(false);
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

      const [cfg, inv, ev, off, docs, screen] = await Promise.all([
        fetchAdmissionConfig({ schoolId: app.school_id, sessionId: app.session_id }),
        fetchMyApplicationInvoice(app.id, "application_fee", school?.id).catch(() => null),
        fetchApplicationEvents(app.id, app.school_id).catch(() => []),
        fetchMyOffer(app.id, school?.id).catch(() => null),
        fetchMyApplicationDocuments(app.id).catch(() => []),
        fetchMyApplicationScreening(app.id).catch(() => []),
      ]);
      setConfig(cfg);
      setInvoice(inv);
      setEvents(ev);
      setOffer(off);
      setDocuments(docs);
      setScreening(screen);
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
  }, [applicationId, school?.id, setError]);

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

  // The form genuinely locks now (075_application_section_fee_gate.sql
  // added the same check to save_application_section) — this just makes
  // the UI match what the database already enforces, rather than showing
  // an editable section that would fail on save.
  const feeLocked = feeVisible && application?.payment_state !== "verified";

  const [payingOnline, setPayingOnline] = useState(false);

  // Straight to Paystack — not /Fees, which is the member-only family
  // portal and hangs forever for an applicant (no school_id: they are not
  // a school_members row). The same function and the same payment_state
  // column are reused for the acceptance fee below — pay_application_fee_
  // initiated only ever touches applications.payment_state, so it has no
  // idea which fee it is; targetInvoice is what tells payable_now/pay-init
  // which one to actually charge.
  const payFee = async (targetInvoice) => {
    if (!application || !targetInvoice || payingOnline) return;
    setError("");
    setPayingOnline(true);
    try {
      await markApplicationPaymentInitiated(application.id);
      const { authorizationUrl } = await startOnlinePayment({ invoiceId: targetInvoice.id });
      openPaystackPayment(authorizationUrl);
    } catch (err) {
      setError(err.message || "Could not start that payment.");
      // The attempt never reached the gateway — leaving payment_state at
      // "processing" here is exactly how it gets stuck forever. Revert so
      // the button goes back to "Pay" rather than a dead "View payment".
      try {
        setApplication(await cancelApplicationPayment(application.id));
      } catch {
        /* best effort — "Cancel and try again" below still works */
      }
      setPayingOnline(false);
    }
  };

  // For when the applicant comes back later still stuck in "processing" —
  // abandoned the gateway's own page, closed the tab, the bank declined.
  const cancelPayment = async () => {
    if (!application) return;
    setError("");
    try {
      setApplication(await cancelApplicationPayment(application.id));
    } catch (err) {
      setError(err.message || "Could not cancel that payment attempt.");
    }
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

  const openLetter = async () => {
    setLetterLoading(true);
    setError("");
    try {
      setLetterApp(await fetchMyApplicationLetter(application.id));
    } catch (err) {
      setError(err.message || "Could not open the admission letter.");
    } finally {
      setLetterLoading(false);
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
          <Link to="/Applications">
            <Button variant="secondary">{"Back to my applications"}</Button>
          </Link>
        </Page>
      </>
    );
  }

  if (letterApp) {
    return (
      <AdmissionLetter
        application={letterApp}
        className={letterApp.classes?.name}
        onClose={() => setLetterApp(null)}
      />
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

  const [statusLabel] = STATUS_META[application.status] || [application.status];

  const heroTone =
    ["offered", "accepted", "enrolled"].includes(application.status) ? "good" :
    ["rejected", "declined"].includes(application.status) ? "somber" :
    "";

  // One plain-language line telling the applicant exactly what today's
  // situation is and what, if anything, they should do about it — the
  // single most-asked question this whole page exists to answer.
  const heroMessage = needsCorrection && feeLocked
    ? "The school asked for some corrections. Pay the application fee first; that opens the form so you can make them."
    : needsCorrection
    ? "The school asked you to correct some answers. The steps are below."
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

  // ------------------------------------------------ what the page shows --

  const [payLabel, payTone] = PAYMENT_LABEL[application.payment_state] || [application.payment_state, "muted"];
  const flaggedSections = needsCorrection ? application.correction_sections || [] : [];
  const flaggedTitles = flaggedSections.map((k) => SECTION_TITLE[k] || k);
  const docsToUpload = documents.filter(
    (d) => d.requirement?.is_required && ["not_uploaded", "rejected", "resubmission_required"].includes(d.status)
  );
  const lastPaymentStart = [...events].reverse().find((e) => /payment initiated/i.test(e.note || ""));
  const feeAmount = `${config?.currency || "NGN"} ${(config?.application_fee_amount || 0).toLocaleString()}`;
  const lockReasonFor = (key) =>
    feeLocked
      ? "Opens once the application fee is paid."
      : isReadonly
      ? "Locked while the school reviews your application."
      : needsCorrection && !editable[key]
      ? "The school has not asked for changes here."
      : "";

  // The things the parent has to do, in the order they have to be done. Each
  // one either has its buttons, or says what it is waiting for. This is what
  // the page is for: the old layout led with "fix something below" while the
  // form below was locked behind an unpaid fee.
  const todos = [];
  if (feeLocked) {
    todos.push({
      key: "fee",
      title: `Pay the application fee · ${feeAmount}`,
      body:
        application.payment_state === "processing"
          ? `A payment was started${lastPaymentStart ? ` on ${formatDate(lastPaymentStart.created_at, { withTime: false })}` : ""} but the bank has not confirmed it. If you finished paying, it confirms on its own shortly. If you did not, pay again or cancel that attempt.`
          : "Paying unlocks the form so you can finish your application.",
      actions: (
        <>
          <div className="btn-row">
            <Button disabled={payingOnline} onClick={() => payFee(invoice)}>
              {payingOnline ? "Opening..." : application.payment_state === "processing" ? "Pay again" : "Pay now"}
            </Button>
            {application.payment_state === "processing" ? (
              <Button variant="secondary" onClick={cancelPayment}>{"Cancel unfinished payment"}</Button>
            ) : null}
          </div>
          {invoice ? (
            <div className="apd-todo-extra">
              <DeclareAdmissionsPayment
                invoice={invoice}
                amount={config?.application_fee_amount || 0}
                schoolId={application.school_id}
                onDeclared={load}
              />
            </div>
          ) : null}
        </>
      ),
    });
  }
  if (needsCorrection) {
    todos.push({
      key: "fix",
      title: `Correct ${listOf(flaggedTitles)}`,
      quote: application.correction_reason,
      blocked: feeLocked ? "Unlocks once the fee is paid." : null,
      actions: (
        <Button variant="secondary" disabled={feeLocked} onClick={() => goTo(`section-${flaggedSections[0]}`)}>
          {"Go to the sections"}
        </Button>
      ),
    });
    todos.push({
      key: "resubmit",
      title: "Send it back to the school",
      body: "Once the corrections are saved, resubmit so the school can look again.",
      blocked: feeLocked ? "After the fee and the corrections." : null,
      actions: (
        <Button onClick={resubmit} disabled={submitting || feeLocked}>
          {submitting ? "Resubmitting..." : "Resubmit application"}
        </Button>
      ),
    });
  }
  if (canSubmit) {
    const formSteps = steps.filter((st) => st.step_key.startsWith("form_"));
    const formDone = formSteps.filter((st) => st.state === "done").length;
    todos.push({
      key: "form",
      title: "Fill in the application form",
      body: formSteps.length ? `${formDone} of ${formSteps.length} sections done.` : null,
      blocked: feeLocked ? "Unlocks once the fee is paid." : null,
      actions: (
        <Button variant="secondary" disabled={feeLocked} onClick={() => goTo("apd-form")}>{"Go to the form"}</Button>
      ),
    });
  }
  if (docsToUpload.length > 0) {
    todos.push({
      key: "docs",
      title: `Upload ${docsToUpload.length === 1 ? "a document" : `${docsToUpload.length} documents`}`,
      body: listOf(docsToUpload.map((d) => d.requirement?.label || "Document")),
      actions: <Button variant="secondary" onClick={() => goTo("apd-docs")}>{"Go to documents"}</Button>,
    });
  }
  if (canSubmit) {
    todos.push({
      key: "submit",
      title: "Submit your application",
      blocked: feeLocked ? "After the fee and the form." : null,
      actions: <Button variant="secondary" disabled={feeLocked} onClick={() => goTo("apd-submit")}>{"Go to submit"}</Button>,
    });
  }
  if (offer?.status === "issued") {
    todos.push({
      key: "offer",
      title: "Reply to your offer",
      body: offer.expires_at ? `Please reply by ${formatDate(offer.expires_at, { withTime: false })}.` : null,
      actions: <Button onClick={() => goTo("apd-offer")}>{"See the offer"}</Button>,
    });
  }
  if (offer?.status === "accepted" && acceptanceInvoice && application.payment_state !== "verified") {
    todos.push({
      key: "acceptance",
      title: "Pay the acceptance fee",
      actions: <Button onClick={() => goTo("apd-offer")}>{"Pay the acceptance fee"}</Button>,
    });
  }

  // Four stages from the nineteen steps.
  const stepByKey = Object.fromEntries(steps.map((st) => [st.step_key, st]));
  const stages = STAGES.map((stage) => {
    const own = stage.steps.map((k) => stepByKey[k]).filter(Boolean);
    const done = own.filter((st) => st.state === "done").length;
    return { ...stage, own, done, total: own.length };
  }).filter((stage) => stage.total > 0);
  const currentStage = stages.find((stage) => stage.done < stage.total)?.key;

  const [shownEvents, moreEvents] = [[...events].reverse().slice(0, 6), Math.max(0, events.length - 6)];

  return (
    <>
      <ApplicantShell school={school} />
      <Page>
        <LiveUpdateBanner count={live.count} onReload={() => { live.reset(); load(); }} />

        {/* Who, where, and where it stands. */}
        <header className={`apd-head ${heroTone}`}>
          <div className="apd-head-main">
            <span className="apd-head-ref">{`${application.reference}${school ? ` · ${school.name}` : ""}`}</span>
            <h1 className="apd-head-title">{statusLabel}</h1>
            <p className="apd-head-sub">{heroMessage}</p>
          </div>
          {/* The heading already names the status; a badge beside it repeated it. */}
          <div className="apd-head-side">
            {application.submitted_at ? (
              <span className="apd-muted">{`Submitted ${formatDate(application.submitted_at, { withTime: false })}`}</span>
            ) : null}
            {["offered", "accepted", "enrolled"].includes(application.status) ? (
              <Button size="sm" variant="secondary" disabled={letterLoading} onClick={openLetter}>
                {letterLoading ? "Opening..." : "View admission letter"}
              </Button>
            ) : null}
          </div>
        </header>

        {/* The four stages at a glance. */}
        {stages.length ? (
          <ol className="apd-stages" aria-label="Where your application is">
            {stages.map((stage, i) => {
              const state = stage.done === stage.total ? "done" : stage.key === currentStage ? "current" : "todo";
              return (
                <li key={stage.key} className={`apd-stage ${state}`}>
                  <span className="apd-stage-dot" aria-hidden="true">{state === "done" ? "✓" : i + 1}</span>
                  <span className="apd-stage-text">
                    <strong>{stage.label}</strong>
                    <span>{state === "done" ? "Done" : state === "current" ? `${stage.done} of ${stage.total} steps` : "Later"}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <div className="apd-layout">
          <div className="apd-main">
            {/* What to do next: the heart of the page. */}
            <section className="apd-card apd-next">
              <h2 className="apd-card-title">{todos.length ? "What to do next" : "Nothing for you to do right now"}</h2>
              {todos.length === 0 ? (
                <p className="apd-muted apd-next-calm">{heroMessage}</p>
              ) : (
                <ol className="apd-todos">
                  {todos.map((t, i) => {
                    const waiting = !!t.blocked;
                    return (
                      <li key={t.key} className={`apd-todo${waiting ? " waiting" : ""}${!waiting && todos.findIndex((x) => !x.blocked) === i ? " first" : ""}`}>
                        <span className="apd-todo-num" aria-hidden="true">{i + 1}</span>
                        <div className="apd-todo-body">
                          <strong className="apd-todo-title">{t.title}</strong>
                          {t.quote ? <blockquote className="apd-quote">{`“${t.quote}”`}<span>{"— the school"}</span></blockquote> : null}
                          {t.body ? <p className="apd-todo-text">{t.body}</p> : null}
                          {waiting ? <p className="apd-todo-wait">{t.blocked}</p> : null}
                          {t.actions ? <div className="apd-todo-actions">{t.actions}</div> : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {offer ? (
              <section className={`apd-card appdash-offer ${offer.status}`} id="apd-offer">
                <div className="apd-card-head">
                  <h2 className="apd-card-title">{offer.status === "issued" ? "You have an offer!" : "Your offer"}</h2>
                  <Badge tone={
                    offer.status === "accepted" ? "success" :
                    offer.status === "declined" ? "danger" :
                    offer.status === "expired" ? "muted" : "brand"
                  }>{{ issued: "Waiting for your reply", accepted: "Accepted", declined: "Declined", expired: "Expired" }[offer.status] || offer.status}</Badge>
                </div>
                {offer.conditions ? <p>{offer.conditions}</p> : null}
                {offer.expires_at ? (
                  <p className="apd-muted">
                    {offer.status === "issued" && new Date(offer.expires_at) < new Date()
                      ? `This offer expired ${formatDate(offer.expires_at, { withTime: false })}.`
                      : `Valid until ${formatDate(offer.expires_at, { withTime: false })}.`}
                  </p>
                ) : null}

                {offer.status === "issued" ? (
                  decliningOffer ? (
                    <div>
                      <Field label="Reason" hint="Optional, but it helps the school.">
                        <textarea className="textarea" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
                      </Field>
                      <div className="btn-row">
                        <Button variant="danger" disabled={submitting} onClick={declineTheOffer}>
                          {submitting ? "Sending..." : "Confirm decline"}
                        </Button>
                        <Button variant="ghost" disabled={submitting} onClick={() => setDecliningOffer(false)}>{"Back"}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="btn-row">
                      <Button disabled={submitting} onClick={acceptTheOffer}>{submitting ? "Accepting..." : "Accept offer"}</Button>
                      <Button variant="secondary" disabled={submitting} onClick={() => setDecliningOffer(true)}>{"Decline"}</Button>
                    </div>
                  )
                ) : null}

                {offer.status === "declined" ? <Notice tone="muted">{"You declined this offer."}</Notice> : null}

                {offer.status === "accepted" && acceptanceInvoice ? (
                  <div className="apd-subpanel">
                    <div className="apd-card-head">
                      <strong>{"Acceptance fee"}</strong>
                      <Badge tone={payTone}>{payLabel}</Badge>
                    </div>
                    <p className="apd-muted">{`Bill ${acceptanceInvoice.reference}`}</p>
                    {application.payment_state === "processing" ? (
                      <Notice tone="warn">{"A payment was started but not confirmed by the bank. If you finished paying it confirms shortly; if not, pay again."}</Notice>
                    ) : null}
                    {application.payment_state === "verified" ? (
                      <Notice tone="success">{"Your acceptance fee has been received."}</Notice>
                    ) : (
                      <div className="btn-row">
                        <Button disabled={payingOnline} onClick={() => payFee(acceptanceInvoice)}>
                          {payingOnline ? "Opening..." : application.payment_state === "processing" ? "Pay again" : "Pay acceptance fee"}
                        </Button>
                        {application.payment_state === "processing" ? (
                          <Button variant="secondary" onClick={cancelPayment}>{"Cancel unfinished payment"}</Button>
                        ) : null}
                      </div>
                    )}
                    {application.payment_state !== "verified" ? (
                      <div className="apd-todo-extra">
                        <DeclareAdmissionsPayment
                          invoice={acceptanceInvoice}
                          amount={config?.acceptance_fee_amount || 0}
                          schoolId={application.school_id}
                          onDeclared={load}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {offer?.status === "accepted" && clearance.length > 0 ? (
              <section className="apd-card">
                <h2 className="apd-card-title">{"Clearance"}</h2>
                <p className="apd-muted">{"Departments the school checks before you register. Each one signs off here; nothing is needed from you."}</p>
                <ul className="apd-list">
                  {clearance.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.department?.name || "Department"}</strong>
                        {item.decision_note && item.status === "rejected" ? <div className="doc-note">{item.decision_note}</div> : null}
                      </div>
                      <Badge tone={
                        item.status === "cleared" ? "success" :
                        item.status === "rejected" ? "danger" :
                        item.status === "waived" ? "muted" :
                        item.status === "in_progress" ? "brand" : "warn"
                      }>{{ pending: "Not started", in_progress: "In progress", cleared: "Cleared", rejected: "Not cleared", waived: "Not needed" }[item.status] || item.status}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {documents.length > 0 ? (
              <section className="apd-card" id="apd-docs">
                <h2 className="apd-card-title">{"Documents"}</h2>
                <ul className="apd-list">
                  {documents.map((d) => {
                    const canUpload = ["not_uploaded", "rejected", "resubmission_required"].includes(d.status);
                    const uploading = uploadingDocId === d.id;
                    const [docLabel, docTone] = DOC_STATUS[d.status] || [d.status.replace(/_/g, " "), "muted"];
                    return (
                      <li key={d.id}>
                        <div className="apd-list-main">
                          <strong>{d.requirement?.label || "Document"}</strong>
                          <span className="apd-muted">{d.requirement?.is_required ? " · Required" : " · Optional"}</span>
                          {d.decision_note ? <div className="doc-note">{d.decision_note}</div> : null}
                          {d.file?.file_name ? <div className="apd-file">{d.file.file_name}</div> : null}
                        </div>
                        <div className="apd-list-side">
                          <Badge tone={docTone}>{docLabel}</Badge>
                          {canUpload ? (
                            <label className="btn btn-secondary btn-sm" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
                              {uploading ? "Uploading..." : d.status === "not_uploaded" ? "Upload" : "Upload again"}
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
              </section>
            ) : null}

            {/* Form sections: shown locked with the reason rather than hidden,
                so an applicant always sees what they sent. The ones the
                school asked to correct are marked and open first. */}
            <section className="apd-card" id="apd-form">
              <div className="apd-card-head">
                <h2 className="apd-card-title">{"Application form"}</h2>
                {isReadonly ? <Badge>{"With the school"}</Badge> : null}
              </div>
              <p className="apd-muted apd-form-hint">
                {feeLocked
                  ? "You can read the sections now; they open for editing once the application fee is paid."
                  : needsCorrection
                  ? `The school asked you to correct ${listOf(flaggedTitles)}. Those are open below; save each one, then resubmit.`
                  : isReadonly
                  ? "Your answers are with the school. They are locked while it reviews them."
                  : "Tap a section to open it, fill it in and save. You can come back to it any time before you submit."}
              </p>

              <Section
                id="section-personal"
                title="Personal information"
                value={application.personal_info}
                disabled={!editable.personal || feeLocked}
                defaultOpen={!!editable.personal && !feeLocked}
                flagged={flaggedSections.includes("personal")}
                lockReason={lockReasonFor("personal")}
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
                id="section-education"
                title="Education history"
                description="Where you have studied so far, most recent first."
                value={application.education_history}
                disabled={!editable.education || feeLocked}
                defaultOpen={!!editable.education && !feeLocked}
                flagged={flaggedSections.includes("education")}
                lockReason={lockReasonFor("education")}
                onSave={saveSection("education")}
                fields={[
                  { name: "school_name", label: "School name" },
                  { name: "country", label: "Country", type: "country" },
                  { name: "start_year", label: "Start year", type: "year" },
                  { name: "end_year", label: "End year", type: "year" },
                  { name: "qualification", label: "Qualification", type: "qualification" },
                ]}
              />

              <Section
                id="section-exams"
                title="Examination results"
                description="Your exam results — WAEC/NECO/NABTEB/JAMB or whatever your school runs."
                value={application.exam_results}
                disabled={!editable.exams || feeLocked}
                defaultOpen={!!editable.exams && !feeLocked}
                flagged={flaggedSections.includes("exams")}
                lockReason={lockReasonFor("exams")}
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
                  id="section-next_of_kin"
                  title="Next of kin"
                  value={application.next_of_kin}
                  disabled={!editable.next_of_kin || feeLocked}
                  defaultOpen={!!editable.next_of_kin && !feeLocked}
                  flagged={flaggedSections.includes("next_of_kin")}
                  lockReason={lockReasonFor("next_of_kin")}
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

              {config?.require_referees || flaggedSections.includes("referees") ? (
                <Section
                  id="section-referees"
                  title="Referees"
                  value={application.referees}
                  disabled={!editable.referees || feeLocked}
                  defaultOpen={!!editable.referees && !feeLocked}
                  flagged={flaggedSections.includes("referees")}
                  lockReason={lockReasonFor("referees")}
                  onSave={saveSection("referees")}
                  fields={[
                    { name: "referee_1_name", label: "Referee 1 — name" },
                    { name: "referee_1_email", label: "Referee 1 — email", type: "email" },
                    { name: "referee_2_name", label: "Referee 2 — name" },
                    { name: "referee_2_email", label: "Referee 2 — email", type: "email" },
                  ]}
                />
              ) : null}
            </section>

            {canSubmit ? (
              <section className="apd-card" id="apd-submit">
                <h2 className="apd-card-title">{"Submit your application"}</h2>
                {feeLocked ? (
                  <Notice tone="warn">{"Pay the application fee first; then fill in the form and submit here."}</Notice>
                ) : (
                  <label className="apd-declare">
                    <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
                    <span>{"I confirm that the information above is accurate and complete. I understand that providing false information may result in cancellation of my admission."}</span>
                  </label>
                )}
                <div className="apd-todo-actions">
                  <Button disabled={!declaration || submitting || feeLocked} onClick={submit}>
                    {submitting ? "Submitting..." : "Submit application"}
                  </Button>
                </div>
              </section>
            ) : null}

            {screening.length > 0 ? (
              <section className="apd-card">
                <h2 className="apd-card-title">{"The school's checks"}</h2>
                <p className="apd-muted">{"Steps the school works through, such as an interview or an entrance test. They update here as each one is decided."}</p>
                <ul className="apd-list">
                  {screening.map((sc) => (
                    <li key={sc.id}>
                      <div className="apd-list-main">
                        <strong>{sc.label || "Screening step"}</strong>
                        <span className="apd-muted">{sc.is_required ? " · Required" : " · Optional"}</span>
                        {sc.decision_note ? <div className="doc-note">{sc.decision_note}</div> : null}
                      </div>
                      <Badge tone={sc.status === "passed" ? "success" : sc.status === "failed" ? "danger" : sc.status === "waived" ? "muted" : "warn"}>
                        {sc.status === "passed" ? "Passed" : sc.status === "failed" ? "Not cleared" : sc.status === "waived" ? "Not needed" : sc.status === "correction_required" ? "Needs follow-up" : "Waiting"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          {/* The rail: every step, the fee, and what has happened so far. */}
          <aside className="apd-rail">
            {feeVisible && !feeLocked ? (
              <section className="apd-card apd-rail-card">
                <div className="apd-card-head">
                  <h2 className="apd-card-title">{"Application fee"}</h2>
                  <Badge tone={payTone}>{payLabel}</Badge>
                </div>
                {invoice ? <p className="apd-muted">{`Bill ${invoice.reference} · ${feeAmount}`}</p> : null}
              </section>
            ) : null}

            <section className="apd-card apd-rail-card">
              <h2 className="apd-card-title">{"Every step"}</h2>
              {stages.map((stage) => (
                <div key={stage.key} className="apd-rail-stage">
                  <span className="apd-rail-stage-name">{stage.label}</span>
                  <ul className="apd-steps">
                    {stage.own.map((step) => (
                      <AppStep key={step.step_key} step={step} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            <section className="apd-card apd-rail-card">
              <h2 className="apd-card-title">{"What has happened"}</h2>
              {events.length === 0 ? (
                <Empty>{"Nothing recorded yet."}</Empty>
              ) : (
                <ul className="appdash-timeline">
                  {shownEvents.map((event) => (
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
              {moreEvents > 0 ? (
                <details className="apd-older">
                  <summary>{`Show ${moreEvents} earlier ${moreEvents === 1 ? "event" : "events"}`}</summary>
                  <ul className="appdash-timeline">
                    {[...events].reverse().slice(6).map((event) => (
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
                </details>
              ) : null}
            </section>
          </aside>
        </div>
      </Page>
    </>
  );
};

export default ApplicationDashboard;
