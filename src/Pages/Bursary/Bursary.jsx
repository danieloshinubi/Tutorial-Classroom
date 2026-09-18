import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchTerms,
  fetchClasses,
  fetchSchoolMembers,
  fetchPaymentQueueContext,
  fetchFeeStructures,
  fetchFeeItems,
  createFeeStructure,
  deleteFeeStructure,
  addFeeItem,
  deleteFeeItem,
  raiseInvoicesForClass,
  issueInvoice,
  cancelInvoice,
  fetchSchoolInvoices,
  fetchPaymentQueue,
  approvePayment,
  rejectPayment,
  takePayment,
  fetchDebtors,
  fetchCollectionSummary,
  PAYMENT_METHODS,
} from "../../lib/api";
import { useDocumentPreview } from "../../Components/DocumentPreview";
import { useActionFeedback } from "../../Components/Toast";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  Tabs,
  MoneyInput,
  Select,
  DatePicker,
  displayName,
  formatDate,
} from "../../Components/UI";
import { StatRow } from "../../Components/Charts";

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS);
const PURPOSE_LABEL = { term_fee: "Term fee", application_fee: "Application fee", acceptance_fee: "Acceptance fee", other: "Other" };

const useMoney = (currency) =>
  useMemo(() => {
    const f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "NGN",
      maximumFractionDigits: 2,
    });
    return (v) => f.format(Number(v || 0));
  }, [currency]);

/* ---------------------------------------------------------------- overview */

const Overview = ({ summary, debtors, money, termName }) => (
  <>
    {/* The figures are the point of the page; scrolling a long debtors list
        should not take them off screen. */}
    <div className="panel-top">
    <StatRow
      stats={[
        {
          label: "Invoiced",
          value: money(summary?.invoiced),
          note: termName || "this session",
        },
        {
          label: "Collected",
          value: money(summary?.collected),
          note: `${summary?.settled || 0} of ${summary?.invoices || 0} settled`,
        },
        {
          label: "Outstanding",
          value: money(summary?.outstanding),
          note: `${summary?.debtors || 0} owing`,
        },
        {
          label: "Collection rate",
          value:
            summary?.collection_rate === null || summary?.collection_rate === undefined
              ? "—"
              : `${summary.collection_rate}%`,
          note: "of what was billed",
        },
      ]}
    />

    {Number(summary?.awaiting) > 0 ? (
      <Notice tone="warn">
        {`${money(summary.awaiting)} declared by families is waiting on you. It is not counted as collected until you approve it.`}
      </Notice>
    ) : null}
    </div>

    <section className="section">
      <h2>{"Who owes the most"}</h2>
      {debtors.length === 0 ? (
        <Empty>{"Nobody owes anything. Enjoy it."}</Empty>
      ) : (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Student"}</th>
                  <th>{"Class"}</th>
                  <th>{"Billed"}</th>
                  <th>{"Paid"}</th>
                  <th>{"Owing"}</th>
                  <th>{"Due"}</th>
                  <th>{"Who to call"}</th>
                </tr>
              </thead>
              <tbody>
                {debtors.map((d) => (
                  <tr key={d.student_id}>
                    <td>
                      <strong>{d.student}</strong>
                    </td>
                    <td>{d.class_name || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{money(d.payable)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{money(d.paid)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <strong>{money(d.balance)}</strong>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {d.oldest_due ? (
                        <Badge
                          tone={new Date(d.oldest_due) < new Date() ? "danger" : undefined}
                        >
                          {formatDate(d.oldest_due, { withTime: false })}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {d.guardians || "no guardian linked"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  </>
);

/* --------------------------------------------------------- fee structures */

const Structures = ({
  schoolId,
  userId,
  terms,
  classes,
  structures,
  items,
  money,
  onChange,
  onError,
}) => {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);

  const [itemFor, setItemFor] = useState(null);
  const [itemName, setItemName] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [itemOptional, setItemOptional] = useState(false);

  const create = async (event) => {
    event.preventDefault();
    onError("");
    if (!name.trim() || !termId) {
      onError("A fee structure needs a name and a term.");
      return;
    }
    const term = terms.find((t) => t.id === termId);
    setBusy(true);
    try {
      await createFeeStructure({
        schoolId,
        sessionId: term.session_id,
        termId,
        classId: classId || null,
        name: name.trim(),
        dueOn,
        userId,
      });
      setName("");
      setClassId("");
      setDueOn("");
      setAdding(false);
      onChange("Fee structure created. Add what it is made up of.");
    } catch (err) {
      onError(err.message || "Could not create that.");
    } finally {
      setBusy(false);
    }
  };

  const addItem = async (structureId) => {
    onError("");
    const amount = Number(itemAmount);
    if (!itemName.trim() || !amount || amount < 0) {
      onError("A line needs a name and an amount.");
      return;
    }
    try {
      await addFeeItem({
        schoolId,
        structureId,
        name: itemName.trim(),
        amount,
        isOptional: itemOptional,
        position: (items[structureId] || []).length + 1,
      });
      setItemName("");
      setItemAmount("");
      setItemOptional(false);
      onChange();
    } catch (err) {
      onError(err.message || "Could not add that line.");
    }
  };

  const bulk = async (structure) => {
    const label = structure.class_id
      ? classes.find((c) => c.id === structure.class_id)?.name || "that class"
      : "every student in the school";
    if (
      !window.confirm(
        `Raise an invoice for ${label} from "${structure.name}"? Anyone who already has one for this term is skipped, and nothing is sent until you issue them.`
      )
    ) {
      return;
    }
    onError("");
    try {
      const made = await raiseInvoicesForClass(structure.id);
      onChange(
        made === 0
          ? "Everybody already had an invoice for this term — nothing new was raised."
          : `${made} invoice${made === 1 ? "" : "s"} raised as drafts. Issue them when you are ready.`
      );
    } catch (err) {
      onError(err.message || "Could not raise the invoices.");
    }
  };

  const remove = async (structure) => {
    if (!window.confirm(`Delete "${structure.name}"?`)) return;
    try {
      await deleteFeeStructure(structure.id, schoolId);
      onChange("Deleted.");
    } catch (err) {
      onError(err.message || "Could not delete that.");
    }
  };

  return (
    <>
      <div className="page-head" style={{ margin: "8px 0 16px" }}>
        <p style={{ color: "var(--ink-2)", margin: 0, maxWidth: "60ch" }}>
          {"What a class is charged in a term. Raising invoices copies these lines onto each student's bill, so changing a structure later never rewrites a bill already issued."}
        </p>
        <Button onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "New structure"}
        </Button>
      </div>

      {adding ? (
        <Card style={{ marginBottom: 20 }}>
          <form onSubmit={create}>
            <div className="split">
              <Field label="Name">
                <input
                  className="input"
                  autoFocus
                  value={name}
                  placeholder="JSS 1 — First Term"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Term">
                <Select
                  className="select"
                  value={termId}
                  onChange={setTermId}
                  options={[
                    { value: "", label: "Choose a term" },
                    ...terms.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              </Field>
            </div>
            <div className="split">
              <Field label="Class" hint="Leave blank to charge every class the same.">
                <Select
                  className="select"
                  value={classId}
                  onChange={setClassId}
                  options={[
                    { value: "", label: "Every class" },
                    ...classes.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </Field>
              <Field label="Due by">
                <DatePicker value={dueOn} onChange={setDueOn} />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create"}
            </Button>
          </form>
        </Card>
      ) : null}

      {terms.length === 0 ? (
        <Notice tone="warn">
          {"There are no terms yet. An administrator sets sessions and terms on the School page — fees hang off a term, so nothing can be billed until one exists."}
        </Notice>
      ) : null}

      {structures.length === 0 ? (
        <Empty>{"No fee structures yet."}</Empty>
      ) : null}

      {structures.map((s) => {
        const lines = items[s.id] || [];
        const total = lines
          .filter((l) => !l.is_optional)
          .reduce((sum, l) => sum + Number(l.amount), 0);
        const term = terms.find((t) => t.id === s.term_id);
        const klass = classes.find((c) => c.id === s.class_id);

        return (
          <Card key={s.id} style={{ marginBottom: 16 }}>
            <div className="page-head" style={{ marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{s.name}</h3>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {[term?.name, klass?.name || "every class",
                    s.due_on ? `due ${formatDate(s.due_on, { withTime: false })}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="btn-row">
                <Button size="sm" disabled={lines.length === 0} onClick={() => bulk(s)}>
                  {"Raise invoices"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                  {"Delete"}
                </Button>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data">
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.name}
                        {l.is_optional ? (
                          <Badge>{"optional"}</Badge>
                        ) : null}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {money(l.amount)}
                      </td>
                      <td style={{ textAlign: "right", width: 40 }}>
                        <button
                          type="button"
                          className="comment-toggle"
                          onClick={async () => {
                            await deleteFeeItem(l.id, schoolId);
                            onChange();
                          }}
                        >
                          {"Remove"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>{"Compulsory total"}</strong>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <strong>{money(total)}</strong>
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {itemFor === s.id ? (
              <div className="split" style={{ marginTop: 12 }}>
                <Field label="Line">
                  <input
                    className="input"
                    autoFocus
                    value={itemName}
                    placeholder="Tuition"
                    onChange={(e) => setItemName(e.target.value)}
                  />
                </Field>
                <Field label="Amount">
                  <MoneyInput value={itemAmount} onChange={setItemAmount} />
                </Field>
                <Field label="Optional" hint="Charged only to families who ask for it.">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={itemOptional}
                      onChange={(e) => setItemOptional(e.target.checked)}
                    />
                    <span>{"e.g. the bus"}</span>
                  </label>
                </Field>
                <div className="btn-row" style={{ alignSelf: "end" }}>
                  <Button size="sm" onClick={() => addItem(s.id)}>
                    {"Add"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setItemFor(null)}>
                    {"Done"}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="comment-toggle"
                onClick={() => setItemFor(s.id)}
              >
                {"Add a line"}
              </button>
            )}
          </Card>
        );
      })}
    </>
  );
};

/* ----------------------------------------------------------------- invoices */

const Invoices = ({ invoices, people, money, onChange, onError }) => {
  const [filter, setFilter] = useState("all");

  // An application/acceptance-fee invoice has no student_id at all (the
  // applicant is not a student yet) — invoice_balances carries the
  // applicant's name separately on exactly those rows (applicant_name),
  // which is what a bare student_id lookup would otherwise render as the
  // literal word "Student".
  const nameOf = useCallback(
    (invoice) => {
      const person = people.find((p) => p.user_id === invoice.student_id || p.id === invoice.student_id);
      if (person) return displayName(person.profiles || person);
      return invoice.applicant_name || "Student";
    },
    [people]
  );

  const shown = invoices.filter((i) =>
    filter === "all"
      ? true
      : filter === "draft"
      ? i.status === "draft"
      : filter === "owing"
      ? i.status === "issued" && Number(i.balance) > 0
      : i.status === "issued" && Number(i.balance) <= 0
  );

  const drafts = invoices.filter((i) => i.status === "draft");

  const issueAll = async () => {
    if (
      !window.confirm(
        `Issue ${drafts.length} draft invoice${drafts.length === 1 ? "" : "s"}? Each family is notified and the invoice becomes visible to them.`
      )
    ) {
      return;
    }
    onError("");
    try {
      for (const invoice of drafts) {
        await issueInvoice(invoice.invoice_id);
      }
      onChange(`${drafts.length} invoice${drafts.length === 1 ? "" : "s"} issued.`);
    } catch (err) {
      onError(err.message || "Could not issue them all.");
    }
  };

  return (
    <>
      <div className="panel-top">
      <div className="page-head" style={{ margin: 0 }}>
        <Tabs
          tabs={[
            { id: "all", label: `All (${invoices.length})` },
            { id: "draft", label: `Drafts (${drafts.length})` },
            { id: "owing", label: "Owing" },
            { id: "settled", label: "Settled" },
          ]}
          active={filter}
          onChange={setFilter}
        />
        {drafts.length ? <Button onClick={issueAll}>{"Issue all drafts"}</Button> : null}
      </div>
      </div>

      {shown.length === 0 ? (
        <Empty>{"Nothing here."}</Empty>
      ) : (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Reference"}</th>
                  <th>{"Student"}</th>
                  <th>{"Billed"}</th>
                  <th>{"Paid"}</th>
                  <th>{"Balance"}</th>
                  <th>{"Standing"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <InvoiceRow
                    key={i.invoice_id}
                    invoice={i}
                    who={nameOf(i)}
                    money={money}
                    onChange={onChange}
                    onError={onError}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
};

const InvoiceRow = ({ invoice, who, money, onChange, onError }) => {
  const [taking, setTaking] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    const reason = window.prompt(
      "Why is this invoice being voided? The reason is kept on the record."
    );
    if (reason === null) return;
    onError("");
    try {
      await cancelInvoice({ invoiceId: invoice.invoice_id, reason });
      onChange("Invoice voided.");
    } catch (err) {
      onError(err.message || "Could not void that invoice.");
    }
  };

  const take = async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      onError("How much was paid?");
      return;
    }
    setBusy(true);
    onError("");
    try {
      await takePayment({
        invoiceId: invoice.invoice_id,
        amount: value,
        method,
        reference: reference.trim(),
      });
      setTaking(false);
      setAmount("");
      setReference("");
      onChange("Payment recorded.");
    } catch (err) {
      onError(err.message || "Could not record that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr>
        <td style={{ whiteSpace: "nowrap" }}>{invoice.reference}</td>
        <td>
          <strong>{who}</strong>
        </td>
        <td style={{ whiteSpace: "nowrap" }}>{money(invoice.payable)}</td>
        <td style={{ whiteSpace: "nowrap" }}>{money(invoice.paid)}</td>
        <td style={{ whiteSpace: "nowrap" }}>
          <strong>{money(invoice.balance)}</strong>
        </td>
        <td>
          <Badge
            tone={
              invoice.standing === "paid"
                ? "success"
                : invoice.standing === "overdue"
                ? "danger"
                : invoice.standing === "part paid"
                ? "warn"
                : undefined
            }
          >
            {invoice.status === "draft" ? "draft" : invoice.standing}
          </Badge>
          {Number(invoice.awaiting_approval) > 0 ? (
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {`${money(invoice.awaiting_approval)} waiting`}
            </div>
          ) : null}
        </td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {invoice.status === "draft" ? (
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await issueInvoice(invoice.invoice_id);
                  onChange("Issued, and the family notified.");
                } catch (err) {
                  onError(err.message);
                }
              }}
            >
              {"Issue"}
            </Button>
          ) : Number(invoice.balance) > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setTaking((v) => !v)}>
              {taking ? "Cancel" : "Take payment"}
            </Button>
          ) : null}
          {/* Only ever offered where no approved money is attached — the
              database refuses the rest, and would be right to. */}
          {invoice.status !== "cancelled" && Number(invoice.paid) === 0 ? (
            <Button size="sm" variant="ghost" onClick={cancel}>
              {"Void"}
            </Button>
          ) : null}
        </td>
      </tr>
      {taking ? (
        <tr>
          <td colSpan={7}>
            <div className="btn-row" style={{ padding: "8px 0", flexWrap: "wrap" }}>
              <MoneyInput
                style={{ maxWidth: 140 }}
                autoFocus
                placeholder="Amount"
                value={amount}
                onChange={setAmount}
              />
              <Select
                className="select"
                style={{ maxWidth: 160 }}
                value={method}
                onChange={setMethod}
                options={PAYMENT_METHODS.map(([v, l]) => ({ value: v, label: l }))}
              />
              <input
                className="input"
                style={{ maxWidth: 180 }}
                placeholder="Receipt number"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <Button size="sm" disabled={busy} onClick={take}>
                {busy ? "Recording..." : "Record"}
              </Button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};

/* ------------------------------------------------------------------ queue */

const Queue = ({ queue, queueContext, money, onChange, onError }) => {
  const [note, setNote] = useState({});
  const [busy, setBusy] = useState(null);
  const preview = useDocumentPreview();

  const contextOf = (invoiceId) => queueContext[invoiceId] || {};
  const refOf = (invoiceId) => contextOf(invoiceId).reference || "—";

  const decide = async (payment, approve) => {
    const text = (note[payment.id] || "").trim();
    if (!approve && !text) {
      onError("Say why it is being rejected — the family is told the reason.");
      return;
    }
    setBusy(payment.id);
    onError("");
    try {
      if (approve) {
        await approvePayment({ id: payment.id, note: text });
        onChange("Approved. The balance has come down and the family has been told.");
      } else {
        await rejectPayment({ id: payment.id, note: text });
        onChange("Rejected, with your reason sent to the family.");
      }
    } catch (err) {
      onError(err.message || "Could not record that decision.");
    } finally {
      setBusy(null);
    }
  };

  const openProof = (path) => {
    preview.open(path, "Receipt");
  };

  if (queue.length === 0) {
    return <Empty>{"Nothing waiting. Every declared payment has been decided."}</Empty>;
  }

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "62ch" }}>
        {"Payments families say they have made. None of these has come off a balance yet — that happens when you approve one."}
      </p>

      {queue.map((p) => {
        const ctx = contextOf(p.invoice_id);
        const isAdmissions = ctx.purpose === "application_fee" || ctx.purpose === "acceptance_fee";
        return (
        <Card key={p.id} style={{ marginBottom: 14 }}>
          <div className="page-head" style={{ marginBottom: 8 }}>
            <div>
              <div className="btn-row" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                {ctx.purpose ? <Badge tone={isAdmissions ? "brand" : undefined}>{PURPOSE_LABEL[ctx.purpose] || ctx.purpose}</Badge> : null}
                {isAdmissions && ctx.applicant_name ? <Badge>{ctx.applicant_name}</Badge> : null}
              </div>
              <h3 style={{ margin: 0 }}>{money(p.amount)}</h3>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {`${refOf(p.invoice_id)} · ${METHOD_LABEL[p.method] || p.method}`}
                {p.reference ? ` · ${p.reference}` : ""}
                {` · paid ${formatDate(p.paid_on, { withTime: false })}`}
                {` · declared ${formatDate(p.submitted_at)}`}
              </div>
            </div>
            {p.proof_path ? (
              <Button size="sm" variant="secondary" onClick={() => openProof(p.proof_path)}>
                {"See receipt"}
              </Button>
            ) : (
              <Badge tone="warn">{"no receipt attached"}</Badge>
            )}
          </div>

          {p.note ? (
            <p className="chat-body" style={{ marginTop: 0 }}>
              {p.note}
            </p>
          ) : null}

          <div className="btn-row" style={{ flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="A note — required to reject, optional to approve"
              value={note[p.id] || ""}
              onChange={(e) => setNote((n) => ({ ...n, [p.id]: e.target.value }))}
            />
            <Button size="sm" disabled={busy === p.id} onClick={() => decide(p, true)}>
              {"Approve"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === p.id}
              onClick={() => decide(p, false)}
            >
              {"Reject"}
            </Button>
          </div>
        </Card>
        );
      })}
      {preview.node}
    </>
  );
};

/* ------------------------------------------------------------------- page */

const Bursary = () => {
  const { user } = useAuth();
  const { school, schoolId } = useSchool();
  const money = useMoney(school?.currency);

  const [tab, setTab] = useState("overview");
  const [termId, setTermId] = useState("");
  const [terms, setTerms] = useState([]);
  const [classes, setClasses] = useState([]);
  const [people, setPeople] = useState([]);
  const [structures, setStructures] = useState([]);
  const [items, setItems] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [queue, setQueue] = useState([]);
  const [queueContext, setQueueContext] = useState({});
  const [debtors, setDebtors] = useState([]);
  const [summary, setSummary] = useState(null);

  const [loading, setLoading] = useState(true);
  const { setError, setNotice } = useActionFeedback();

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [t, c, m, s, inv, q, d, sum] = await Promise.all([
        fetchTerms(schoolId).catch(() => []),
        fetchClasses(schoolId).catch(() => []),
        fetchSchoolMembers(schoolId).catch(() => []),
        fetchFeeStructures(schoolId),
        fetchSchoolInvoices({ schoolId, termId: termId || null }),
        fetchPaymentQueue(schoolId),
        fetchDebtors({ schoolId, termId: termId || null }),
        fetchCollectionSummary({ schoolId, termId: termId || null }),
      ]);
      setTerms(t);
      setClasses(c);
      setPeople(m);
      setStructures(s);
      setItems(await fetchFeeItems(s.map((r) => r.id)).catch(() => ({})));
      setInvoices(inv);
      setQueue(q);
      // Independent of the term filter above — an admissions invoice
      // always has term_id null, so reusing `inv` here would show "—" for
      // one of these whenever a term is selected.
      setQueueContext(await fetchPaymentQueueContext(q.map((p) => p.invoice_id)).catch(() => ({})));
      setDebtors(d);
      setSummary(sum);
    } catch (err) {
      setError(err.message || "Could not load the bursary.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, termId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = (message) => {
    setNotice(message || "");
    load();
  };

  const termName = terms.find((t) => t.id === termId)?.name;

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Bursary"
        subtitle={school ? `Fees at ${school.name}` : "Fees"}
        action={
          terms.length ? (
            <Select
              className="select"
              aria-label="Term"
              value={termId}
              onChange={setTermId}
              options={[
                { value: "", label: "Every term" },
                ...terms.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          ) : null
        }
        toolbar={
          <Tabs
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "structures", label: "Fee structures" },
              { id: "invoices", label: `Invoices (${invoices.length})` },
              { id: "queue", label: queue.length ? `Payments (${queue.length})` : "Payments" },
            ]}
            active={tab}
            onChange={setTab}
          />
        }
      >

        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {!loading && tab === "overview" ? (
          <Overview summary={summary} debtors={debtors} money={money} termName={termName} />
        ) : null}

        {!loading && tab === "structures" ? (
          <Structures
            schoolId={schoolId}
            userId={user?.id}
            terms={terms}
            classes={classes}
            structures={structures}
            items={items}
            money={money}
            onChange={refresh}
            onError={setError}
          />
        ) : null}

        {!loading && tab === "invoices" ? (
          <Invoices
            invoices={invoices}
            people={people}
            money={money}
            onChange={refresh}
            onError={setError}
          />
        ) : null}

        {!loading && tab === "queue" ? (
          <Queue
            queue={queue}
            queueContext={queueContext}
            money={money}
            onChange={refresh}
            onError={setError}
          />
        ) : null}
      </Page>
    </div>
  );
};

export default Bursary;
