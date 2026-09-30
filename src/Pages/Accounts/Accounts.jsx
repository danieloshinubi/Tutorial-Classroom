import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { useMoney } from "../../lib/money";
import { todayISO, monthStartISO } from "../../lib/dates";
import { canUseModule } from "../../lib/modules";
import {
  fetchAccountingSettings,
  setupAccounting,
  fetchChartOfAccounts,
  saveAccount,
  fetchAccountBalances,
  fetchJournal,
  fetchAccountLedger,
  postManualJournal,
  reverseJournal,
  saveOpeningBalances,
  fetchStoreProducts,
} from "../../lib/api";
import {
  Page,
  Field,
  Button,
  Badge,
  Select,
  MoneyInput,
  DatePicker,
  Tabs,
  Empty,
  formatDate,
  SkeletonCards,
} from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import ExportButton from "../../Components/ExportButton";

// The school's books: double entry, kept by the events themselves.
//
// Nothing here is typed twice. Issuing a bill, a payment being approved, a
// store sale, a restock: each writes its own journal entry in the database,
// in the same transaction as the event (supabase/188). This page reads those
// entries, adds the ones only a person can make (rent, a loan, depreciation),
// and turns them into the statements.
//
// Amounts come back signed debit-minus-credit. Each account type has a
// normal side (assets and expenses are debits; liabilities, equity and
// income are credits), and a balance is shown on that side, so "Bank
// ₦1,200,000" rather than "Bank −₦1,200,000" for a liability's mirror image.

const TYPES = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));
const TYPE_PLURAL = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
const DEBIT_NORMAL = new Set(["asset", "expense"]);
// Shown on the account's own normal side.
const natural = (type, signed) => (DEBIT_NORMAL.has(type) ? signed : -signed);

const SOURCE = {
  invoice: { label: "Bill", tone: "brand" },
  payment: { label: "Payment", tone: "success" },
  store_sale: { label: "Store sale", tone: "brand" },
  store_stock: { label: "Stock", tone: null },
  manual: { label: "Journal", tone: "warn" },
  opening: { label: "Opening", tone: null },
  reversal: { label: "Reversal", tone: "danger" },
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "journal", label: "Journal" },
  { id: "reports", label: "Reports" },
  { id: "chart", label: "Chart of accounts" },
  { id: "opening", label: "Opening balances" },
];

const accountLabel = (a) => (a ? `${a.code} · ${a.name}` : "");

// The page size of the journal; "Load older entries" fetches the next.
const JOURNAL_PAGE = 300;

// The type an account code's first digit usually means. Only a warning: an
// accountant's own scheme may differ.
const typeForCode = (code) => {
  const d = String(code || "").trim()[0];
  return { 1: "asset", 2: "liability", 3: "equity", 4: "income" }[d] || (/[5-9]/.test(d || "") ? "expense" : null);
};

// Whole words from the start: "rent" finds "Rent for September" and
// "rental", not "parent".
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchesWords = (text, needle) =>
  needle.split(/\s+/).filter(Boolean).every((w) => new RegExp(`${/^\w/.test(w) ? "\\b" : ""}${escapeRegex(w)}`, "i").test(text));

// Debit and credit in the words a bursar uses. Shown where amounts are typed.
const DrCrHelp = () => (
  <p className="ac-drcr">
    <span><strong>{"Debit"}</strong>{" = money into the bank or cash, an expense, or something the school owns going up."}</span>
    <span><strong>{"Credit"}</strong>{" = money out of the bank or cash, income, or something the school owes going up."}</span>
  </p>
);
const sum = (rows, pick) => rows.reduce((total, r) => total + Number(pick(r) || 0), 0);
const toCents = (v) => Math.round(Number(v || 0) * 100);

// ------------------------------------------------------------------ setup --

const Setup = ({ schoolId, onDone }) => {
  const [startDate, setStartDate] = useState(monthStartISO());
  const [restockFrom, setRestockFrom] = useState("bank");
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  const open = async () => {
    setBusy(true);
    try {
      const posted = await setupAccounting({ schoolId, startDate, restockFrom });
      setNotice(
        posted > 0
          ? `The books are open. ${posted} ${posted === 1 ? "entry was" : "entries were"} posted from what has happened since ${formatDate(startDate, { withTime: false })}.`
          : "The books are open."
      );
      onDone();
    } catch (err) {
      setError(err.message || "Could not open the books.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ac-setup">
      <div className="ac-card">
        <h2 className="ac-card-title">{"Open the school's books"}</h2>
        <p className="ac-lead">
          {"From the date you choose, every bill, payment and store sale is recorded in the books automatically. You add the rest (rent, salaries until payroll is in, loans) as journals, and the trial balance, income statement and balance sheet follow."}
        </p>
        <ol className="ac-steps">
          <li>{"Choose the date the books start from. The start of a term or a financial year is usual."}</li>
          <li>{"Enter what the school had and owed on that date, under Opening balances."}</li>
          <li>{"Anything since that date is posted straight away; nothing before it is counted twice."}</li>
        </ol>
        <div className="ac-setup-form">
          <Field label="Books start on" hint="Can be changed until the first entry after the opening balances is made.">
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <div className="ac-field">
            <span className="ac-field-label">{"Store restocks are paid from"}</span>
            <Select
              className="select"
              value={restockFrom}
              onChange={setRestockFrom}
              options={[
                { value: "bank", label: "The bank" },
                { value: "cash", label: "Cash in hand" },
                { value: "payables", label: "Owed to the supplier" },
              ]}
            />
            <span className="ac-hint">{"Where the cost of new stock is taken from."}</span>
          </div>
        </div>
        <Button onClick={open} disabled={busy || !startDate}>{busy ? "Opening the books..." : "Open the books"}</Button>
      </div>
    </div>
  );
};

// --------------------------------------------------------------- overview --

const Overview = ({ settings, balances, month, journal, hasOpening, stockOnShelf, money, onGo }) => {
  const byKey = (key) => balances.find((b) => b.system_key === key);
  const tile = (key, label, hint) => {
    const b = byKey(key);
    return (
      <div className="ac-tile" key={key}>
        <span className="ac-tile-label">{b?.name || label}</span>
        <strong className="ac-num">{money(b ? natural(b.type, b.closing) : 0)}</strong>
        {hint ? <span className="ac-tile-hint">{hint}</span> : null}
      </div>
    );
  };
  const income = sum(month.filter((b) => b.type === "income"), (b) => b.credit - b.debit);
  const expenses = sum(month.filter((b) => b.type === "expense"), (b) => b.debit - b.credit);
  const stockBooks = byKey("inventory");
  const stockGap =
    stockOnShelf != null && stockBooks ? Math.round(stockOnShelf - natural("asset", stockBooks.closing)) : 0;

  return (
    <div className="ac-stack">
      {!hasOpening ? (
        <div className="ac-callout">
          <div>
            <strong>{"Opening balances are not entered yet."}</strong>
            <p>{`Until the bank, cash and what the school owes on ${formatDate(settings.start_date, { withTime: false })} are entered, the balance sheet shows only what has happened since.`}</p>
          </div>
          <Button size="sm" onClick={() => onGo("opening")}>{"Enter opening balances"}</Button>
        </div>
      ) : null}

      <section className="ac-card">
        <h2 className="ac-card-title">{"Where the school stands"}</h2>
        <div className="ac-tiles">
          {/* Before the opening balances, bank and cash show only what moved
              since the start, which can read as an overdraft. */}
          {tile("bank", "Bank", hasOpening ? null : "Movements since the start only")}
          {tile("cash", "Cash in hand", hasOpening ? null : "Movements since the start only")}
          {tile("receivables", "Owed by families", "On issued bills")}
          {tile(
            "inventory",
            "Store stock",
            stockOnShelf != null && stockGap !== 0
              ? `${money(stockOnShelf)} on the shelf at today's cost`
              : "At what it cost"
          )}
        </div>
        {stockOnShelf != null && stockGap !== 0 ? (
          <p className="ac-note">
            {"The books keep stock at what was actually paid. The Store values the whole shelf at the latest price, so after a restock at a new price the two differ. The books are the figure for the accounts."}
          </p>
        ) : null}
      </section>

      <section className="ac-card">
        <div className="ac-card-head">
          <h2 className="ac-card-title">{"This month"}</h2>
          <Button size="sm" variant="secondary" onClick={() => onGo("reports")}>{"Income statement"}</Button>
        </div>
        <div className="ac-tiles">
          <div className="ac-tile">
            <span className="ac-tile-label">{"Income"}</span>
            <strong className="ac-num">{money(income)}</strong>
          </div>
          <div className="ac-tile">
            <span className="ac-tile-label">{"Expenses"}</span>
            <strong className="ac-num">{money(expenses)}</strong>
          </div>
          <div className={`ac-tile ${income - expenses < 0 ? "tone-danger" : "tone-success"}`}>
            <span className="ac-tile-label">{income - expenses < 0 ? "Deficit" : "Surplus"}</span>
            <strong className="ac-num">{money(Math.abs(income - expenses))}</strong>
          </div>
        </div>
      </section>

      <section className="ac-card">
        <div className="ac-card-head">
          <h2 className="ac-card-title">{"Latest entries"}</h2>
          <Button size="sm" variant="secondary" onClick={() => onGo("journal")}>{"Whole journal"}</Button>
        </div>
        {journal.length === 0 ? (
          <Empty>{"Nothing posted yet. Bills, payments and store sales appear here as they happen."}</Empty>
        ) : (
          <ul className="ac-mini-list">
            {journal.slice(0, 8).map((e) => (
              <li key={e.id}>
                <span className="ac-mini-date">{formatDate(e.entry_date, { withTime: false })}</span>
                <span className="ac-mini-memo">{e.memo}</span>
                <span className="ac-num">{money(sum(e.lines, (l) => l.debit))}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="ac-note">{`Books kept since ${formatDate(settings.start_date, { withTime: false })}.`}</p>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------- journal --

const blankLine = () => ({ accountId: "", debit: "", credit: "", memo: "" });

const NewJournal = ({ schoolId, settings, accountOptions, money, onPosted, onCancel }) => {
  const [date, setDate] = useState(todayISO());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([blankLine(), blankLine()]);
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  const setLine = (i, patch) =>
    setLines((current) =>
      current.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        // A line is a debit or a credit, never both: typing one clears the other.
        if (patch.debit !== undefined && patch.debit !== "") next.credit = "";
        if (patch.credit !== undefined && patch.credit !== "") next.debit = "";
        return next;
      })
    );

  const debits = sum(lines, (l) => l.debit);
  const credits = sum(lines, (l) => l.credit);
  const difference = toCents(debits) - toCents(credits);
  const used = lines.filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
  const beforeStart = date && date < settings.start_date;
  const blocked = !memo.trim()
    ? "Say what the journal is for."
    : used.length < 2
    ? "A journal needs at least two lines with an account and an amount."
    : difference !== 0
    ? `Debits and credits differ by ${money(Math.abs(difference) / 100)}.`
    : beforeStart
    ? `The books start on ${formatDate(settings.start_date, { withTime: false })}.`
    : "";

  const post = async () => {
    setBusy(true);
    try {
      await postManualJournal({ schoolId, date, memo: memo.trim(), lines: used });
      setNotice("Journal posted.");
      onPosted();
    } catch (err) {
      setError(err.message || "Could not post the journal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ac-card ac-new-journal">
      <div className="ac-card-head">
        <h2 className="ac-card-title">{"New journal"}</h2>
        <button type="button" className="ac-link" onClick={onCancel}>{"Cancel"}</button>
      </div>
      <p className="ac-note">
        {"For what the system cannot see: rent or diesel paid, a loan received, depreciation, moving money between bank and cash. Each line is one account; the debits and the credits must come to the same total."}
      </p>
      <div className="ac-journal-top">
        <Field label="Date">
          <DatePicker value={date} onChange={setDate} minDate={settings.start_date} />
        </Field>
        <Field label="What it is for">
          <input className="input" value={memo} placeholder="e.g. Rent for the Ikeja campus, September" onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>
      <DrCrHelp />
      <div className="ac-lines">
        <div className="ac-lines-head" aria-hidden="true">
          <span>{"Account"}</span>
          <span>{"Debit"}</span>
          <span>{"Credit"}</span>
          <span>{"Note (optional)"}</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div className="ac-line" key={i}>
            <div className="ac-line-account">
              <Select
                className="select"
                value={l.accountId}
                onChange={(v) => setLine(i, { accountId: v })}
                options={[{ value: "", label: "Choose an account" }, ...accountOptions]}
              />
            </div>
            <MoneyInput value={l.debit} onChange={(v) => setLine(i, { debit: v })} placeholder="Debit" aria-label="Debit" />
            <MoneyInput value={l.credit} onChange={(v) => setLine(i, { credit: v })} placeholder="Credit" aria-label="Credit" />
            <input className="input" value={l.memo} placeholder="Note (optional)" onChange={(e) => setLine(i, { memo: e.target.value })} aria-label="Note" />
            <button
              type="button"
              className="ac-remove"
              aria-label="Remove line"
              disabled={lines.length <= 2}
              onClick={() => setLines((current) => current.filter((_, j) => j !== i))}
            >
              {"×"}
            </button>
          </div>
        ))}
        <div className="ac-lines-foot">
          <button type="button" className="ac-link" onClick={() => setLines((c) => [...c, blankLine()])}>{"+ Add a line"}</button>
          <span className="ac-num">{money(debits)}</span>
          <span className="ac-num">{money(credits)}</span>
          <span className={`ac-diff${difference === 0 && debits > 0 ? " ok" : ""}`}>
            {debits === 0 && credits === 0 ? "" : difference === 0 ? "Balanced" : `Off by ${money(Math.abs(difference) / 100)}`}
          </span>
        </div>
      </div>
      <div className="ac-actions">
        <Button onClick={post} disabled={busy || !!blocked}>{busy ? "Posting..." : "Post journal"}</Button>
        {blocked ? <span className="ac-hint">{blocked}</span> : null}
      </div>
    </section>
  );
};

const JournalEntry = ({ entry, chartById, money, onReversed }) => {
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();
  const src = SOURCE[entry.source_type] || { label: entry.source_type, tone: null };
  const total = sum(entry.lines, (l) => l.debit);

  const reverse = async () => {
    setBusy(true);
    try {
      await reverseJournal({ entryId: entry.id, reason: reason.trim() });
      setNotice("Journal reversed.");
      onReversed();
    } catch (err) {
      setError(err.message || "Could not reverse the journal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`ac-entry${entry.reversed_by ? " is-reversed" : ""}`}>
      <header className="ac-entry-head">
        <span className="ac-entry-date">{formatDate(entry.entry_date, { withTime: false })}</span>
        <Badge tone={src.tone}>{src.label}</Badge>
        <span className="ac-entry-memo">{entry.memo}</span>
        {entry.reversed_by ? <Badge tone="danger">{"Reversed"}</Badge> : null}
        <span className="ac-entry-total">
          <span className="ac-entry-total-label">{"Total debits"}</span>
          <span className="ac-num">{money(total)}</span>
        </span>
      </header>
      <table className="ac-entry-lines">
        <tbody>
          {entry.lines.map((l) => {
            const acct = chartById[l.account_id];
            return (
              <tr key={l.id} className={l.credit > 0 ? "is-credit" : ""}>
                <td className="ac-entry-account">
                  {accountLabel(acct)}
                  {l.memo ? <span className="ac-entry-line-memo">{l.memo}</span> : null}
                </td>
                <td className="ac-num">{l.debit > 0 ? money(l.debit) : ""}</td>
                <td className="ac-num">{l.credit > 0 ? money(l.credit) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {entry.source_type === "manual" && !entry.reversed_by ? (
        reversing ? (
          <div className="ac-reverse">
            <input className="input" value={reason} placeholder="Why it is being reversed" onChange={(e) => setReason(e.target.value)} autoFocus />
            <span className="ac-hint ac-reverse-hint">{"The reversal is dated today; the original stays in the books, marked Reversed."}</span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReversing(false)}>{"Keep it"}</Button>
            <Button size="sm" disabled={busy || !reason.trim()} onClick={reverse}>{busy ? "Reversing..." : "Reverse"}</Button>
          </div>
        ) : (
          <div className="ac-entry-foot">
            <button type="button" className="ac-link" onClick={() => setReversing(true)}>{"Reverse this journal"}</button>
          </div>
        )
      ) : null}
    </article>
  );
};

const JournalTab = ({ schoolId, settings, journal, hasMore, loadingMore, onLoadMore, chartById, accountOptions, money, onChanged }) => {
  const [composing, setComposing] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return journal.filter(
      (e) =>
        (!accountFilter || e.lines.some((l) => l.account_id === accountFilter)) &&
        (!sourceFilter || e.source_type === sourceFilter) &&
        (!needle || matchesWords(e.memo, needle))
    );
  }, [journal, accountFilter, sourceFilter, query]);

  return (
    <div className="ac-stack">
      {composing ? (
        <NewJournal
          schoolId={schoolId}
          settings={settings}
          accountOptions={accountOptions}
          money={money}
          onCancel={() => setComposing(false)}
          onPosted={() => { setComposing(false); onChanged(); }}
        />
      ) : null}
      <section className="ac-card">
        <div className="ac-card-head">
          <h2 className="ac-card-title">{"Journal"}</h2>
          <div className="btn-row">
            <ExportButton
              roles={["bursar"]}
              filename="journal"
              sheetName="Journal"
              rows={shown.flatMap((e) => (e.lines || []).map((l) => ({ entry: e, line: l })))}
              columns={[
                { key: "entry.entry_date", label: "Date", type: "date" },
                { key: "entry.memo", label: "Entry" },
                { key: (r) => { const a = chartById[r.line.account_id]; return a ? `${a.code} ${a.name}` : ""; }, label: "Account" },
                { key: "line.memo", label: "Line note" },
                { key: (r) => (Number(r.line.debit) ? Number(r.line.debit) : ""), label: "Debit", type: "money" },
                { key: (r) => (Number(r.line.credit) ? Number(r.line.credit) : ""), label: "Credit", type: "money" },
              ]}
            />
            {!composing ? <Button size="sm" onClick={() => setComposing(true)}>{"New journal"}</Button> : null}
          </div>
        </div>
        <div className="ac-filters">
          <input className="input" placeholder="Search what entries are for" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the journal" />
          <div className="ac-filter">
            <Select
              className="select"
              value={accountFilter}
              onChange={setAccountFilter}
              options={[{ value: "", label: "Every account" }, ...accountOptions]}
            />
          </div>
          <div className="ac-filter">
            <Select
              className="select"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={[
                { value: "", label: "Every kind" },
                ...Object.entries(SOURCE).map(([value, s]) => ({ value, label: s.label })),
              ]}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty>{journal.length === 0 ? "Nothing posted yet." : "No entries match."}</Empty>
        ) : (
          <div className="ac-entries">
            {shown.map((e) => (
              <JournalEntry key={e.id} entry={e} chartById={chartById} money={money} onReversed={onChanged} />
            ))}
          </div>
        )}
        {hasMore ? (
          <div className="ac-more">
            <span className="ac-hint">{`Showing the latest ${journal.length} entries; search and filters look through these. Load older ones to reach further back.`}</span>
            <Button size="sm" variant="secondary" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Loading..." : "Load older entries"}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------- reports --

const REPORTS = [
  { value: "trial", label: "Trial balance" },
  { value: "income", label: "Income statement" },
  { value: "balance", label: "Balance sheet" },
  { value: "ledger", label: "Account ledger" },
];

const ReportTable = ({ children }) => (
  <div className="table-wrap table-wrap-plain">
    <table className="data ac-report">{children}</table>
  </div>
);

const ReportsTab = ({ schoolId, settings, chart, accountOptions, money, schoolName }) => {
  const [report, setReport] = useState("trial");
  const [from, setFrom] = useState(settings.start_date > monthStartISO() ? settings.start_date : monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const { setError } = useActionFeedback();
  const periodic = report === "income" || report === "ledger";

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        if (report === "ledger") {
          if (!accountId) { setLedger(null); setRows(null); return; }
          const [b, lines] = await Promise.all([
            fetchAccountBalances(schoolId, { from, to }),
            fetchAccountLedger(schoolId, accountId, { from, to }),
          ]);
          if (!cancelled) { setRows(b); setLedger(lines); }
        } else {
          const b = await fetchAccountBalances(schoolId, periodic ? { from, to } : { to });
          if (!cancelled) setRows(b);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not run that report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [schoolId, report, from, to, accountId, periodic, setError]);

  const period = periodic
    ? `${formatDate(from, { withTime: false })} to ${formatDate(to, { withTime: false })}`
    : `As at ${formatDate(to, { withTime: false })}`;

  // The report on screen as rows, for Export: the same arithmetic as below.
  const exportSheet = () => {
    if (!rows) return { columns: [], rows: [] };
    const line = (label, amount, extra = {}) => ({ label, amount, ...extra });
    if (report === "trial") {
      const live = rows.filter((r) => Math.round(r.closing * 100) !== 0);
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "label", label: "Account" },
          { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" },
        ],
        rows: [
          ...live.map((r) => ({ code: r.code, label: r.name, debit: r.closing > 0 ? r.closing : "", credit: r.closing < 0 ? -r.closing : "" })),
          { label: "Totals", debit: sum(live, (r) => (r.closing > 0 ? r.closing : 0)), credit: sum(live, (r) => (r.closing < 0 ? -r.closing : 0)) },
        ],
      };
    }
    const two = [{ key: "label", label: "Account" }, { key: "amount", label: "Amount", type: "money" }];
    if (report === "income") {
      const income = rows.filter((r) => r.type === "income").map((r) => ({ ...r, amount: r.credit - r.debit })).filter((r) => toCents(r.amount) !== 0);
      const expenses = rows.filter((r) => r.type === "expense").map((r) => ({ ...r, amount: r.debit - r.credit })).filter((r) => toCents(r.amount) !== 0);
      const ti = sum(income, (r) => r.amount);
      const te = sum(expenses, (r) => r.amount);
      return {
        columns: two,
        rows: [
          line("INCOME", ""), ...income.map((r) => line(`${r.code} · ${r.name}`, r.amount)), line("Total income", ti),
          line("EXPENSES", ""), ...expenses.map((r) => line(`${r.code} · ${r.name}`, r.amount)), line("Total expenses", te),
          line(ti - te < 0 ? "Deficit for the period" : "Surplus for the period", Math.abs(ti - te)),
        ],
      };
    }
    if (report === "balance") {
      const side = (type) => rows.filter((r) => r.type === type).map((r) => ({ ...r, amount: natural(type, r.closing) })).filter((r) => toCents(r.amount) !== 0);
      const assets = side("asset");
      const liabilities = side("liability");
      const equity = side("equity");
      const surplus = sum(rows.filter((r) => r.type === "income"), (r) => -r.closing) - sum(rows.filter((r) => r.type === "expense"), (r) => r.closing);
      const block = (title, list, extra = []) => [
        line(title.toUpperCase(), ""), ...list.map((r) => line(`${r.code} · ${r.name}`, r.amount)), ...extra,
        line(`Total ${title.toLowerCase()}`, sum(list, (r) => r.amount) + sum(extra, (x) => Number(x.amount) || 0)),
      ];
      return {
        columns: two,
        rows: [
          ...block("Assets", assets),
          ...block("Liabilities", liabilities),
          ...block("Equity", equity, toCents(surplus) !== 0 ? [line(surplus < 0 ? "Deficit to date" : "Surplus to date", surplus)] : []),
        ],
      };
    }
    const acct = rows.find((r) => r.account_id === accountId);
    if (!acct || !ledger) return { columns: [], rows: [] };
    let running = acct.opening;
    return {
      columns: [
        { key: "date", label: "Date", type: "date" }, { key: "label", label: "Entry" },
        { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" },
        { key: "balance", label: "Balance", type: "money" },
      ],
      rows: [
        { date: from, label: "Brought forward", balance: natural(acct.type, acct.opening) },
        ...ledger.map((l) => {
          running += l.debit - l.credit;
          return { date: l.entry.entry_date, label: l.memo ? `${l.entry.memo} · ${l.memo}` : l.entry.memo, debit: l.debit > 0 ? l.debit : "", credit: l.credit > 0 ? l.credit : "", balance: natural(acct.type, running) };
        }),
        { label: "Carried forward", debit: acct.debit, credit: acct.credit, balance: natural(acct.type, acct.closing) },
      ],
    };
  };
  const reportLabel = `${REPORTS.find((r) => r.value === report)?.label}${report === "ledger" && accountId ? `: ${accountLabel(chart.find((a) => a.id === accountId))}` : ""}`;

  const body = () => {
    if (report === "ledger" && !accountId) return <Empty>{"Choose an account above to see its ledger."}</Empty>;
    if (!rows) return null;
    if (report === "trial") {
      const live = rows.filter((r) => Math.round(r.closing * 100) !== 0);
      const dr = sum(live, (r) => (r.closing > 0 ? r.closing : 0));
      const cr = sum(live, (r) => (r.closing < 0 ? -r.closing : 0));
      return (
        <ReportTable>
          <thead><tr><th className="ac-col-code">{"Code"}</th><th>{"Account"}</th><th className="num">{"Debit"}</th><th className="num">{"Credit"}</th></tr></thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.account_id}>
                <td className="ac-col-code">{r.code}</td>
                <td>{r.name}</td>
                <td className="num">{r.closing > 0 ? money(r.closing) : ""}</td>
                <td className="num">{r.closing < 0 ? money(-r.closing) : ""}</td>
              </tr>
            ))}
            {live.length === 0 ? <tr><td colSpan={4} className="ac-muted-cell">{"No balances yet."}</td></tr> : null}
          </tbody>
          <tfoot>
            <tr className="ac-total-row">
              <td className="ac-col-code" />
              <td>{toCents(dr) === toCents(cr) ? "Totals · balanced" : "Totals · NOT balanced"}</td>
              <td className="num">{money(dr)}</td>
              <td className="num">{money(cr)}</td>
            </tr>
          </tfoot>
        </ReportTable>
      );
    }

    if (report === "income") {
      const income = rows.filter((r) => r.type === "income").map((r) => ({ ...r, amount: r.credit - r.debit })).filter((r) => toCents(r.amount) !== 0);
      const expenses = rows.filter((r) => r.type === "expense").map((r) => ({ ...r, amount: r.debit - r.credit })).filter((r) => toCents(r.amount) !== 0);
      const ti = sum(income, (r) => r.amount);
      const te = sum(expenses, (r) => r.amount);
      const section = (title, list, total, totalLabel) => (
        <>
          <tr className="ac-section-row"><td colSpan={2}>{title}</td></tr>
          {list.map((r) => (
            <tr key={r.account_id}><td>{`${r.code} · ${r.name}`}</td><td className="num">{money(r.amount)}</td></tr>
          ))}
          {list.length === 0 ? <tr><td className="ac-muted-cell">{"None in this period."}</td><td /></tr> : null}
          <tr className="ac-subtotal-row"><td>{totalLabel}</td><td className="num">{money(total)}</td></tr>
        </>
      );
      return (
        <ReportTable>
          <thead><tr><th>{"Account"}</th><th className="num">{"Amount"}</th></tr></thead>
          <tbody>
            {section("Income", income, ti, "Total income")}
            {section("Expenses", expenses, te, "Total expenses")}
          </tbody>
          <tfoot>
            <tr className={`ac-total-row ${ti - te < 0 ? "tone-danger" : "tone-success"}`}>
              <td>{ti - te < 0 ? "Deficit for the period" : "Surplus for the period"}</td>
              <td className="num">{money(Math.abs(ti - te))}</td>
            </tr>
          </tfoot>
        </ReportTable>
      );
    }

    if (report === "balance") {
      const side = (type) =>
        rows.filter((r) => r.type === type).map((r) => ({ ...r, amount: natural(type, r.closing) })).filter((r) => toCents(r.amount) !== 0);
      const assets = side("asset");
      const liabilities = side("liability");
      const equity = side("equity");
      // No year-end close yet, so this period's surplus sits in its own line
      // until it is moved to retained earnings by a journal.
      const surplus =
        sum(rows.filter((r) => r.type === "income"), (r) => -r.closing) -
        sum(rows.filter((r) => r.type === "expense"), (r) => r.closing);
      const ta = sum(assets, (r) => r.amount);
      const tl = sum(liabilities, (r) => r.amount);
      const teq = sum(equity, (r) => r.amount) + surplus;
      const block = (title, list, total, extra) => (
        <>
          <tr className="ac-section-row"><td colSpan={2}>{title}</td></tr>
          {list.map((r) => (
            <tr key={r.account_id}><td>{`${r.code} · ${r.name}`}</td><td className="num">{money(r.amount)}</td></tr>
          ))}
          {extra}
          {list.length === 0 && !extra ? <tr><td className="ac-muted-cell">{"None."}</td><td /></tr> : null}
          <tr className="ac-subtotal-row"><td>{`Total ${title.toLowerCase()}`}</td><td className="num">{money(total)}</td></tr>
        </>
      );
      const balanced = toCents(ta) === toCents(tl + teq);
      return (
        <ReportTable>
          <thead><tr><th>{"Account"}</th><th className="num">{"Amount"}</th></tr></thead>
          <tbody>
            {block("Assets", assets, ta)}
            {block("Liabilities", liabilities, tl)}
            {block(
              "Equity",
              equity,
              teq,
              toCents(surplus) !== 0 ? (
                <tr><td>{surplus < 0 ? "Deficit to date" : "Surplus to date"}</td><td className="num">{money(surplus)}</td></tr>
              ) : null
            )}
          </tbody>
          <tfoot>
            <tr className={`ac-total-row${balanced ? "" : " tone-danger"}`}>
              <td>{balanced ? "Liabilities and equity · balances with assets" : "Liabilities and equity · does NOT balance"}</td>
              <td className="num">{money(tl + teq)}</td>
            </tr>
          </tfoot>
        </ReportTable>
      );
    }

    // Ledger
    if (!accountId) return <Empty>{"Choose an account to see its ledger."}</Empty>;
    const acct = rows.find((r) => r.account_id === accountId);
    if (!acct || !ledger) return null;
    let running = acct.opening;
    return (
      <ReportTable>
        <thead>
          <tr><th>{"Date"}</th><th>{"Entry"}</th><th className="num">{"Debit"}</th><th className="num">{"Credit"}</th><th className="num">{"Balance"}</th></tr>
        </thead>
        <tbody>
          <tr className="ac-section-row">
            <td>{formatDate(from, { withTime: false })}</td>
            <td>{"Brought forward"}</td>
            <td /><td />
            <td className="num">{money(natural(acct.type, acct.opening))}</td>
          </tr>
          {ledger.map((l) => {
            running += l.debit - l.credit;
            return (
              <tr key={l.id}>
                <td>{formatDate(l.entry.entry_date, { withTime: false })}</td>
                <td>{l.memo ? `${l.entry.memo} · ${l.memo}` : l.entry.memo}</td>
                <td className="num">{l.debit > 0 ? money(l.debit) : ""}</td>
                <td className="num">{l.credit > 0 ? money(l.credit) : ""}</td>
                <td className="num">{money(natural(acct.type, running))}</td>
              </tr>
            );
          })}
          {ledger.length === 0 ? <tr><td colSpan={5} className="ac-muted-cell">{"No entries in this period."}</td></tr> : null}
        </tbody>
        <tfoot>
          <tr className="ac-total-row">
            <td colSpan={2}>{"Carried forward"}</td>
            <td className="num">{money(acct.debit)}</td>
            <td className="num">{money(acct.credit)}</td>
            <td className="num">{money(natural(acct.type, acct.closing))}</td>
          </tr>
        </tfoot>
      </ReportTable>
    );
  };

  return (
    <section className="ac-card ac-reports">
      <div className="ac-report-controls ac-print-hide">
        <div className="ac-field">
          <span className="ac-field-label">{"Report"}</span>
          <Select className="select" value={report} onChange={setReport} options={REPORTS} />
        </div>
        {report === "ledger" ? (
          <div className="ac-field ac-field-wide">
            <span className="ac-field-label">{"Account"}</span>
            <Select className="select" value={accountId} onChange={setAccountId} options={[{ value: "", label: "Choose an account" }, ...accountOptions]} />
          </div>
        ) : null}
        {periodic ? (
          <Field label="From">
            <DatePicker value={from} onChange={setFrom} />
          </Field>
        ) : null}
        <Field label={periodic ? "To" : "As at"}>
          <DatePicker value={to} onChange={setTo} />
        </Field>
        <ExportButton
          roles={["bursar"]}
          size={undefined}
          filename={`${String(reportLabel).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${periodic ? `${from}-to-${to}` : to}`}
          title={`${reportLabel} · ${period}`}
          sheetName={REPORTS.find((r) => r.value === report)?.label}
          {...exportSheet()}
        />
      </div>
      <header className="ac-report-title">
        <strong>{schoolName}</strong>
        <h2>{REPORTS.find((r) => r.value === report)?.label}{report === "ledger" && accountId ? `: ${accountLabel(chart.find((a) => a.id === accountId))}` : ""}</h2>
        <span>{period}</span>
      </header>
      {loading && !rows ? <SkeletonCards count={1} lines={6} /> : body()}
      {settings.start_date > (periodic ? from : to) ? (
        <p className="ac-note">{`The books start on ${formatDate(settings.start_date, { withTime: false })}; nothing before that date is in them.`}</p>
      ) : null}
    </section>
  );
};

// ------------------------------------------------------ chart of accounts --

const blankAccount = { id: null, code: "", name: "", type: "expense", description: "", isActive: true };

const ChartTab = ({ schoolId, settings, chart, balances, money, onChanged }) => {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();
  const formRef = React.useRef(null);
  // Opening an account low in the list brings its form into view.
  useEffect(() => {
    if (form) formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [form?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching an account off or on saves straight away. As a toggle inside
  // the form it looked done but was lost on Cancel.
  const toggleActive = async () => {
    const original = chart.find((a) => a.id === form.id);
    if (!original) return;
    setBusy(true);
    try {
      await saveAccount({
        schoolId, id: original.id, code: original.code, name: original.name, type: original.type,
        description: original.description || null, isActive: !original.is_active,
      });
      setNotice(original.is_active ? `${original.name} is switched off.` : `${original.name} is switched on.`);
      setForm((f) => ({ ...f, isActive: !original.is_active }));
      onChanged();
    } catch (err) {
      setError(err.message || "Could not change that account.");
    } finally {
      setBusy(false);
    }
  };

  const [restockFrom, setRestockFrom] = useState(settings.restock_paid_from);
  useEffect(() => setRestockFrom(settings.restock_paid_from), [settings.restock_paid_from]);
  const saveRestock = async (value) => {
    setRestockFrom(value);
    try {
      await setupAccounting({ schoolId, startDate: settings.start_date, restockFrom: value });
      setNotice("Saved. New stock will be paid from there from now on.");
      onChanged();
    } catch (err) {
      setRestockFrom(settings.restock_paid_from);
      setError(err.message || "Could not save that.");
    }
  };
  const balanceOf = (id) => balances.find((b) => b.account_id === id);

  const save = async () => {
    setBusy(true);
    try {
      await saveAccount({ schoolId, ...form, description: form.description || null });
      setNotice(form.id ? "Account saved." : "Account added.");
      setForm(null);
      onChanged();
    } catch (err) {
      setError(err.message || "Could not save that account.");
    } finally {
      setBusy(false);
    }
  };

  const edit = (a) =>
    setForm({ id: a.id, code: a.code, name: a.name, type: a.type, description: a.description || "", isActive: a.is_active, system: !!a.system_key });

  const codeHint = form && typeForCode(form.code) && typeForCode(form.code) !== form.type
    ? `Codes starting with ${String(form.code).trim()[0]} are usually ${TYPE_PLURAL[typeForCode(form.code)].toLowerCase()}; this one is ${TYPE_LABEL[form.type].toLowerCase()}. Check it is the type you meant.`
    : "";

  const formCard = form ? (
    <section className="ac-card" ref={formRef}>
      <div className="ac-card-head">
        <h2 className="ac-card-title">{form.id ? `Edit ${form.code} · ${form.name}` : "Add an account"}</h2>
        <button type="button" className="ac-link" onClick={() => setForm(null)}>{"Cancel"}</button>
      </div>
      <div className="ac-account-form">
        <Field label="Code" hint="A number that sorts it with its type: 1 assets, 2 liabilities, 3 equity, 4 income, 5 expenses.">
          <input className="input" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
        </Field>
        <Field label="Name">
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <div className="ac-field">
          <span className="ac-field-label">{"Type"}</span>
          {form.system ? (
            <span className="ac-readonly">{`${TYPE_LABEL[form.type]} · used by automatic postings, so it stays this type`}</span>
          ) : (
            <Select className="select" value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} options={TYPES} />
          )}
        </div>
        <Field label="Description (optional)">
          <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
      </div>
      {codeHint ? <p className="ac-warn">{codeHint}</p> : null}
      <div className="ac-actions">
        <Button onClick={save} disabled={busy || !form.code.trim() || !form.name.trim()}>{busy ? "Saving..." : "Save"}</Button>
        {form.id && !form.system ? (
          <Button variant="secondary" disabled={busy} onClick={toggleActive}>
            {form.isActive ? "Switch off now (hides it from new journals)" : "Switch on now"}
          </Button>
        ) : null}
      </div>
    </section>
  ) : null;

  return (
    <div className="ac-stack">
      {formCard}
      <section className="ac-card">
        <h2 className="ac-card-title">{"How the store posts"}</h2>
        <div className="ac-field ac-restock">
          <span className="ac-field-label">{"New stock is paid from"}</span>
          <Select
            className="select"
            value={restockFrom}
            onChange={saveRestock}
            options={[
              { value: "bank", label: "The bank" },
              { value: "cash", label: "Cash in hand" },
              { value: "payables", label: "Owed to the supplier (paid later)" },
            ]}
          />
          <span className="ac-hint">{"Where the cost of stock received in the Store is taken from. Stock bought another way can be corrected with a journal."}</span>
        </div>
      </section>
      <section className="ac-card">
        <div className="ac-card-head">
          <h2 className="ac-card-title">{"Chart of accounts"}</h2>
          {!form ? <Button size="sm" onClick={() => setForm({ ...blankAccount })}>{"Add an account"}</Button> : null}
        </div>
        <p className="ac-note">
          {"Rename or renumber any account to match what your accountant uses. Accounts marked Automatic are where bills, payments and store sales post, so they keep their type and cannot be switched off."}
        </p>
        {TYPES.map((t) => {
          const list = chart.filter((a) => a.type === t.value);
          if (list.length === 0) return null;
          return (
            <div key={t.value} className="ac-chart-group">
              <h3 className="ac-chart-type">{TYPE_PLURAL[t.value]}</h3>
              <ul className="ac-chart-list">
                {list.map((a) => {
                  const b = balanceOf(a.id);
                  return (
                    <li key={a.id} className={a.is_active ? "" : "is-off"}>
                      <span className="ac-chart-code">{a.code}</span>
                      <span className="ac-chart-name">
                        {a.name}
                        {a.description ? <span className="ac-chart-desc">{a.description}</span> : null}
                      </span>
                      <span className="ac-chart-badges">
                        {a.system_key ? <Badge tone="brand">{"Automatic"}</Badge> : null}
                        {!a.is_active ? <Badge>{"Off"}</Badge> : null}
                      </span>
                      <span className="ac-num ac-chart-balance">{b && toCents(b.closing) !== 0 ? money(natural(a.type, b.closing)) : ""}</span>
                      <button type="button" className="ac-link" onClick={() => edit(a)}>{"Edit"}</button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
};

// -------------------------------------------------------- opening balances --

// opening is fetched on its own: on busy books it is older than the latest
// entries the journal list holds.
const OpeningTab = ({ schoolId, settings, chart, balances, journal, opening, money, onChanged }) => {
  const onlyOpening = !journal.some((e) => e.source_type !== "opening");
  const equityAccount = chart.find((a) => a.system_key === "opening_equity");
  const accounts = chart.filter(
    (a) => ["asset", "liability", "equity"].includes(a.type) && a.system_key !== "opening_equity" && (a.is_active || opening?.lines.some((l) => l.account_id === a.id))
  );

  const initial = useMemo(() => {
    const values = {};
    (opening?.lines || []).forEach((l) => {
      values[l.account_id] = { debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "" };
    });
    return values;
    // Re-read whenever a new opening entry arrives.
  }, [opening]);

  const [values, setValues] = useState(initial);
  useEffect(() => setValues(initial), [initial]);
  const [startDate, setStartDate] = useState(settings.start_date);
  useEffect(() => setStartDate(settings.start_date), [settings.start_date]);
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  const set = (id, side, v) =>
    setValues((current) => {
      const next = { ...(current[id] || { debit: "", credit: "" }), [side]: v };
      if (v !== "") next[side === "debit" ? "credit" : "debit"] = "";
      return { ...current, [id]: next };
    });

  // What the books already hold for an account, apart from the opening
  // entry: bills issued and stock received since the start are posted by the
  // system, so typing them here as well would count them twice.
  const alreadyInBooks = (systemKey) => {
    const a = chart.find((x) => x.system_key === systemKey);
    const b = a && balances.find((x) => x.account_id === a.id);
    if (!b) return 0;
    const openingPart = sum((opening?.lines || []).filter((l) => l.account_id === a.id), (l) => l.debit - l.credit);
    return b.closing - openingPart;
  };
  const doubleCountHint = {
    receivables: () => `Only what families still owed on bills issued before ${formatDate(startDate, { withTime: false })}. Bills issued since are already in the books (${money(alreadyInBooks("receivables"))}); do not include them.`,
    inventory: () => `Only stock on the shelf on ${formatDate(startDate, { withTime: false })}, at cost. Stock received since is already in the books (${money(alreadyInBooks("inventory"))}); do not include it.`,
  };

  const dr = sum(accounts, (a) => values[a.id]?.debit);
  const cr = sum(accounts, (a) => values[a.id]?.credit);
  const toEquity = (toCents(dr) - toCents(cr)) / 100;

  const save = async () => {
    setBusy(true);
    try {
      if (startDate !== settings.start_date) {
        await setupAccounting({ schoolId, startDate, restockFrom: settings.restock_paid_from });
      }
      await saveOpeningBalances({
        schoolId,
        lines: accounts
          .map((a) => ({ accountId: a.id, debit: Number(values[a.id]?.debit || 0), credit: Number(values[a.id]?.credit || 0) }))
          .filter((l) => l.debit > 0 || l.credit > 0),
      });
      setNotice("Opening balances saved.");
      onChanged();
    } catch (err) {
      setError(err.message || "Could not save the opening balances.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ac-card">
      <div className="ac-card-head">
        <h2 className="ac-card-title">{`Opening balances on ${formatDate(startDate, { withTime: false })}`}</h2>
      </div>
      <p className="ac-note">
        {"What the school had and owed on the day the books start: each bank account's balance on its statement, cash in hand, fees still owed by families from before, stock on the shelf at cost, what is owed to suppliers, loans. Assets are usually debits; what the school owes is a credit. Whatever does not balance goes to Opening balance equity, and can be moved to capital or retained earnings later with a journal."}
      </p>
      {onlyOpening ? (
        <div className="ac-opening-date">
          <Field label="Books start on" hint="Can change until something else is posted.">
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
        </div>
      ) : (
        <p className="ac-note">{`The start date is fixed now that entries have been posted since ${formatDate(settings.start_date, { withTime: false })}.`}</p>
      )}
      <DrCrHelp />
      <div className="ac-opening">
        <div className="ac-opening-head" aria-hidden="true">
          <span>{"Account"}</span>
          <span>{"Debit"}</span>
          <span>{"Credit"}</span>
        </div>
        {["asset", "liability", "equity"].map((type) => (
          <React.Fragment key={type}>
            <div className="ac-opening-type">{TYPE_PLURAL[type]}</div>
            {accounts.filter((a) => a.type === type).map((a) => (
              <div className="ac-opening-row" key={a.id}>
                <span className="ac-opening-name">
                  <span className="ac-chart-code">{a.code}</span>
                  {a.name}
                  {doubleCountHint[a.system_key] ? <span className="ac-opening-warn">{doubleCountHint[a.system_key]()}</span> : null}
                </span>
                <MoneyInput value={values[a.id]?.debit || ""} onChange={(v) => set(a.id, "debit", v)} placeholder="Debit" aria-label={`${a.name} debit`} />
                <MoneyInput value={values[a.id]?.credit || ""} onChange={(v) => set(a.id, "credit", v)} placeholder="Credit" aria-label={`${a.name} credit`} />
              </div>
            ))}
          </React.Fragment>
        ))}
        {equityAccount ? (
          <div className="ac-opening-row ac-opening-equity">
            <span className="ac-opening-name">
              <span className="ac-chart-code">{equityAccount.code}</span>
              {"Balancing figure (ask your accountant to move this to capital)"}
            </span>
            <span className="ac-num">{toEquity < 0 ? money(-toEquity) : ""}</span>
            <span className="ac-num">{toEquity > 0 ? money(toEquity) : ""}</span>
          </div>
        ) : null}
        <div className="ac-opening-row ac-opening-total">
          <span>{"Totals"}</span>
          <span className="ac-num">{money(Math.max(dr, cr))}</span>
          <span className="ac-num">{money(Math.max(dr, cr))}</span>
        </div>
      </div>
      <div className="ac-actions">
        <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save opening balances"}</Button>
        <span className="ac-hint">{"Saving replaces the whole opening entry, so it can be corrected as often as needed."}</span>
      </div>
    </section>
  );
};

// ------------------------------------------------------------------- page --

const Accounts = () => {
  const { school, schoolId, roles, disabledModules } = useSchool();
  const money = useMoney(school?.currency);
  const { setError } = useActionFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab = TABS.some((t) => t.id === requested) ? requested : "overview";
  const setTab = (id) =>
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", id); return next; }, { replace: true });

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [chart, setChart] = useState([]);
  const [balances, setBalances] = useState([]);
  const [month, setMonth] = useState([]);
  const [journal, setJournal] = useState([]);
  const [stockOnShelf, setStockOnShelf] = useState(null);
  const [opening, setOpening] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const storeOn = canUseModule("store", roles, disabledModules);

  // quiet: refresh underneath without swapping the page for a skeleton, so an
  // open form or report is not thrown away.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!schoolId) return;
    if (!quiet) setLoading(true);
    try {
      const s = await fetchAccountingSettings(schoolId);
      setSettings(s);
      if (s) {
        const [c, b, m, j, o, products] = await Promise.all([
          fetchChartOfAccounts(schoolId),
          fetchAccountBalances(schoolId),
          fetchAccountBalances(schoolId, { from: monthStartISO(), to: todayISO() }),
          fetchJournal(schoolId),
          fetchJournal(schoolId, { sourceType: "opening", limit: 1 }),
          storeOn ? fetchStoreProducts(schoolId).catch(() => null) : Promise.resolve(null),
        ]);
        setChart(c);
        setBalances(b);
        setMonth(m);
        setJournal(j);
        setHasMore(j.length === JOURNAL_PAGE);
        setOpening(o[0] || null);
        setStockOnShelf(products ? sum(products, (p) => Number(p.stock_qty || 0) * Number(p.net_cost || 0)) : null);
      }
    } catch (err) {
      setError(err.message || "Could not load the books.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [schoolId, storeOn, setError]);

  useEffect(() => { load(); }, [load]);

  const chartById = useMemo(() => Object.fromEntries(chart.map((a) => [a.id, a])), [chart]);
  const accountOptions = useMemo(
    () => chart.filter((a) => a.is_active).map((a) => ({ value: a.id, label: accountLabel(a) })),
    [chart]
  );
  const refresh = () => load({ quiet: true });

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const older = await fetchJournal(schoolId, { offset: journal.length, limit: JOURNAL_PAGE });
      setJournal((current) => {
        const seen = new Set(current.map((e) => e.id));
        return [...current, ...older.filter((e) => !seen.has(e.id))];
      });
      setHasMore(older.length === JOURNAL_PAGE);
    } catch (err) {
      setError(err.message || "Could not load older entries.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Accounts"
        subtitle={school ? `The books of ${school.name}` : "The school's books"}
        toolbar={settings ? <Tabs tabs={TABS} active={tab} onChange={setTab} /> : null}
      >
        <div className="ac-page">
          {loading ? <SkeletonCards count={3} lines={3} /> : null}
          {!loading && !settings ? <Setup schoolId={schoolId} onDone={() => load()} /> : null}
          {!loading && settings && tab === "overview" ? (
            <Overview
              settings={settings}
              balances={balances}
              month={month}
              journal={journal}
              hasOpening={!!opening}
              stockOnShelf={stockOnShelf}
              money={money}
              onGo={setTab}
            />
          ) : null}
          {!loading && settings && tab === "journal" ? (
            <JournalTab
              schoolId={schoolId}
              settings={settings}
              journal={journal}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              chartById={chartById}
              accountOptions={accountOptions}
              money={money}
              onChanged={refresh}
            />
          ) : null}
          {!loading && settings && tab === "reports" ? (
            <ReportsTab
              schoolId={schoolId}
              settings={settings}
              chart={chart}
              accountOptions={accountOptions}
              money={money}
              schoolName={school?.name}
            />
          ) : null}
          {!loading && settings && tab === "chart" ? (
            <ChartTab schoolId={schoolId} settings={settings} chart={chart} balances={balances} money={money} onChanged={refresh} />
          ) : null}
          {!loading && settings && tab === "opening" ? (
            <OpeningTab schoolId={schoolId} settings={settings} chart={chart} balances={balances} journal={journal} opening={opening} money={money} onChanged={refresh} />
          ) : null}
        </div>
      </Page>
    </div>
  );
};

export default Accounts;
