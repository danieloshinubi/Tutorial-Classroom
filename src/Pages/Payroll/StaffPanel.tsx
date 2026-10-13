import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MoneyInput, Select, DatePicker, Switch, displayName, type Profile } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import { savePayrollStaff, saveStaffDeduction, deleteStaffDeduction } from "../../lib/api";
import { previewPay, staffPay, type PayBreakdown, type PayFigures } from "../../lib/payrollApi";

// Payroll → Staff (2026-10-13): the list, and one person in a panel that
// slides in from the right when their row is clicked, as School admin →
// People does. The panel leads with what they take home each month, worked
// out by the same calculation a payroll run uses (supabase/257) and updated
// as the figures are typed, with the full breakdown beside the pay: gross,
// pension, the housing fund, tax, their own loans and savings, and net.

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRow = Record<string, any>;
export interface Labels {
  tax: string;
  pension: string;
  fund: string;
  nigeria: boolean;
  rentRelief: boolean;
  fundInUse: boolean;
  pensionStaff: number;
  pensionSchool: number;
}
type Money = (n: number) => string;

const num = (v: unknown) => Number(v || 0);
const blank: AnyRow = {
  id: null, user_id: "", full_name: "", job_title: "", start_date: "", end_date: "", is_active: true,
  basic: "", housing: "", transport: "", other_allowances: [], pension_applies: true, nhf_applies: false,
  annual_rent: "", bank_name: "", account_number: "", account_name: "", tin: "", pension_provider: "", rsa_pin: "", notes: "",
};
export const blankStaff = blank;

const figuresOf = (f: AnyRow): PayFigures => ({
  basic: num(f.basic),
  housing: num(f.housing),
  transport: num(f.transport),
  other_allowances: (f.other_allowances || []).filter((a: AnyRow) => num(a.amount) > 0).map((a: AnyRow) => ({ label: a.label || "Allowance", amount: num(a.amount) })),
  pension_applies: !!f.pension_applies,
  nhf_applies: !!f.nhf_applies,
  annual_rent: num(f.annual_rent),
});

/* ------------------------------------------------------------ small parts */
const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const I = {
  close: "M18 6 6 18M6 6l12 12",
  pay: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  tax: "M9 14l6-6M9.5 8.5h.01M14.5 13.5h.01M5 3h14a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2z",
  bank: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3",
  ded: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12h8",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 18 6-6-6-6",
};
const input =
  "tw-h-10 tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-text-[14px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]";

const Field = ({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) => (
  <label className={`tw-flex tw-min-w-0 tw-flex-col tw-gap-1 ${wide ? "tw-col-span-2 mobile:tw-col-span-1" : ""}`}>
    <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{label}</span>
    {children}
    {hint ? <span className="tw-text-[12px] tw-text-ink-3">{hint}</span> : null}
  </label>
);

const Section = ({ icon, title, children, action }: { icon: string; title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 tw-shadow-1">
    <header className="tw-mb-4 tw-flex tw-items-center tw-gap-3">
      <span className="tw-inline-flex tw-h-8 tw-w-8 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-text-brand">
        <Svg d={icon} size={15} />
      </span>
      <h3 className="tw-m-0 tw-flex-1 tw-text-[15px] tw-font-semibold tw-text-ink">{title}</h3>
      {action}
    </header>
    {children}
  </section>
);

const Chip = ({ tone, children }: { tone: "good" | "muted" | "brand" | "warn"; children: React.ReactNode }) => (
  <span
    className={`tw-inline-flex tw-items-center tw-rounded-full tw-px-2.5 tw-py-0.5 tw-text-[12px] tw-font-semibold ${
      tone === "good" ? "tw-bg-success-soft tw-text-success" : tone === "brand" ? "tw-bg-brand-soft tw-text-brand" : tone === "warn" ? "tw-bg-warn-soft tw-text-warn-ink" : "tw-bg-bg tw-text-ink-2"
    }`}
  >
    {children}
  </span>
);

const initialsOf = (name: string) =>
  name
    .replace(/^(mr|mrs|ms|miss|dr|prof|engr|chief)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

const Avatar = ({ name, size = 40 }: { name: string; size?: number }) => (
  <span
    className="tw-inline-flex tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-font-bold tw-text-brand"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    aria-hidden="true"
  >
    {initialsOf(name)}
  </span>
);

/* --------------------------------------------------------- the breakdown */
const Line = ({ label, value, minus, strong, muted }: { label: string; value: string; minus?: boolean; strong?: boolean; muted?: boolean }) => (
  <div className={`tw-flex tw-items-baseline tw-justify-between tw-gap-3 tw-py-1.5 ${strong ? "tw-text-[15px] tw-font-bold tw-text-ink" : muted ? "tw-text-[13px] tw-text-ink-3" : "tw-text-[13.5px] tw-text-ink"}`}>
    <span className="tw-min-w-0">{label}</span>
    <span className={`tw-shrink-0 tw-tabular-nums ${minus ? "tw-text-danger" : ""}`}>{minus ? `− ${value}` : value}</span>
  </div>
);

const Breakdown = ({ b, money, labels, loading }: { b: PayBreakdown | null; money: Money; labels: Labels; loading: boolean }) => {
  if (!b) return <p className="tw-m-0 tw-text-[13px] tw-text-ink-3">{loading ? "Working it out…" : "Enter the pay to see the breakdown."}</p>;
  const pensionPct = labels.pensionStaff ? ` (${labels.pensionStaff}%)` : "";
  return (
    <div className={`tw-transition-opacity ${loading ? "tw-opacity-60" : ""}`}>
      {b.earnings.map((e) => (
        <Line key={e.label} label={e.label} value={money(e.amount)} />
      ))}
      <div className="tw-my-1 tw-border-0 tw-border-t tw-border-solid tw-border-line" />
      <Line label="Gross pay" value={money(b.gross)} strong />
      {b.pension_employee > 0 ? <Line label={`${labels.pension}${pensionPct}`} value={money(b.pension_employee)} minus /> : null}
      {b.nhf > 0 ? <Line label={labels.fund} value={money(b.nhf)} minus /> : null}
      <Line label={labels.tax} value={money(b.paye)} minus={b.paye > 0} />
      {b.deductions.map((d) => (
        <Line key={d.label} label={d.label} value={money(d.amount)} minus />
      ))}
      <div className="tw-mt-2 tw-flex tw-items-baseline tw-justify-between tw-rounded-xl tw-bg-success-soft tw-px-4 tw-py-3">
        <span className="tw-text-[14px] tw-font-semibold tw-text-success">{"Net pay a month"}</span>
        <span className="tw-text-[22px] tw-font-bold tw-tabular-nums tw-text-success">{money(b.net)}</span>
      </div>
      {b.pension_employer > 0 ? (
        <p className="tw-m-0 tw-mt-2 tw-text-[12.5px] tw-text-ink-3">{`The school also pays ${money(b.pension_employer)} a month into their ${labels.pension.toLowerCase()}${labels.pensionSchool ? ` (${labels.pensionSchool}%)` : ""}, on top of their pay.`}</p>
      ) : null}
      {b.rent_relief > 0 ? <p className="tw-m-0 tw-mt-1 tw-text-[12.5px] tw-text-ink-3">{`Rent relief lowers their ${labels.tax} by counting ${money(b.rent_relief)} of their yearly pay as tax-free.`}</p> : null}
      <p className="tw-m-0 tw-mt-1 tw-text-[12px] tw-text-ink-3">{"A full month. A payroll run pays less for a month someone joins or leaves part-way."}</p>
    </div>
  );
};

/* ----------------------------------------------------------- the panel */
type Tab = "pay" | "tax" | "bank" | "deductions" | "details";

const StaffPanel = ({
  schoolId,
  initial,
  members,
  types,
  deductions,
  money,
  labels,
  canEdit,
  onClose,
  onSaved,
}: {
  schoolId: string;
  initial: AnyRow;
  members: AnyRow[];
  types: AnyRow[];
  deductions: AnyRow[];
  money: Money;
  labels: Labels;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const start = useMemo(() => ({ ...blank, ...initial, other_allowances: initial?.other_allowances || [] }), [initial]);
  const [f, setF] = useState<AnyRow>(start);
  const [tab, setTab] = useState<Tab>("pay");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [b, setB] = useState<PayBreakdown | null>(null);
  const [working, setWorking] = useState(false);
  const [newDed, setNewDed] = useState({ type_id: "", kind: "fixed", value: "", balance: "" });
  const set = (patch: AnyRow) => setF((x) => ({ ...x, ...patch }));
  // Saved (or a new person's first save): the form takes what was stored.
  const version = `${initial?.id || ""}|${initial?.updated_at || ""}`;
  useEffect(() => {
    setF(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const mine = deductions.filter((d) => d.staff_id === f.id);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);

  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 10);
    return () => window.clearTimeout(t);
  }, []);

  // The breakdown, a moment after each change to the pay.
  const figures = JSON.stringify(figuresOf(f));
  const dedKey = mine.map((d) => `${d.id}:${d.is_active}:${d.value}:${d.kind}`).join(",");
  useEffect(() => {
    let live = true;
    setWorking(true);
    const t = window.setTimeout(() => {
      previewPay(schoolId, f.id || null, JSON.parse(figures))
        .then((r) => live && setB(r))
        .catch(() => live && setB(null))
        .finally(() => live && setWorking(false));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [schoolId, f.id, figures, dedKey]);

  const close = async () => {
    if (dirty && !(await confirmDialog({ title: "Close without saving?", body: "Your changes to this person are not saved.", confirmLabel: "Close", tone: "danger" }))) return;
    setShown(false);
    window.setTimeout(onClose, 200);
  };

  const save = async () => {
    if (!f.full_name.trim()) {
      setTab("details");
      return setError("Enter the staff member's name.");
    }
    setBusy(true);
    try {
      const row: AnyRow = {
        id: f.id || undefined,
        school_id: schoolId,
        user_id: f.user_id || null,
        full_name: f.full_name.trim(),
        job_title: f.job_title || null,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        is_active: f.is_active,
        ...figuresOf(f),
        bank_name: f.bank_name || null,
        account_number: f.account_number || null,
        account_name: f.account_name || null,
        tin: f.tin || null,
        pension_provider: f.pension_provider || null,
        rsa_pin: f.rsa_pin || null,
        notes: f.notes || null,
      };
      if (!row.id) delete row.id;
      const id = await savePayrollStaff({ id: undefined, ...row });
      setNotice(`${row.full_name} saved.`);
      await onSaved(id);
    } catch (err) {
      const m = (err as Error).message || "";
      setError(/payroll_staff_user_once/.test(m) ? "That login already belongs to another staff record." : m || "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const addDeduction = async () => {
    if (!newDed.type_id || !(num(newDed.value) > 0)) return setError("Choose a deduction and an amount.");
    try {
      await saveStaffDeduction({
        id: undefined,
        school_id: schoolId,
        staff_id: f.id,
        type_id: newDed.type_id,
        kind: newDed.kind,
        value: num(newDed.value),
        balance: newDed.balance === "" ? null : num(newDed.balance),
      });
      setNewDed({ type_id: "", kind: "fixed", value: "", balance: "" });
      await onSaved(f.id);
    } catch (err) {
      setError((err as Error).message || "Could not add the deduction.");
    }
  };

  const memberOptions = [
    { value: "", label: "No Schoolivio login" },
    ...members
      .filter((m) => !["parent", "student"].includes(m.role))
      .map((m) => ({ value: m.user_id, label: `${displayName(m.profiles as Profile)} · ${m.role}` })),
  ];

  const tabs: { id: Tab; label: string }[] = [
    { id: "pay", label: "Pay" },
    { id: "tax", label: labels.nigeria ? "Tax & pension" : "Tax & pension" },
    { id: "bank", label: "Bank" },
    { id: "deductions", label: "Deductions" },
    { id: "details", label: "Details" },
  ];
  const name = f.full_name.trim() || "New staff member";
  const ro = !canEdit;

  return createPortal(
    <div className="tw-fixed tw-inset-0 tw-z-[150] [font-family:inherit]">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className={`tw-absolute tw-inset-0 tw-border-0 tw-bg-[rgb(15_23_42_/_0.4)] tw-backdrop-blur-[2px] tw-cursor-default tw-transition-opacity tw-duration-200 ${shown ? "tw-opacity-100" : "tw-opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-label={name}
        className={`tw-absolute tw-right-0 tw-top-0 tw-flex tw-h-full tw-w-[min(780px,100vw)] tw-flex-col tw-bg-bg tw-shadow-3 tw-transition-transform tw-duration-300 tw-ease-out ${shown ? "tw-translate-x-0" : "tw-translate-x-full"}`}
      >
        {/* Header: who, and what they take home. */}
        <div className="tw-relative tw-shrink-0 tw-bg-surface tw-shadow-1">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="tw-absolute tw-right-4 tw-top-4 tw-inline-flex tw-h-9 tw-w-9 tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-transparent tw-text-ink-2 tw-cursor-pointer hover:tw-bg-bg hover:tw-text-ink"
          >
            <Svg d={I.close} size={18} />
          </button>
          <div className="tw-px-7 tw-pt-7 mobile:tw-px-5">
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-4 tw-pr-10">
              <Avatar name={name} size={64} />
              <div className="tw-min-w-0 tw-flex-1">
                <div className="tw-mb-1 tw-flex tw-flex-wrap tw-gap-1.5">
                  {f.id ? (f.is_active ? <Chip tone="good">{"On payroll"}</Chip> : <Chip tone="muted">{"Not on payroll"}</Chip>) : <Chip tone="brand">{"New"}</Chip>}
                  {f.user_id ? <Chip tone="brand">{"Sees own payslips"}</Chip> : null}
                  {!f.bank_name || !f.account_number ? <Chip tone="warn">{"No bank details"}</Chip> : null}
                </div>
                <h2 className="tw-m-0 tw-truncate tw-text-[22px] tw-font-bold tw-leading-tight tw-text-ink">{name}</h2>
                <div className="tw-mt-0.5 tw-text-[14px] tw-text-ink-2">{f.job_title || "No job title"}</div>
              </div>
              <div className="tw-flex tw-flex-col tw-items-end tw-rounded-2xl tw-bg-success-soft tw-px-4 tw-py-2.5 mobile:tw-w-full mobile:tw-items-start">
                <span className="tw-text-[11.5px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-success">{"Net pay a month"}</span>
                <span className="tw-text-[24px] tw-font-bold tw-leading-tight tw-tabular-nums tw-text-success">{b ? money(b.net) : "—"}</span>
                <span className="tw-text-[12px] tw-text-ink-2">{b ? `of ${money(b.gross)} gross` : ""}</span>
              </div>
            </div>
            <div role="tablist" className="tw-mt-5 tw-inline-flex tw-max-w-full tw-gap-1 tw-overflow-x-auto tw-rounded-full tw-bg-bg tw-p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`tw-whitespace-nowrap tw-rounded-full tw-border-0 tw-px-4 tw-py-1.5 tw-text-[13.5px] tw-cursor-pointer [font-family:inherit] ${
                    tab === t.id ? "tw-bg-surface tw-font-semibold tw-text-brand tw-shadow-1" : "tw-bg-transparent tw-font-medium tw-text-ink-2 hover:tw-text-ink"
                  }`}
                >
                  {t.label}
                  {t.id === "deductions" && mine.length ? ` (${mine.length})` : ""}
                </button>
              ))}
            </div>
            <div className="tw-h-4" />
          </div>
        </div>

        {/* Body */}
        <fieldset disabled={ro} className="tw-m-0 tw-min-h-0 tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-border-0 tw-px-7 tw-py-5 mobile:tw-px-4">
          <div className="tw-flex tw-flex-col tw-gap-4">
            {tab === "pay" ? (
              <>
                <Section icon={I.pay} title="Monthly pay">
                  <div className="tw-grid tw-grid-cols-3 tw-gap-3 mobile:tw-grid-cols-1">
                    <Field label="Basic salary"><MoneyInput value={f.basic} onChange={(v) => set({ basic: v })} placeholder="0" /></Field>
                    <Field label="Housing"><MoneyInput value={f.housing} onChange={(v) => set({ housing: v })} placeholder="0" /></Field>
                    <Field label="Transport"><MoneyInput value={f.transport} onChange={(v) => set({ transport: v })} placeholder="0" /></Field>
                  </div>
                  {f.other_allowances.length ? (
                    <div className="tw-mt-3 tw-flex tw-flex-col tw-gap-2">
                      {f.other_allowances.map((a: AnyRow, i: number) => (
                        <div key={i} className="tw-grid tw-grid-cols-[1fr_180px_auto] tw-items-center tw-gap-2 mobile:tw-grid-cols-1">
                          <input className={input} placeholder="Allowance, e.g. Responsibility" value={a.label} onChange={(e) => set({ other_allowances: f.other_allowances.map((x: AnyRow, j: number) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                          <MoneyInput placeholder="0" value={a.amount} onChange={(v) => set({ other_allowances: f.other_allowances.map((x: AnyRow, j: number) => (j === i ? { ...x, amount: v } : x)) })} />
                          <button type="button" className="tw-rounded-full tw-border-0 tw-bg-transparent tw-px-3 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-text-danger tw-cursor-pointer hover:tw-bg-danger-soft [font-family:inherit]" onClick={() => set({ other_allowances: f.other_allowances.filter((_: AnyRow, j: number) => j !== i) })}>
                            {"Remove"}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {!ro ? (
                    <button type="button" onClick={() => set({ other_allowances: [...f.other_allowances, { label: "", amount: "" }] })} className="tw-mt-3 tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3.5 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-text-ink tw-cursor-pointer hover:tw-border-brand hover:tw-text-brand [font-family:inherit]">
                      <Svg d={I.plus} size={13} />
                      {"Add an allowance"}
                    </button>
                  ) : null}
                </Section>
                <Section icon={I.tax} title="What they take home">
                  <Breakdown b={b} money={money} labels={labels} loading={working} />
                </Section>
              </>
            ) : tab === "tax" ? (
              <Section icon={I.tax} title="Tax and pension">
                <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
                  {labels.rentRelief ? (
                    <Field label="Yearly rent paid" hint={`Lowers their ${labels.tax} (rent relief). Leave 0 if none.`}>
                      <MoneyInput value={f.annual_rent} onChange={(v) => set({ annual_rent: v })} placeholder="0" />
                    </Field>
                  ) : null}
                  <Field label={labels.nigeria ? "Tax ID (TIN)" : "Tax ID"}><input className={input} value={f.tin || ""} onChange={(e) => set({ tin: e.target.value })} /></Field>
                  <Field label={labels.nigeria ? "Pension provider (PFA)" : "Pension provider"}><input className={input} value={f.pension_provider || ""} onChange={(e) => set({ pension_provider: e.target.value })} /></Field>
                  <Field label={labels.nigeria ? "RSA PIN" : "Pension number"}><input className={input} value={f.rsa_pin || ""} onChange={(e) => set({ rsa_pin: e.target.value })} /></Field>
                </div>
                <div className="tw-mt-4 tw-flex tw-flex-wrap tw-gap-5">
                  <Switch compact label={labels.nigeria ? "Contributory pension" : labels.pension} checked={f.pension_applies} onChange={(v) => set({ pension_applies: v })} />
                  {labels.fundInUse || f.nhf_applies ? <Switch compact label={`Contributes to ${labels.fund}`} checked={f.nhf_applies} onChange={(v) => set({ nhf_applies: v })} /> : null}
                </div>
                <div className="tw-mt-5 tw-rounded-xl tw-bg-bg tw-p-4">
                  <Breakdown b={b} money={money} labels={labels} loading={working} />
                </div>
              </Section>
            ) : tab === "bank" ? (
              <Section icon={I.bank} title="Where their pay goes">
                <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
                  <Field label="Bank"><input className={input} value={f.bank_name || ""} onChange={(e) => set({ bank_name: e.target.value })} /></Field>
                  <Field label="Account number"><input className={input} inputMode="numeric" value={f.account_number || ""} onChange={(e) => set({ account_number: e.target.value })} /></Field>
                  <Field label="Account name" wide><input className={input} value={f.account_name || ""} onChange={(e) => set({ account_name: e.target.value })} /></Field>
                </div>
              </Section>
            ) : tab === "deductions" ? (
              <Section icon={I.ded} title="Loans, savings and other deductions">
                {!f.id ? (
                  <p className="tw-m-0 tw-text-[13.5px] tw-text-ink-3">{"Save this person first, then add their loans, savings or insurance here."}</p>
                ) : (
                  <>
                    {mine.length ? (
                      <ul className="tw-m-0 tw-mb-4 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0">
                        {mine.map((d) => {
                          const t = types.find((x) => x.id === d.type_id);
                          return (
                            <li key={d.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-p-3">
                              <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
                                <span className="tw-text-[14px] tw-font-semibold tw-text-ink">{t?.label || "Deduction"}</span>
                                <span className="tw-text-[12.5px] tw-text-ink-3">
                                  {d.kind === "percent" ? `${num(d.value)}% of gross` : `${money(num(d.value))} a month`}
                                  {d.balance != null ? ` · ${money(num(d.balance))} still owed` : ""}
                                </span>
                              </span>
                              <Switch compact label="On" checked={d.is_active} onChange={(v) => saveStaffDeduction({ id: d.id, is_active: v }).then(() => onSaved(f.id))} />
                              <button type="button" className="tw-rounded-full tw-border-0 tw-bg-transparent tw-px-3 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-text-danger tw-cursor-pointer hover:tw-bg-danger-soft [font-family:inherit]" onClick={() => deleteStaffDeduction(d.id).then(() => onSaved(f.id))}>
                                {"Remove"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="tw-m-0 tw-mb-4 tw-text-[13.5px] tw-text-ink-3">{"None yet."}</p>
                    )}
                    {!ro ? (
                      <div className="tw-rounded-xl tw-bg-bg tw-p-4">
                        <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
                          <Field label="Deduction">
                            <Select value={newDed.type_id} onChange={(v) => setNewDed((x) => ({ ...x, type_id: v }))} options={[{ value: "", label: "Choose…" }, ...types.filter((t) => t.is_active).map((t) => ({ value: t.id, label: t.label }))]} />
                          </Field>
                          <Field label="How much">
                            <Select value={newDed.kind} onChange={(v) => setNewDed((x) => ({ ...x, kind: v, value: "" }))} options={[{ value: "fixed", label: "Amount a month" }, { value: "percent", label: "% of gross" }]} />
                          </Field>
                          <Field label={newDed.kind === "percent" ? "Percent" : "Amount"}>
                            {newDed.kind === "percent" ? (
                              <input className={input} type="number" min="0" max="100" value={newDed.value} onChange={(e) => setNewDed((x) => ({ ...x, value: e.target.value }))} />
                            ) : (
                              <MoneyInput value={newDed.value} onChange={(v) => setNewDed((x) => ({ ...x, value: v }))} placeholder="0" />
                            )}
                          </Field>
                          <Field label="Total still owed" hint="For a loan or advance; stops at zero.">
                            <MoneyInput value={newDed.balance} onChange={(v) => setNewDed((x) => ({ ...x, balance: v }))} placeholder="Leave empty if ongoing" />
                          </Field>
                        </div>
                        <button type="button" onClick={addDeduction} className="tw-mt-3 tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border-0 tw-bg-brand tw-px-4 tw-py-2 tw-text-[13px] tw-font-semibold tw-text-white tw-cursor-pointer hover:tw-opacity-90 [font-family:inherit]">
                          <Svg d={I.plus} size={13} />
                          {"Add deduction"}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </Section>
            ) : (
              <Section icon={I.info} title="Details">
                <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
                  <Field label="Full name"><input className={input} value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} /></Field>
                  <Field label="Job title"><input className={input} value={f.job_title || ""} onChange={(e) => set({ job_title: e.target.value })} placeholder="e.g. Mathematics teacher" /></Field>
                  <Field label="Schoolivio login" hint="Linked staff see their own payslips." wide>
                    <Select searchable value={f.user_id || ""} onChange={(v) => set({ user_id: v })} options={memberOptions} />
                  </Field>
                  <Field label="Started"><DatePicker value={f.start_date || ""} onChange={(v) => set({ start_date: v })} /></Field>
                  <Field label="Left (if they have)"><DatePicker value={f.end_date || ""} onChange={(v) => set({ end_date: v })} /></Field>
                </div>
                <div className="tw-mt-4">
                  <Switch compact label="On payroll (paid each month)" checked={f.is_active} onChange={(v) => set({ is_active: v })} />
                </div>
              </Section>
            )}
          </div>
        </fieldset>

        {/* Save bar */}
        {!ro ? (
          <div className="tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-3 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-bg-surface tw-px-7 tw-py-3 mobile:tw-px-4">
            <span className="tw-text-[13px] tw-text-ink-3">{dirty ? "Changes not saved yet." : f.id ? "Saved." : "Fill in the pay and details, then save."}</span>
            <div className="tw-flex tw-gap-2">
              <button type="button" onClick={close} className="tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-4 tw-py-2 tw-text-[13.5px] tw-font-semibold tw-text-ink tw-cursor-pointer hover:tw-border-brand [font-family:inherit]">
                {"Close"}
              </button>
              <button type="button" onClick={save} disabled={busy || (!dirty && !!f.id)} className="tw-rounded-full tw-border-0 tw-bg-brand tw-px-5 tw-py-2 tw-text-[13.5px] tw-font-semibold tw-text-white tw-cursor-pointer hover:tw-opacity-90 disabled:tw-cursor-not-allowed disabled:tw-opacity-50 [font-family:inherit]">
                {busy ? "Saving…" : f.id ? "Save changes" : "Add to payroll"}
              </button>
            </div>
          </div>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
};

/* ---------------------------------------------------------------- list */
export const StaffTab = ({
  schoolId,
  staff,
  types,
  deductions,
  members,
  money,
  labels,
  canEdit,
  onChanged,
}: {
  schoolId: string;
  staff: AnyRow[];
  types: AnyRow[];
  deductions: AnyRow[];
  members: AnyRow[];
  money: Money;
  labels: Labels;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) => {
  // The panel's row, and a key that stays the same while it is open (so a
  // save does not slide it in again).
  const [open, setOpen] = useState<{ row: AnyRow; key: number } | null>(null);
  const [query, setQuery] = useState("");
  const [pay, setPay] = useState<Record<string, { gross: number; net: number }>>({});
  const loadPay = useCallback(() => {
    staffPay(schoolId).then(setPay).catch(() => setPay({}));
  }, [schoolId]);
  useEffect(loadPay, [loadPay, staff, deductions]);

  const q = query.trim().toLowerCase();
  const shown = staff.filter((s) => !q || `${s.full_name} ${s.job_title || ""}`.toLowerCase().includes(q));
  const totalNet = staff.filter((s) => s.is_active).reduce((t, s) => t + (pay[s.id]?.net || 0), 0);

  // After a save, the panel shows the saved record (a new one included).
  const saved = async (id: string) => {
    await onChanged();
    setOpen((cur) => (cur ? { ...cur, row: { ...cur.row, id } } : cur));
  };
  const current = open ? (open.row.id ? staff.find((s) => s.id === open.row.id) || open.row : open.row) : null;

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 [font-family:inherit]">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
        <input className={`${input} tw-max-w-[320px]`} placeholder="Search staff" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="tw-flex-1 tw-text-[13px] tw-text-ink-3">{staff.length ? `${staff.filter((s) => s.is_active).length} on payroll · ${money(totalNet)} net a month` : ""}</span>
        {canEdit ? (
          <button type="button" onClick={() => setOpen({ row: { ...blank }, key: Date.now() })} className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border-0 tw-bg-brand tw-px-4 tw-py-2 tw-text-[13.5px] tw-font-semibold tw-text-white tw-cursor-pointer hover:tw-opacity-90 [font-family:inherit]">
            <Svg d={I.plus} size={14} />
            {"Add staff"}
          </button>
        ) : null}
      </div>

      {!staff.length ? (
        <div className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-10 tw-text-center tw-text-[14px] tw-text-ink-3">
          {"No staff on payroll yet. Add each person with their monthly pay and bank details."}
        </div>
      ) : (
        <div className="tw-overflow-hidden tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-shadow-1">
          <div className="tw-overflow-x-auto">
            <table className="tw-w-full tw-border-collapse tw-text-[14px]">
              <thead>
                <tr className="tw-bg-bg">
                  {["Name", "Gross a month", "Net a month", "Bank", ""].map((h) => (
                    <th key={h} className="tw-px-4 tw-py-2.5 tw-text-left tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const p = pay[s.id];
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setOpen({ row: s, key: Date.now() })}
                      className={`tw-cursor-pointer tw-border-0 tw-border-t tw-border-solid tw-border-line tw-transition-colors hover:tw-bg-brand-soft ${s.is_active ? "" : "tw-opacity-60"}`}
                    >
                      <td className="tw-px-4 tw-py-3">
                        <span className="tw-flex tw-items-center tw-gap-3">
                          <Avatar name={s.full_name} size={36} />
                          <span className="tw-flex tw-min-w-0 tw-flex-col">
                            <span className="tw-font-semibold tw-text-ink">{s.full_name}</span>
                            <span className="tw-text-[12.5px] tw-text-ink-3">{[s.job_title, s.is_active ? null : "Not on payroll", s.user_id ? "Sees own payslips" : null].filter(Boolean).join(" · ") || "—"}</span>
                          </span>
                        </span>
                      </td>
                      <td className="tw-px-4 tw-py-3 tw-tabular-nums tw-text-ink">{p ? money(p.gross) : money(num(s.basic) + num(s.housing) + num(s.transport) + (s.other_allowances || []).reduce((t: number, a: AnyRow) => t + num(a.amount), 0))}</td>
                      <td className="tw-px-4 tw-py-3 tw-font-semibold tw-tabular-nums tw-text-success">{p ? money(p.net) : "—"}</td>
                      <td className="tw-px-4 tw-py-3 tw-text-ink-2">
                        {s.bank_name ? `${s.bank_name}${s.account_number ? ` · ••••${String(s.account_number).slice(-4)}` : ""}` : <span className="tw-text-warn-ink">{"Not set"}</span>}
                      </td>
                      <td className="tw-px-4 tw-py-3 tw-text-right tw-text-ink-3"><Svg d={I.chevron} size={16} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!shown.length ? <p className="tw-m-0 tw-p-6 tw-text-center tw-text-[13.5px] tw-text-ink-3">{"No one by that name."}</p> : null}
        </div>
      )}

      {current ? (
        <StaffPanel
          key={open?.key}
          schoolId={schoolId}
          initial={current}
          members={members}
          types={types}
          deductions={deductions}
          money={money}
          labels={labels}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      ) : null}
    </div>
  );
};
