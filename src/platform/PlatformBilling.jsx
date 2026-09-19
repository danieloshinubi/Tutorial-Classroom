import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAllBillingRecords,
  fetchTenants,
  addBillingRecord,
  setBillingStatus,
  BILLING_STATUSES,
  PLANS,
} from "../lib/platformApi";
import { Page, Card, Badge, Empty, Select, Modal, Button, Field, MoneyInput, formatDate } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import { downloadCsv } from "../lib/csv";

const BILLING_TONE = { paid: "success", pending: "warn", overdue: "danger", waived: "muted" };
const STATUS_OPTIONS = [{ value: "", label: "All statuses" }, ...BILLING_STATUSES.map((s) => ({ value: s, label: s }))];

const AddRecordModal = ({ schools, onClose, onDone }) => {
  const [form, setForm] = useState({
    schoolId: schools[0]?.id || "",
    plan: "basic",
    amount: "",
    currency: "NGN",
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: "",
    status: "pending",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const { setError } = useActionFeedback();

  const submit = async (e) => {
    e.preventDefault();
    if (!form.schoolId || !form.amount || !form.periodEnd) {
      setError("A school, an amount and a period end date are required.");
      return;
    }
    setSaving(true);
    try {
      await addBillingRecord({
        schoolId: form.schoolId,
        plan: form.plan,
        amount: Number(form.amount),
        currency: form.currency,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        status: form.status,
        note: form.note.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err.message || "Could not add that record.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record a billing period"
      onClose={onClose}
      wide
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{"Cancel"}</Button>
          <Button type="submit" form="global-billing-form" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      <form id="global-billing-form" onSubmit={submit}>
        <Field label="School">
          <Select
            value={form.schoolId}
            onChange={(v) => setForm((f) => ({ ...f, schoolId: v }))}
            options={schools.map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
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
  );
};

// The manual ledger, across every school at once — a support call about
// "did school X pay for last quarter" used to mean opening that school's own
// page first. This is a record of what was invoiced and whether it was
// paid; it does not charge anyone.
const PlatformBilling = () => {
  const [rows, setRows] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const { setError, setNotice } = useActionFeedback();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchAllBillingRecords(), fetchTenants()])
      .then(([records, tenants]) => {
        setRows(records);
        setSchools(tenants);
      })
      .catch((err) => setError(err.message || "Could not load billing records."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (needle && !(r.school_name || "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, status, query]);

  const setStatusFor = async (record, next) => {
    setBusyId(record.id);
    try {
      await setBillingStatus({ recordId: record.id, status: next });
      setViewing(null);
      setNotice(`Marked ${next}.`);
      load();
    } catch (err) {
      setError(err.message || "Could not update that record.");
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = () => {
    downloadCsv("billing", filtered, [
      { key: "school_name", label: "School" },
      { key: "plan", label: "Plan" },
      { key: (r) => `${r.currency} ${Number(r.amount).toLocaleString()}`, label: "Amount" },
      { key: (r) => formatDate(r.period_start, { withTime: false }), label: "Period start" },
      { key: (r) => formatDate(r.period_end, { withTime: false }), label: "Period end" },
      { key: "status", label: "Status" },
      { key: (r) => r.note || "", label: "Note" },
    ]);
  };

  return (
    <Page
      title="Billing"
      subtitle="A manual ledger of what every school was invoiced, and whether it was paid"
      action={
        <div className="btn-row">
          <Button variant="secondary" disabled={!filtered.length} onClick={exportCsv}>{"Export CSV"}</Button>
          <Button onClick={() => setAdding(true)}>{"Record a period"}</Button>
        </div>
      }
      toolbar={
        <div className="filters">
          <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} style={{ minWidth: 180 }} />
          <input
            className="input"
            placeholder="Search by school"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
    >
      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && filtered.length === 0 ? <Empty>{"No billing records match."}</Empty> : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"School"}</th>
                  <th>{"Plan"}</th>
                  <th>{"Amount"}</th>
                  <th>{"Period"}</th>
                  <th>{"Status"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/Tenants/${r.school_id}`}><strong>{r.school_name}</strong></Link></td>
                    <td>{r.plan}</td>
                    <td>{`${r.currency} ${Number(r.amount).toLocaleString()}`}</td>
                    <td style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                      {`${formatDate(r.period_start, { withTime: false })} – ${formatDate(r.period_end, { withTime: false })}`}
                    </td>
                    <td><Badge tone={BILLING_TONE[r.status]}>{r.status}</Badge></td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="link-action" onClick={() => setViewing(r)}>{"View"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {viewing ? (
        <Modal
          title={viewing.school_name}
          subtitle={`${viewing.plan} · ${formatDate(viewing.period_start, { withTime: false })} – ${formatDate(viewing.period_end, { withTime: false })}`}
          onClose={() => setViewing(null)}
          footer={
            <>
              <Button
                variant="danger-outline"
                disabled={busyId === viewing.id || viewing.status === "waived"}
                onClick={() => setStatusFor(viewing, "waived")}
              >
                {"Waive"}
              </Button>
              <Button
                disabled={busyId === viewing.id || viewing.status === "paid"}
                onClick={() => setStatusFor(viewing, "paid")}
              >
                {"Mark paid"}
              </Button>
            </>
          }
        >
          <dl className="facts">
            <div><dt>{"Amount"}</dt><dd>{`${viewing.currency} ${Number(viewing.amount).toLocaleString()}`}</dd></div>
            <div><dt>{"Status"}</dt><dd><Badge tone={BILLING_TONE[viewing.status]}>{viewing.status}</Badge></dd></div>
            <div><dt>{"Recorded"}</dt><dd>{formatDate(viewing.created_at)}</dd></div>
            {viewing.note ? <div><dt>{"Note"}</dt><dd>{viewing.note}</dd></div> : null}
          </dl>
        </Modal>
      ) : null}

      {adding ? (
        <AddRecordModal
          schools={schools}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            setNotice("Billing record added.");
            load();
          }}
        />
      ) : null}
    </Page>
  );
};

export default PlatformBilling;
