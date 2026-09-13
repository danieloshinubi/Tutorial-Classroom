import React, { useCallback, useEffect, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchSessions,
  fetchAdmissionConfigRow,
  saveAdmissionConfig,
  fetchAdmissionProgrammes,
  createAdmissionProgramme,
  deleteAdmissionProgramme,
  fetchScreeningRequirements,
  upsertScreeningRequirement,
  deleteScreeningRequirement,
  fetchDocumentRequirements,
  upsertDocumentRequirement,
  deleteDocumentRequirement,
} from "../../lib/api";
import { Card, Field, Button, Badge, Notice, Empty, Tabs, MoneyInput, Select } from "../../Components/UI";
import ClearanceDepartmentsPanel from "./ClearanceDepartmentsPanel";

// Defaults mirror classroom.effective_admission_config()'s fallback exactly
// (040_admissions_engine.sql) — what an unconfigured school is already
// running on, so the form never lies about the starting point.
const CONFIG_DEFAULTS = {
  application_fee_enabled: false,
  application_fee_amount: "0",
  currency: "NGN",
  payment_verification: "manual",
  form_locked_until_paid: true,
  acceptance_fee_enabled: false,
  acceptance_fee_amount: "0",
  require_jamb: false,
  require_matric: false,
  require_interview: false,
  require_referees: false,
  require_next_of_kin: true,
  academic_hierarchy: "flat",
  use_applicant_accounts: true,
  allow_anonymous_apply: true,
};

const Toggle = ({ label, hint, checked, onChange }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
    <span>
      <div style={{ fontWeight: 600 }}>{label}</div>
      {hint ? <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{hint}</div> : null}
    </span>
  </label>
);

/* ----------------------------------------------------------- application & fees ---- */
const ConfigPanel = ({ schoolId, sessionId }) => {
  const [form, setForm] = useState(CONFIG_DEFAULTS);
  const [existing, setExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const row = await fetchAdmissionConfigRow({ schoolId, sessionId });
      if (row) {
        setForm({
          ...CONFIG_DEFAULTS,
          ...row,
          application_fee_amount: String(row.application_fee_amount ?? "0"),
          acceptance_fee_amount: String(row.acceptance_fee_amount ?? "0"),
        });
        setExisting(true);
      } else {
        setForm(CONFIG_DEFAULTS);
        setExisting(false);
      }
    } catch (err) {
      setError(err.message || "Could not load this configuration.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, sessionId]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveAdmissionConfig({
        schoolId,
        sessionId,
        ...form,
        application_fee_amount: Number(form.application_fee_amount || 0),
        acceptance_fee_amount: Number(form.acceptance_fee_amount || 0),
      });
      setNotice("Saved.");
      setExisting(true);
    } catch (err) {
      setError(err.message || "Could not save this configuration.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Empty>{"Loading..."}</Empty>;

  return (
    <form onSubmit={save}>
      {!existing ? (
        <Notice tone="muted">
          {"Nothing has been set for this scope yet — the fields below show what applicants currently experience (the built-in defaults). Save to make it explicit."}
        </Notice>
      ) : null}
      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      <Card style={{ marginBottom: 16, maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{"Application fee"}</h3>
        <Toggle label="Charge an application fee" checked={form.application_fee_enabled}
          onChange={set("application_fee_enabled")} />
        {form.application_fee_enabled ? (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 100px", marginTop: 12 }}>
            <Field label="Amount">
              <MoneyInput value={form.application_fee_amount} onChange={set("application_fee_amount")} />
            </Field>
            <Field label="Currency">
              <input className="input" value={form.currency} onChange={(e) => set("currency")(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <Toggle label="Lock the rest of the form until it's paid" checked={form.form_locked_until_paid}
          onChange={set("form_locked_until_paid")}
          hint="If off, applicants can fill in every section before paying." />
        <Field label="How a manual payment is confirmed" hint="Gateway payments always settle themselves regardless of this setting.">
          <Select className="select" value={form.payment_verification}
            onChange={set("payment_verification")}
            options={[
              { value: "manual", label: "A staff member checks proof of payment" },
              { value: "gateway", label: "Only the payment gateway (Paystack) — no manual proof accepted" },
              { value: "automatic", label: "Treated as paid immediately (no verification)" },
            ]} />
        </Field>
      </Card>

      <Card style={{ marginBottom: 16, maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{"Acceptance fee"}</h3>
        <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 0 }}>
          {"Charged once an applicant accepts their offer — a separate invoice from the application fee."}
        </p>
        <Toggle label="Charge an acceptance fee" checked={form.acceptance_fee_enabled}
          onChange={set("acceptance_fee_enabled")} />
        {form.acceptance_fee_enabled ? (
          <Field label="Amount" hint={`In ${form.currency || "NGN"}`}>
            <MoneyInput value={form.acceptance_fee_amount} onChange={set("acceptance_fee_amount")} />
          </Field>
        ) : null}
      </Card>

      <Card style={{ marginBottom: 16, maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{"What the form asks for"}</h3>
        <Toggle label="Require an interview before a decision" checked={form.require_interview}
          onChange={set("require_interview")} />
        <Toggle label="Require referees" checked={form.require_referees}
          onChange={set("require_referees")} />
        <Toggle label="Require next of kin details" checked={form.require_next_of_kin}
          onChange={set("require_next_of_kin")} />
        <Toggle label="Require JAMB details" checked={form.require_jamb}
          onChange={set("require_jamb")} />
        <Toggle label="Require matriculation details" checked={form.require_matric}
          onChange={set("require_matric")} />
      </Card>

      <Card style={{ marginBottom: 16, maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{"How applicants reach the form"}</h3>
        <Field label="Academic structure" hint="Controls whether a programme carries a faculty and/or department.">
          <Select className="select" value={form.academic_hierarchy}
            onChange={set("academic_hierarchy")}
            options={[
              { value: "flat", label: "Flat — no faculty or department" },
              { value: "department_only", label: "Departments only" },
              { value: "faculty_department", label: "Faculties and departments" },
            ]} />
        </Field>
        <Toggle label="Allow signed-in applicants to track their own application" checked={form.use_applicant_accounts}
          onChange={set("use_applicant_accounts")} />
        <Toggle label="Allow anonymous applications (no account needed)" checked={form.allow_anonymous_apply}
          onChange={set("allow_anonymous_apply")} />
      </Card>

      <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save configuration"}</Button>
    </form>
  );
};

/* ----------------------------------------------------------------- programmes ---- */
const ProgrammesPanel = ({ schoolId, sessionId }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", code: "", faculty: "", department: "", study_mode: "full_time", capacity: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchAdmissionProgrammes({ schoolId, sessionId }));
    } catch (err) {
      setError(err.message || "Could not load programmes.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, sessionId]);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.code.trim()) return setError("Name and code are both required.");
    setBusy(true);
    try {
      await createAdmissionProgramme({
        schoolId, sessionId,
        name: form.name.trim(), code: form.code.trim(),
        faculty: form.faculty.trim() || null, department: form.department.trim() || null,
        study_mode: form.study_mode,
        capacity: form.capacity ? Number(form.capacity) : null,
      });
      setForm({ name: "", code: "", faculty: "", department: "", study_mode: "full_time", capacity: "" });
      load();
    } catch (err) {
      setError(err.message || "Could not add that programme.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove "${row.name}"? Applications already against it keep their history.`)) return;
    setBusy(true);
    try {
      await deleteAdmissionProgramme(row.id);
      load();
    } catch (err) {
      setError(err.message || "Could not remove that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "62ch" }}>
        {"What an applicant chooses from at Apply/Start — leave faculty and department blank for a school that doesn't use them."}
      </p>
      <Notice tone="error">{error}</Notice>

      <Card style={{ maxWidth: 680, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>{"Add a programme"}</h3>
        <form onSubmit={add}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
            <Field label="Name"><input className="input" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Code"><input className="input" value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></Field>
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <Field label="Faculty (optional)"><input className="input" value={form.faculty}
              onChange={(e) => setForm((f) => ({ ...f, faculty: e.target.value }))} /></Field>
            <Field label="Department (optional)"><input className="input" value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} /></Field>
            <Field label="Capacity (optional)"><input type="number" className="input" value={form.capacity}
              onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} /></Field>
          </div>
          <Field label="Study mode">
            <Select className="select" value={form.study_mode}
              onChange={(v) => setForm((f) => ({ ...f, study_mode: v }))}
              options={[
                { value: "full_time", label: "Full time" },
                { value: "part_time", label: "Part time" },
                { value: "distance", label: "Distance" },
                { value: "sandwich", label: "Sandwich" },
                { value: "evening", label: "Evening" },
                { value: "other", label: "Other" },
              ]} />
          </Field>
          <Button type="submit" disabled={busy}>{"Add programme"}</Button>
        </form>
      </Card>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && rows.length === 0 ? <Empty>{"No programmes yet for this session."}</Empty> : null}

      {rows.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{"Name"}</th><th>{"Code"}</th><th>{"Faculty / department"}</th><th>{"Mode"}</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td style={{ fontFamily: "monospace" }}>{r.code}</td>
                    <td style={{ color: "var(--ink-3)" }}>{[r.faculty, r.department].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{r.study_mode}</td>
                    <td><Button size="sm" variant="danger" disabled={busy} onClick={() => remove(r)}>{"Delete"}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
};

/* ------------------------------------------------------- screening & documents ---- */
// Shared shape: both tables are a school's own ordered checklist (screening
// steps an officer works through, or documents an applicant must upload),
// scoped the same way (school + optional session, optional programme).
const ChecklistPanel = ({
  title, description, kindLabel, fetchRows, upsertRow, deleteRow, schoolId, sessionId,
}) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ kind: "", label: "", is_required: true, notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchRows({ schoolId, sessionId }));
    } catch (err) {
      setError(err.message || "Could not load these.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, sessionId, fetchRows]);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.kind.trim() || !form.label.trim()) return setError("Give it both a key and a label.");
    setBusy(true);
    try {
      await upsertRow({
        school_id: schoolId, session_id: sessionId,
        kind: form.kind.trim(), label: form.label.trim(),
        is_required: form.is_required, notes: form.notes.trim() || null,
        position: rows.length,
      });
      setForm({ kind: "", label: "", is_required: true, notes: "" });
      load();
    } catch (err) {
      setError(err.message || "Could not add that.");
    } finally {
      setBusy(false);
    }
  };

  const toggleRequired = async (row) => {
    setBusy(true);
    try {
      await upsertRow({ ...row, is_required: !row.is_required });
      load();
    } catch (err) {
      setError(err.message || "Could not update that.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.label}"?`)) return;
    setBusy(true);
    try {
      await deleteRow(row.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "62ch" }}>{description}</p>
      <Notice tone="error">{error}</Notice>

      <Card style={{ maxWidth: 640, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>{`Add ${title.toLowerCase()}`}</h3>
        <form onSubmit={add}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 2fr" }}>
            <Field label={kindLabel} hint="A short internal key, e.g. aptitude_test">
              <input className="input" value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} />
            </Field>
            <Field label="Label shown to staff and applicants">
              <input className="input" value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <input className="input" value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <label style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input type="checkbox" checked={form.is_required}
              onChange={(e) => setForm((f) => ({ ...f, is_required: e.target.checked }))} />
            {"Required"}
          </label>
          <Button type="submit" disabled={busy}>{"Add"}</Button>
        </form>
      </Card>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && rows.length === 0 ? (
        <Empty>{`No ${title.toLowerCase()} configured — none of this is required until you add at least one.`}</Empty>
      ) : null}

      {rows.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{"Label"}</th><th>{"Key"}</th><th>{"Required"}</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.label}</strong>{r.notes ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.notes}</div> : null}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>{r.kind}</td>
                    <td>
                      <Badge tone={r.is_required ? "warn" : undefined}>
                        {r.is_required ? "required" : "optional"}
                      </Badge>
                    </td>
                    <td>
                      <span className="btn-row">
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => toggleRequired(r)}>
                          {r.is_required ? "Make optional" : "Make required"}
                        </Button>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(r)}>{"Delete"}</Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
};

/* --------------------------------------------------------------------- shell ---- */
const AdmissionsSettingsPanel = () => {
  const { schoolId } = useSchool();
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [subTab, setSubTab] = useState("config");

  useEffect(() => {
    if (!schoolId) return;
    fetchSessions(schoolId).then(setSessions).catch(() => {});
  }, [schoolId]);

  const effectiveSessionId = sessionId || null;

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "68ch" }}>
        {"Not every school runs admissions the same way — fees, required documents, screening steps and clearance departments are all configured here, per school, per session. Nothing here needs a developer."}
      </p>

      <div className="panel-top">
        <Field label="Session this applies to" hint="A session-specific setting overrides the school default for that session only.">
          <Select
            className="select"
            style={{ maxWidth: 320 }}
            value={sessionId}
            onChange={setSessionId}
            options={[
              { value: "", label: "School default (every session, unless overridden)" },
              ...sessions.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </Field>
      </div>

      <Tabs
        tabs={[
          { id: "config", label: "Application & fees" },
          { id: "programmes", label: "Programmes" },
          { id: "screening", label: "Screening steps" },
          { id: "documents", label: "Required documents" },
          { id: "clearance", label: "Clearance departments" },
        ]}
        active={subTab}
        onChange={setSubTab}
      />

      <div style={{ marginTop: 16 }}>
        {subTab === "config" ? (
          <ConfigPanel schoolId={schoolId} sessionId={effectiveSessionId} />
        ) : null}

        {subTab === "programmes" ? (
          sessionId ? (
            <ProgrammesPanel schoolId={schoolId} sessionId={sessionId} />
          ) : (
            <Notice tone="muted">{"Programmes belong to one session — pick a session above first."}</Notice>
          )
        ) : null}

        {subTab === "screening" ? (
          <ChecklistPanel
            title="Screening steps"
            description="What admissions staff work through before a decision — an aptitude test, an academic review, whatever your school actually screens for. Leave this empty and screening is skipped entirely."
            kindLabel="Step key"
            fetchRows={fetchScreeningRequirements}
            upsertRow={upsertScreeningRequirement}
            deleteRow={deleteScreeningRequirement}
            schoolId={schoolId}
            sessionId={effectiveSessionId}
          />
        ) : null}

        {subTab === "documents" ? (
          <ChecklistPanel
            title="Required documents"
            description="What an applicant must upload — birth certificate, previous results, passport photo, whatever your school actually asks for."
            kindLabel="Document key"
            fetchRows={fetchDocumentRequirements}
            upsertRow={upsertDocumentRequirement}
            deleteRow={deleteDocumentRequirement}
            schoolId={schoolId}
            sessionId={effectiveSessionId}
          />
        ) : null}

        {subTab === "clearance" ? <ClearanceDepartmentsPanel /> : null}
      </div>
    </>
  );
};

export default AdmissionsSettingsPanel;
