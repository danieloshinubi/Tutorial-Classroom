import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchMyInvoices,
  fetchInvoiceItems,
  fetchPaymentsFor,
  fetchChildren,
  declarePayment,
  uploadPaymentProof,
  withdrawPayment,
  PAYMENT_METHODS,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  displayName,
  formatDate,
} from "../../Components/UI";
import { StatRow } from "../../Components/Charts";

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS);

const STANDING_TONE = {
  paid: "success",
  "part paid": "warn",
  unpaid: undefined,
  overdue: "danger",
  cancelled: undefined,
};

// One place that decides how money reads, so a figure never appears in two
// different shapes on the same screen.
const useMoney = (currency) =>
  useMemo(() => {
    const format = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "NGN",
      maximumFractionDigits: 2,
    });
    return (value) => format.format(Number(value || 0));
  }, [currency]);

// What a family owes and has paid.
//
// The rule this page has to communicate honestly: declaring a payment is not
// the same as the school having received it. Until the bursary approves it,
// the balance has not moved, and the page says so rather than showing a
// figure the school does not agree with.
const Fees = () => {
  const { user } = useAuth();
  const { school, schoolId, isParent } = useSchool();
  const money = useMoney(school?.currency);

  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState({});
  const [payments, setPayments] = useState({});
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    if (!schoolId || !user) return;
    setLoading(true);
    try {
      const rows = await fetchMyInvoices();
      setInvoices(rows);
      const ids = rows.map((r) => r.invoice_id);
      const [itemRows, payRows, kids] = await Promise.all([
        fetchInvoiceItems(ids).catch(() => ({})),
        fetchPaymentsFor(ids).catch(() => ({})),
        fetchChildren(user.id).catch(() => []),
      ]);
      setItems(itemRows);
      setPayments(payRows);
      setChildren(kids);
    } catch (err) {
      setError(err.message || "Could not load your fees.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, user]);

  useEffect(() => {
    load();
  }, [load]);

  // A parent with three children needs to know which bill is whose.
  const nameOf = useCallback(
    (studentId) => {
      if (studentId === user?.id) return "You";
      const child = children.find((c) => c.student?.id === studentId);
      return child ? displayName(child.student) : "Student";
    },
    [children, user]
  );

  const totals = useMemo(() => {
    const live = invoices.filter((i) => i.status === "issued");
    return {
      payable: live.reduce((sum, i) => sum + Number(i.payable || 0), 0),
      paid: live.reduce((sum, i) => sum + Number(i.paid || 0), 0),
      balance: live.reduce((sum, i) => sum + Number(i.balance || 0), 0),
      waiting: live.reduce((sum, i) => sum + Number(i.awaiting_approval || 0), 0),
    };
  }, [invoices]);

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Fees"
        subtitle={
          isParent ? "What your children owe, and what you have paid" : "Your school fees"
        }
      >
        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{notice}</Notice>

        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {!loading && invoices.length === 0 ? (
          <Empty>
            {"Nothing has been billed yet. Invoices appear here as soon as the school issues them."}
          </Empty>
        ) : null}

        {invoices.length ? (
          <StatRow
            stats={[
              { label: "Billed", value: money(totals.payable), note: "this session" },
              { label: "Paid", value: money(totals.paid), note: "approved by the school" },
              {
                label: "Outstanding",
                value: money(totals.balance),
                note: totals.balance > 0 ? "still to pay" : "nothing owing",
              },
              {
                label: "Awaiting approval",
                value: money(totals.waiting),
                note: totals.waiting > 0 ? "not counted yet" : "nothing waiting",
              },
            ]}
          />
        ) : null}

        {totals.waiting > 0 ? (
          <Notice tone="warn">
            {`${money(totals.waiting)} you have declared is still being checked by the school. It does not come off the balance until the bursary approves it.`}
          </Notice>
        ) : null}

        {invoices.map((invoice) => (
          <InvoiceCard
            key={invoice.invoice_id}
            invoice={invoice}
            who={nameOf(invoice.student_id)}
            items={items[invoice.invoice_id] || []}
            payments={payments[invoice.invoice_id] || []}
            money={money}
            open={openId === invoice.invoice_id}
            onToggle={() =>
              setOpenId((current) =>
                current === invoice.invoice_id ? null : invoice.invoice_id
              )
            }
            onChange={(message) => {
              setNotice(message || "");
              load();
            }}
            onError={setError}
          />
        ))}
      </Page>
    </div>
  );
};

const InvoiceCard = ({
  invoice,
  who,
  items,
  payments,
  money,
  open,
  onToggle,
  onChange,
  onError,
}) => {
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const owing = Number(invoice.balance || 0);

  const submit = async (event) => {
    event.preventDefault();
    onError("");

    const value = Number(amount);
    if (!value || value <= 0) {
      onError("How much did you pay?");
      return;
    }
    if (value > owing) {
      onError(
        `That is more than the ${money(owing)} outstanding. Check the amount, or speak to the bursary.`
      );
      return;
    }

    setBusy(true);
    try {
      let proofPath = null;
      if (file) {
        proofPath = await uploadPaymentProof({
          schoolId: invoice.school_id,
          invoiceId: invoice.invoice_id,
          file,
        });
      }
      await declarePayment({
        schoolId: invoice.school_id,
        invoiceId: invoice.invoice_id,
        userId: user.id,
        amount: value,
        method,
        reference: reference.trim(),
        paidOn,
        proofPath,
      });
      setPaying(false);
      setAmount("");
      setReference("");
      setFile(null);
      onChange(
        "Sent to the bursary. They will check it against the account and confirm — the balance updates once they do."
      );
    } catch (err) {
      onError(err.message || "Could not send that.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (payment) => {
    if (!window.confirm("Withdraw this declaration?")) return;
    try {
      await withdrawPayment(payment.id);
      onChange("Withdrawn.");
    } catch (err) {
      onError(err.message || "Could not withdraw that.");
    }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <div className="page-head" style={{ marginBottom: 6 }}>
        <div>
          <div className="btn-row" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <Badge tone={STANDING_TONE[invoice.standing]}>{invoice.standing}</Badge>
            <Badge>{who}</Badge>
            {invoice.due_on ? (
              <Badge>{`due ${formatDate(invoice.due_on, { withTime: false })}`}</Badge>
            ) : null}
          </div>
          <h3 style={{ margin: 0 }}>{money(invoice.balance)}</h3>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
            {`${invoice.reference} · ${money(invoice.paid)} paid of ${money(invoice.payable)}`}
          </div>
        </div>

        <div className="btn-row">
          {owing > 0 && invoice.status === "issued" ? (
            <Button size="sm" onClick={() => setPaying((v) => !v)}>
              {paying ? "Cancel" : "I have paid"}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onToggle}>
            {open ? "Hide detail" : "See detail"}
          </Button>
        </div>
      </div>

      {paying ? (
        <form onSubmit={submit} className="pay-form">
          <p style={{ color: "var(--ink-2)", fontSize: 13.5, marginTop: 0 }}>
            {"Tell the school about a payment you have already made. It is checked against the account before it comes off your balance."}
          </p>

          <div className="split">
            <Field label="How much">
              <input
                className="input"
                type="number"
                min="1"
                step="0.01"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="How you paid">
              <select
                className="select"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {PAYMENT_METHODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="split">
            <Field label="When" >
              <input
                className="input"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
            <Field label="Teller or transfer reference" hint="Optional, but it speeds the check up.">
              <input
                className="input"
                value={reference}
                placeholder="GTB/8891"
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Receipt" hint="A photograph of the teller, or the transfer screenshot.">
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>

          <Button type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send to the bursary"}
          </Button>
        </form>
      ) : null}

      {open ? (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ marginBottom: 6 }}>{"What you were billed"}</h4>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {money(item.amount)}
                    </td>
                  </tr>
                ))}
                {Number(invoice.discount) > 0 ? (
                  <tr>
                    <td>
                      {"Discount"}
                      {invoice.discount_reason ? (
                        <span style={{ color: "var(--ink-3)" }}>
                          {` · ${invoice.discount_reason}`}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {`− ${money(invoice.discount)}`}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td>
                    <strong>{"Total"}</strong>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <strong>{money(invoice.payable)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h4 style={{ margin: "18px 0 6px" }}>{"Payments"}</h4>
          {payments.length === 0 ? (
            <Empty>{"Nothing recorded against this invoice yet."}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{"Date"}</th>
                    <th>{"Amount"}</th>
                    <th>{"How"}</th>
                    <th>{"Reference"}</th>
                    <th>{"Status"}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {formatDate(payment.paid_on, { withTime: false })}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{money(payment.amount)}</td>
                      <td>{METHOD_LABEL[payment.method] || payment.method}</td>
                      <td style={{ color: "var(--ink-3)" }}>{payment.reference || "—"}</td>
                      <td>
                        <Badge
                          tone={
                            payment.status === "approved"
                              ? "success"
                              : payment.status === "rejected"
                              ? "danger"
                              : "warn"
                          }
                        >
                          {payment.status === "submitted" ? "being checked" : payment.status}
                        </Badge>
                        {payment.decision_note ? (
                          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                            {payment.decision_note}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {payment.status === "submitted" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => withdraw(payment)}
                          >
                            {"Withdraw"}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
};

export default Fees;
