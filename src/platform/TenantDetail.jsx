import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchTenant,
  fetchTenantAdmins,
  setTenantActive,
  setTenantPlan,
  fetchOnboarding,
  fetchBillingForSchool,
  addBillingRecord,
  setBillingStatus,
  exportSchool,
  archiveSchool,
  extendTrial,
  BILLING_STATUSES,
  PLANS,
} from "../lib/platformApi";
import {
  Page,
  Card,
  Button,
  Badge,
  Empty,
  Modal,
  Field,
  Select,
  MoneyInput,
  Section,
  formatDate,
} from "../Components/UI";
import { StatRow } from "../Components/Charts";
import { useActionFeedback } from "../Components/Toast";
import { downloadCsv } from "../lib/csv";

const Fact = ({ label, children }) =>
  children ? (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  ) : null;

const CHECKLIST_LABELS = [
  ["has_second_admin", "A second admin, principal or the owner has signed in"],
  ["has_logo", "School logo uploaded"],
  ["has_theme", "Theme colour set"],
  ["has_gateway", "Payment gateway confirmed"],
  ["has_levels", "At least one class level created"],
  ["has_class", "At least one class created"],
  ["has_student", "At least one student"],
  ["has_application", "At least one admission application received"],
];

const OnboardingChecklist = ({ schoolId }) => {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    fetchOnboarding(schoolId).then(setProgress).catch(() => setProgress(null));
  }, [schoolId]);

  if (!progress) return null;

  const done = CHECKLIST_LABELS.filter(([key]) => progress[key]).length;

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>{"Onboarding"}</h3>
      <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
        {`${done} of ${CHECKLIST_LABELS.length} steps — where this school actually is, not just its student count.`}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {CHECKLIST_LABELS.map(([key, label]) => (
          <li key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <span style={{ color: progress[key] ? "var(--success)" : "var(--ink-3)" }}>
              {progress[key] ? "✓" : "○"}
            </span>
            <span style={{ color: progress[key] ? "var(--ink)" : "var(--ink-3)" }}>{label}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

const BILLING_TONE = { paid: "success", pending: "warn", overdue: "danger", waived: "muted" };

const BillingSection = ({ schoolId, currency }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const { setError, setNotice } = useActionFeedback();

  const [form, setForm] = useState({
    plan: "basic",
    amount: "",
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: "",
    status: "pending",
    note: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchBillingForSchool(schoolId)
      .then(setRecords)
      .catch((err) => setError(err.message || "Could not load billing records."))
      .finally(() => setLoading(false));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.amount || !form.periodEnd) {
      setError("An amount and a period end date are required.");
      return;
    }
    setSaving(true);
    try {
      await addBillingRecord({
        schoolId,
        plan: form.plan,
        amount: Number(form.amount),
        currency: currency || "NGN",
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        status: form.status,
        note: form.note.trim() || null,
      });
      setNotice("Billing record added.");
      setShowAdd(false);
      setForm((f) => ({ ...f, amount: "", periodEnd: "", note: "" }));
      load();
    } catch (err) {
      setError(err.message || "Could not add that record.");
    } finally {
      setSaving(false);
    }
  };

  const cycleStatus = async (record) => {
    const next = BILLING_STATUSES[(BILLING_STATUSES.indexOf(record.status) + 1) % BILLING_STATUSES.length];
    setBusyId(record.id);
    try {
      await setBillingStatus({ recordId: record.id, status: next });
      load();
    } catch (err) {
      setError(err.message || "Could not update that.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ marginTop: 0 }}>{"Billing"}</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>{"Record a period"}</Button>
      </div>
      <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
        {"A manual ledger — not automated billing. This school is never charged from here; it's a record of what was invoiced and whether it was paid."}
      </p>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && records.length === 0 ? <Empty>{"Nothing recorded yet."}</Empty> : null}

      {records.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {records.map((r) => (
            <li key={r.id} className="doc-row">
              <div>
                <strong>{`${r.currency} ${Number(r.amount).toLocaleString()}`}</strong>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {`${r.plan} · ${formatDate(r.period_start, { withTime: false })} – ${formatDate(r.period_end, { withTime: false })}`}
                  {r.note ? ` · ${r.note}` : ""}
                </div>
              </div>
              <div className="doc-actions">
                <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => cycleStatus(r)}>
                  <Badge tone={BILLING_TONE[r.status]}>{r.status}</Badge>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {showAdd ? (
        <Modal
          title="Record a billing period"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>{"Cancel"}</Button>
              <Button type="submit" form="billing-form" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          }
        >
          <form id="billing-form" onSubmit={submit}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <Field label="Plan">
                <Select value={form.plan} onChange={(v) => setForm((f) => ({ ...f, plan: v }))}
                  options={PLANS.map((p) => ({ value: p, label: p }))} />
              </Field>
              <Field label="Amount">
                <MoneyInput value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
              </Field>
            </div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <Field label="Period start">
                <input type="date" className="input" value={form.periodStart}
                  onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />
              </Field>
              <Field label="Period end">
                <input type="date" className="input" value={form.periodEnd}
                  onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />
              </Field>
            </div>
            <Field label="Status">
              <Select value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                options={BILLING_STATUSES.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field label="Note (optional)">
              <input className="input" value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </Field>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
};

// One school, in the detail a support call needs: who runs it, how much of it
// is in use, what plan it is on. Not its coursework — that belongs to the
// school, and this console has no business reading it.
const TenantDetail = () => {
  const { schoolId } = useParams();
  const [tenant, setTenant] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [extendDays, setExtendDays] = useState("45");
  const { setError, setNotice } = useActionFeedback();

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    Promise.all([fetchTenant(schoolId), fetchTenantAdmins(schoolId).catch(() => [])])
      .then(([t, a]) => {
        setTenant(t);
        setAdmins(a);
      })
      .catch((err) => setError(err.message || "Could not load that school."))
      .finally(() => setLoading(false));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  const changePlan = async (plan) => {
    setBusy(true);
    try {
      const updated = await setTenantPlan({ id: schoolId, plan });
      setTenant((current) => ({ ...current, plan: updated.plan }));
      setNotice(`${tenant.name} is now on the ${plan} plan.`);
    } catch (err) {
      setError(err.message || "Could not change the plan.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (
      tenant.is_active &&
      !window.confirm(
        `Suspend ${tenant.name}? Everyone at that school loses access until it is reactivated.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await setTenantActive({ id: schoolId, isActive: !tenant.is_active });
      setTenant((current) => ({ ...current, is_active: !current.is_active }));
    } catch (err) {
      setError(err.message || "Could not change that school.");
    } finally {
      setBusy(false);
    }
  };

  const doExtend = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await extendTrial({ schoolId, days: Number(extendDays) });
      setTenant((current) => ({ ...current, trial_ends_at: updated.trial_ends_at }));
      setNotice(`${tenant.name}'s trial now runs ${extendDays} more days.`);
      setShowExtend(false);
    } catch (err) {
      setError(err.message || "Could not extend that trial.");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const data = await exportSchool(schoolId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tenant.slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice("Export downloaded.");
    } catch (err) {
      setError(err.message || "Could not export that school.");
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async () => {
    const archiving = !tenant.archived_at;
    if (
      archiving &&
      !window.confirm(
        `Archive ${tenant.name}? This marks it as formally offboarded — export their data first if you'll need it. Not the same as a temporary suspend, and can be undone here later if needed.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const updated = await archiveSchool({ schoolId, archived: archiving });
      setTenant((current) => ({ ...current, is_active: updated.is_active, archived_at: updated.archived_at }));
      setNotice(archiving ? `${tenant.name} has been archived.` : `${tenant.name} has been restored.`);
    } catch (err) {
      setError(err.message || "Could not change that.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Page>
        <Empty>{"Loading school..."}</Empty>
      </Page>
    );
  }

  if (!tenant) {
    return (
      <Page title="School">
        <Link to="/Tenants">
          <Button variant="secondary">{"All schools"}</Button>
        </Link>
      </Page>
    );
  }

  const trialExpired = tenant.plan === "trial" && tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date();

  return (
    <Page
      title={tenant.name}
      subtitle={`${tenant.slug}.schoolivio.com`}
      action={
        <div className="btn-row">
          <Button variant="secondary" disabled={busy} onClick={handleExport}>{"Export data"}</Button>
          <Button
            variant={tenant.is_active ? "secondary" : "primary"}
            disabled={busy}
            onClick={toggle}
          >
            {tenant.is_active ? "Suspend" : "Reactivate"}
          </Button>
          <Button variant="danger-outline" disabled={busy} onClick={handleArchive}>
            {tenant.archived_at ? "Unarchive" : "Archive"}
          </Button>
          <Link to="/Tenants">
            <Button variant="secondary">{"All schools"}</Button>
          </Link>
        </div>
      }
    >
      <div className="btn-row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Badge tone={tenant.is_active ? "success" : "danger"}>
          {tenant.is_active ? "active" : "suspended"}
        </Badge>
        <Badge>{tenant.plan || "trial"}</Badge>
        {tenant.archived_at ? <Badge tone="muted">{"archived"}</Badge> : null}
        <Badge>{`since ${formatDate(tenant.created_at, { withTime: false })}`}</Badge>
        {tenant.plan === "trial" && tenant.trial_ends_at ? (
          <>
            <Badge tone={trialExpired ? "danger" : "warn"}>
              {`trial ${trialExpired ? "expired" : "ends"} ${formatDate(tenant.trial_ends_at, { withTime: false })}`}
            </Badge>
            <Button size="sm" variant="secondary" onClick={() => setShowExtend(true)}>{"Extend trial"}</Button>
          </>
        ) : null}
      </div>

      <StatRow
        stats={[
          { label: "Students", value: tenant.students, note: "active members" },
          { label: "Staff", value: tenant.staff, note: "teaching and admin" },
          { label: "Parents", value: tenant.parents, note: "guardian accounts" },
          { label: "Courses", value: tenant.courses, note: "not archived" },
        ]}
      />

      <div className="split" style={{ marginTop: 26 }}>
        <Card>
          <h3>{"The school"}</h3>
          <dl className="facts">
            <Fact label="Name">{tenant.name}</Fact>
            <Fact label="Address">{`${tenant.slug}.schoolivio.com`}</Fact>
            <Fact label="Email">{tenant.email}</Fact>
            <Fact label="Phone">{tenant.phone}</Fact>
            <Fact label="Currency">{tenant.currency}</Fact>
            <Fact label="Timezone">{tenant.timezone}</Fact>
            <Fact label="Applications">
              {tenant.applications === 0 ? "none yet" : String(tenant.applications)}
            </Fact>
            <Fact label="Result sheets">
              {tenant.result_sheets === 0 ? "none yet" : String(tenant.result_sheets)}
            </Fact>
            <Fact label="Last activity">
              {tenant.last_activity
                ? formatDate(tenant.last_activity)
                : "nothing recorded"}
            </Fact>
          </dl>
        </Card>

        <Card>
          <h3>{"Plan"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
            {"A plan is a platform decision. A school cannot change its own."}
          </p>
          <div className="btn-row" style={{ flexWrap: "wrap" }}>
            {PLANS.map((plan) => (
              <Button
                key={plan}
                size="sm"
                variant={tenant.plan === plan ? "primary" : "secondary"}
                disabled={busy || tenant.plan === plan}
                onClick={() => changePlan(plan)}
              >
                {plan}
              </Button>
            ))}
          </div>
        </Card>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <OnboardingChecklist schoolId={schoolId} />
        <BillingSection schoolId={schoolId} currency={tenant.currency} />
      </div>

      <Section
        title="Who runs it"
        action={
          admins.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadCsv(`${tenant.slug}-admins`, admins, [
                  { key: "name", label: "Name" },
                  { key: "email", label: "Email" },
                  { key: "role", label: "Role" },
                  { key: (a) => (a.is_active ? "active" : "deactivated"), label: "Status" },
                ])
              }
            >
              {"Export CSV"}
            </Button>
          ) : null
        }
      >
        {admins.length === 0 ? (
          <Empty>
            {"Nobody administers this school yet — it cannot be set up until somebody does."}
          </Empty>
        ) : (
          <Card className="pad-0" style={{ padding: "4px 14px" }}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{"Name"}</th>
                    <th>{"Email"}</th>
                    <th>{"Role"}</th>
                    <th>{"Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((a) => (
                    <tr key={a.user_id}>
                      <td>
                        <strong>{a.name}</strong>
                      </td>
                      <td>
                        <a href={`mailto:${a.email}`}>{a.email}</a>
                      </td>
                      <td>{a.role}</td>
                      <td>
                        <Badge tone={a.is_active ? "success" : "danger"}>
                          {a.is_active ? "active" : "deactivated"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 24 }}>
        {"To work inside this school, sign in at "}
        <code>{`${tenant.slug}.schoolivio.com`}</code>
        {" with an account that belongs to it. This console deliberately cannot read a tenant's coursework, marks or fees."}
      </p>

      {showExtend ? (
        <Modal
          title={`Extend ${tenant.name}'s trial`}
          onClose={() => setShowExtend(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setShowExtend(false)}>{"Cancel"}</Button>
              <Button type="submit" form="extend-trial-form-detail" disabled={busy}>
                {busy ? "Extending..." : "Extend"}
              </Button>
            </>
          }
        >
          <form id="extend-trial-form-detail" onSubmit={doExtend}>
            <Field label="Extra days">
              <input
                type="number"
                min="1"
                className="input"
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
              />
            </Field>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
};

export default TenantDetail;
