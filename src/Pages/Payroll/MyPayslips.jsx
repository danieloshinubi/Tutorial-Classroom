import React, { useEffect, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { useMoney } from "../../lib/money";
import { fetchMyPayslips, markPayslipNotificationsRead } from "../../lib/api";
import { Page, Card, Empty, SkeletonCards } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { ExportMenu } from "../../Components/ExportButton";

// A payslip as a file (PDF by default for most people, or Excel/CSV):
// what was earned, what came off, and the net, as two short tables.
const payslipSheets = (slip) => [
  {
    name: "Earnings",
    columns: [{ key: "label", label: "Earnings" }, { key: "amount", label: "Amount", type: "money" }],
    rows: [...(slip.earnings || []), { label: "Gross pay", amount: slip.gross }],
  },
  {
    name: "Deductions",
    columns: [{ key: "label", label: "Deductions" }, { key: "amount", label: "Amount", type: "money" }],
    rows: [
      { label: "PAYE (income tax)", amount: slip.paye },
      ...(Number(slip.pension_employee) ? [{ label: "Pension", amount: slip.pension_employee }] : []),
      ...(Number(slip.nhf) ? [{ label: "National Housing Fund", amount: slip.nhf }] : []),
      ...(slip.deductions || []).map((d) => ({ label: d.label, amount: d.amount })),
      { label: "Net pay", amount: slip.net },
    ],
  },
];

// A staff member's own payslips, once the school has approved the month
// (supabase/197, 198). Nobody else's: the database only returns their own.

const monthLabel = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";
const num = (v) => Number(v || 0);
// The calendar day, not midnight UTC (which read as 1:00 AM in Nigeria).
const dayLabel = (iso) =>
  iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const Slip = ({ slip, money }) => (
  <div className="pr-slip pr-slip-print">
    <div className="pr-slip-head">
      {slip.school_logo ? <img src={slip.school_logo} alt="" /> : null}
      <div>
        <strong>{slip.school_name}</strong>
        <span>{`Payslip · ${monthLabel(slip.period)}`}</span>
      </div>
    </div>
    <div className="pr-slip-who">
      <div><span>{"Name"}</span><b>{slip.full_name}</b></div>
      {slip.job_title ? <div><span>{"Role"}</span><b>{slip.job_title}</b></div> : null}
      {slip.bank_name ? <div><span>{"Paid to"}</span><b>{`${slip.bank_name}${slip.account_number ? ` ·••${String(slip.account_number).slice(-4)}` : ""}`}</b></div> : null}
      {slip.paid_on ? <div><span>{"Paid on"}</span><b>{dayLabel(slip.paid_on)}</b></div> : null}
    </div>
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
        <div className="pr-line"><span>{"PAYE (income tax)"}</span><b>{money(slip.paye)}</b></div>
        {num(slip.pension_employee) ? <div className="pr-line"><span>{"Pension"}</span><b>{money(slip.pension_employee)}</b></div> : null}
        {num(slip.nhf) ? <div className="pr-line"><span>{"National Housing Fund"}</span><b>{money(slip.nhf)}</b></div> : null}
        {(slip.deductions || []).map((d, i) => (
          <div key={i} className="pr-line"><span>{d.label}</span><b>{money(d.amount)}</b></div>
        ))}
        <div className="pr-line total net"><span>{"Net pay"}</span><b>{money(slip.net)}</b></div>
      </div>
    </div>
    <p className="pr-slip-note">
      {`The school also paid ${money(slip.pension_employer)} into your pension this month.`}
      {slip.rsa_pin ? ` RSA PIN ${slip.rsa_pin}.` : ""}
      {slip.tin ? ` TIN ${slip.tin}.` : ""}
    </p>
  </div>
);

const MyPayslips = () => {
  const { school } = useSchool();
  const money = useMoney(school?.currency);
  const { setError } = useActionFeedback();
  const [slips, setSlips] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetchMyPayslips()
      .then((rows) => {
        setSlips(rows);
        if (rows[0]) setOpen(rows[0].id);
        if (rows.length) markPayslipNotificationsRead().catch(() => {});
      })
      .catch((err) => {
        setError(err.message || "Could not load your payslips.");
        setSlips([]);
      });
  }, [setError]);

  const current = slips?.find((s) => s.id === open);

  return (
    <div className="shell">
      <Navbar />
      <Page title="My payslips" subtitle="Your pay, month by month">
        {slips == null ? <SkeletonCards count={2} lines={3} /> : null}
        {slips && slips.length === 0 ? <Empty>{"No payslips yet. They appear here once the school approves a month's payroll."}</Empty> : null}
        {slips && slips.length ? (
          <div className="pr-mine">
            <div className="pr-run-list" role="list">
              {slips.map((s) => (
                <button key={s.id} type="button" role="listitem" className={`pr-run${s.id === open ? " active" : ""}`} onClick={() => setOpen(s.id)}>
                  <span>{monthLabel(s.period)}</span>
                  <b>{money(s.net)}</b>
                </button>
              ))}
            </div>
            {current ? (
              <Card>
                <Slip slip={current} money={money} />
                <div className="btn-row pr-no-print">
                  <ExportMenu
                    label="Download payslip"
                    filename={`payslip-${String(current.period).slice(0, 7)}`}
                    title={`${current.full_name} · Payslip · ${monthLabel(current.period)}`}
                    sheets={payslipSheets(current)}
                  />
                </div>
              </Card>
            ) : null}
          </div>
        ) : null}
      </Page>
    </div>
  );
};

export default MyPayslips;
