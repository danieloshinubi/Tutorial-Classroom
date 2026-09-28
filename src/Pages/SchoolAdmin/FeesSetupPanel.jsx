import React, { useCallback, useEffect, useState } from "react";
import { Card, Field, Button, Tabs, Select, MoneyInput } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { useConfirm } from "../../Components/Confirm";
import { useSchool } from "../../context/SchoolContext";
import { useMoney } from "../../lib/money";
import {
  fetchFeeCatalogue,
  upsertFeeCatalogueItem,
  deleteFeeCatalogueItem,
  fetchDiscountRules,
  upsertDiscountRule,
  deleteDiscountRule,
} from "../../lib/api";

// Where a school names the things it charges for and the discounts it gives,
// once, instead of retyping them into every term's fee structure.
//
// Both lists show switched-off rows too: a retired charge is still referenced
// by last term's invoices, so it is deactivated rather than deleted, and a
// bursar wondering "why can't I pick WAEC" needs to see that it is off rather
// than missing.

const CATEGORIES = [
  { value: "", label: "No category" },
  { value: "tuition", label: "Tuition" },
  { value: "exam", label: "Exams" },
  { value: "material", label: "Materials" },
  { value: "activity", label: "Activities" },
  { value: "other", label: "Other" },
];

// The table must show the label the user picked. Showing the stored value
// instead turned "Exams" into "Exam" and "Activities" into "Activity" the
// moment a row saved, so the list disagreed with the dropdown above it.
const categoryLabel = (value) =>
  CATEGORIES.find((c) => c.value === (value || ""))?.label || value || "—";

// Postgres reports a duplicate as 23505 with the constraint name in the text.
// Surfacing that verbatim ("duplicate key value violates unique constraint
// fee_catalogue_label_once") tells a bursar nothing and reads like a crash.
const friendlyError = (err, noun) => {
  if (err?.code === "23505" || /duplicate key|already exists/i.test(err?.message || "")) {
    return `There is already a ${noun} with that name. Names are matched ignoring case and spacing.`;
  }
  if (err?.code === "23514" || /violates check constraint/i.test(err?.message || "")) {
    return "That value isn't allowed. Check the amount or percentage.";
  }
  return err?.message || "Could not save that.";
};

// One row of fields, then the button, on a fixed grid. A flex row let the
// button jump sideways whenever the category dropdown resized, which made the
// Add button move out from under the pointer mid-click.
const formGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(160px, 1.4fr) minmax(130px, 1fr) minmax(140px, 1fr) auto",
  gap: 12,
  alignItems: "end",
  marginBottom: 18,
};

const intro = { marginTop: 0, marginBottom: 16, color: "var(--ink-3)", fontSize: 14 };
const emptyNote = { color: "var(--ink-3)", fontSize: 13, margin: "6px 2px" };
// Dimming the whole <tr> dimmed the buttons too, so "Switch on" — the one
// control you need on a switched-off row — looked disabled.
const dimCell = { opacity: 0.55 };
// Holds the height of the "Editing …" line whether or not it has text.
const editingLine = { margin: "0 0 10px", fontSize: 13, color: "var(--brand-dark)", minHeight: 18 };
// Columns keep their width as rows come and go, so the action buttons stay put.
const fixedTable = { tableLayout: "fixed" };


/* ------------------------------------------------------------------ charges */

const blankFee = { id: null, label: "", defaultAmount: "", category: "", isActive: true };

const FeeCatalogue = ({ schoolId, currency }) => {
  const money = useMoney(currency);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(blankFee);
  // Toasts, not an inline Notice: the message pops in the corner instead of
  // appearing above the form and shoving every field down as it renders.
  const { setError } = useActionFeedback();
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    fetchFeeCatalogue(schoolId, { includeInactive: true })
      .then(setRows)
      .catch((err) => setError(err.message || "Could not load the charges."));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  // Any edit to the form clears a stale error. Without this the duplicate
  // message stayed on screen through unrelated actions and looked like the
  // next thing had failed too.
  const edit = (patch) => {
    setError("");
    setDraft((d) => ({ ...d, ...patch }));
  };

  const startEdit = async (row) => {
    // Loading a row into the form silently discarded whatever was half-typed.
    if (!draft.id && draft.label.trim() && draft.label.trim() !== row.label) {
      const ok = await confirmAction({
        title: "Discard what you're typing?",
        body: `You have "${draft.label.trim()}" unsaved. Editing ${row.label} will clear it.`,
        confirmLabel: "Discard and edit",
        cancelLabel: "Keep typing",
      });
      if (!ok) return;
    }
    setError("");
    setDraft({
      id: row.id,
      label: row.label,
      defaultAmount: row.default_amount ?? "",
      category: row.category || "",
      isActive: row.is_active,
    });
  };

  const save = async (event) => {
    event?.preventDefault();
    if (!draft.label.trim()) return;
    setBusy(true);
    setError("");
    try {
      await upsertFeeCatalogueItem({ ...draft, schoolId, label: draft.label.trim() });
      setDraft(blankFee);
      load();
    } catch (err) {
      setError(friendlyError(err, "charge"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row) => {
    setError("");
    try {
      await upsertFeeCatalogueItem({
        id: row.id,
        schoolId,
        label: row.label,
        defaultAmount: row.default_amount,
        category: row.category,
        isActive: !row.is_active,
      });
      load();
    } catch (err) {
      setError(friendlyError(err, "charge"));
    }
  };

  const remove = async (row) => {
    const ok = await confirmAction({
      title: `Delete “${row.label}”?`,
      body: "This can't be undone. If it has already been used on an invoice, switch it off instead — that keeps the history and hides it from new bills.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteFeeCatalogueItem(row.id);
      if (draft.id === row.id) setDraft(blankFee);
      load();
    } catch (err) {
      setError(
        `${row.label} is already used on an invoice, so it can't be deleted. Switch it off instead — existing bills keep it.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <p style={intro}>
        {"The charges this school raises — WAEC, PTA, extra coaching, the end-of-session party. Name them once here and pick them when building a term's fees. The amount is a default you can still change per term."}
      </p>

      <form onSubmit={save}>
        {/* Always rendered, blank when not editing: showing it only while
            editing pushed every field down 30px the moment Edit was clicked. */}
        <p style={editingLine}>
          {draft.id ? `Editing “${rows.find((r) => r.id === draft.id)?.label || draft.label}”` : ""}
        </p>
        <div style={formGrid}>
          <Field label="Charge">
            <input
              className="input"
              placeholder="e.g. WAEC"
              value={draft.label}
              onChange={(e) => edit({ label: e.target.value })}
            />
          </Field>
          {/* "Optional" lives in the label, not a hint underneath — a hint on
              one field of a row pushes that field's input out of line with
              its neighbours. */}
          <Field label="Usual amount (optional)">
            <MoneyInput
              placeholder="45,000"
              value={draft.defaultAmount}
              onChange={(raw) => edit({ defaultAmount: raw })}
            />
          </Field>
          <Field label="Category">
            <Select
              value={draft.category}
              onChange={(value) => edit({ category: value })}
              options={CATEGORIES}
            />
          </Field>
          <div className="btn-row">
            <Button type="submit" size="sm" disabled={!draft.label.trim() || busy}>
              {busy ? "Saving..." : draft.id ? "Save" : "Add"}
            </Button>
            {draft.id ? (
              <Button size="sm" variant="secondary" onClick={() => { setError(""); setDraft(blankFee); }}>
                {"Cancel"}
              </Button>
            ) : null}
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <p style={emptyNote}>{"No charges yet. Add the first one above."}</p>
      ) : (
        <div className="table-wrap table-wrap-plain">
          <table className="data" style={fixedTable}>
            <colgroup>
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 250 }} />
            </colgroup>
            <thead>
              <tr>
                <th>{"Charge"}</th>
                <th>{"Usual amount"}</th>
                <th>{"Category"}</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  style={draft.id === row.id ? { background: "var(--brand-soft)" } : undefined}
                >
                  <td style={row.is_active ? undefined : dimCell}>
                    {row.label}
                    {row.is_active ? null : (
                      <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink-3)" }}>{"(off)"}</span>
                    )}
                  </td>
                  <td style={row.is_active ? undefined : dimCell}>
                    {row.default_amount == null ? "—" : money(row.default_amount)}
                  </td>
                  <td style={row.is_active ? undefined : dimCell}>{categoryLabel(row.category)}</td>
                  <td>
                    <div className="btn-row">
                      <Button size="sm" variant="secondary" onClick={() => startEdit(row)}>{"Edit"}</Button>
                      <Button size="sm" variant="secondary" onClick={() => toggle(row)}>
                        {row.is_active ? "Switch off" : "Switch on"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => remove(row)}>
                        {"Delete"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </Card>
  );
};

/* ---------------------------------------------------------------- discounts */

const blankRule = { id: null, label: "", kind: "percent", value: "", isActive: true };

const DiscountRules = ({ schoolId, currency }) => {
  const money = useMoney(currency);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(blankRule);
  // Toasts, not an inline Notice: the message pops in the corner instead of
  // appearing above the form and shoving every field down as it renders.
  const { setError } = useActionFeedback();
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    fetchDiscountRules(schoolId, { includeInactive: true })
      .then(setRows)
      .catch((err) => setError(err.message || "Could not load discounts."));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  const edit = (patch) => {
    setError("");
    setDraft((d) => ({ ...d, ...patch }));
  };

  // Switching percent -> fixed kept the old number, so "150" silently became
  // ₦150. The two kinds are not the same quantity, so the value resets.
  const changeKind = (kind) => {
    setError("");
    setDraft((d) => ({ ...d, kind, value: "" }));
  };

  const startEdit = async (row) => {
    if (!draft.id && draft.label.trim() && draft.label.trim() !== row.label) {
      const ok = await confirmAction({
        title: "Discard what you're typing?",
        body: `You have "${draft.label.trim()}" unsaved. Editing ${row.label} will clear it.`,
        confirmLabel: "Discard and edit",
        cancelLabel: "Keep typing",
      });
      if (!ok) return;
    }
    setError("");
    setDraft({ id: row.id, label: row.label, kind: row.kind, value: row.value, isActive: row.is_active });
  };

  const save = async (event) => {
    event?.preventDefault();
    if (!draft.label.trim() || draft.value === "") return;
    if (draft.kind === "percent" && Number(draft.value) > 100) {
      setError("A percentage discount can't be more than 100.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await upsertDiscountRule({ ...draft, schoolId, label: draft.label.trim() });
      setDraft(blankRule);
      load();
    } catch (err) {
      setError(friendlyError(err, "discount"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row) => {
    setError("");
    try {
      await upsertDiscountRule({
        id: row.id,
        schoolId,
        label: row.label,
        kind: row.kind,
        value: row.value,
        isActive: !row.is_active,
      });
      load();
    } catch (err) {
      setError(friendlyError(err, "discount"));
    }
  };

  const remove = async (row) => {
    const ok = await confirmAction({
      title: `Delete “${row.label}”?`,
      body: "This can't be undone. If it has already been used on an invoice, switch it off instead — that keeps the history and hides it from new bills.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteDiscountRule(row.id);
      if (draft.id === row.id) setDraft(blankRule);
      load();
    } catch (err) {
      setError(`${row.label} has been used on an invoice, so it can't be deleted. Switch it off instead.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <p style={intro}>
        {"Discounts the school gives — a staff child, a second sibling, a parent who works here. Defined once, the amount is worked out from the bill itself, so nobody calculates it per invoice."}
      </p>

      <form onSubmit={save}>
        {/* Always rendered, blank when not editing: showing it only while
            editing pushed every field down 30px the moment Edit was clicked. */}
        <p style={editingLine}>
          {draft.id ? `Editing “${rows.find((r) => r.id === draft.id)?.label || draft.label}”` : ""}
        </p>
        <div style={formGrid}>
          <Field label="Discount">
            <input
              className="input"
              placeholder="e.g. Staff child"
              value={draft.label}
              onChange={(e) => edit({ label: e.target.value })}
            />
          </Field>
          <Field label="Type">
            <Select
              value={draft.kind}
              onChange={changeKind}
              options={[
                { value: "percent", label: "Percentage off" },
                { value: "fixed", label: "Fixed amount off" },
              ]}
            />
          </Field>
          <Field label={draft.kind === "percent" ? "Percent (max 100)" : "Amount"}>
            {draft.kind === "percent" ? (
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="50"
                value={draft.value}
                onChange={(e) => edit({ value: e.target.value })}
              />
            ) : (
              <MoneyInput
                placeholder="5,000"
                value={draft.value}
                onChange={(raw) => edit({ value: raw })}
              />
            )}
          </Field>
          <div className="btn-row">
            <Button type="submit" size="sm" disabled={!draft.label.trim() || draft.value === "" || busy}>
              {busy ? "Saving..." : draft.id ? "Save" : "Add"}
            </Button>
            {draft.id ? (
              <Button size="sm" variant="secondary" onClick={() => { setError(""); setDraft(blankRule); }}>
                {"Cancel"}
              </Button>
            ) : null}
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <p style={emptyNote}>{"No discounts yet. Add the first one above."}</p>
      ) : (
        <div className="table-wrap table-wrap-plain">
          <table className="data" style={fixedTable}>
            <colgroup>
              <col />
              <col style={{ width: 160 }} />
              <col style={{ width: 250 }} />
            </colgroup>
            <thead>
              <tr>
                <th>{"Discount"}</th>
                <th>{"Takes off"}</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  style={draft.id === row.id ? { background: "var(--brand-soft)" } : undefined}
                >
                  <td style={row.is_active ? undefined : dimCell}>
                    {row.label}
                    {row.is_active ? null : (
                      <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink-3)" }}>{"(off)"}</span>
                    )}
                  </td>
                  <td style={row.is_active ? undefined : dimCell}>
                    {row.kind === "percent" ? `${Number(row.value)}%` : money(row.value)}
                  </td>
                  <td>
                    <div className="btn-row">
                      <Button size="sm" variant="secondary" onClick={() => startEdit(row)}>{"Edit"}</Button>
                      <Button size="sm" variant="secondary" onClick={() => toggle(row)}>
                        {row.is_active ? "Switch off" : "Switch on"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => remove(row)}>
                        {"Delete"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </Card>
  );
};

const FeesSetupPanel = () => {
  const { school } = useSchool();
  const [tab, setTab] = useState("catalogue");

  return (
    <>
      <Tabs
        tabs={[
          { id: "catalogue", label: "Charges" },
          { id: "discounts", label: "Discounts" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ marginTop: 14 }}>
        {tab === "catalogue" ? <FeeCatalogue schoolId={school?.id} currency={school?.currency} /> : null}
        {tab === "discounts" ? <DiscountRules schoolId={school?.id} currency={school?.currency} /> : null}
      </div>
    </>
  );
};

export default FeesSetupPanel;
