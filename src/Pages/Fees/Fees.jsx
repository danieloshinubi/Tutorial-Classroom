import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useMoney } from "../../lib/money";
import { todayISO } from "../../lib/dates";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchMyInvoices,
  fetchInvoiceItems,
  fetchPaymentsFor,
  fetchChildren,
  fetchTerms,
  declarePayment,
  uploadPaymentProof,
  withdrawPayment,
  startOnlinePayment,
  PAYMENT_METHODS,
} from "../../lib/api";
import { openPaystackPayment } from "../../lib/paystack";
import {
  Page,
  Field,
  Button,
  Badge,
  MoneyInput,
  Select,
  DatePicker,
  displayName,
  formatDate,
  SkeletonStatRow,
  SkeletonCards,
} from "../../Components/UI";
import { useDocumentPreview } from "../../Components/DocumentPreview";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS);

const STANDING_TONE = {
  paid: "success",
  "carried forward": undefined,
  "part paid": "warn",
  unpaid: undefined,
  overdue: "danger",
  cancelled: undefined,
};

// invoice_balances.standing as a family would say it. It used to print as
// stored, in lower case.
const STANDING_LABEL = {
  paid: "Paid",
  "carried forward": "Moved to next term",
  "part paid": "Part paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

// A parent seeing the bare word "overdue" or "part paid" for the first time
// has no way to know what it means for them right now. One plain sentence
// next to the badge, every time — never just the badge on its own.
const STANDING_EXPLAINER = {
  paid: "Fully paid — nothing more owed on this bill.",
  "carried forward": "What was still owing here has been added to this child’s bill for the next term, so it is paid there, not here.",
  "part paid": "Some of this has been paid; the rest is still owing.",
  unpaid: "Nothing has been paid on this bill yet.",
  overdue: "This is past its due date and still has money owing.",
  cancelled: "The school cancelled this bill — there is nothing to pay.",
};

const PURPOSE_LABEL = { application_fee: "Application fee", acceptance_fee: "Acceptance fee" };

// What needs paying first: overdue, then by due date (soonest first, undated
// last), then part paid before unpaid; fully paid and cancelled at the end.
const urgency = (i) => {
  if (i.status === "cancelled" || i.standing === "cancelled") return 4;
  if (Number(i.balance) <= 0) return 3;
  if (i.standing === "overdue") return 0;
  return 1;
};
const byUrgency = (a, b) =>
  urgency(a) - urgency(b) ||
  (a.due_on ? new Date(a.due_on).getTime() : Infinity) - (b.due_on ? new Date(b.due_on).getTime() : Infinity);

// What a family owes and has paid.
//
// The rule this page has to communicate honestly: declaring a payment is not
// the same as the school having received it. Until the bursary approves it,
// the balance has not moved, and the page says so rather than showing a
// figure the school does not agree with.
//
// Laid out around the question a parent opens it with — what do I still have
// to pay, and for whom? A summary of what is outstanding and what is due next
// comes first; then the bills, grouped by child, with anything owing (overdue
// first) ahead of what is already paid, which folds away. It used to be one
// flat list in which an overdue bill could sit below a fully paid one, and a
// parent of three told the bills apart by a small name badge.
const Fees = () => {
  const { user } = useAuth();
  const { school, schoolId, isParent } = useSchool();
  const money = useMoney(school?.currency);

  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState({});
  const [payments, setPayments] = useState({});
  const [children, setChildren] = useState([]);
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError, setNotice } = useActionFeedback();
  const [openId, setOpenId] = useState(null);
  const [showPaid, setShowPaid] = useState({});
  // ?bill=<id>: a bill notice opens the bill it is about (supabase/186).
  const [searchParams] = useSearchParams();
  const billParam = searchParams.get("bill");

  const load = useCallback(async () => {
    if (!schoolId || !user) return;
    setLoading(true);
    try {
      const rows = await fetchMyInvoices(schoolId);
      setInvoices(rows);
      const ids = rows.map((r) => r.invoice_id);
      const [itemRows, payRows, kids, termRows] = await Promise.all([
        fetchInvoiceItems(ids, schoolId).catch(() => ({})),
        fetchPaymentsFor(ids, schoolId).catch(() => ({})),
        fetchChildren(user.id, schoolId).catch(() => []),
        fetchTerms(schoolId).catch(() => []),
      ]);
      setItems(itemRows);
      setPayments(payRows);
      setChildren(kids);
      setTerms(termRows);
    } catch (err) {
      setError(err.message || "Could not load your fees.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, user, setError]);

  // "For Term 2, 2025/2026" is a lot more legible than a bare invoice
  // reference — an admissions invoice (application/acceptance fee) has no
  // term at all, so this is null for those and simply isn't shown.
  const termLabel = useCallback(
    (termId) => {
      const term = terms.find((t) => t.id === termId);
      if (!term) return null;
      return term.sessions?.name ? `${term.name}, ${term.sessions.name}` : term.name;
    },
    [terms]
  );

  useEffect(() => {
    load();
  }, [load]);

  // A parent with three children needs to know which bill is whose. An
  // application/acceptance-fee invoice has no student_id at all (see
  // Bursary.jsx's own nameOf) — invoice_balances carries the applicant's
  // name separately on exactly those rows.
  const nameOf = useCallback(
    (invoice) => {
      if (invoice.student_id === user?.id) return "You";
      const child = children.find((c) => c.student?.id === invoice.student_id);
      if (child) return displayName(child.student);
      return invoice.applicant_name || "Student";
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
      owingCount: live.filter((i) => Number(i.balance) > 0).length,
    };
  }, [invoices]);

  // The bill to deal with first: the earliest due date among bills still
  // owing.
  const nextDue = useMemo(
    () =>
      invoices
        .filter((i) => i.status === "issued" && Number(i.balance) > 0 && i.due_on)
        .sort((a, b) => new Date(a.due_on) - new Date(b.due_on))[0] || null,
    [invoices]
  );

  // One group per person the bills are for, each with its own total.
  const groups = useMemo(() => {
    const map = new Map();
    invoices.forEach((invoice) => {
      const key = invoice.student_id || `applicant:${invoice.applicant_name || invoice.invoice_id}`;
      if (!map.has(key)) map.set(key, { key, who: nameOf(invoice), invoices: [] });
      map.get(key).invoices.push(invoice);
    });
    return [...map.values()]
      .map((g) => {
        const sorted = [...g.invoices].sort(byUrgency);
        return {
          ...g,
          owing: sorted.filter((i) => i.status === "issued" && Number(i.balance) > 0),
          settled: sorted.filter((i) => !(i.status === "issued" && Number(i.balance) > 0)),
          balance: sorted
            .filter((i) => i.status === "issued")
            .reduce((sum, i) => sum + Number(i.balance || 0), 0),
        };
      })
      .sort((a, b) => b.balance - a.balance || a.who.localeCompare(b.who));
  }, [invoices, nameOf]);

  // Once per link, not on every render: groups is rebuilt each render, and
  // re-running this set state each time (a render loop), and would also
  // reopen the list every time the parent closed it.
  const handledBillRef = useRef(null);
  useEffect(() => {
    if (!billParam || loading || handledBillRef.current === billParam) return undefined;
    const group = groups.find((g) => g.invoices.some((i) => i.invoice_id === billParam));
    if (!group) return undefined;
    handledBillRef.current = billParam;
    if (group.settled.some((i) => i.invoice_id === billParam)) {
      setShowPaid((current) => (current[group.key] ? current : { ...current, [group.key]: true }));
    }
    setOpenId(billParam);
    const timer = setTimeout(() => {
      document.getElementById(`bill-${billParam}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(timer);
  }, [billParam, loading, groups]);

  const paidPct = totals.payable > 0 ? Math.min(100, (totals.paid / totals.payable) * 100) : 0;
  const waitingPct = totals.payable > 0 ? Math.min(100 - paidPct, (totals.waiting / totals.payable) * 100) : 0;

  const card = (invoice) => (
    <InvoiceCard
      key={invoice.invoice_id}
      invoice={invoice}
      who={nameOf(invoice)}
      term={termLabel(invoice.term_id)}
      items={items[invoice.invoice_id] || []}
      payments={payments[invoice.invoice_id] || []}
      money={money}
      open={openId === invoice.invoice_id}
      onToggle={() =>
        setOpenId((current) => (current === invoice.invoice_id ? null : invoice.invoice_id))
      }
      onChange={(message) => {
        setNotice(message || "");
        load();
      }}
      onError={setError}
    />
  );

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Fees"
        subtitle={isParent ? "What your children owe, and what you have paid" : "Your school fees"}
      >
        {loading ? (
          <>
            <SkeletonStatRow count={3} />
            <SkeletonCards count={3} lines={3} />
          </>
        ) : null}

        {!loading && invoices.length === 0 ? (
          <div className="fe-empty">
            <strong>{"Nothing has been billed yet"}</strong>
            <span>{"Bills appear here as soon as the school issues them, and you are notified when one arrives."}</span>
          </div>
        ) : null}

        {!loading && invoices.length ? (
          <div className="fe-stack">
            <section className={`fe-summary${totals.balance > 0 ? "" : " clear"}`}>
              <div className="fe-summary-main">
                <span className="fe-label">{totals.balance > 0 ? "Still to pay" : "All paid up"}</span>
                <div className="fe-summary-figure">
                  <span>{money(totals.balance)}</span>
                  {totals.balance > 0 ? (
                    <span className="fe-summary-of">
                      {`on ${totals.owingCount} bill${totals.owingCount === 1 ? "" : "s"}`}
                    </span>
                  ) : null}
                </div>
                <div className="fe-progress" aria-hidden="true">
                  <span className="fe-progress-paid" style={{ width: `${paidPct}%` }} />
                  <span className="fe-progress-waiting" style={{ width: `${waitingPct}%` }} />
                </div>
                <div className="fe-legend">
                  <span><i className="fe-swatch paid" />{`Paid ${money(totals.paid)}`}</span>
                  {totals.waiting > 0 ? (
                    <span><i className="fe-swatch waiting" />{`Being checked ${money(totals.waiting)}`}</span>
                  ) : null}
                  <span className="fe-muted">{`of ${money(totals.payable)} billed in total`}</span>
                </div>
              </div>

              {nextDue ? (
                <div className={`fe-next${nextDue.standing === "overdue" ? " late" : ""}`}>
                  <span className="fe-label">{nextDue.standing === "overdue" ? "Overdue since" : "Next due"}</span>
                  <strong>{formatDate(nextDue.due_on, { withTime: false })}</strong>
                  <span>{`${money(nextDue.balance)} · ${nameOf(nextDue)}`}</span>
                </div>
              ) : null}
            </section>

            {totals.waiting > 0 ? (
              <p className="fe-waiting">
                {`${money(totals.waiting)} you told the school you paid is still being checked by the bursary. It comes off what you owe once they confirm it — the bill it belongs to is marked below.`}
              </p>
            ) : null}

            {groups.map((g) => (
              <section key={g.key} className="fe-group">
                {groups.length > 1 || g.who !== "You" ? (
                  <header className="fe-group-head">
                    <h2>{g.who}</h2>
                    <span className={g.balance > 0 ? "fe-group-owing" : "fe-muted"}>
                      {g.balance > 0 ? `${money(g.balance)} to pay` : "Nothing owing"}
                    </span>
                  </header>
                ) : null}

                {g.owing.map(card)}

                {g.settled.length ? (
                  <>
                    {g.owing.length === 0 || showPaid[g.key] ? (
                      g.settled.map(card)
                    ) : null}
                    {g.owing.length ? (
                      <button
                        type="button"
                        className="fe-toggle"
                        aria-expanded={Boolean(showPaid[g.key])}
                        onClick={() => setShowPaid((s) => ({ ...s, [g.key]: !s[g.key] }))}
                      >
                        {showPaid[g.key]
                          ? "Hide paid or cancelled bills"
                          : `Show ${g.settled.length} paid or cancelled bill${g.settled.length === 1 ? "" : "s"}`}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}
      </Page>
    </div>
  );
};

const InvoiceCard = ({
  invoice,
  who,
  term,
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
  // The date on the family's own calendar, not UTC's (src/lib/dates.js).
  const [paidOn, setPaidOn] = useState(todayISO());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [payingOnline, setPayingOnline] = useState(false);
  const fileRef = useRef(null);
  const preview = useDocumentPreview();

  // Straight to the gateway. The amount is decided server-side from the
  // outstanding balance, so there is nothing to pass here but the invoice.
  const payOnline = async () => {
    onError("");
    setPayingOnline(true);
    try {
      const paymentData = await startOnlinePayment({
        invoiceId: invoice.invoice_id,
      });
      // eslint-disable-next-line no-console
      console.log("[pay-init response]", paymentData);
      openPaystackPayment(paymentData?.authorizationUrl);
    } catch (err) {
      onError(err.message || "Could not start that payment.");
      setPayingOnline(false);
    }
  };

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
    // Two things about this catch block. First, we extract the message
    // safely: Supabase Storage errors in some versions carry a self-
    // referencing `context` inside the error object, and reading `err.message`
    // in a template literal, or handing the whole error to React, could
    // recurse straight into "Maximum call stack size exceeded". Second, we
    // log the raw error to the console so the next report has a real
    // stack trace behind it — the user only ever sees the friendly string.
    const messageOf = (err) => {
      try {
        if (!err) return "Could not send that.";
        if (typeof err === "string") return err;
        // A Supabase PostgrestError has string message + hint; a StorageError
        // has string message. Never string-ify the whole object.
        if (typeof err.message === "string" && err.message) return err.message;
        if (typeof err.error === "string") return err.error;
        return "Could not send that.";
      } catch {
        return "Could not send that.";
      }
    };

    let stage = "start";
    try {
      let proofPath = null;
      if (file) {
        stage = "upload";
        proofPath = await uploadPaymentProof({
          schoolId: invoice.school_id,
          invoiceId: invoice.invoice_id,
          file,
        });
      }
      stage = "declare";
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
      stage = "done";
      setPaying(false);
      setAmount("");
      setReference("");
      setFile(null);
      onChange(
        "Sent to the bursary. They will check it against the account and confirm — the balance updates once they do."
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Payment ${stage} failed:`, err);
      onError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (payment) => {
    if (!await confirmDialog("Withdraw this declaration?")) return;
    try {
      await withdrawPayment(payment.id);
      onChange("Withdrawn.");
    } catch (err) {
      onError(err.message || "Could not withdraw that.");
    }
  };

  // What the bill is for, in the family's terms. A term fee is named by its
  // term; an additional charge (WAEC, the end-of-session party) by what it
  // is, since two bills both headed "First Term, 2026/2027" read as the same
  // bill twice; an admissions fee by its kind.
  // A store purchase added to the bill (uniforms, books) names what was
  // bought, so it is never mistaken for a fee.
  const title =
    invoice.purpose === "term_fee" || !invoice.purpose
      ? term
        ? `${term} fees`
        : "School fees"
      : invoice.purpose === "store"
      ? items.length
        ? `School store: ${items.map((i) => i.name).join(", ")}`
        : "School store"
      : PURPOSE_LABEL[invoice.purpose] ||
        (items.length ? items.map((i) => i.name).join(", ") : "Additional charge");
  const subtitle = [
    invoice.purpose && invoice.purpose !== "term_fee" && term ? term : null,
    invoice.reference,
  ]
    .filter(Boolean)
    .join(" · ");

  const cancelled = invoice.status === "cancelled" || invoice.standing === "cancelled";
  const settled = !cancelled && owing <= 0;
  const payable = Number(invoice.payable || 0);
  const paidPct = payable > 0 ? Math.min(100, (Number(invoice.paid || 0) / payable) * 100) : 0;
  const waitingPct =
    payable > 0 ? Math.min(100 - paidPct, (Number(invoice.awaiting_approval || 0) / payable) * 100) : 0;
  const late = invoice.standing === "overdue";

  return (
    <article
      id={`bill-${invoice.invoice_id}`}
      className={`fe-bill${settled ? " settled" : ""}${cancelled ? " cancelled" : ""}${late ? " late" : ""}`}
    >
      <div className="fe-bill-top">
        <div className="fe-bill-id">
          <div className="fe-bill-title">
            <h3>{title}</h3>
            <Badge tone={STANDING_TONE[invoice.standing]}>
              {STANDING_LABEL[invoice.standing] || invoice.standing}
            </Badge>
          </div>
          <div className="fe-sub">{subtitle}</div>
        </div>

        <div className="fe-bill-amount">
          {cancelled ? (
            <span className="fe-muted">{"Nothing to pay"}</span>
          ) : settled && invoice.standing === "carried forward" ? (
            <span className="fe-muted">{"Moved to next term"}</span>
          ) : settled ? (
            <>
              <strong className="paid">{"Paid in full"}</strong>
              <span className="fe-sub">{money(invoice.payable)}</span>
            </>
          ) : (
            <>
              <strong>{money(invoice.balance)}</strong>
              <span className={`fe-sub${late ? " late" : ""}`}>
                {invoice.due_on
                  ? `${late ? "was due" : "due"} ${formatDate(invoice.due_on, { withTime: false })}`
                  : "to pay"}
              </span>
            </>
          )}
        </div>
      </div>

      {!cancelled ? (
        <div className="fe-bill-progress">
          <span className="fe-progress small" aria-hidden="true">
            <span className="fe-progress-paid" style={{ width: `${paidPct}%` }} />
            <span className="fe-progress-waiting" style={{ width: `${waitingPct}%` }} />
          </span>
          <span className="fe-sub">{`${money(invoice.paid)} paid of ${money(invoice.payable)}`}</span>
        </div>
      ) : null}

      {/* The one sentence that answers "what does this word mean for me" —
          never leave the badge above to speak for itself. */}
      <p className="fe-explain">{STANDING_EXPLAINER[invoice.standing]}</p>

      {Number(invoice.awaiting_approval) > 0 ? (
        <p className="fe-bill-waiting">
          {`${money(invoice.awaiting_approval)} you declared on this bill is still being checked by the bursary — it comes off the balance once they confirm it, not before.`}
        </p>
      ) : null}

      <div className="fe-bill-actions">
        {owing > 0 && invoice.status === "issued" ? (
          <>
            <Button disabled={payingOnline} onClick={payOnline}>
              {payingOnline ? "Opening..." : `Pay ${money(owing)} now`}
            </Button>
            <Button variant="secondary" onClick={() => setPaying((v) => !v)} aria-expanded={paying}>
              {paying ? "Cancel" : "I already paid"}
            </Button>
          </>
        ) : null}
        <button type="button" className="fe-link" onClick={onToggle} aria-expanded={open}>
          {open ? "Hide breakdown" : "What this is made of"}
        </button>
      </div>

      {paying ? (
        <form onSubmit={submit} className="fe-pay">
          <h4>{who === "You" ? "Tell the school about a payment you made" : `Tell the school about a payment for ${who}`}</h4>
          <p className="fe-sub">
            {"It is checked against the school's account before it comes off your balance."}
          </p>

          <div className="fe-pay-grid">
            <Field label="How much">
              <MoneyInput autoFocus value={amount} onChange={setAmount} />
            </Field>
            <Field label="How you paid">
              <Select
                className="select"
                value={method}
                onChange={setMethod}
                options={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="When">
              <DatePicker value={paidOn} onChange={setPaidOn} />
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

          {/* A labelled drop target in place of the browser's bare "Choose
              file / No file chosen" control, which reads differently on every
              phone and says nothing about what to attach. */}
          <div className="fe-file">
            <span className="fe-file-label">{"Receipt"}</span>
            <input
              ref={fileRef}
              id={`receipt-${invoice.invoice_id}`}
              className="fe-file-input"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <label htmlFor={`receipt-${invoice.invoice_id}`} className={`fe-file-drop${file ? " has" : ""}`}>
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span>{"Tap to choose a different file"}</span>
                </>
              ) : (
                <>
                  <strong>{"Attach the teller or transfer screenshot"}</strong>
                  <span>{"A photo or PDF. Optional, but it gets your payment confirmed faster."}</span>
                </>
              )}
            </label>
            {file ? (
              <button
                type="button"
                className="fe-link"
                onClick={() => {
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                {"Remove file"}
              </button>
            ) : null}
          </div>

          <Button type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send to the bursary"}
          </Button>
        </form>
      ) : null}

      {open ? (
        <div className="fe-breakdown">
          <h4>{"What you were billed"}</h4>
          <ul className="fe-lines">
            {items.map((item) => (
              <li key={item.id}>
                <span>{item.name}</span>
                <span className="fe-amount">{money(item.amount)}</span>
              </li>
            ))}
            {Number(invoice.discount) > 0 ? (
              <li className="fe-discount">
                <span>
                  {"Discount"}
                  {invoice.discount_reason ? <span className="fe-muted">{` · ${invoice.discount_reason}`}</span> : null}
                </span>
                <span className="fe-amount">{`− ${money(invoice.discount)}`}</span>
              </li>
            ) : null}
            <li className="fe-total">
              <span>{"Total"}</span>
              <span className="fe-amount">{money(invoice.payable)}</span>
            </li>
          </ul>

          <h4>{"Payments"}</h4>
          {payments.length === 0 ? (
            <p className="fe-muted" style={{ margin: 0 }}>
              {cancelled ? "No payments were made on this bill." : "Nothing recorded against this bill yet."}
            </p>
          ) : (
            <ul className="fe-payments">
              {payments.map((payment) => (
                <li key={payment.id} className="fe-payment">
                  <div className="fe-payment-main">
                    <strong className="fe-amount">{money(payment.amount)}</strong>
                    <span className="fe-sub">
                      {[
                        formatDate(payment.paid_on, { withTime: false }),
                        METHOD_LABEL[payment.method] || payment.method,
                        payment.reference || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {payment.note ? <span className="fe-sub">{`You said: ${payment.note}`}</span> : null}
                    {/* The reason the bursary gave — its own clearly
                        labelled line, not lost in the same small grey
                        as everything else, especially when it's a
                        rejection a parent needs to actually act on. */}
                    {payment.decision_note ? (
                      <span className={`fe-why${payment.status === "rejected" ? " rejected" : ""}`}>
                        {`Why: ${payment.decision_note}`}
                      </span>
                    ) : null}
                  </div>
                  <div className="fe-payment-side">
                    <Badge
                      tone={
                        payment.status === "approved"
                          ? "success"
                          : payment.status === "rejected"
                          ? "danger"
                          : "warn"
                      }
                    >
                      {payment.status === "submitted"
                        ? "Being checked"
                        : payment.status === "approved"
                        ? "Confirmed"
                        : payment.status === "rejected"
                        ? "Not accepted"
                        : payment.status}
                    </Badge>
                    {payment.proof_path ? (
                      <button
                        type="button"
                        className="fe-link"
                        onClick={() => preview.open(payment.proof_path, "Your receipt")}
                      >
                        {"View receipt"}
                      </button>
                    ) : null}
                    {/* A gateway-sourced submitted row (require_confirmation
                        on) is not a family's own declaration — it's the
                        record of money the gateway already reports as
                        taken, and RLS itself now refuses this for one
                        (119_unify_payment_confirmation.sql); this just
                        keeps the button from appearing only to fail. */}
                    {payment.status === "submitted" && !payment.gateway_ref ? (
                      <button type="button" className="fe-link" onClick={() => withdraw(payment)}>
                        {"Withdraw"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {preview.node}
    </article>
  );
};

export default Fees;
