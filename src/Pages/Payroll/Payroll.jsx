import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool, useModuleAccess } from "../../context/SchoolContext";
import { useMoney } from "../../lib/money";
import { todayISO, localISODate } from "../../lib/dates";
import { ExportMenu } from "../../Components/ExportButton";
import {
  fetchPayrollSettings,
  setupPayroll,
  savePayrollSettings,
  confirmPayrollBands,
  fetchPayrollStaff,
  fetchDeductionTypes,
  saveDeductionType,
  fetchStaffDeductions,
  fetchPayrollRuns,
  fetchPayslips,
  preparePayroll,
  refreshPayroll,
  deletePayrollDraft,
  approvePayroll,
  submitPayroll,
  recallPayroll,
  returnPayroll,
  markPayrollPaid,
  fetchPaymentGateway,
  runSznpPayrollPayout,
  fetchPayees,
  savePayee,
  deletePayee,
  fetchPayeePayments,
  recordPayeePayment,
  fetchSchoolMembers,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Select,
  MoneyInput,
  DatePicker,
  Switch,
  Tabs,
  Notice,
  Empty,
  SkeletonCards,
  formatDate,
} from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { useConfirm, usePrompt } from "../../Components/Confirm";
import { StaffTab } from "./StaffPanel";

// Monthly payroll: staff pay, PAYE, pension, NHF, the school's own
// deductions, and payments to consultants and vendors with withholding tax.
// Every figure is worked out in the database (supabase/197), never here:
// this page prepares, shows, approves and exports.

const TABS = [
  { id: "runs", label: "Payroll" },
  { id: "staff", label: "Staff" },
  { id: "deductions", label: "Deductions" },
  { id: "payees", label: "Consultants & vendors" },
  { id: "settings", label: "Settings" },
];

const monthLabel = (iso) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";

// A calendar date ("2026-09-30") as the day it is, never as a moment at
// midnight UTC, which showed paid dates as "1:00 AM" in Nigeria.
const dayLabel = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const STATUS = { draft: ["Draft", undefined], submitted: ["Awaiting approval", "warn"], approved: ["Approved", "warn"], disbursing: ["Paying out...", "warn"], paid: ["Paid", "success"] };

const num = (v) => Number(v || 0);
const sum = (rows, f) => rows.reduce((t, r) => t + num(f(r)), 0);

// Schedules for the bank, the tax office, the PFAs and NHF, as Excel
// workbooks (lib/xlsx.js): money as numbers, account numbers kept as text.
const M = "money";
const T = "text";

/* ----------------------------------------------------------------- labels */

// What the school calls its statutory deductions (supabase/227). A Nigerian
// school starts with PAYE, pension and NHF under the Nigeria Tax Act 2025;
// a school anywhere else starts with none, named "Income tax", "Pension" and
// "Housing fund", and enters its own country's bands and rates. Everything
// below reads the names from here, so a payslip in Toronto never says NHF.
const isNigerian = (school) => (school?.country || (school?.currency === "NGN" ? "NG" : "")) === "NG";
const labelsFor = (settings, school) => ({
  tax: settings?.tax_label || (isNigerian(school) ? "PAYE" : "Income tax"),
  pension: settings?.pension_label || "Pension",
  fund: settings?.fund_label || (isNigerian(school) ? "NHF" : "Housing fund"),
  nigeria: isNigerian(school),
  // Rent relief and the housing fund only show where they are in use.
  rentRelief: num(settings?.rent_relief_percent) > 0 || isNigerian(school),
  fundInUse: num(settings?.nhf_percent) > 0,
  pensionStaff: num(settings?.pension_employee_percent),
  pensionSchool: num(settings?.pension_employer_percent),
});
const LabelsContext = React.createContext(labelsFor(null, null));
const useLabels = () => React.useContext(LabelsContext);

/* ------------------------------------------------------------------ setup */

const Setup = ({ schoolId, onDone }) => {
  const { school } = useSchool();
  const nigeria = isNigerian(school);
  const [busy, setBusy] = useState(false);
  const { setError } = useActionFeedback();
  const go = async () => {
    setBusy(true);
    try {
      await setupPayroll(schoolId);
      onDone();
    } catch (err) {
      setError(err.message || "Could not set up payroll.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="pr-setup">
      <h3>{"Set up payroll"}</h3>
      <p>
        {nigeria
          ? "Payroll works out each month's pay for your staff: PAYE under the Nigeria Tax Act 2025, contributory pension (8% staff, 10% school), NHF, and your own deductions such as loans and cooperative savings. It also pays consultants and vendors with withholding tax."
          : "Payroll works out each month's pay for your staff: income tax, pension and any housing fund at your country's rates, and your own deductions such as loans and savings. It also pays consultants and vendors with withholding tax."}
      </p>
      <p>
        {nigeria
          ? "You can check and change every rate under Settings before the first payroll is approved."
          : "Schoolivio starts with no statutory deductions for your country. Enter your income tax bands, pension and housing fund rates under Settings, and confirm them, before the first payroll is approved."}
      </p>
      <Button disabled={busy} onClick={go}>{busy ? "Setting up..." : "Set up payroll"}</Button>
    </Card>
  );
};

/* ------------------------------------------------------------------- runs */

const monthOptions = () => {
  const now = new Date();
  const out = [];
  // This month and the eleven before it; a payroll is never prepared ahead.
  for (let i = 0; i >= -11; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const iso = localISODate(d);
    out.push({ value: iso, label: monthLabel(iso) });
  }
  return out;
};

const PayslipDetail = ({ slip, money }) => {
  const L = useLabels();
  return (
  <div className="pr-slip">
    <div className="pr-slip-cols">
      <div>
        <h4>{"Earnings"}</h4>
        {(slip.earnings || []).map((e, i) => (
          <div key={i} className="pr-line"><span>{e.label}</span><b>{money(e.amount)}</b></div>
        ))}
        <div className="pr-line total"><span>{"Gross pay"}</span><b>{money(slip.gross)}</b></div>
      </div>
      <div>
        <h4>{"Deductions"}</h4>
        {num(slip.paye) || L.nigeria ? <div className="pr-line"><span>{L.tax}</span><b>{money(slip.paye)}</b></div> : null}
        {num(slip.pension_employee) ? <div className="pr-line"><span>{`${L.pension} (${L.pensionStaff}%)`}</span><b>{money(slip.pension_employee)}</b></div> : null}
        {num(slip.nhf) ? <div className="pr-line"><span>{L.fund}</span><b>{money(slip.nhf)}</b></div> : null}
        {(slip.deductions || []).map((d, i) => (
          <div key={i} className="pr-line"><span>{d.label}</span><b>{money(d.amount)}</b></div>
        ))}
        <div className="pr-line total"><span>{"Net pay"}</span><b>{money(slip.net)}</b></div>
      </div>
    </div>
    <p className="pr-slip-note">
      {`Taxable income for the year ${money(slip.taxable_annual)}${num(slip.rent_relief) ? ` after rent relief of ${money(slip.rent_relief)}` : ""}. ${num(slip.pension_employer) ? ` The school also pays ${money(slip.pension_employer)} into ${L.pension.toLowerCase()}.` : ""}`}
      {num(slip.days_factor) < 1 ? ` Part month: ${Math.round(num(slip.days_factor) * 100)}% of the month's pay.` : ""}
    </p>
  </div>
  );
};

const RunsTab = ({ schoolId, settings, runs, money, onChanged, onGo, canApprove }) => {
  const L = useLabels();
  const { setError, setNotice } = useActionFeedback();
  const confirmAction = useConfirm();
  const promptFor = usePrompt();
  // View-only people (School admin → People) see payroll but change nothing.
  const { canEdit } = useModuleAccess("payroll");
  const approverName = (settings.approver_roles || ["owner"]).map((r) => (r === "owner" ? "the proprietor" : r)).join(" or ");
  const [period, setPeriod] = useState(() => localISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [selected, setSelected] = useState(runs[0]?.id || null);
  const [slips, setSlips] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paidOn, setPaidOn] = useState(todayISO());
  const [gateway, setGateway] = useState(null);
  const run = runs.find((r) => r.id === selected) || null;

  useEffect(() => {
    if (!selected && runs[0]) setSelected(runs[0].id);
  }, [runs, selected]);

  // Automated payout is only offered once this school has Sznd connected
  // (Settings → Payment gateway) — same rollout scope as fee collection,
  // nothing extra to opt into.
  useEffect(() => {
    if (!schoolId) return;
    fetchPaymentGateway(schoolId).then(setGateway).catch(() => setGateway(null));
  }, [schoolId]);
  const szndReady = gateway?.provider === "sznd" && gateway?.is_active;

  const loadSlips = useCallback(() => {
    if (!selected) return setSlips([]);
    fetchPayslips(selected).then(setSlips).catch((err) => setError(err.message || "Could not load the payslips."));
    return undefined;
  }, [selected, setError]);
  useEffect(() => { loadSlips(); }, [loadSlips]);

  const act = async (fn, done) => {
    setBusy(true);
    try {
      const result = await fn();
      if (done) setNotice(done);
      await onChanged();
      // Load the payslips of the run just acted on. Reloading "the selected
      // run" here read the one selected BEFORE preparing, so a freshly
      // prepared month showed "No payslips" until something refreshed it.
      const runId = result?.id || selected;
      if (result?.id) setSelected(result.id);
      if (runId) setSlips(await fetchPayslips(runId));
    } catch (err) {
      setError(err.message || "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const prepare = () => act(() => preparePayroll(schoolId, period), `Payroll for ${monthLabel(period)} prepared as a draft.`);

  const approve = async () => {
    const ok = await confirmAction({
      title: `Approve payroll for ${monthLabel(run.period)}?`,
      body: `${slips.length} payslip${slips.length === 1 ? "" : "s"}, ${money(sum(slips, (s) => s.net))} net pay. Staff with a Schoolivio account see their payslip and are notified. It cannot be changed after approval.`,
      confirmLabel: "Approve",
    });
    if (ok) act(() => approvePayroll(run.id), "Payroll approved. Staff can now see their payslips.");
  };

  // The bursary prepares payroll and sends it to the proprietor, who is
  // notified; they approve it or send it back with a note (supabase/209).
  const submit = async () => {
    const ok = await confirmAction({
      title: `Send payroll for ${monthLabel(run.period)} for approval?`,
      body: `${slips.length} payslip${slips.length === 1 ? "" : "s"}, ${money(sum(slips, (s) => s.net))} net pay. ${approverName.charAt(0).toUpperCase() + approverName.slice(1)} is notified to approve it. You can take it back until then.`,
      confirmLabel: "Send for approval",
    });
    if (ok) act(() => submitPayroll(run.id), `Sent to ${approverName} for approval.`);
  };

  const sendBack = async () => {
    const reason = await promptFor({
      title: `Send payroll for ${monthLabel(run.period)} back?`,
      body: "It goes back to the bursary as a draft. Say what needs changing; they are notified.",
      label: "What needs changing",
      placeholder: "e.g. Mr Ade's transport allowance is missing",
      confirmLabel: "Send back",
    });
    if (reason == null) return;
    if (!reason.trim()) return setError("Say what needs changing.");
    act(() => returnPayroll(run.id, reason.trim()), "Sent back to the bursary.");
  };

  const remove = async () => {
    const ok = await confirmAction({ title: "Delete this draft?", body: "The draft and its payslips are removed. You can prepare the month again.", confirmLabel: "Delete" });
    if (ok) act(async () => { await deletePayrollDraft(run.id); setSelected(null); }, "Draft deleted.");
  };

  // Real bank transfers, one per payslip, through this school's connected
  // Sznd account — the explicit second step after approval (not automatic
  // on approve) so a bad bank detail or a surprise balance issue can still
  // be caught before anything is actually sent. A partial result (some
  // paid, some failed) is normal, not an error — the run stays visible as
  // "Paying out..." with any failed payslips retryable by running this
  // again, picking up only what's still outstanding.
  const payViaSznd = async () => {
    const ok = await confirmAction({
      title: `Pay ${slips.length} staff via Sznd?`,
      body: `${money(sum(slips, (s) => s.net))} total, sent as real bank transfers to each person's account on file. This cannot be undone once started.`,
      confirmLabel: "Pay now",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await runSznpPayrollPayout(run.id);
      setNotice(
        result.failed > 0
          ? `${result.processing} payment${result.processing === 1 ? "" : "s"} sent, ${result.failed} failed — check them below and retry.`
          : `${result.processing} payment${result.processing === 1 ? "" : "s"} sent. They'll show as paid once each one confirms.`
      );
      await onChanged();
      if (run.id) setSlips(await fetchPayslips(run.id));
    } catch (err) {
      setError(err.message || "Could not run that payout.");
    } finally {
      setBusy(false);
    }
  };

  const totals = {
    gross: sum(slips, (s) => s.gross),
    paye: sum(slips, (s) => s.paye),
    pension: sum(slips, (s) => num(s.pension_employee) + num(s.pension_employer)),
    nhf: sum(slips, (s) => s.nhf),
    other: sum(slips, (s) => s.other_deductions),
    net: sum(slips, (s) => s.net),
  };

  const tag = run ? run.period.slice(0, 7) : "";
  const withPension = slips.filter((s) => num(s.pension_employee) || num(s.pension_employer));
  const withNhf = slips.filter((s) => num(s.nhf));
  const sheets = run
    ? {
        bank: { name: "Bank schedule", rows: slips, columns: [
          { key: "full_name", label: "Name" }, { key: "bank_name", label: "Bank" },
          { key: "account_number", label: "Account number", type: T }, { key: "account_name", label: "Account name" },
          { key: "net", label: "Net pay", type: M }] },
        paye: { name: L.tax, rows: slips, columns: [
          { key: "full_name", label: "Name" }, { key: "tin", label: "TIN", type: T },
          { key: "gross", label: "Gross pay", type: M },
          ...(L.rentRelief ? [{ key: "rent_relief", label: "Rent relief (year)", type: M }] : []),
          { key: "taxable_annual", label: "Taxable (year)", type: M }, { key: "paye", label: L.tax, type: M }] },
        pension: { name: L.pension, rows: withPension, columns: [
          { key: "full_name", label: "Name" }, { key: "pension_provider", label: "Pension provider" },
          ...(L.nigeria ? [{ key: "rsa_pin", label: "RSA PIN", type: T }] : []),
          { key: "pension_employee", label: `Employee ${L.pensionStaff}%`, type: M },
          { key: "pension_employer", label: `Employer ${L.pensionSchool}%`, type: M },
          { key: (s) => num(s.pension_employee) + num(s.pension_employer), label: "Total", type: M }] },
        nhf: { name: L.fund, rows: withNhf, columns: [
          { key: "full_name", label: "Name" }, { key: "nhf", label: L.fund, type: M }] },
        payslips: { name: "Payslips", rows: slips, columns: [
          { key: "full_name", label: "Name" }, { key: "job_title", label: "Role" },
          { key: "gross", label: "Gross", type: M }, { key: "paye", label: L.tax, type: M },
          { key: "pension_employee", label: L.pension, type: M }, { key: "nhf", label: L.fund, type: M },
          { key: "other_deductions", label: "Other deductions", type: M }, { key: "net", label: "Net pay", type: M },
          { key: "pension_employer", label: "School pension", type: M }] },
      }
    : null;
  // Each schedule as Excel, CSV or PDF (ExportMenu); "Everything" is one
  // workbook with a sheet each.
  const exports = run
    ? [
        ["Everything", `payroll-${tag}`, [sheets.payslips, sheets.bank, sheets.paye, sheets.pension, sheets.nhf]],
        ["Bank schedule", `salaries-${tag}`, [sheets.bank]],
        [L.tax, `tax-${tag}`, [sheets.paye]],
        [L.pension, `pension-${tag}`, [sheets.pension]],
        ...(L.fundInUse || withNhf.length ? [[L.fund, `housing-fund-${tag}`, [sheets.nhf]]] : []),
      ]
    : [];

  return (
    <div className="pr-stack">
      {!settings.bands_confirmed_at ? (
        <Notice tone="warn">
          {L.nigeria
            ? "Before the first payroll can be approved, check the PAYE bands and rates under Settings and confirm them. "
            : `Before the first payroll can be approved, enter your country's ${L.tax.toLowerCase()} bands, ${L.pension.toLowerCase()} and other rates under Settings and confirm them. `}
          <button type="button" className="pr-link" onClick={() => onGo("settings")}>{"Open Settings"}</button>
        </Notice>
      ) : null}

      {canEdit ? (
      <Card className="pr-prepare">
        <Field label="Month">
          <Select value={period} onChange={setPeriod} options={monthOptions()} />
        </Field>
        <Button disabled={busy} onClick={prepare}>{busy ? "Working..." : "Prepare payroll"}</Button>
        <p className="pr-hint">{"Prepares a draft from each active staff member's pay and deductions. Preparing a month again recalculates its draft."}</p>
      </Card>
      ) : null}

      {runs.length === 0 ? (
        <Empty>{"No payroll yet. Add your staff under Staff, then prepare the first month."}</Empty>
      ) : (
        <div className="pr-runs">
          <div className="pr-run-list" role="list">
            {runs.map((r) => (
              <button key={r.id} type="button" role="listitem" className={`pr-run${r.id === selected ? " active" : ""}`} onClick={() => { setSelected(r.id); setOpen(null); }}>
                <span>{monthLabel(r.period)}</span>
                <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
              </button>
            ))}
          </div>

          {run ? (
            <div className="pr-run-body">
              <div className="pr-run-head">
                <div>
                  <h3>{`Payroll for ${monthLabel(run.period)}`}</h3>
                  <p className="pr-hint">
                    {run.status === "draft" ? (!canEdit ? "Draft — still being prepared." : canApprove ? "Draft — check it, then approve." : `Draft — check it, then send it to ${approverName} for approval.`) : null}
                    {run.status === "submitted" ? `Sent for approval ${formatDate(run.submitted_at)}. Waiting for ${approverName}.` : null}
                    {run.status === "approved" ? `Approved ${formatDate(run.approved_at)}. Not yet marked as paid.` : null}
                    {run.status === "disbursing" ? "Payouts are in progress — this updates automatically as each one confirms." : null}
                    {run.status === "paid" ? `Paid ${dayLabel(run.paid_on)}.` : null}
                  </p>
                </div>
                <div className="btn-row">
                  {run.status === "draft" && canEdit ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => refreshPayroll(run.id), "Recalculated.")}>{"Recalculate"}</Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={remove}>{"Delete draft"}</Button>
                      {canApprove ? (
                        <Button size="sm" disabled={busy || !slips.length} onClick={approve}>{"Approve"}</Button>
                      ) : (
                        <Button size="sm" disabled={busy || !slips.length} onClick={submit}>{"Send for approval"}</Button>
                      )}
                    </>
                  ) : null}
                  {run.status === "submitted" && canApprove ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={sendBack}>{"Send back"}</Button>
                      <Button size="sm" disabled={busy || !slips.length} onClick={approve}>{"Approve"}</Button>
                    </>
                  ) : null}
                  {run.status === "submitted" && !canApprove && canEdit ? (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => recallPayroll(run.id), "Taken back as a draft.")}>{"Take back"}</Button>
                  ) : null}
                  {run.status === "approved" && canEdit ? (
                    <>
                      {szndReady ? (
                        <Button size="sm" disabled={busy || !slips.length} onClick={payViaSznd}>{"Pay via Sznd"}</Button>
                      ) : null}
                      <DatePicker value={paidOn} onChange={setPaidOn} />
                      <Button size="sm" variant={szndReady ? "secondary" : undefined} disabled={busy} onClick={() => act(() => markPayrollPaid(run.id, paidOn), "Marked as paid.")}>{"Mark as paid"}</Button>
                    </>
                  ) : null}
                </div>
              </div>

              {run.status === "draft" && run.returned_note ? (
                <Notice tone="warn">{`Sent back ${formatDate(run.returned_at)}: ${run.returned_note}`}</Notice>
              ) : null}

              <div className="pr-totals">
                {[["Gross pay", totals.gross], [L.tax, totals.paye], [`${L.pension} (staff + school)`, totals.pension], ...(L.fundInUse || num(totals.nhf) ? [[L.fund, totals.nhf]] : []), ["Other deductions", totals.other], ["Net pay", totals.net]].map(([label, value]) => (
                  <div key={label} className="pr-total"><span>{label}</span><b>{money(value)}</b></div>
                ))}
              </div>

              {slips.length === 0 ? (
                <Empty>{"No payslips in this payroll. Staff appear here when their record is active, has pay set, and started on or before this month (or has no start date)."}</Empty>
              ) : (
                <div className="table-wrap table-wrap-plain">
                  <table className="data pr-table">
                    <thead>
                      <tr><th>{"Staff"}</th><th>{"Gross"}</th><th>{L.tax}</th><th>{L.pension}</th><th>{L.fund}</th><th>{"Other"}</th><th>{"Net"}</th></tr>
                    </thead>
                    <tbody>
                      {slips.map((s) => (
                        <React.Fragment key={s.id}>
                          <tr className="pr-row" onClick={() => setOpen(open === s.id ? null : s.id)}>
                            <td><strong>{s.full_name}</strong>{s.job_title ? <span className="pr-sub">{s.job_title}</span> : null}</td>
                            <td>{money(s.gross)}</td>
                            <td>{money(s.paye)}</td>
                            <td>{money(s.pension_employee)}</td>
                            <td>{money(s.nhf)}</td>
                            <td>{money(s.other_deductions)}</td>
                            <td><strong>{money(s.net)}</strong></td>
                          </tr>
                          {open === s.id ? (
                            <tr className="pr-detail-row"><td colSpan={7}><PayslipDetail slip={s} money={money} /></td></tr>
                          ) : null}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {slips.length ? (
                <div className="pr-exports">
                  <span>{"Download:"}</span>
                  {exports.map(([label, filename, list]) => (
                    <ExportMenu key={label} label={label} filename={filename} title={`${label} · ${monthLabel(run.period)}`} sheets={list} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ staff */
// The staff list and each person's panel live in StaffPanel.tsx.

/* ------------------------------------------------------------- deductions */

const DeductionsTab = ({ schoolId, types, onChanged }) => {
  const { setError } = useActionFeedback();
  const { canEdit } = useModuleAccess("payroll");
  const [label, setLabel] = useState("");
  const [beforeTax, setBeforeTax] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      await saveDeductionType({ school_id: schoolId, label: label.trim(), before_tax: beforeTax, position: types.length + 1 });
      setLabel("");
      setBeforeTax(false);
      onChanged();
    } catch (err) {
      setError(/label_once/.test(err.message || "") ? "There is already a deduction with that name." : err.message || "Could not add it.");
    }
  };
  const update = (t, patch) => saveDeductionType({ id: t.id, ...patch }).then(onChanged).catch((err) => setError(err.message));
  return (
    <Card>
      <p className="pr-hint">{"The kinds of deduction your school takes from pay. Each staff member's own amounts are set on their record under Staff. Mark a deduction \"before tax\" only if the law lets it reduce PAYE, such as health insurance or life assurance."}</p>
      {canEdit ? (
      <form className="pr-inline" onSubmit={add}>
        <input className="input" placeholder="e.g. Union dues" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Switch compact label="Before tax" checked={beforeTax} onChange={setBeforeTax} />
        <Button type="submit" size="sm" disabled={!label.trim()}>{"Add"}</Button>
      </form>
      ) : null}
      <fieldset className="pr-fieldset" disabled={!canEdit}>
      <div className="pr-type-list">
        {types.map((t) => (
          <div key={t.id} className={`pr-type${t.is_active ? "" : " pr-dim"}`}>
            <strong>{t.label}</strong>
            <Switch compact label="Before tax" checked={t.before_tax} onChange={(v) => update(t, { before_tax: v })} />
            <Switch compact label="In use" checked={t.is_active} onChange={(v) => update(t, { is_active: v })} />
          </div>
        ))}
      </div>
      </fieldset>
    </Card>
  );
};

/* ------------------------------------------------ consultants and vendors */

const KINDS = [
  { value: "consultant", label: "Consultant" },
  { value: "vendor", label: "Vendor" },
  { value: "honorarium", label: "Honorarium" },
  { value: "other", label: "Other" },
];

const PayeesTab = ({ schoolId, payees, payments, money, onChanged }) => {
  const { setError, setNotice } = useActionFeedback();
  const { canEdit } = useModuleAccess("payroll");
  const blank = { id: null, name: "", kind: "consultant", service: "", wht_rate: "5", bank_name: "", account_number: "", account_name: "", tin: "", is_active: true };
  const [p, setP] = useState(blank);
  const [pay, setPay] = useState({ payeeId: "", description: "", gross: "", whtRate: "", paidOn: todayISO(), paidFrom: "bank", reference: "" });
  const [busy, setBusy] = useState(false);
  const chosen = payees.find((x) => x.id === pay.payeeId);
  const rate = pay.whtRate === "" ? num(chosen?.wht_rate) : num(pay.whtRate);
  const wht = Math.round(num(pay.gross) * rate) / 100;

  // Only someone never paid can be deleted: a payment is in the books and
  // the tax schedule, so its payee has to stay (switch them off instead).
  const removePayee = async (x) => {
    try {
      await deletePayee(x.id);
      onChanged();
    } catch (err) {
      setError(`${x.name} has payments recorded, so switch them off instead.`);
    }
  };

  const savePe = async (e) => {
    e.preventDefault();
    if (!p.name.trim()) return;
    try {
      const row = { ...p, school_id: schoolId, name: p.name.trim(), wht_rate: num(p.wht_rate) };
      if (!row.id) delete row.id;
      await savePayee(row);
      setP(blank);
      onChanged();
    } catch (err) {
      setError(err.message || "Could not save.");
    }
  };

  const record = async (e) => {
    e.preventDefault();
    if (!pay.payeeId || !(num(pay.gross) > 0) || !pay.description.trim()) return setError("Choose who, what it was for, and the amount before tax.");
    setBusy(true);
    try {
      await recordPayeePayment(pay);
      setNotice(`Recorded: ${money(num(pay.gross) - wht)} paid, ${money(wht)} withholding tax kept back.`);
      setPay({ ...pay, description: "", gross: "", reference: "" });
      onChanged();
    } catch (err) {
      setError(err.message || "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pr-stack">
      {canEdit ? (
      <Card>
        <h3>{"Record a payment"}</h3>
        <form onSubmit={record}>
          <div className="pr-grid">
            <Field label="Paid to"><Select value={pay.payeeId} onChange={(v) => setPay({ ...pay, payeeId: v, whtRate: "" })} options={[{ value: "", label: "Choose…" }, ...payees.filter((x) => x.is_active).map((x) => ({ value: x.id, label: x.name }))]} /></Field>
            <Field label="For"><input className="input" placeholder="e.g. Extra lessons, September" value={pay.description} onChange={(e) => setPay({ ...pay, description: e.target.value })} /></Field>
            <Field label="Amount before tax"><MoneyInput value={pay.gross} onChange={(v) => setPay({ ...pay, gross: v })} placeholder="0" /></Field>
            <Field label="Withholding tax %"><input className="input" type="number" min="0" max="100" step="0.5" placeholder={chosen ? String(num(chosen.wht_rate)) : "0"} value={pay.whtRate} onChange={(e) => setPay({ ...pay, whtRate: e.target.value })} /></Field>
            <Field label="Paid on"><DatePicker value={pay.paidOn} onChange={(v) => setPay({ ...pay, paidOn: v })} /></Field>
            <Field label="Paid from"><Select value={pay.paidFrom} onChange={(v) => setPay({ ...pay, paidFrom: v })} options={[{ value: "bank", label: "Bank" }, { value: "cash", label: "Cash" }]} /></Field>
          </div>
          <div className="pr-inline">
            <Button type="submit" disabled={busy}>{busy ? "Recording..." : "Record payment"}</Button>
            {num(pay.gross) > 0 ? <span className="pr-hint">{`They receive ${money(num(pay.gross) - wht)}; ${money(wht)} (${rate}%) is kept back for tax.`}</span> : null}
          </div>
        </form>
      </Card>
      ) : null}

      <Card>
        <h3>{p.id ? `Edit ${p.name}` : "Consultants, vendors and honoraria"}</h3>
        {canEdit ? (
        <form onSubmit={savePe}>
          <div className="pr-grid">
            <Field label="Name"><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="Type"><Select value={p.kind} onChange={(v) => setP({ ...p, kind: v })} options={KINDS} /></Field>
            <Field label="Service"><input className="input" placeholder="e.g. Coding and robotics" value={p.service || ""} onChange={(e) => setP({ ...p, service: e.target.value })} /></Field>
            <Field label="Withholding tax %"><input className="input" type="number" min="0" max="100" step="0.5" value={p.wht_rate} onChange={(e) => setP({ ...p, wht_rate: e.target.value })} /></Field>
            <Field label="Bank"><input className="input" value={p.bank_name || ""} onChange={(e) => setP({ ...p, bank_name: e.target.value })} /></Field>
            <Field label="Account number"><input className="input" value={p.account_number || ""} onChange={(e) => setP({ ...p, account_number: e.target.value })} /></Field>
            <Field label="Account name"><input className="input" value={p.account_name || ""} onChange={(e) => setP({ ...p, account_name: e.target.value })} /></Field>
            <Field label="TIN"><input className="input" value={p.tin || ""} onChange={(e) => setP({ ...p, tin: e.target.value })} /></Field>
          </div>
          <div className="btn-row">
            <Button type="submit" size="sm" disabled={!p.name.trim()}>{p.id ? "Save" : "Add"}</Button>
            {p.id ? <Button size="sm" variant="secondary" onClick={() => setP(blank)}>{"Cancel"}</Button> : null}
          </div>
        </form>
        ) : null}
        {payees.length ? (
          <div className="table-wrap table-wrap-plain">
            <table className="data pr-table">
              <thead><tr><th>{"Name"}</th><th>{"Type"}</th><th>{"WHT"}</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {payees.map((x) => (
                  <tr key={x.id} className={x.is_active ? undefined : "pr-dim"}>
                    <td><strong>{x.name}</strong>{x.service ? <span className="pr-sub">{x.service}</span> : null}</td>
                    <td>{KINDS.find((k) => k.value === x.kind)?.label}</td>
                    <td>{`${num(x.wht_rate)}%`}</td>
                    <td>{canEdit ? <div className="btn-row">
                      <Button size="sm" variant="secondary" onClick={() => setP({ ...blank, ...x, wht_rate: String(num(x.wht_rate)) })}>{"Edit"}</Button>
                      <Button size="sm" variant="secondary" onClick={() => savePayee({ id: x.id, is_active: !x.is_active }).then(onChanged)}>{x.is_active ? "Switch off" : "Switch on"}</Button>
                      {payments.some((pm) => pm.payee_id === x.id) ? null : (
                        <Button size="sm" variant="secondary" onClick={() => removePayee(x)}>{"Delete"}</Button>
                      )}
                    </div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {payments.length ? (
        <Card>
          <h3>{"Payments made"}</h3>
          <div className="table-wrap table-wrap-plain">
            <table className="data pr-table">
              <thead><tr><th>{"Date"}</th><th>{"To"}</th><th>{"For"}</th><th>{"Gross"}</th><th>{"WHT"}</th><th>{"Paid"}</th></tr></thead>
              <tbody>
                {payments.map((x) => (
                  <tr key={x.id}>
                    <td>{dayLabel(x.paid_on)}</td>
                    <td>{payees.find((pe) => pe.id === x.payee_id)?.name || "—"}</td>
                    <td>{x.description}</td>
                    <td>{money(x.gross)}</td>
                    <td>{`${money(x.wht)} (${num(x.wht_rate)}%)`}</td>
                    <td><strong>{money(x.net)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pr-exports">
            <ExportMenu label="Withholding tax schedule" filename="withholding-tax" title="Withholding tax" sheets={[{ name: "Withholding tax", rows: payments.map((x) => ({ ...x, payee: payees.find((y) => y.id === x.payee_id) })), columns: [
              { key: "paid_on", label: "Date", type: "date" }, { key: "payee.name", label: "Paid to" }, { key: "payee.tin", label: "TIN", type: T },
              { key: "description", label: "For" }, { key: "gross", label: "Gross", type: M }, { key: "wht_rate", label: "WHT %", type: "number" },
              { key: "wht", label: "WHT", type: M }, { key: "net", label: "Net", type: M }] }]} />
          </div>
        </Card>
      ) : null}
    </div>
  );
};

/* --------------------------------------------------------------- settings */

const APPROVERS = [
  { value: "owner", label: "Proprietor (owner)" },
  { value: "principal", label: "Principal" },
  { value: "admin", label: "Admin" },
  { value: "bursar", label: "Bursar" },
];

const SettingsTab = ({ schoolId, settings, money, onChanged }) => {
  const L = useLabels();
  const { setError, setNotice } = useActionFeedback();
  const { canEdit } = useModuleAccess("payroll");
  const [f, setF] = useState(() => ({
    ...settings,
    paye_bands: (settings.paye_bands || []).map((b) => ({ upto: b.upto == null ? "" : String(b.upto), rate: String(b.rate) })),
  }));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
      const bands = f.paye_bands.map((b) => ({ upto: b.upto === "" ? null : num(b.upto), rate: num(b.rate) }));
      if (bands[bands.length - 1]?.upto != null) throw new Error("The last band must have no upper limit.");
      await savePayrollSettings(schoolId, {
        paye_bands: bands,
        rent_relief_percent: num(f.rent_relief_percent),
        rent_relief_cap: num(f.rent_relief_cap),
        pension_employee_percent: num(f.pension_employee_percent),
        pension_employer_percent: num(f.pension_employer_percent),
        nhf_percent: num(f.nhf_percent),
        tax_label: (f.tax_label || "").trim() || L.tax,
        pension_label: (f.pension_label || "").trim() || L.pension,
        fund_label: (f.fund_label || "").trim() || L.fund,
        approver_roles: f.approver_roles?.length ? f.approver_roles : ["owner"],
        tax_office: f.tax_office || null,
        paying_bank: f.paying_bank || null,
      });
      setNotice("Settings saved.");
      onChanged();
    } catch (err) {
      setError(err.message || "Could not save the settings.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    try {
      await confirmPayrollBands(schoolId);
      setNotice(`${L.tax} bands confirmed. Payroll can now be approved.`);
      onChanged();
    } catch (err) {
      setError(err.message || "Could not confirm.");
    }
  };

  let from = 0;
  return (
    <fieldset className="pr-fieldset pr-stack" disabled={!canEdit}>
      <Card>
        <h3>{`${L.tax} bands (a year)`}</h3>
        <p className="pr-hint">
          {L.nigeria
            ? "Loaded with the Nigeria Tax Act 2025 rates, in force from 1 January 2026. Change them only if the law changes."
            : "Enter your country's income tax bands for a year: each band's upper limit and its rate, with no limit on the last. Add a band for each step. Schoolivio starts with none (0%) rather than guess your country's law."}
        </p>
        <div className="pr-bands">
          {f.paye_bands.map((b, i) => {
            const label = `${money(from)} ${b.upto === "" ? "and above" : `to ${money(b.upto)}`}`;
            from = b.upto === "" ? from : num(b.upto);
            return (
              <div key={i} className="pr-band">
                <span className="pr-band-range">{label}</span>
                <MoneyInput value={b.upto} placeholder="No limit" onChange={(v) => set({ paye_bands: f.paye_bands.map((x, j) => (j === i ? { ...x, upto: v } : x)) })} aria-label="Up to" />
                <input className="input" type="number" min="0" max="100" step="0.5" value={b.rate} onChange={(e) => set({ paye_bands: f.paye_bands.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} aria-label="Rate %" />
                <span>{"%"}</span>
              </div>
            );
          })}
        </div>
        {!L.nigeria || f.paye_bands.length > 1 ? (
          <div className="pr-inline">
            {/* A new band goes just before the last ("and above") one; fill in its upper limit. */}
            <Button size="sm" variant="secondary" onClick={() => {
              const last = f.paye_bands[f.paye_bands.length - 1] || { upto: "", rate: "0" };
              set({ paye_bands: [...f.paye_bands.slice(0, -1), { upto: "", rate: "0" }, { ...last, upto: "" }] });
            }}>{"Add a band"}</Button>
            {f.paye_bands.length > 1 ? (
              <Button size="sm" variant="ghost" onClick={() => {
                const bands = f.paye_bands.slice(0, -1);
                bands[bands.length - 1] = { ...bands[bands.length - 1], upto: "" };
                set({ paye_bands: bands });
              }}>{"Remove the last band"}</Button>
            ) : null}
          </div>
        ) : null}
        <div className="pr-grid">
          <Field label="Rent relief (% of rent)"><input className="input" type="number" value={f.rent_relief_percent} onChange={(e) => set({ rent_relief_percent: e.target.value })} /></Field>
          <Field label="Rent relief cap (a year)"><MoneyInput value={f.rent_relief_cap} onChange={(v) => set({ rent_relief_cap: v })} /></Field>
        </div>
        <div className="pr-confirm">
          {settings.bands_confirmed_at ? (
            <Badge tone="success">{`Confirmed ${formatDate(settings.bands_confirmed_at)}`}</Badge>
          ) : (
            <>
              <Badge tone="warn">{"Not confirmed yet"}</Badge>
              <Button size="sm" onClick={confirm}>{"These are correct — confirm"}</Button>
            </>
          )}
          <span className="pr-hint">{"Changing the bands or rent relief asks for confirmation again."}</span>
        </div>
      </Card>

      <Card>
        <h3>{`${L.pension}, ${L.fund} and approval`}</h3>
        <div className="pr-grid">
          <Field label="Name of income tax" hint="As it appears on payslips, e.g. PAYE"><input className="input" maxLength={40} value={f.tax_label || ""} onChange={(e) => set({ tax_label: e.target.value })} /></Field>
          <Field label="Name of pension" hint="e.g. Pension, CPP, SSNIT"><input className="input" maxLength={40} value={f.pension_label || ""} onChange={(e) => set({ pension_label: e.target.value })} /></Field>
          <Field label="Name of housing fund" hint="e.g. NHF; leave its % at 0 if none"><input className="input" maxLength={40} value={f.fund_label || ""} onChange={(e) => set({ fund_label: e.target.value })} /></Field>
          <Field label="Pension, staff %"><input className="input" type="number" value={f.pension_employee_percent} onChange={(e) => set({ pension_employee_percent: e.target.value })} /></Field>
          <Field label="Pension, school %"><input className="input" type="number" value={f.pension_employer_percent} onChange={(e) => set({ pension_employer_percent: e.target.value })} /></Field>
          <Field label={`${L.fund} % of basic`}><input className="input" type="number" step="0.5" value={f.nhf_percent} onChange={(e) => set({ nhf_percent: e.target.value })} /></Field>
          <Field label={L.nigeria ? "State tax office for PAYE" : "Tax office"}><input className="input" placeholder={L.nigeria ? "e.g. Lagos State IRS" : ""} value={f.tax_office || ""} onChange={(e) => set({ tax_office: e.target.value })} /></Field>
          <Field label="Salaries are paid from"><input className="input" placeholder={L.nigeria ? "e.g. First Bank" : ""} value={f.paying_bank || ""} onChange={(e) => set({ paying_bank: e.target.value })} /></Field>
        </div>
        <h4>{"Who approves payroll"}</h4>
        <div className="pr-switches">
          {APPROVERS.map((a) => (
            <Switch key={a.value} compact label={a.label}
              checked={(f.approver_roles || []).includes(a.value)}
              onChange={(v) => set({ approver_roles: v ? [...(f.approver_roles || []), a.value] : (f.approver_roles || []).filter((r) => r !== a.value) })} />
          ))}
        </div>
        {(f.approver_roles || []).some((r) => !["owner", "admin", "bursar"].includes(r)) ? (
          <p className="pr-hint">{"A principal who approves also needs Payroll opened to them under School admin → People (View only is enough), or the approval notice will not open for them."}</p>
        ) : null}
      </Card>
      {canEdit ? <div><Button disabled={busy} onClick={save}>{busy ? "Saving..." : "Save settings"}</Button></div> : null}
    </fieldset>
  );
};

/* ------------------------------------------------------------------- page */

const Payroll = () => {
  const { school, schoolId, roles } = useSchool();
  const { canEdit } = useModuleAccess("payroll");
  const money = useMoney(school?.currency);
  const { setError } = useActionFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab = TABS.some((t) => t.id === requested) ? requested : "runs";
  const setTab = (id) =>
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", id); return next; }, { replace: true });

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [staff, setStaff] = useState([]);
  const [types, setTypes] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [runs, setRuns] = useState([]);
  const [payees, setPayees] = useState([]);
  const [payments, setPayments] = useState([]);
  const [members, setMembers] = useState([]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!schoolId) return;
    if (!quiet) setLoading(true);
    try {
      const s = await fetchPayrollSettings(schoolId);
      setSettings(s);
      if (s) {
        const [a, b, c, d, e, g, m] = await Promise.all([
          fetchPayrollStaff(schoolId),
          fetchDeductionTypes(schoolId),
          fetchStaffDeductions(schoolId),
          fetchPayrollRuns(schoolId),
          fetchPayees(schoolId),
          fetchPayeePayments(schoolId),
          fetchSchoolMembers(schoolId).catch(() => []),
        ]);
        setStaff(a); setTypes(b); setDeductions(c); setRuns(d); setPayees(e); setPayments(g); setMembers(m);
      }
    } catch (err) {
      setError(err.message || "Could not load payroll.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => { load(); }, [load]);
  const refresh = () => load({ quiet: true });

  const labels = useMemo(() => labelsFor(settings, school), [settings, school]);

  const canApprove = useMemo(
    () => (settings?.approver_roles || ["owner"]).some((r) => (roles || []).includes(r)),
    [settings, roles]
  );

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Payroll"
        subtitle={school ? `Staff pay at ${school.name}` : "Staff pay"}
        toolbar={settings ? <Tabs tabs={TABS} active={tab} onChange={setTab} /> : null}
      >
        <LabelsContext.Provider value={labels}>
        <div className="pr-page">
          {loading ? <SkeletonCards count={3} lines={3} /> : null}
          {!loading && !settings && canEdit ? <Setup schoolId={schoolId} onDone={() => load()} /> : null}
          {!loading && !settings && !canEdit ? <Empty>{"Payroll has not been set up yet."}</Empty> : null}
          {!loading && settings && tab === "runs" ? <RunsTab schoolId={schoolId} settings={settings} runs={runs} money={money} onChanged={refresh} onGo={setTab} canApprove={canApprove} /> : null}
          {!loading && settings && tab === "staff" ? <StaffTab schoolId={schoolId} staff={staff} types={types} deductions={deductions} members={members} money={money} labels={labels} canEdit={canEdit} onChanged={refresh} /> : null}
          {!loading && settings && tab === "deductions" ? <DeductionsTab schoolId={schoolId} types={types} onChanged={refresh} /> : null}
          {!loading && settings && tab === "payees" ? <PayeesTab schoolId={schoolId} payees={payees} payments={payments} money={money} onChanged={refresh} /> : null}
          {!loading && settings && tab === "settings" ? <SettingsTab key={settings.updated_at} schoolId={schoolId} settings={settings} money={money} onChanged={refresh} /> : null}
        </div>
        </LabelsContext.Provider>
      </Page>
    </div>
  );
};

export default Payroll;
