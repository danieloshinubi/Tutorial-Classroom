import React, { useCallback, useEffect, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useMoney } from "../../lib/money";
import { useAuth } from "../../context/AuthContext";
import { useSchool, useModuleAccess } from "../../context/SchoolContext";
import {
  fetchTerms,
  fetchClasses,
  fetchSchoolMembers,
  fetchPaymentQueueContext,
  fetchFeeStructures,
  fetchFeeCatalogue,
  fetchFeeItems,
  createFeeStructure,
  deleteFeeStructure,
  addFeeItem,
  deleteFeeItem,
  updateFeeItem,
  updateFeeStructure,
  countStructureInvoices,
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
  fetchDiscountRules,
  applyDiscountRule,
  previewDiscount,
  carryForwardBalances,
  PAYMENT_METHODS,
} from "../../lib/api";
import { useDocumentPreview } from "../../Components/DocumentPreview";
import { useActionFeedback } from "../../Components/Toast";
import {
  Switch,
  Page,
  Field,
  Button,
  Badge,
  Notice,
  Tabs,
  MoneyInput,
  Select,
  DatePicker,
  displayName,
  formatDate,
  SkeletonStatRow,
  SkeletonTable,
  SkeletonCards,
  SkeletonList,
} from "../../Components/UI";
import { confirmDialog, promptDialog } from "../../Components/Confirm";
import ExportButton from "../../Components/ExportButton";

// Spreadsheet columns for the bursary's lists (Export to Excel).
const DEBTOR_COLUMNS = [
  { key: "student", label: "Student" },
  { key: "class_name", label: "Class" },
  { key: "payable", label: "Billed", type: "money" },
  { key: "paid", label: "Paid", type: "money" },
  { key: "balance", label: "Owing", type: "money" },
  { key: "oldest_due", label: "Oldest due", type: "date" },
  { key: "guardians", label: "Parents" },
];

// Two charge names are the same charge when they differ only in case or
// spacing. The database tidies spaces the same way (supabase/185).
const sameCharge = (a, b) =>
  String(a).trim().replace(/\s+/g, " ").toLowerCase() ===
  String(b).trim().replace(/\s+/g, " ").toLowerCase();

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS);
const PURPOSE_LABEL = { term_fee: "Term fee", application_fee: "Application fee", acceptance_fee: "Acceptance fee", other: "Other", store: "Store purchase" };


/* ---------------------------------------------------------------- overview */

// A due date in the past, compared by calendar day: a bill due today is not
// yet overdue this morning.
const isPastDue = (due) => {
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(due) < today;
};

// Collection first — how much of what was billed has come in, drawn as one
// bar so the proportion reads before any number does — then the things that
// are waiting on the bursar, each a button to the place it is dealt with,
// then who owes. It used to be four equal tiles and a table; the one figure
// that says how the term is going, and the work waiting to be done, had no
// more weight than anything else.
const Overview = ({ summary, debtors, money, termName, draftCount, queueCount, queueTotal, onGo }) => {
  const invoiced = Number(summary?.invoiced || 0);
  const collected = Number(summary?.collected || 0);
  const outstanding = Number(summary?.outstanding || 0);
  const rate =
    summary?.collection_rate === null || summary?.collection_rate === undefined
      ? null
      : summary.collection_rate;
  // Declared-but-unapproved money is shown on the bar as its own hatched
  // segment: real money, very likely, but not collected until approved.
  const collectedPct = invoiced > 0 ? Math.min(100, (collected / invoiced) * 100) : 0;
  const awaitingPct =
    invoiced > 0 ? Math.min(100 - collectedPct, (Number(summary?.awaiting || 0) / invoiced) * 100) : 0;
  const overdue = debtors.filter((d) => isPastDue(d.oldest_due)).length;

  const todo = [
    queueCount
      ? {
          key: "queue",
          tone: "warn",
          title: `${queueCount} payment${queueCount === 1 ? "" : "s"} to confirm`,
          detail: `${money(queueTotal)} that families say they have paid. It comes off their balance when you approve it.`,
          action: "Review payments",
          go: () => onGo("queue"),
        }
      : null,
    draftCount
      ? {
          key: "drafts",
          tone: "brand",
          title: `${draftCount} draft invoice${draftCount === 1 ? "" : "s"} not sent`,
          detail: "Families cannot see a draft. Issue them once the amounts are right.",
          action: "Open drafts",
          go: () => onGo("invoices", "draft"),
        }
      : null,
    overdue
      ? {
          key: "overdue",
          tone: "danger",
          title: `${overdue} ${overdue === 1 ? "family" : "families"} past due`,
          detail: "Their oldest bill is past its due date. The list below says who to call.",
          action: "See who",
          go: () => document.getElementById("bz-debtors")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        }
      : null,
  ].filter(Boolean);

  return (
    <div className="bz-stack">
      <section className="bz-hero">
        <div className="bz-hero-main">
          <span className="bz-label">{`Collected · ${termName || "every term"}`}</span>
          <div className="bz-hero-figure">
            <span>{money(collected)}</span>
            <span className="bz-hero-of">{`of ${money(invoiced)} billed`}</span>
          </div>
          <div
            className="bz-progress"
            role="img"
            aria-label={`${rate === null ? 0 : rate}% of what was billed has been collected`}
          >
            <span className="bz-progress-done" style={{ width: `${collectedPct}%` }} />
            <span className="bz-progress-waiting" style={{ width: `${awaitingPct}%` }} />
          </div>
          <div className="bz-legend">
            <span><i className="bz-swatch done" />{`Collected${rate === null ? "" : ` ${rate}%`}`}</span>
            {awaitingPct > 0 ? (
              <span><i className="bz-swatch waiting" />{`Awaiting approval ${money(summary?.awaiting)}`}</span>
            ) : null}
            <span><i className="bz-swatch owed" />{`Still owed ${money(outstanding)}`}</span>
          </div>
        </div>
        <dl className="bz-hero-facts">
          <div>
            <dt>{"Outstanding"}</dt>
            <dd>{money(outstanding)}</dd>
            {/* collection_summary.debtors counts unpaid INVOICES — admissions
                fees for applicants included — not students; the list below
                is per student. Saying "students" here would disagree with it. */}
            <span>{`on ${summary?.debtors || 0} unpaid invoice${Number(summary?.debtors) === 1 ? "" : "s"}`}</span>
          </div>
          <div>
            <dt>{"Invoices settled"}</dt>
            <dd>{`${summary?.settled || 0} of ${summary?.invoices || 0}`}</dd>
            <span>{"paid in full"}</span>
          </div>
        </dl>
      </section>

      {todo.length ? (
        <section className="bz-todo" aria-label="Needs you">
          {/* tone-*, not the bare tone name: .brand is the logo's own class
              (bold, nowrap) and leaked straight into these cards. */}
          {todo.map((t) => (
            <div key={t.key} className={`bz-todo-item tone-${t.tone}`}>
              <div className="bz-todo-text">
                <strong>{t.title}</strong>
                <span>{t.detail}</span>
              </div>
              <Button size="sm" variant="secondary" onClick={t.go}>
                {t.action}
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="bz-card" id="bz-debtors">
        <div className="bz-card-head">
          <h2 className="bz-card-title">{"Who owes the most"}</h2>
          {debtors.length ? (
            <span className="bz-muted">{`${debtors.length} ${debtors.length === 1 ? "student" : "students"}`}</span>
          ) : null}
          <ExportButton module="bursary" roles={["bursar"]} filename={`debtors${termName ? `-${termName}` : ""}`} sheetName="Who owes" columns={DEBTOR_COLUMNS} rows={debtors} />
        </div>
        {debtors.length === 0 ? (
          <div className="bz-empty">
            <strong>{"Nobody owes anything"}</strong>
            <span>{invoiced ? "Every issued bill is paid in full." : "Nothing has been billed yet."}</span>
          </div>
        ) : (
          <div className="table-wrap table-wrap-plain">
            <table className="data bz-table">
              <thead>
                <tr>
                  <th>{"Student"}</th>
                  <th className="num">{"Billed"}</th>
                  <th className="num">{"Paid"}</th>
                  <th className="num">{"Owing"}</th>
                  <th>{"Due"}</th>
                  <th>{"Who to call"}</th>
                </tr>
              </thead>
              <tbody>
                {debtors.map((d) => {
                  const late = isPastDue(d.oldest_due);
                  return (
                    <tr key={d.student_id}>
                      <td>
                        <strong>{d.student}</strong>
                        <div className="bz-sub">{d.class_name || "No class"}</div>
                      </td>
                      <td className="num">{money(d.payable)}</td>
                      <td className="num">{money(d.paid)}</td>
                      <td className="num">
                        <strong>{money(d.balance)}</strong>
                      </td>
                      <td className="bz-nowrap">
                        {d.oldest_due ? (
                          <Badge tone={late ? "danger" : undefined}>
                            {`${late ? "Overdue · " : ""}${formatDate(d.oldest_due, { withTime: false })}`}
                          </Badge>
                        ) : (
                          <span className="bz-muted">{"No due date"}</span>
                        )}
                      </td>
                      <td className="bz-sub">{d.guardians || "No guardian linked"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

/* --------------------------------------------------------- fee structures */

// Picked instead of a saved charge, for a line that genuinely belongs to one
// structure only.
const OTHER_ITEM = "__other";

// .split is a page layout — one wide column and a 320px rail — not a form
// row. Four fields were already being squeezed through it, and the typed-name
// box makes five. These flow instead, and wrap when the card is narrow.
const lineForm = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  // Labels level along the top; the buttons meet the bottom of the inputs
  // (the 16px margin every .field carries is matched on the button row).
  alignItems: "start",
  marginTop: 12,
};

const Structures = ({
  schoolId,
  userId,
  terms,
  classes,
  structures,
  catalogue,
  items,
  money,
  onChange,
  onError,
}) => {
  // The school's own year groups ("SSS 3", "Primary 5"), already loaded by
  // SchoolContext — taken from there rather than threaded through as one more
  // prop, since this is the only place in Bursary that needs them.
  const { levels } = useSchool();
  // View-only access sees the structures but none of the controls that change them.
  const { canEdit } = useModuleAccess("bursary");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [termId, setTermId] = useState("");
  // One control for the three audiences the database allows, encoded as
  // "" | "level:<year>" | "class:<uuid>". Kept as one field because
  // fee_structures_one_audience forbids naming both a class and a level, and
  // two separate pickers would let someone set both and only find out on save.
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("term_fee");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);

  const [itemFor, setItemFor] = useState(null);
  const [itemName, setItemName] = useState("");
  const [itemCatalogueId, setItemCatalogueId] = useState("");
  // Set when the bursar picks "Something else": the line keeps a typed name
  // and no catalogue link, which is what a genuine one-off should be.
  const [itemCustom, setItemCustom] = useState(false);
  const [itemAmount, setItemAmount] = useState("");
  const [itemOptional, setItemOptional] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);

  const resetItem = () => {
    setItemName("");
    setItemCatalogueId("");
    setItemCustom(false);
    setItemAmount("");
    setItemOptional(false);
  };

  const pickCatalogue = (value) => {
    if (value === OTHER_ITEM) {
      setItemCustom(true);
      setItemCatalogueId("");
      setItemName("");
      return;
    }
    const picked = catalogue.find((c) => c.id === value);
    setItemCustom(false);
    setItemCatalogueId(value);
    setItemName(picked?.label || "");
    // The saved figure is the school's usual price, not a fixed one — it
    // fills the box so the common case is two clicks, and a term that
    // differs can still be typed over. A charge with no saved figure EMPTIES
    // the box: leaving it alone kept the previous charge's amount, so picking
    // PTA (₦10,000) and then Extra Coaching quietly priced Extra Coaching at
    // ₦10,000.
    setItemAmount(
      picked?.default_amount != null && picked.default_amount !== ""
        ? String(picked.default_amount)
        : ""
    );
  };

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
        classId: audience.startsWith("class:") ? audience.slice(6) : null,
        levelYear: audience.startsWith("level:") ? Number(audience.slice(6)) : null,
        purpose,
        name: name.trim(),
        dueOn,
        userId,
      });
      setName("");
      setAudience("");
      setPurpose("term_fee");
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
    // A second click while the first save is still in flight used to add the
    // same line twice; the button is disabled below, and this is the guard
    // for the keyboard and for a click that beats the re-render.
    if (itemBusy) return;
    onError("");
    const amount = Number(itemAmount);
    if (!itemName.trim() || !amount || amount < 0) {
      onError("A line needs a name and an amount.");
      return;
    }
    // Checked here for a clear message; the database refuses it regardless
    // (supabase/183). A second Tuition used to go straight in and add
    // ₦150,000 to every family's bill.
    const existing = (items[structureId] || []).find(
      (l) =>
        sameCharge(l.name, itemName) ||
        (itemCatalogueId && l.catalogue_id === itemCatalogueId)
    );
    if (existing) {
      onError(`${existing.name} is already on this structure. Remove it first if it needs a different amount.`);
      return;
    }
    setItemBusy(true);
    try {
      await addFeeItem({
        schoolId,
        structureId,
        catalogueId: itemCatalogueId || null,
        name: itemName.trim(),
        amount,
        isOptional: itemOptional,
        position: (items[structureId] || []).length + 1,
      });
      resetItem();
      onChange();
    } catch (err) {
      onError(
        err?.code === "23505" || /fee_items_.*once_per_structure|duplicate key/i.test(err?.message || "")
          ? `${itemName.trim()} is already on this structure. Remove it first if it needs a different amount.`
          : err.message || "Could not add that line."
      );
    } finally {
      setItemBusy(false);
    }
  };

  // Shared by the card and by the confirmation below, so the two can never
  // disagree about who a structure covers.
  const audienceOf = (structure) => {
    if (structure.class_id) {
      return classes.find((c) => c.id === structure.class_id)?.name || "that class";
    }
    if (structure.level_year != null) {
      const level = levels.find((l) => l.year === structure.level_year);
      return level ? `${level.label} — whole year group` : `year ${structure.level_year}`;
    }
    return "every student in the school";
  };

  const bulk = async (structure) => {
    const label = audienceOf(structure);
    if (
      !await confirmDialog(
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
          : made === 1
          ? "1 invoice raised as a draft. Issue it when you're ready."
          : `${made} invoices raised as drafts. Issue them when you're ready.`
      );
    } catch (err) {
      onError(err.message || "Could not raise the invoices.");
    }
  };

  // Editing a structure in place: its name, due date and the amount of each
  // charge (supabase/205). Who it applies to and the term stay as they are;
  // bills may already hang off them.
  const [editing, setEditing] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const startEdit = (structure) =>
    setEditing({
      id: structure.id,
      name: structure.name,
      dueOn: structure.due_on || "",
      lines: Object.fromEntries((items[structure.id] || []).map((l) => [l.id, { name: l.name, amount: String(Number(l.amount)), optional: l.is_optional }])),
    });
  const saveEdit = async (structure) => {
    if (!editing?.name.trim()) {
      onError("Give the structure a name.");
      return;
    }
    const before = Object.fromEntries((items[structure.id] || []).map((l) => [l.id, l]));
    const changed = Object.entries(editing.lines).filter(([id, v]) => {
      const b = before[id];
      return b && (Number(v.amount) !== Number(b.amount) || Boolean(v.optional) !== Boolean(b.is_optional));
    });
    if (changed.some(([, v]) => !(Number(v.amount) >= 0) || v.amount === "")) {
      onError("Every charge needs an amount (0 or more).");
      return;
    }
    const counts = await countStructureInvoices(structure.id).catch(() => ({}));
    const drafts = counts.draft || 0;
    const issued = counts.issued || 0;
    if (changed.length && issued) {
      const ok = await confirmDialog({
        title: "Change these charges?",
        body: `${issued} bill${issued === 1 ? " has" : "s have"} already been issued from this structure and will not change. Only bills raised from now on use the new amounts.`,
        confirmLabel: "Save",
      });
      if (!ok) return;
    }
    setSavingEdit(true);
    onError("");
    try {
      await updateFeeStructure({ id: structure.id, name: editing.name.trim(), dueOn: editing.dueOn || null });
      for (const [id, v] of changed) {
        await updateFeeItem({ id, schoolId, amount: Number(v.amount), isOptional: Boolean(v.optional) });
      }
      setEditing(null);
      const movedDue = (editing.dueOn || null) !== (structure.due_on || null) && drafts;
      onChange(`Saved.${movedDue ? ` The due date of ${drafts} draft bill${drafts === 1 ? "" : "s"} moved too.` : ""}`);
    } catch (err) {
      onError(err.message || "Could not save the changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (structure) => {
    if (!await confirmDialog(`Delete "${structure.name}"?`)) return;
    try {
      await deleteFeeStructure(structure.id, schoolId);
      onChange("Deleted.");
    } catch (err) {
      onError(err.message || "Could not delete that.");
    }
  };

  return (
    <div className="bz-stack">
      <div className="bz-intro">
        <p>
          {"What a class is charged in a term. Raising invoices copies these lines onto each student's bill, so changing a structure later never rewrites a bill already issued."}
        </p>
        {canEdit ? (
          <Button onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "New structure"}
          </Button>
        ) : null}
      </div>

      {adding && canEdit ? (
        <section className="bz-card" style={{ marginBottom: 20 }}>
          <h2 className="bz-card-title">{"New fee structure"}</h2>
          {/* One wrapping grid. These were three .split rows — the page's
              wide-column-plus-320px-rail layout — so the second field of each
              pair was pinned to 320px whatever it held. */}
          <form onSubmit={create}>
            <div className="bz-form-grid">
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
              <Field
                label="Applies to"
                hint="A whole year group covers every class in it — so a WAEC fee can go to SSS 3 without naming each arm."
              >
                <Select
                  className="select"
                  value={audience}
                  onChange={setAudience}
                  options={[
                    { value: "", label: "Every class" },
                    ...levels.map((l) => ({
                      value: `level:${l.year}`,
                      label: `${l.label} — whole year group`,
                    })),
                    ...classes.map((c) => ({ value: `class:${c.id}`, label: c.name })),
                  ]}
                />
              </Field>
              <Field label="Due by">
                <DatePicker value={dueOn} onChange={setDueOn} />
              </Field>
              {/* Purpose is what lets a second charge exist beside the term
                  fee: invoices are unique per structure now, but a school
                  still wants the term bill and a one-off charge to read
                  differently on a family's statement. */}
              <Field
                label="Kind"
                hint="An additional charge sits alongside the term fee rather than replacing it."
              >
                <Select
                  className="select"
                  value={purpose}
                  onChange={setPurpose}
                  options={[
                    { value: "term_fee", label: "Term fee" },
                    { value: "other", label: "Additional charge" },
                  ]}
                />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create"}
            </Button>
          </form>
        </section>
      ) : null}

      {terms.length === 0 ? (
        <Notice tone="warn">
          {"There are no terms yet. An administrator sets sessions and terms on the School page — fees hang off a term, so nothing can be billed until one exists."}
        </Notice>
      ) : null}

      {structures.length === 0 ? (
        <div className="bz-empty">
          <strong>{"No fee structures yet"}</strong>
          {canEdit ? (
            <span>{"Start with New structure: name it, choose the term and who it applies to, then add its lines."}</span>
          ) : null}
        </div>
      ) : null}

      {structures.map((s) => {
        const lines = items[s.id] || [];
        const total = lines
          .filter((l) => !l.is_optional)
          .reduce((sum, l) => sum + Number(l.amount), 0);
        const term = terms.find((t) => t.id === s.term_id);

        return (
          <section key={s.id} className="bz-card bz-structure">
            <div className="bz-structure-head">
              <div className="bz-structure-id">
                <div className="bz-structure-name">
                  <h3>{s.name}</h3>
                  <Badge tone={s.purpose === "term_fee" ? "brand" : undefined}>
                    {s.purpose === "term_fee" ? "Term fee" : "Additional charge"}
                  </Badge>
                </div>
                <div className="bz-sub">
                  {/* The session, not just the term: "First Term · every
                      class" reads identically for 2026/2027 and 2027/2028,
                      and these sit in one list. */}
                  {[term?.sessions?.name, term?.name, audienceOf(s),
                    s.due_on ? `due ${formatDate(s.due_on, { withTime: false })}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="bz-structure-total">
                <span className="bz-label">{"Compulsory total"}</span>
                <strong>{money(total)}</strong>
              </div>
            </div>

            {editing?.id === s.id && canEdit ? (
              <div className="bz-edit">
                <div className="bz-edit-grid">
                  <Field label="Name">
                    <input className="input" value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} />
                  </Field>
                  <Field label="Due by" hint="Draft bills from this structure move too; issued bills keep their date.">
                    <DatePicker value={editing.dueOn} onChange={(v) => setEditing((x) => ({ ...x, dueOn: v || "" }))} />
                  </Field>
                </div>
                {lines.length ? (
                  <ul className="bz-edit-lines">
                    {lines.map((l) => {
                      const v = editing.lines[l.id] || { amount: String(Number(l.amount)), optional: l.is_optional };
                      const setLine = (patch) => setEditing((x) => ({ ...x, lines: { ...x.lines, [l.id]: { ...v, ...patch } } }));
                      return (
                        <li key={l.id}>
                          <span className="bz-line-name">{l.name}</span>
                          <MoneyInput value={v.amount} onChange={(raw) => setLine({ amount: raw })} aria-label={`Amount for ${l.name}`} />
                          <Switch compact label="Optional" checked={Boolean(v.optional)} onChange={(on) => setLine({ optional: on })} />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <p className="bz-sub">{"Who it applies to and the term stay as they are. To change those, make a new structure."}</p>
                <div className="btn-row">
                  <Button size="sm" disabled={savingEdit} onClick={() => saveEdit(s)}>{savingEdit ? "Saving..." : "Save"}</Button>
                  <Button size="sm" variant="secondary" disabled={savingEdit} onClick={() => setEditing(null)}>{"Cancel"}</Button>
                </div>
              </div>
            ) : lines.length ? (
              <ul className="bz-lines">
                {lines.map((l) => (
                  <li key={l.id} className="bz-line">
                    <span className="bz-line-name">
                      {l.name}
                      {l.is_optional ? <Badge>{"Optional"}</Badge> : null}
                    </span>
                    <span className="bz-line-amount">{money(l.amount)}</span>
                    {canEdit ? (
                    <button
                      type="button"
                      className="bz-line-remove"
                      aria-label={`Remove ${l.name}`}
                      onClick={async () => {
                        // It changes what every family on this structure will
                        // be billed, so it asks first — and says by how much.
                        const after = total - (l.is_optional ? 0 : Number(l.amount));
                        const ok = await confirmDialog({
                          title: `Remove ${l.name}?`,
                          body: l.is_optional
                            ? `It is optional, so the compulsory total stays at ${money(total)}. Invoices already raised from this structure are not changed.`
                            : `The compulsory total goes from ${money(total)} to ${money(after)}. Invoices already raised from this structure are not changed.`,
                          confirmLabel: "Remove",
                        });
                        if (!ok) return;
                        // Unhandled, a failed delete left the row on screen
                        // with nothing said about why.
                        try {
                          await deleteFeeItem(l.id, schoolId);
                          onChange();
                        } catch (err) {
                          onError(err.message || "Could not remove that line.");
                        }
                      }}
                    >
                      {"Remove"}
                    </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="bz-muted bz-lines-none">{canEdit ? "No lines yet. Add what this structure is made of before raising invoices." : "No lines yet."}</p>
            )}

            {itemFor === s.id && canEdit ? (
              <>
              <div style={lineForm}>
                {/* No hint inside this Field: its extra line made "Line" sit
                    higher than "Amount" and "Optional" in the same row. The
                    hint is under the whole row instead. */}
                <Field label="Line">
                  {catalogue.length ? (
                    <Select
                      className="select"
                      value={itemCustom ? OTHER_ITEM : itemCatalogueId}
                      placeholder="Choose a charge"
                      onChange={pickCatalogue}
                      options={[
                        // A charge already on this structure is left out, so
                        // it cannot be added twice by picking it again.
                        ...catalogue
                          .filter(
                            (c) =>
                              !lines.some(
                                (l) =>
                                  l.catalogue_id === c.id ||
                                  sameCharge(l.name, c.label)
                              )
                          )
                          .map((c) => ({ value: c.id, label: c.label })),
                        { value: OTHER_ITEM, label: "Something else (type a name)" },
                      ]}
                    />
                  ) : (
                    <input
                      className="input"
                      autoFocus
                      value={itemName}
                      placeholder="Tuition"
                      onChange={(e) => setItemName(e.target.value)}
                    />
                  )}
                </Field>
                {catalogue.length && itemCustom ? (
                  <Field label="Name">
                    <input
                      className="input"
                      autoFocus
                      value={itemName}
                      placeholder="Tuition"
                      onChange={(e) => setItemName(e.target.value)}
                    />
                  </Field>
                ) : null}
                <Field label="Amount">
                  <MoneyInput
                    value={itemAmount}
                    onChange={setItemAmount}
                    placeholder={
                      itemCatalogueId &&
                      catalogue.find((c) => c.id === itemCatalogueId)?.default_amount == null
                        ? "Enter an amount"
                        : undefined
                    }
                  />
                </Field>
                <Field label="Optional">
                  <Switch
                    compact
                    label="Charged only to families who ask for it"
                    checked={itemOptional}
                    onChange={setItemOptional}
                  />
                </Field>
                <div className="btn-row" style={{ alignSelf: "end", marginBottom: 16 }}>
                  <Button size="sm" disabled={itemBusy} onClick={() => addItem(s.id)}>
                    {itemBusy ? "Adding..." : "Add"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={itemBusy}
                    onClick={() => {
                      setItemFor(null);
                      resetItem();
                    }}
                  >
                    {"Done"}
                  </Button>
                </div>
              </div>
              <p className="bz-line-hint">
                {/* A charge saved without a usual amount says so here, where
                    there is room — in the Amount box itself it was cut off. */}
                {itemCatalogueId &&
                catalogue.find((c) => c.id === itemCatalogueId)?.default_amount == null ? (
                  <strong className="bz-line-hint-strong">
                    {`${catalogue.find((c) => c.id === itemCatalogueId)?.label} has no usual amount saved, so enter the amount for this term. `}
                  </strong>
                ) : null}
                {catalogue.length
                  ? `From the charges saved in School admin → Fees setup.${
                      catalogue.some((c) =>
                        lines.some(
                          (l) =>
                            l.catalogue_id === c.id ||
                            sameCharge(l.name, c.label)
                        )
                      )
                        ? " Charges already on this structure are not listed."
                        : ""
                    }`
                  : "Nothing saved yet — an administrator adds the school's charges in School admin → Fees setup."}
              </p>
              </>
            ) : null}

            {canEdit ? (
            <div className="bz-structure-actions">
              {itemFor === s.id ? null : (
                <Button size="sm" variant="secondary" onClick={() => setItemFor(s.id)}>
                  {"Add a line"}
                </Button>
              )}
              <span className="bz-spacer" />
              {editing?.id === s.id ? null : (
                <Button size="sm" variant="secondary" onClick={() => startEdit(s)}>
                  {"Edit"}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                {"Delete"}
              </Button>
              <Button
                size="sm"
                disabled={lines.length === 0}
                title={lines.length === 0 ? "Add at least one line first" : undefined}
                onClick={() => bulk(s)}
              >
                {"Raise invoices"}
              </Button>
            </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
};

/* ----------------------------------------------------------------- invoices */

// Filter chips and a search box, not a second row of tabs inside the Invoices
// tab — two tab strips stacked read as two levels of navigation. The filter
// lives in the page, so "Open drafts" on the Overview lands on the drafts.
const Invoices = ({ invoices, people, money, onChange, onError, filter, setFilter, discounts = [], term = null }) => {
  const { canEdit } = useModuleAccess("bursary");
  const [query, setQuery] = useState("");
  const [carrying, setCarrying] = useState(false);

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

  const needle = query.trim().toLowerCase();
  const shown = invoices.filter((i) => {
    const inFilter =
      filter === "all"
        ? true
        : filter === "draft"
        ? i.status === "draft"
        : filter === "owing"
        ? i.status === "issued" && Number(i.balance) > 0
        : i.status === "issued" && Number(i.balance) <= 0;
    if (!inFilter) return false;
    if (!needle) return true;
    return [i.reference, nameOf(i)].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
  });

  const drafts = invoices.filter((i) => i.status === "draft");
  // Counted with the same tests as `shown` above, so a tab's number is always
  // the number of rows it opens onto.
  const owingCount = invoices.filter((i) => i.status === "issued" && Number(i.balance) > 0).length;
  const settledCount = invoices.filter((i) => i.status === "issued" && Number(i.balance) <= 0).length;

  const issueAll = async () => {
    if (
      !await confirmDialog(
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

  // Unpaid balances from earlier terms onto this term’s drafts (196). Only
  // offered once a term is chosen and it has drafts to carry them.
  const carryForward = async () => {
    if (!term || carrying) return;
    const ok = await confirmDialog({
      title: `Bring unpaid balances into ${term.name}?`,
      body: `Whatever is still owed on earlier terms’ bills is added to each child’s draft bill for ${term.name} as “Balance brought forward”, and the earlier bill is marked as moved. Nothing is sent to families until you issue the drafts. Deleting or voiding a draft puts its balance back where it came from.`,
      confirmLabel: "Bring forward",
    });
    if (!ok) return;
    setCarrying(true);
    onError("");
    try {
      const result = await carryForwardBalances(term.id);
      const missing = result.no_draft_bill || [];
      const names = missing.map((m) => nameOf({ student_id: m.student_id })).filter((v, i, a) => a.indexOf(v) === i);
      const moved = result.moved
        ? `${money(result.amount)} brought forward on ${result.moved} bill${result.moved === 1 ? "" : "s"}.`
        : "Nothing was owing on earlier bills.";
      onChange(
        missing.length
          ? `${moved} ${names.length} child${names.length === 1 ? " has" : "ren have"} money owing but no draft bill for ${term.name} yet (${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}). Raise their bills, then bring forward again.`
          : moved
      );
    } catch (err) {
      onError(err.message || "Could not bring the balances forward.");
    } finally {
      setCarrying(false);
    }
  };

  const filters = [
    { id: "all", label: "All", count: invoices.length },
    { id: "draft", label: "Drafts", count: drafts.length },
    { id: "owing", label: "Owing", count: owingCount },
    { id: "settled", label: "Settled", count: settledCount },
  ];

  const emptyText = needle
    ? ["Nothing matches", "Try a different name or reference."]
    : filter === "draft"
    ? ["No drafts", "Every invoice raised has been issued."]
    : filter === "owing"
    ? ["Nobody owes anything", "Every issued invoice is paid in full."]
    : filter === "settled"
    ? ["Nothing settled yet", "Invoices move here once they are paid in full."]
    : ["No invoices yet", "Raise them from a fee structure under Fee structures."];

  return (
    <div className="bz-stack">
      <div className="panel-top bz-toolbar">
        <div className="bz-chips" role="tablist" aria-label="Show">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`bz-chip${filter === f.id ? " active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              <span>{f.label}</span>
              <span className="bz-chip-count">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="bz-toolbar-end">
          <input
            className="input bz-search"
            placeholder="Search name or reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {canEdit && term && drafts.length ? (
            <Button variant="secondary" disabled={carrying} onClick={carryForward}>
              {carrying ? "Bringing forward..." : "Bring forward unpaid"}
            </Button>
          ) : null}
          <ExportButton
            module="bursary"
            roles={["bursar"]}
            filename={`invoices${term ? `-${term.name}` : ""}`}
            sheetName="Invoices"
            rows={shown}
            columns={[
              { key: "reference", label: "Reference" },
              { key: (i) => nameOf(i), label: "Student" },
              { key: (i) => standingLabel(i), label: "Standing" },
              { key: "gross", label: "Billed", type: "money" },
              { key: "discount", label: "Discount", type: "money" },
              { key: "discount_reason", label: "Discount for" },
              { key: "payable", label: "Payable", type: "money" },
              { key: "paid", label: "Paid", type: "money" },
              { key: "balance", label: "Balance", type: "money" },
              { key: "due_on", label: "Due", type: "date" },
              { key: "issued_at", label: "Issued", type: "datetime" },
            ]}
          />
          {canEdit && drafts.length ? (
            <Button onClick={issueAll}>{`Issue ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}</Button>
          ) : null}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="bz-empty">
          <strong>{emptyText[0]}</strong>
          <span>{emptyText[1]}</span>
        </div>
      ) : (
        <section className="bz-card bz-card-flush">
          <div className="table-wrap table-wrap-plain">
            <table className="data bz-table">
              <thead>
                <tr>
                  <th>{"Reference"}</th>
                  <th>{"Student"}</th>
                  <th className="num">{"Billed"}</th>
                  <th className="num">{"Paid"}</th>
                  <th className="num">{"Balance"}</th>
                  <th>{"Standing"}</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <InvoiceRow
                    key={i.invoice_id}
                    invoice={i}
                    who={nameOf(i)}
                    money={money}
                    discounts={discounts}
                    onChange={onChange}
                    onError={onError}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

// invoice_balances.standing (paid | part paid | overdue | unpaid | cancelled),
// as a label a family would use. It used to print in lower case as stored.
const STANDING_LABEL = { paid: "Paid", overdue: "Overdue", "part paid": "Part paid", unpaid: "Unpaid" };
const standingLabel = (invoice) =>
  invoice.status === "draft"
    ? "Draft"
    : invoice.status === "cancelled"
    ? "Voided"
    : STANDING_LABEL[invoice.standing] ||
      String(invoice.standing || "").replace(/^./, (c) => c.toUpperCase());

const InvoiceRow = ({ invoice, who, money, discounts = [], onChange, onError }) => {
  // View-only access keeps the row but loses Discount, Issue, Take payment and Void.
  const { canEdit } = useModuleAccess("bursary");
  const [taking, setTaking] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const [ruleId, setRuleId] = useState("");
  const [applying, setApplying] = useState(false);

  // A preview of the figure, so the bursar sees what the rule comes to on
  // this bill before applying it. Only a preview: the database works the
  // amount out again, from the invoice's own lines, when it is applied.
  const gross = Number(invoice.gross || 0);
  const chosen = discounts.find((d) => d.id === ruleId);
  // A rule on particular charges needs the bill's lines, which this row does
  // not have, so the database works that one out (supabase/191).
  const itemisedRule = Boolean(chosen?.items?.length);
  const [itemisedPreview, setItemisedPreview] = useState(null);
  useEffect(() => {
    if (!itemisedRule) return undefined;
    let live = true;
    setItemisedPreview(null);
    previewDiscount({ invoiceId: invoice.invoice_id, ruleId: chosen.id })
      .then((n) => live && setItemisedPreview(n))
      .catch(() => live && setItemisedPreview(null));
    return () => {
      live = false;
    };
  }, [itemisedRule, chosen?.id, invoice.invoice_id]);
  const previewAmount = chosen
    ? itemisedRule
      ? itemisedPreview ?? 0
      : chosen.kind === "percent"
      ? Math.round(gross * Number(chosen.value)) / 100
      : Math.min(Number(chosen.value), gross)
    : 0;

  const applyDiscount = async (nextRuleId) => {
    setApplying(true);
    onError("");
    try {
      await applyDiscountRule({ invoiceId: invoice.invoice_id, ruleId: nextRuleId });
      setDiscounting(false);
      setRuleId("");
      onChange(nextRuleId ? "Discount applied. Issue the invoice when it is right." : "Discount removed.");
    } catch (err) {
      onError(err.message || "Could not change the discount.");
    } finally {
      setApplying(false);
    }
  };
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  // Issuing notifies the family at once and cannot be taken back, so it asks
  // first, as Raise invoices and Delete already do. The dialog also answers
  // the double-click: "Take payment" replaces this button the moment the
  // row updates, directly under the pointer, and a second click used to land
  // on it. With the dialog up, that click lands on the dialog instead.
  const issue = async () => {
    if (issuing) return;
    const ok = await confirmDialog({
      title: "Issue and notify the family?",
      body: `${invoice.reference} for ${who} becomes visible to the family, and they are notified straight away. It can still be voided while nothing has been paid on it, but the notification cannot be recalled.`,
      confirmLabel: "Issue and notify",
    });
    if (!ok) return;
    setIssuing(true);
    onError("");
    try {
      await issueInvoice(invoice.invoice_id);
      onChange("Issued, and the family notified.");
    } catch (err) {
      onError(err.message || "Could not issue that invoice.");
    } finally {
      setIssuing(false);
    }
  };

  const cancel = async () => {
    const reason = await promptDialog({ body: "Why is this invoice being voided? The reason is kept on the record." });
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
      <tr className={taking ? "bz-row-open" : undefined}>
        <td className="bz-ref">{invoice.reference}</td>
        <td>
          <strong>{who}</strong>
          {invoice.purpose && invoice.purpose !== "term_fee" ? (
            <div className="bz-sub">{PURPOSE_LABEL[invoice.purpose] || invoice.purpose}</div>
          ) : null}
        </td>
        <td className="num">
          {money(invoice.payable)}
          {Number(invoice.discount) > 0 ? (
            <div className="bz-sub bz-discount">
              {`− ${money(invoice.discount)}${invoice.discount_reason ? ` · ${invoice.discount_reason}` : ""}`}
            </div>
          ) : null}
        </td>
        <td className="num">{money(invoice.paid)}</td>
        <td className="num">
          <strong>{money(invoice.balance)}</strong>
        </td>
        <td>
          <Badge
            tone={
              invoice.status === "draft"
                ? "brand"
                : invoice.standing === "paid"
                ? "success"
                : invoice.standing === "overdue"
                ? "danger"
                : invoice.standing === "part paid"
                ? "warn"
                : undefined
            }
          >
            {standingLabel(invoice)}
          </Badge>
          {Number(invoice.awaiting_approval) > 0 ? (
            <div className="bz-sub">{`${money(invoice.awaiting_approval)} awaiting approval`}</div>
          ) : null}
        </td>
        <td className="bz-actions">
          {canEdit ? (
          <>
          {/* Discounts go on while an invoice is still a draft — the family
              has not seen a figure yet, so nothing they were told changes. */}
          {invoice.status === "draft" && discounts.length ? (
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={discounting}
              onClick={() => {
                setDiscounting((v) => !v);
                setTaking(false);
              }}
            >
              {discounting ? "Cancel" : Number(invoice.discount) > 0 ? "Change discount" : "Discount"}
            </Button>
          ) : null}
          {invoice.status === "draft" ? (
            <Button size="sm" disabled={issuing} onClick={issue}>
              {issuing ? "Issuing..." : "Issue"}
            </Button>
          ) : invoice.status === "issued" && Number(invoice.balance) > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setTaking((v) => !v);
                setDiscounting(false);
              }}
            >
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
          </>
          ) : null}
        </td>
      </tr>
      {discounting ? (
        <tr className="bz-take-row">
          <td colSpan={7}>
            <div className="bz-take">
              <span className="bz-take-title">
                {`Discount for ${who} · billed ${money(gross)}`}
              </span>
              <div className="bz-take-fields">
                <label className="bz-take-field bz-take-wide">
                  <span>{"Discount"}</span>
                  <Select
                    className="select"
                    value={ruleId}
                    placeholder="Choose a discount"
                    onChange={setRuleId}
                    options={discounts.map((d) => ({
                      value: d.id,
                      label: d.items?.length
                        ? `${d.label} — on particular charges`
                        : `${d.label} — ${d.kind === "percent" ? `${Number(d.value)}% off` : `${money(d.value)} off`}`,
                    }))}
                  />
                </label>
                {chosen ? (
                  <span className="bz-take-preview">
                    {itemisedRule && itemisedPreview == null
                      ? "Working it out..."
                      : itemisedRule && previewAmount === 0
                      ? "None of the charges it covers are on this bill"
                      : `− ${money(previewAmount)} · they would pay ${money(Math.max(0, gross - previewAmount))}`}
                  </span>
                ) : null}
                <div className="bz-take-buttons">
                  {Number(invoice.discount) > 0 ? (
                    <Button size="sm" variant="ghost" disabled={applying} onClick={() => applyDiscount(null)}>
                      {"Remove discount"}
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={applying || !ruleId} onClick={() => applyDiscount(ruleId)}>
                    {applying ? "Applying..." : "Apply"}
                  </Button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
      {taking ? (
        <tr className="bz-take-row">
          <td colSpan={7}>
            <div className="bz-take">
              <span className="bz-take-title">
                {`Record a payment for ${who} · ${money(invoice.balance)} owing`}
              </span>
              <div className="bz-take-fields">
                <label className="bz-take-field">
                  <span>{"Amount"}</span>
                  <MoneyInput autoFocus placeholder="0" value={amount} onChange={setAmount} />
                </label>
                <label className="bz-take-field">
                  <span>{"How"}</span>
                  <Select
                    className="select"
                    value={method}
                    onChange={setMethod}
                    options={PAYMENT_METHODS.map(([v, l]) => ({ value: v, label: l }))}
                  />
                </label>
                <label className="bz-take-field">
                  <span>{"Receipt number"}</span>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <div className="bz-take-buttons">
                  <Button size="sm" variant="secondary" onClick={() => setAmount(String(Number(invoice.balance) || ""))}>
                    {"Full balance"}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={take}>
                    {busy ? "Recording..." : "Record payment"}
                  </Button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};

/* ------------------------------------------------------------------ queue */

const Queue = ({ queue, queueContext, money, onChange, onError }) => {
  const { canEdit } = useModuleAccess("bursary");
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
    return (
      <div className="bz-empty">
        <strong>{"Nothing waiting"}</strong>
        <span>{"Every payment a family has declared has been approved or rejected."}</span>
      </div>
    );
  }

  const total = queue.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const noReceipt = queue.filter((p) => !p.proof_path).length;

  return (
    <div className="bz-stack">
      <div className="bz-intro">
        <p>
          {"Payments families say they have made. None has come off a balance yet — that happens when you approve it. Check the money actually arrived before you do."}
        </p>
      </div>
      <div className="bz-queue-summary">
        <ExportButton
          module="bursary"
          roles={["bursar"]}
          filename="payments-waiting"
          sheetName="Payments waiting"
          rows={queue}
          columns={[
            { key: (p) => refOf(p.invoice_id), label: "Bill" },
            { key: (p) => contextOf(p.invoice_id).applicant_name || "", label: "Applicant" },
            { key: "amount", label: "Amount", type: "money" },
            { key: (p) => METHOD_LABEL[p.method] || p.method, label: "Method" },
            { key: "reference", label: "Reference", type: "text" },
            { key: "paid_on", label: "Paid on", type: "date" },
            { key: (p) => (p.proof_path ? "Yes" : "No"), label: "Receipt" },
          ]}
        />
        <span>
          <strong>{queue.length}</strong>
          {` waiting · `}
          <strong>{money(total)}</strong>
          {" declared"}
        </span>
        {noReceipt ? <Badge tone="warn">{`${noReceipt} without a receipt`}</Badge> : null}
      </div>

      {queue.map((p) => {
        const ctx = contextOf(p.invoice_id);
        const isAdmissions = ctx.purpose === "application_fee" || ctx.purpose === "acceptance_fee";
        return (
          <section key={p.id} className="bz-card bz-pay">
            <div className="bz-pay-top">
              <div className="bz-pay-amount">
                <strong>{money(p.amount)}</strong>
                <span className="bz-sub">
                  {[METHOD_LABEL[p.method] || p.method, p.reference ? `ref ${p.reference}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="bz-pay-tags">
                {ctx.purpose ? (
                  <Badge tone={isAdmissions ? "brand" : undefined}>{PURPOSE_LABEL[ctx.purpose] || ctx.purpose}</Badge>
                ) : null}
                {p.proof_path ? (
                  <Button size="sm" variant="secondary" onClick={() => openProof(p.proof_path)}>
                    {"See receipt"}
                  </Button>
                ) : (
                  <Badge tone="warn">{"No receipt attached"}</Badge>
                )}
              </div>
            </div>

            <dl className="bz-pay-facts">
              <div>
                <dt>{"Invoice"}</dt>
                <dd className="bz-ref">{refOf(p.invoice_id)}</dd>
              </div>
              {isAdmissions && ctx.applicant_name ? (
                <div>
                  <dt>{"Applicant"}</dt>
                  <dd>{ctx.applicant_name}</dd>
                </div>
              ) : null}
              <div>
                <dt>{"Paid on"}</dt>
                <dd>{formatDate(p.paid_on, { withTime: false })}</dd>
              </div>
              <div>
                <dt>{"Declared"}</dt>
                <dd>{formatDate(p.submitted_at)}</dd>
              </div>
            </dl>

            {p.note ? <p className="bz-pay-note">{`“${p.note}”`}</p> : null}

            {canEdit ? (
            <div className="bz-pay-decide">
              <input
                className="input"
                placeholder="Note to the family — required to reject, optional to approve"
                value={note[p.id] || ""}
                onChange={(e) => setNote((n) => ({ ...n, [p.id]: e.target.value }))}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === p.id}
                onClick={() => decide(p, false)}
              >
                {"Reject"}
              </Button>
              <Button size="sm" disabled={busy === p.id} onClick={() => decide(p, true)}>
                {busy === p.id ? "Saving..." : "Approve"}
              </Button>
            </div>
            ) : null}
          </section>
        );
      })}
      {preview.node}
    </div>
  );
};

/* ------------------------------------------------------------------- page */

const Bursary = () => {
  const { user } = useAuth();
  const { school, schoolId } = useSchool();
  const money = useMoney(school?.currency);

  const [tab, setTab] = useState("overview");
  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [termId, setTermId] = useState("");
  const [terms, setTerms] = useState([]);
  const [classes, setClasses] = useState([]);
  const [people, setPeople] = useState([]);
  const [structures, setStructures] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [items, setItems] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [queue, setQueue] = useState([]);
  const [queueContext, setQueueContext] = useState({});
  const [debtors, setDebtors] = useState([]);
  const [summary, setSummary] = useState(null);

  const [loading, setLoading] = useState(true);
  const { setError, setNotice } = useActionFeedback();

  // quiet: refresh the data underneath without swapping the tab for a
  // skeleton. Flipping `loading` unmounts the panel below, and the panels
  // hold their own form state — which structure's "Add a line" box is open,
  // what is half-typed in it. Tearing that down mid-edit is how a second
  // click on Add landed on a component that no longer existed and was lost
  // with no message. The skeleton belongs to the first load and to changing
  // the term filter; after an action the rows simply update in place.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!schoolId) return;
    if (!quiet) setLoading(true);
    try {
      const [t, c, m, s, cat, inv, q, d, sum, rules] = await Promise.all([
        fetchTerms(schoolId).catch(() => []),
        fetchClasses(schoolId).catch(() => []),
        fetchSchoolMembers(schoolId).catch(() => []),
        fetchFeeStructures(schoolId),
        fetchFeeCatalogue(schoolId).catch(() => []),
        fetchSchoolInvoices({ schoolId, termId: termId || null }),
        fetchPaymentQueue(schoolId),
        fetchDebtors({ schoolId, termId: termId || null }),
        fetchCollectionSummary({ schoolId, termId: termId || null }),
        // Active rules only: a switched-off rule cannot be applied (the
        // database refuses it), so it is not offered.
        fetchDiscountRules(schoolId).catch(() => []),
      ]);
      setTerms(t);
      setClasses(c);
      setPeople(m);
      setStructures(s);
      setCatalogue(cat);
      setItems(await fetchFeeItems(s.map((r) => r.id)).catch(() => ({})));
      setInvoices(inv);
      setQueue(q);
      // Independent of the term filter above — an admissions invoice
      // always has term_id null, so reusing `inv` here would show "—" for
      // one of these whenever a term is selected.
      setQueueContext(await fetchPaymentQueueContext(q.map((p) => p.invoice_id)).catch(() => ({})));
      setDebtors(d);
      setSummary(sum);
      setDiscounts(rules);
    } catch (err) {
      setError(err.message || "Could not load the bursary.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [schoolId, termId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = (message) => {
    setNotice(message || "");
    load({ quiet: true });
  };

  const termName = terms.find((t) => t.id === termId)?.name;
  const draftCount = invoices.filter((i) => i.status === "draft").length;
  const queueTotal = queue.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // From an Overview action to the place it is dealt with, with the invoice
  // filter already on the right list.
  const goTo = (nextTab, filter) => {
    if (filter) setInvoiceFilter(filter);
    setTab(nextTab);
  };

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

        {loading && tab === "overview" ? (
          <>
            <div className="panel-top">
              <SkeletonStatRow count={4} />
            </div>
            <SkeletonTable rows={5} cols={7} />
          </>
        ) : null}
        {loading && tab === "structures" ? <SkeletonCards count={3} lines={3} /> : null}
        {loading && tab === "invoices" ? <SkeletonTable rows={5} cols={7} /> : null}
        {loading && tab === "queue" ? <SkeletonList rows={4} avatar={false} /> : null}

        {!loading && tab === "overview" ? (
          <Overview
            summary={summary}
            debtors={debtors}
            money={money}
            termName={termName}
            draftCount={draftCount}
            queueCount={queue.length}
            queueTotal={queueTotal}
            onGo={goTo}
          />
        ) : null}

        {!loading && tab === "structures" ? (
          <Structures
            schoolId={schoolId}
            userId={user?.id}
            terms={terms}
            classes={classes}
            structures={structures}
            catalogue={catalogue}
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
            filter={invoiceFilter}
            setFilter={setInvoiceFilter}
            discounts={discounts}
            term={terms.find((t) => t.id === termId) || null}
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
