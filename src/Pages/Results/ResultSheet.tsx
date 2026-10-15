import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { Page, Modal, SkeletonTable, displayName } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog, promptDialog } from "../../Components/Confirm";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  approveSheet,
  fetchSheet,
  bandFor,
  gradeTone,
  releaseSheet,
  returnSheet,
  saveEntry,
  setSplit,
  STATUS_LABEL,
  submitSheet,
  withdrawSheet,
  type Entry,
  type SheetDetail,
} from "../../lib/resultsApi";
import { Chip, Svg, I, btn, card, statusTone, useGradeBands } from "./resultsUi";

// One subject's results for one term (Results.tsx explains the whole flow).
// The teacher types each pupil's CA and exam mark (saved as they go, checked
// against what each is out of), or pastes them from a spreadsheet; total,
// percentage and grade follow. Then: submit → approve or send back →
// release, each a button for whoever may press it, all recorded below.

const STAGES: { status: string[]; label: string }[] = [
  { status: ["draft", "returned"], label: "Marking" },
  { status: ["submitted"], label: "Approval" },
  { status: ["approved"], label: "Approved" },
  { status: ["released"], label: "Released" },
];

const num = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const normal = (s: string) => s.toLowerCase().replace(/[^a-z]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

/* ------------------------------------------------------------- one cell */
const ScoreInput = ({ value, max, disabled, onSave, label, rowIndex, col }: { value: number | null; max: number; disabled: boolean; onSave: (v: number | null) => Promise<void>; label: string; rowIndex: number; col: number }) => {
  const [text, setText] = useState(value == null ? "" : String(Number(value)));
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setErr] = useState("");
  // Follows the saved mark only when it actually changes (a paste, a
  // reload), never over what is being typed.
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    setText(value == null ? "" : String(Number(value)));
  }, [value]);
  const commit = async () => {
    const n = num(text);
    if (n === (value == null ? null : Number(value))) return;
    if (Number.isNaN(n as number) || (n !== null && (n < 0 || n > max))) {
      setState("error");
      setErr(`0 to ${max}`);
      return;
    }
    setState("saving");
    try {
      await onSave(n);
      setState("idle");
      setErr("");
    } catch (e) {
      setState("error");
      setErr((e as Error).message);
    }
  };
  return (
    <span className="tw-flex tw-flex-col tw-items-center">
      <input
        aria-label={label}
        data-cell={`${rowIndex}:${col}`}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (state === "error") setState("idle");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = document.querySelector<HTMLInputElement>(`[data-cell="${rowIndex + (e.key === "ArrowUp" ? -1 : 1)}:${col}"]`);
            next?.focus();
            next?.select();
          }
        }}
        className={`tw-h-9 tw-w-[72px] tw-rounded-lg tw-border tw-border-solid tw-bg-surface tw-text-center tw-text-[14px] tw-tabular-nums tw-text-ink tw-outline-none disabled:tw-border-transparent disabled:tw-bg-transparent [font-family:inherit] ${
          state === "error" ? "tw-border-danger" : state === "saving" ? "tw-border-brand" : "tw-border-line focus:tw-border-brand"
        }`}
      />
      {state === "error" ? <span className="tw-mt-0.5 tw-text-[11px] tw-text-danger">{error}</span> : null}
    </span>
  );
};

/* ---------------------------------------------------- paste from Excel */
const PasteMarks = ({ entries, caMax, examMax, onClose, onApply }: { entries: Entry[]; caMax: number; examMax: number; onClose: () => void; onApply: (rows: { entry: Entry; ca: number | null; exam: number | null }[]) => Promise<void> }) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // A name two pupils share matches neither (null): their marks must not be
  // given to the wrong child. Their usernames still match.
  const byName = useMemo(() => {
    const m = new Map<string, Entry | null>();
    const put = (key: string, e: Entry) => {
      if (!key) return;
      const had = m.get(key);
      m.set(key, had === undefined || had === e ? e : null);
    };
    entries.forEach((e) => {
      const p = e.student;
      put(normal(`${p?.first_name || ""} ${p?.surname || ""}`), e);
      if (p?.username) put(normal(p.username), e);
    });
    return m;
  }, [entries]);
  const parsed = useMemo(() => {
    return text
      .split(/\r?\n/)
      .map((line) => line.split(/\t|,|;/).map((c) => c.trim()))
      .filter((cells) => cells.some(Boolean))
      .map((cells) => {
        // Name first, then the CA and the exam marks (the first two numbers).
        const numbers = cells.slice(1).map(num).filter((n) => n !== null) as number[];
        const found = byName.get(normal(cells[0] || ""));
        const ambiguous = found === null;
        const entry = found || undefined;
        const ca = numbers[0] ?? null;
        const exam = numbers[1] ?? null;
        const bad = (ca !== null && (Number.isNaN(ca) || ca < 0 || ca > caMax)) || (exam !== null && (Number.isNaN(exam) || exam < 0 || exam > examMax));
        return { name: cells[0], entry, ca, exam, bad, ambiguous };
      })
      .filter((r) => !/^(name|student|pupil)s?$/i.test(r.name || ""));
  }, [text, byName, caMax, examMax]);
  const good = parsed.filter((r) => r.entry && !r.bad);

  return (
    <Modal
      title="Paste marks from a spreadsheet"
      subtitle={`In Excel or Google Sheets, select three columns, the pupil's name, the CA mark (out of ${caMax}) and the exam mark (out of ${examMax}), copy, and paste below.`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn()} onClick={onClose}>{"Cancel"}</button>
          <button
            type="button"
            className={btn("primary")}
            disabled={busy || !good.length}
            onClick={async () => {
              setBusy(true);
              await onApply(good.map((r) => ({ entry: r.entry as Entry, ca: r.ca, exam: r.exam })));
              setBusy(false);
            }}
          >
            {busy ? "Saving…" : `Use ${good.length} row${good.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        rows={7}
        placeholder={"Ada Obi\t32\t51\nBola Ade\t28\t47"}
        className="tw-w-full tw-resize-y tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-3 tw-text-[13.5px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:ui-monospace,monospace]"
      />
      {parsed.length ? (
        <div className="tw-mt-3 tw-max-h-[260px] tw-overflow-auto tw-rounded-xl tw-border tw-border-solid tw-border-line">
          <table className="tw-w-full tw-border-collapse tw-text-[13px]">
            <tbody>
              {parsed.map((r, i) => (
                <tr key={i} className="tw-border-0 tw-border-b tw-border-solid tw-border-line">
                  <td className="tw-px-3 tw-py-1.5">{r.name}</td>
                  <td className="tw-px-3 tw-py-1.5 tw-text-center tw-tabular-nums">{r.ca ?? "—"}</td>
                  <td className="tw-px-3 tw-py-1.5 tw-text-center tw-tabular-nums">{r.exam ?? "—"}</td>
                  <td className="tw-px-3 tw-py-1.5 tw-text-right">
                    {r.ambiguous ? <Chip tone="bad">{"Two pupils have this name: use the username"}</Chip> : !r.entry ? <Chip tone="bad">{"Not in this class"}</Chip> : r.bad ? <Chip tone="bad">{"Mark out of range"}</Chip> : <Chip tone="good">{displayName(r.entry.student)}</Chip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
};

/* ---------------------------------------------------------------- page */
const ResultSheet = () => {
  const { sheetId } = useParams();
  const { user } = useAuth() as { user: { id: string } | null };
  const { roles, schoolId } = useSchool();
  const bands = useGradeBands(schoolId);
  const { setError, setNotice } = useActionFeedback();
  const isLeader = roles.some((r) => r === "owner" || r === "admin" || r === "principal");
  const [d, setD] = useState<SheetDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [splitting, setSplitting] = useState<{ ca: string; exam: string } | null>(null);
  const live = useRef(true);

  const load = useCallback(() => {
    if (!sheetId) return;
    fetchSheet(sheetId)
      .then((x) => live.current && setD(x))
      .catch(() => live.current && setNotFound(true));
  }, [sheetId]);
  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const sheet = d?.sheet;
  const editable = !!sheet && (sheet.status === "draft" || sheet.status === "returned");
  // Who may type marks (the database checks it again): the subject's
  // teacher, the class's form teacher, or a leader for a subject with no
  // teacher yet; for a course, its teacher.
  const me = user?.id;
  const u = d?.unit;
  const teaches = !!u && (u.kind === "subject" ? u.teacherId === me || u.formTeacherId === me || (!u.teacherId && isLeader) : u.courseOwnerId === me || (!!me && u.coTeacherIds.includes(me)) || isLeader);
  const canMark = editable && teaches;
  const outOf = sheet ? sheet.ca_max + sheet.exam_max : 100;
  const marked = (d?.entries || []).filter((e) => e.ca_score != null || e.exam_score != null).length;
  const total = d?.entries.length || 0;
  const lastReturn = d?.events.find((e) => e.status_to === "returned");
  const submittedByMe = sheet?.status === "submitted" && d?.events.find((e) => e.status_to === "submitted")?.actor_id === user?.id;

  const patchEntry = async (e: Entry, patch: Partial<Entry>) => {
    await saveEntry(e.id, patch as never);
    setD((cur) =>
      cur
        ? {
            ...cur,
            entries: cur.entries.map((x) => {
              if (x.id !== e.id) return x;
              const y = { ...x, ...patch };
              return { ...y, total: Number(y.ca_score || 0) + Number(y.exam_score || 0) };
            }),
          }
        : cur,
    );
  };

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      setNotice(done);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (marked < total) return setError(`${total - marked} pupil${total - marked === 1 ? " has" : "s have"} no marks yet.`);
    if (!(await confirmDialog({ title: "Submit these results for approval?", body: "After this you cannot change a mark unless the principal sends it back.", confirmLabel: "Submit", tone: "primary" }))) return;
    act(() => submitSheet(sheet!.id), "Submitted. The principal and administrators have been told.");
  };
  const approve = async () => {
    if (!(await confirmDialog({ title: "Approve these results?", body: "They are not visible to families until they are released.", confirmLabel: "Approve", tone: "primary" }))) return;
    act(() => approveSheet(sheet!.id), "Approved.");
  };
  const sendBack = async () => {
    const note = await promptDialog({ title: "Send back to the teacher", body: "Say what needs correcting; the teacher is told.", label: "What needs correcting", placeholder: "e.g. Check Ada Obi's exam mark" });
    if (!note?.trim()) return;
    act(() => returnSheet(sheet!.id, note.trim()), "Sent back to the teacher.");
  };
  const release = async () => {
    if (!(await confirmDialog({ title: "Release to families?", body: "Each pupil and their parents can see these results straight away, and are told.", confirmLabel: "Release", tone: "primary" }))) return;
    act(() => releaseSheet(sheet!.id), "Released. Pupils and parents have been told.");
  };
  const withdraw = async () => {
    const note = await promptDialog({ title: "Withdraw these results?", body: "Families stop seeing them until they are released again.", label: "Why", placeholder: "e.g. A mark needs correcting" });
    if (!note?.trim()) return;
    act(() => withdrawSheet(sheet!.id, note.trim()), "Withdrawn. Families no longer see them.");
  };
  const applyPaste = async (rows: { entry: Entry; ca: number | null; exam: number | null }[]) => {
    let done = 0;
    for (const r of rows) {
      try {
        // Only what was pasted: a sheet with just the CA column must not
        // wipe exam marks already saved.
        const patch: { ca_score?: number; exam_score?: number } = {};
        if (r.ca !== null) patch.ca_score = r.ca;
        if (r.exam !== null) patch.exam_score = r.exam;
        if (!Object.keys(patch).length) continue;
        await patchEntry(r.entry, patch);
        done += 1;
      } catch (err) {
        setError(`${displayName(r.entry.student)}: ${(err as Error).message}`);
      }
    }
    setPasting(false);
    setNotice(`${done} pupil${done === 1 ? "'s" : "s'"} marks filled in.`);
  };
  const saveSplit = async () => {
    const ca = Number(splitting?.ca);
    const exam = Number(splitting?.exam);
    try {
      await setSplit(sheet!.id, ca, exam);
      setSplitting(null);
      setNotice(`CA out of ${ca}, exam out of ${exam}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (notFound) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Results">
          <div className={`${card} tw-p-10 tw-text-center tw-text-[14px] tw-text-ink-3`}>{"That result sheet is not available to you."}</div>
        </Page>
      </div>
    );
  }

  const stage = sheet ? STAGES.findIndex((s) => s.status.includes(sheet.status)) : 0;

  return (
    <div className="shell">
      <Navbar />
      <Page title={d ? `${d.unit.title} · ${d.unit.where}` : "Results"} subtitle={d?.unit.termName}>
        <div className="tw-flex tw-flex-col tw-gap-4 [font-family:inherit]">
          <Link to="/Results" className="tw-inline-flex tw-w-fit tw-items-center tw-gap-1 tw-text-[13.5px] tw-font-semibold tw-text-brand tw-no-underline">
            <Svg d={I.back} size={15} />
            {"All results"}
          </Link>

          {!d || !sheet ? (
            <SkeletonTable rows={8} cols={6} />
          ) : (
            <>
              {/* Where it is in the journey */}
              <section className={`${card} tw-p-5`}>
                <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Chip tone={statusTone(sheet.status)}>{STATUS_LABEL[sheet.status]}</Chip>
                    <span className="tw-text-[13px] tw-text-ink-3">{`${marked} of ${total} pupils marked`}</span>
                  </div>
                  <span className="tw-text-[13px] tw-text-ink-2">
                    {`CA out of ${sheet.ca_max} · Exam out of ${sheet.exam_max}`}
                    {canMark ? (
                      <button type="button" onClick={() => setSplitting({ ca: String(sheet.ca_max), exam: String(sheet.exam_max) })} className="tw-ml-2 tw-rounded-full tw-border-0 tw-bg-transparent tw-px-2 tw-py-0.5 tw-text-[13px] tw-font-semibold tw-text-brand tw-cursor-pointer hover:tw-bg-brand-soft [font-family:inherit]">
                        {"Change"}
                      </button>
                    ) : null}
                  </span>
                </div>
                <ol className="tw-m-0 tw-mt-4 tw-grid tw-list-none tw-grid-cols-4 tw-gap-2 tw-p-0">
                  {STAGES.map((s, i) => (
                    <li key={s.label} className="tw-flex tw-flex-col tw-gap-1.5">
                      <span className={`tw-h-1.5 tw-rounded-full ${i <= stage ? "tw-bg-brand" : "tw-bg-line"}`} />
                      <span className={`tw-text-[12.5px] ${i === stage ? "tw-font-semibold tw-text-brand" : i < stage ? "tw-text-ink-2" : "tw-text-ink-3"}`}>{s.label}</span>
                    </li>
                  ))}
                </ol>
                {sheet.status === "returned" && lastReturn?.note ? (
                  <div className="tw-mt-4 tw-rounded-xl tw-bg-danger-soft tw-px-4 tw-py-3 tw-text-[13.5px] tw-text-danger">
                    <strong>{`Sent back by ${lastReturn.actor_label || "the principal"}: `}</strong>
                    {lastReturn.note}
                  </div>
                ) : null}
              </section>

              {/* The marks */}
              <section className={`${card} tw-overflow-hidden`}>
                <header className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-px-5 tw-py-3">
                  <h3 className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">{"Marks"}</h3>
                  {canMark ? (
                    <button type="button" className={btn()} onClick={() => setPasting(true)}>
                      <Svg d={I.paste} size={14} />
                      {"Paste from Excel"}
                    </button>
                  ) : null}
                </header>
                {canMark ? <p className="tw-m-0 tw-px-5 tw-pb-3 tw-text-[12.5px] tw-text-ink-3">{"Each mark saves when you leave the box. Enter moves to the next pupil."}</p> : null}
                <div className="tw-overflow-x-auto">
                  <table className="tw-w-full tw-border-collapse tw-text-[14px]">
                    <thead>
                      <tr className="tw-bg-bg">
                        {["#", "Pupil", `CA /${sheet.ca_max}`, `Exam /${sheet.exam_max}`, `Total /${outOf}`, "%", "Grade", "Remark"].map((h, i) => (
                          <th key={h} className={`tw-px-3 tw-py-2.5 tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3 ${i >= 2 && i <= 6 ? "tw-text-center" : "tw-text-left"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.entries.map((e, i) => {
                        const pct = e.ca_score == null && e.exam_score == null ? null : Math.round((Number(e.total) * 1000) / outOf) / 10;
                        const band = bandFor(pct, bands);
                        const grade = band?.grade || "";
                        return (
                          <tr key={e.id} className="tw-border-0 tw-border-t tw-border-solid tw-border-line">
                            <td className="tw-px-3 tw-py-2 tw-text-[12.5px] tw-text-ink-3">{i + 1}</td>
                            <td className="tw-min-w-[180px] tw-px-3 tw-py-2 tw-font-semibold tw-text-ink">{displayName(e.student)}</td>
                            <td className="tw-px-3 tw-py-2 tw-text-center">
                              <ScoreInput value={e.ca_score} max={sheet.ca_max} disabled={!canMark} label={`${displayName(e.student)} CA`} rowIndex={i} col={0} onSave={(v) => patchEntry(e, { ca_score: v })} />
                            </td>
                            <td className="tw-px-3 tw-py-2 tw-text-center">
                              <ScoreInput value={e.exam_score} max={sheet.exam_max} disabled={!canMark} label={`${displayName(e.student)} exam`} rowIndex={i} col={1} onSave={(v) => patchEntry(e, { exam_score: v })} />
                            </td>
                            <td className="tw-px-3 tw-py-2 tw-text-center tw-font-semibold tw-tabular-nums tw-text-ink">{pct === null ? "—" : Number(e.total)}</td>
                            <td className="tw-px-3 tw-py-2 tw-text-center tw-tabular-nums tw-text-ink-2">{pct === null ? "—" : pct}</td>
                            <td className="tw-px-3 tw-py-2 tw-text-center" title={band?.remark || undefined}>{grade ? <Chip tone={gradeTone(grade, bands)}>{grade}</Chip> : "—"}</td>
                            <td className="tw-min-w-[180px] tw-px-3 tw-py-2">
                              {canMark ? (
                                <input
                                  aria-label={`${displayName(e.student)} remark`}
                                  defaultValue={e.remark || ""}
                                  onBlur={(ev) => {
                                    const v = ev.target.value.trim() || null;
                                    if (v !== (e.remark || null)) patchEntry(e, { remark: v }).catch((err: Error) => setError(err.message));
                                  }}
                                  placeholder="Optional"
                                  className="tw-h-9 tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-2.5 tw-text-[13.5px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]"
                                />
                              ) : (
                                <span className="tw-text-[13.5px] tw-text-ink-2">{e.remark || ""}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!d.entries.length ? <p className="tw-m-0 tw-p-6 tw-text-center tw-text-[13.5px] tw-text-ink-3">{"No pupils in this class yet."}</p> : null}
              </section>

              {/* Who did what */}
              {d.events.length ? (
                <section className={`${card} tw-p-5`}>
                  <h3 className="tw-m-0 tw-mb-3 tw-flex tw-items-center tw-gap-2 tw-text-[15px] tw-font-semibold tw-text-ink">
                    <Svg d={I.history} size={15} />
                    {"History"}
                  </h3>
                  <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0">
                    {d.events.map((ev) => (
                      <li key={ev.id} className="tw-text-[13.5px] tw-text-ink-2">
                        <strong className="tw-text-ink">{ev.actor_label || "Someone"}</strong>
                        {` · ${ev.status_from ? STATUS_LABEL[ev.status_from].toLowerCase() + " → " : ""}${STATUS_LABEL[ev.status_to].toLowerCase()} · ${new Date(ev.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
                        {ev.note ? <span className="tw-block tw-text-ink-3">{`“${ev.note}”`}</span> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* The next step, for whoever takes it */}
              <div className={`${card} tw-sticky tw-bottom-3 tw-z-10 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-px-5 tw-py-3 tw-shadow-2`}>
                <span className="tw-text-[13.5px] tw-text-ink-2">
                  {editable && !teaches
                    ? "Its teacher is still entering the marks."
                    : editable
                    ? marked < total
                      ? `${total - marked} pupil${total - marked === 1 ? "" : "s"} still to mark.`
                      : "Everyone is marked. Submit when you have checked them."
                    : sheet.status === "submitted"
                    ? isLeader
                      ? "Check the marks, then approve or send back."
                      : "With the principal for approval. You are told when it moves."
                    : sheet.status === "approved"
                    ? isLeader
                      ? "Approved. Families see it once you release it."
                      : "Approved. Families see it once the school releases it."
                    : "Released. Pupils and parents can see these results."}
                </span>
                <div className="tw-flex tw-flex-wrap tw-gap-2">
                  {canMark ? (
                    <button type="button" className={btn("primary")} disabled={busy || !total} onClick={submit}>
                      <Svg d={I.send} size={14} />
                      {"Submit for approval"}
                    </button>
                  ) : null}
                  {isLeader && (sheet.status === "submitted" || sheet.status === "approved") ? (
                    <button type="button" className={btn("danger")} disabled={busy} onClick={sendBack}>
                      <Svg d={I.undo} size={14} />
                      {"Send back"}
                    </button>
                  ) : null}
                  {isLeader && sheet.status === "submitted" ? (
                    <button type="button" className={btn("primary")} disabled={busy || submittedByMe} title={submittedByMe ? "You submitted these, so someone else approves them" : undefined} onClick={approve}>
                      <Svg d={I.check} size={14} />
                      {"Approve"}
                    </button>
                  ) : null}
                  {isLeader && sheet.status === "approved" ? (
                    <button type="button" className={btn("primary")} disabled={busy} onClick={release}>
                      <Svg d={I.eye} size={14} />
                      {"Release to families"}
                    </button>
                  ) : null}
                  {isLeader && sheet.status === "released" ? (
                    <button type="button" className={btn("danger")} disabled={busy} onClick={withdraw}>
                      {"Withdraw"}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        {pasting && d && sheet ? <PasteMarks entries={d.entries} caMax={sheet.ca_max} examMax={sheet.exam_max} onClose={() => setPasting(false)} onApply={applyPaste} /> : null}
        {splitting ? (
          <Modal
            title="What the marks are out of"
            subtitle="Together they make the total. Most schools use CA 40 and exam 60."
            onClose={() => setSplitting(null)}
            footer={
              <>
                <button type="button" className={btn()} onClick={() => setSplitting(null)}>{"Cancel"}</button>
                <button type="button" className={btn("primary")} onClick={saveSplit}>{"Save"}</button>
              </>
            }
          >
            <div className="tw-grid tw-grid-cols-2 tw-gap-3">
              {(["ca", "exam"] as const).map((k) => (
                <label key={k} className="tw-flex tw-flex-col tw-gap-1">
                  <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{k === "ca" ? "CA out of" : "Exam out of"}</span>
                  <input className="input" inputMode="numeric" value={splitting[k]} onChange={(e) => setSplitting({ ...splitting, [k]: e.target.value })} />
                </label>
              ))}
            </div>
          </Modal>
        ) : null}
      </Page>
    </div>
  );
};

export default ResultSheet;
