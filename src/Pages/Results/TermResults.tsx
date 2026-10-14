import React, { useEffect, useMemo, useState } from "react";
import { fetchReleasedResults, type Slip } from "../../lib/resultsApi";
import { Chip } from "./resultsUi";

// A pupil's released term results, on their report (Reports → a pupil).
// Only what the school has released: the database refuses families anything
// else, and staff see the same view here (drafts live under Results).

const TermResults = ({ studentId }: { studentId: string }) => {
  const [slips, setSlips] = useState<Slip[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchReleasedResults(studentId)
      .then((r) => live && setSlips(r))
      .catch(() => live && setSlips([]));
    return () => {
      live = false;
    };
  }, [studentId]);

  // Newest term first, subjects A–Z.
  const terms = useMemo(() => {
    const m = new Map<string, { name: string; at: string; rows: Slip[] }>();
    (slips || []).forEach((s) => {
      if (!m.has(s.term_id)) m.set(s.term_id, { name: [s.term_name, s.session_name].filter(Boolean).join(" · "), at: s.released_at || "", rows: [] });
      m.get(s.term_id)!.rows.push(s);
    });
    return [...m.values()]
      .map((t) => ({ ...t, rows: t.rows.sort((a, b) => (a.course_title || "").localeCompare(b.course_title || "")) }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [slips]);

  if (!slips || !slips.length) return null;

  return (
    <section className="sr-card [font-family:inherit]">
      <div className="sr-card-head">
        <h2 className="sr-card-title">{"Term results"}</h2>
        <span className="sr-card-hint">{"From the school's exams, as released by the school."}</span>
      </div>
      <div className="tw-flex tw-flex-col tw-gap-5">
        {terms.map((t) => {
          const avg = t.rows.length ? Math.round((t.rows.reduce((n, r) => n + Number(r.percentage || 0), 0) / t.rows.length) * 10) / 10 : null;
          return (
            <div key={t.name}>
              <div className="tw-mb-2 tw-flex tw-flex-wrap tw-items-baseline tw-justify-between tw-gap-2">
                <h3 className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">{t.name}</h3>
                {avg !== null ? <span className="tw-text-[13px] tw-text-ink-2">{`Average ${avg}% across ${t.rows.length} subject${t.rows.length === 1 ? "" : "s"}`}</span> : null}
              </div>
              <div className="tw-overflow-x-auto tw-rounded-xl tw-border tw-border-solid tw-border-line">
                <table className="tw-w-full tw-border-collapse tw-text-[13.5px]">
                  <thead>
                    <tr className="tw-bg-bg">
                      {["Subject", "CA", "Exam", "Total", "Grade", "Remark"].map((h, i) => (
                        <th key={h} className={`tw-px-3 tw-py-2 tw-text-[11.5px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3 ${i >= 1 && i <= 4 ? "tw-text-center" : "tw-text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.entry_id} className="tw-border-0 tw-border-t tw-border-solid tw-border-line">
                        <td className="tw-px-3 tw-py-2 tw-font-semibold tw-text-ink">{r.course_title || "Subject"}</td>
                        <td className="tw-px-3 tw-py-2 tw-text-center tw-tabular-nums tw-text-ink-2">{r.ca_score == null ? "—" : `${Number(r.ca_score)}/${r.ca_max}`}</td>
                        <td className="tw-px-3 tw-py-2 tw-text-center tw-tabular-nums tw-text-ink-2">{r.exam_score == null ? "—" : `${Number(r.exam_score)}/${r.exam_max}`}</td>
                        <td className="tw-px-3 tw-py-2 tw-text-center tw-font-semibold tw-tabular-nums tw-text-ink">{`${Number(r.total)}/${r.ca_max + r.exam_max}`}</td>
                        <td className="tw-px-3 tw-py-2 tw-text-center">{r.grade ? <Chip tone={r.grade === "F" ? "bad" : r.grade === "A" ? "good" : "muted"}>{r.grade}</Chip> : "—"}</td>
                        <td className="tw-px-3 tw-py-2 tw-text-ink-2">{r.remark || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default TermResults;
