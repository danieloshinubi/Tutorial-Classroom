import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, SkeletonText } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import { useSchool } from "../../context/SchoolContext";
import { DEFAULT_BANDS, fetchGradeBands, saveGradeBands, type GradeBand } from "../../lib/resultsApi";

// School admin → Grading (supabase/262). The school's own grades, the lowest
// mark for each and what each means on a report. Until a school sets one it
// uses Schoolivio's default (A 70+, B 60+, C 50+, D 45+, E 40+, F below).
// Every result sheet and report card grades by whatever is saved here.

type Row = { key: number; grade: string; min: string; remark: string };

let seq = 0;
const toRows = (bands: GradeBand[]): Row[] =>
  [...bands].sort((a, b) => b.min_pct - a.min_pct).map((b) => ({ key: ++seq, grade: b.grade, min: String(b.min_pct), remark: b.remark || "" }));

const input =
  "tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-[14px] tw-text-ink focus:tw-border-brand focus:tw-outline-none disabled:tw-bg-bg disabled:tw-text-ink-3 [font-family:inherit]";

const GradingPanel = () => {
  const { schoolId, roles } = useSchool();
  const { setError, setNotice } = useActionFeedback();
  const canEdit = roles.some((r: string) => r === "owner" || r === "admin" || r === "principal");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    fetchGradeBands(schoolId)
      .then((b) => {
        const r = toRows(b);
        setRows(r);
        setIsDefault(b.every((x) => x.is_default));
        setSaved(JSON.stringify(r.map(({ grade, min, remark }) => [grade, min, remark])));
      })
      .catch((e: Error) => setError(e.message));
  }, [schoolId, setError]);
  useEffect(load, [load]);

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => (rs || []).map((r) => (r.key === key ? { ...r, ...p } : r)));

  // What is wrong with the scale as typed, in words, or "" when it is fine.
  const problem = useMemo(() => {
    if (!rows) return "";
    if (!rows.length) return "Add at least one grade.";
    for (const r of rows) {
      if (!r.grade.trim()) return "Every grade needs a name (A, B, Credit…).";
      if (r.grade.trim().length > 4) return `"${r.grade}" is too long: up to 4 characters.`;
      const n = Number(r.min);
      if (r.min.trim() === "" || Number.isNaN(n) || n < 0 || n > 100) return `Give ${r.grade.trim() || "each grade"} a lowest mark from 0 to 100.`;
    }
    if (new Set(rows.map((r) => r.grade.trim().toUpperCase())).size !== rows.length) return "Two grades have the same name.";
    if (new Set(rows.map((r) => Number(r.min))).size !== rows.length) return "Two grades start at the same mark.";
    if (Math.min(...rows.map((r) => Number(r.min))) !== 0) return "The lowest grade must start at 0, so every mark gets a grade.";
    return "";
  }, [rows]);

  const dirty = !!rows && JSON.stringify(rows.map(({ grade, min, remark }) => [grade, min, remark])) !== saved;

  // Each grade's range, worked out from the grade above it.
  const ranges = useMemo(() => {
    const sorted = [...(rows || [])].map((r) => Number(r.min)).filter((n) => !Number.isNaN(n)).sort((a, b) => b - a);
    return (rows || []).map((r) => {
      const n = Number(r.min);
      const above = sorted.filter((m) => m > n);
      const top = above.length ? Math.min(...above) : null;
      if (Number.isNaN(n) || r.min.trim() === "") return "";
      return top === null ? `${n}–100` : `${n}–${Number.isInteger(top) ? top - 1 : (top - 0.1).toFixed(1)}`;
    });
  }, [rows]);

  const save = async () => {
    if (!schoolId || !rows || problem) return;
    setBusy(true);
    try {
      await saveGradeBands(
        schoolId,
        rows.map((r) => ({ grade: r.grade, min_pct: Number(r.min), remark: r.remark })),
      );
      setNotice("Grading scale saved. Result sheets and report cards now use it.");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const useDefault = async () => {
    if (!schoolId) return;
    const ok = await confirmDialog({
      title: "Go back to the Schoolivio default?",
      body: "A 70–100, B 60–69, C 50–59, D 45–49, E 40–44 and F 0–39. Result sheets and report cards change to it straight away.",
      confirmLabel: "Use the default",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await saveGradeBands(schoolId, []);
      setNotice("Back to the Schoolivio default scale.");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <SkeletonText lines={6} />;

  return (
    <div className="tw-flex tw-max-w-[760px] tw-flex-col tw-gap-4 [font-family:inherit]">
      <div className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 tw-shadow-1">
        <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
          <div className="tw-min-w-0">
            <h3 className="tw-m-0 tw-text-[16px] tw-font-bold tw-text-ink">{"Grading scale"}</h3>
            <p className="tw-m-0 tw-mt-1 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-3">
              {"The grade each pupil's percentage gets on result sheets and report cards. A grade covers every mark from its lowest mark up to the grade above it."}
            </p>
          </div>
          <span
            className={`tw-inline-flex tw-items-center tw-whitespace-nowrap tw-rounded-full tw-px-3 tw-py-1 tw-text-[12px] tw-font-semibold ${
              isDefault ? "tw-bg-bg tw-text-ink-2" : "tw-bg-brand-soft tw-text-brand"
            }`}
          >
            {isDefault ? "Schoolivio default" : "Your school's own scale"}
          </span>
        </div>

        <div className="tw-mt-4 tw-overflow-x-auto">
          <table className="tw-w-full tw-min-w-[520px] tw-border-collapse tw-text-[14px]">
            <thead>
              <tr className="tw-text-left tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">
                <th className="tw-w-[90px] tw-pb-2 tw-pr-3 tw-font-semibold">{"Grade"}</th>
                <th className="tw-w-[130px] tw-pb-2 tw-pr-3 tw-font-semibold">{"Lowest mark %"}</th>
                <th className="tw-w-[90px] tw-pb-2 tw-pr-3 tw-font-semibold">{"Range"}</th>
                <th className="tw-pb-2 tw-pr-3 tw-font-semibold">{"Meaning (on reports)"}</th>
                <th className="tw-w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="tw-py-1.5 tw-pr-3">
                    <input className={input} value={r.grade} maxLength={4} disabled={!canEdit} aria-label="Grade" onChange={(e) => patch(r.key, { grade: e.target.value })} />
                  </td>
                  <td className="tw-py-1.5 tw-pr-3">
                    <input
                      className={`${input} tw-tabular-nums`}
                      value={r.min}
                      inputMode="decimal"
                      disabled={!canEdit}
                      aria-label={`Lowest mark for ${r.grade || "this grade"}`}
                      onChange={(e) => patch(r.key, { min: e.target.value.replace(/[^0-9.]/g, "") })}
                    />
                  </td>
                  <td className="tw-whitespace-nowrap tw-py-1.5 tw-pr-3 tw-tabular-nums tw-text-ink-2">{ranges[i]}</td>
                  <td className="tw-py-1.5 tw-pr-3">
                    <input className={input} value={r.remark} maxLength={40} placeholder="e.g. Excellent" disabled={!canEdit} aria-label="Meaning" onChange={(e) => patch(r.key, { remark: e.target.value })} />
                  </td>
                  <td className="tw-py-1.5 tw-text-right">
                    {canEdit && rows.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove ${r.grade || "grade"}`}
                        onClick={() => setRows((rs) => (rs || []).filter((x) => x.key !== r.key))}
                        className="tw-cursor-pointer tw-rounded-full tw-border-0 tw-bg-transparent tw-px-2 tw-py-1 tw-text-[18px] tw-leading-none tw-text-ink-3 hover:tw-bg-danger-soft hover:tw-text-danger"
                      >
                        {"×"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit ? (
          <>
            {problem ? <p className="tw-m-0 tw-mt-3 tw-text-[13px] tw-font-semibold tw-text-danger">{problem}</p> : null}
            <div className="tw-mt-4 tw-flex tw-flex-wrap tw-items-center tw-gap-2">
              <Button variant="secondary" onClick={() => setRows((rs) => [...(rs || []), { key: ++seq, grade: "", min: "", remark: "" }])}>
                {"Add grade"}
              </Button>
              <span className="tw-flex-1" />
              {!isDefault ? (
                <Button variant="ghost" onClick={useDefault} disabled={busy}>
                  {"Use Schoolivio default"}
                </Button>
              ) : null}
              {dirty ? (
                <Button variant="ghost" onClick={load} disabled={busy}>
                  {"Discard changes"}
                </Button>
              ) : null}
              <Button onClick={save} disabled={busy || !dirty || !!problem}>
                {busy ? "Saving…" : "Save scale"}
              </Button>
            </div>
          </>
        ) : (
          <p className="tw-m-0 tw-mt-3 tw-text-[13px] tw-text-ink-3">{"Only the owner, an admin or the principal can change the scale."}</p>
        )}
      </div>

      <p className="tw-m-0 tw-text-[12.5px] tw-text-ink-3">
        {`Schoolivio default: ${DEFAULT_BANDS.map((b) => `${b.grade} ${b.min_pct}+`).join(", ").replace(" 0+", " below 40")}.`}
      </p>
    </div>
  );
};

export default GradingPanel;
