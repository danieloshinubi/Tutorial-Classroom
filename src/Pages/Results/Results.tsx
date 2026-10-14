import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { Page, Select, SkeletonList, displayName } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { fetchSheets, fetchTerms, fetchUnits, openSheet, releaseSheet, STATUS_LABEL, type Sheet, type Status, type Term, type Unit } from "../../lib/resultsApi";
import { Chip, Svg, I, card, statusTone } from "./resultsUi";

// Results (2026-10-14): term results for exams written on paper. A teacher
// opens a subject's sheet for the term and types (or pastes from Excel) each
// pupil's CA and exam marks, then submits; the principal, a proprietor or an
// admin approves or sends it back, and releases it; families then see it on
// their child's report. The rules live in the database (supabase/024, 258):
// marks are locked once submitted, nobody approves their own, and families
// read nothing until it is released.

type View = "mine" | "approve" | "release" | "all";

const Results = () => {
  const navigate = useNavigate();
  const { user } = useAuth() as { user: { id: string } | null };
  const { schoolId, roles } = useSchool();
  const { setError, setNotice } = useActionFeedback();
  const isLeader = roles.some((r) => r === "owner" || r === "admin" || r === "principal");
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [termId, setTermId] = useState("");
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [view, setView] = useState<View>(isLeader ? "approve" : "mine");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    Promise.all([fetchTerms(schoolId), fetchUnits(schoolId)])
      .then(([t, u]) => {
        setTerms(t);
        setTermId((cur) => cur || t.find((x) => x.is_current)?.id || t[0]?.id || "");
        setUnits(u);
      })
      .catch((err: Error) => setError(err.message));
  }, [schoolId, setError]);

  const loadSheets = useCallback(() => {
    if (!schoolId || !termId) return;
    fetchSheets(schoolId, termId).then(setSheets).catch((err: Error) => setError(err.message));
  }, [schoolId, termId, setError]);
  useEffect(loadSheets, [loadSheets]);

  const me = user?.id;
  const canTeach = useCallback(
    (u: Unit) => u.teacherId === me || u.formTeacherId === me || (!!me && u.coTeacherIds.includes(me)) || (u.kind === "subject" && !u.teacherId && isLeader),
    [me, isLeader],
  );
  const sheetOf = useMemo(() => {
    const m = new Map<string, Sheet>();
    sheets.forEach((s) => m.set(s.class_subject_id ? `s:${s.class_subject_id}` : `c:${s.course_id}`, s));
    return m;
  }, [sheets]);

  const rows = useMemo(() => {
    const all = (units || []).filter((u) => u.pupils > 0);
    const st = (u: Unit) => sheetOf.get(u.key)?.status;
    switch (view) {
      case "mine":
        return all.filter(canTeach);
      case "approve":
        return all.filter((u) => st(u) === "submitted");
      case "release":
        return all.filter((u) => st(u) === "approved");
      default:
        return all;
    }
  }, [units, view, sheetOf, canTeach]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { mine: 0, approve: 0, release: 0, all: 0 };
    (units || []).filter((u) => u.pupils > 0).forEach((u) => {
      c.all += 1;
      if (canTeach(u)) c.mine += 1;
      const s = sheetOf.get(u.key)?.status;
      if (s === "submitted") c.approve += 1;
      if (s === "approved") c.release += 1;
    });
    return c;
  }, [units, sheetOf, canTeach]);

  const open = async (u: Unit) => {
    const existing = sheetOf.get(u.key);
    if (existing) return navigate(`/Results/${existing.id}`);
    if (!canTeach(u)) return setError("Its teacher has not started this sheet yet.");
    setBusy(u.key);
    try {
      const s = await openSheet(u, termId);
      navigate(`/Results/${s.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const releaseAll = async () => {
    const ready = sheets.filter((s) => s.status === "approved");
    if (!ready.length) return;
    if (!(await confirmDialog({ title: `Release ${ready.length} approved sheet${ready.length === 1 ? "" : "s"}?`, body: "Students and parents can see these results straight away, and are told.", confirmLabel: "Release", tone: "primary" }))) return;
    setBusy("all");
    let done = 0;
    for (const s of ready) {
      try {
        await releaseSheet(s.id);
        done += 1;
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setBusy(null);
    setNotice(`${done} sheet${done === 1 ? "" : "s"} released to families.`);
    loadSheets();
  };

  const views: { id: View; label: string; show: boolean }[] = [
    { id: "approve", label: "To approve", show: isLeader },
    { id: "release", label: "Ready to release", show: isLeader },
    { id: "mine", label: "My subjects", show: counts.mine > 0 || !isLeader },
    { id: "all", label: "All subjects", show: isLeader },
  ];

  // Grouped by class, as a school thinks of them.
  const groups = useMemo(() => {
    const g = new Map<string, Unit[]>();
    rows.forEach((u) => {
      if (!g.has(u.where)) g.set(u.where, []);
      g.get(u.where)!.push(u);
    });
    return [...g.entries()];
  }, [rows]);

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Results"
        subtitle={isLeader ? "Term results: teachers enter the marks, you approve and release them, and families see them on each child's report." : "Enter each pupil's CA and exam marks for the term, then submit them for approval."}
      >
        <div className="tw-flex tw-flex-col tw-gap-4 [font-family:inherit]">
          <div className="tw-flex tw-flex-wrap tw-items-end tw-gap-3">
            <label className="tw-flex tw-w-[280px] tw-flex-col tw-gap-1 mobile:tw-w-full">
              <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"Term"}</span>
              <Select
                value={termId}
                onChange={setTermId}
                options={(terms || []).map((t) => ({ value: t.id, label: `${t.name}${t.sessions?.name ? ` · ${t.sessions.name}` : ""}${t.is_current ? " (current)" : ""}` }))}
                placeholder={terms && !terms.length ? "No terms set up yet" : "Choose a term"}
              />
            </label>
            <div className="tw-flex tw-flex-1 tw-flex-wrap tw-gap-1 tw-rounded-full tw-bg-bg tw-p-1 mobile:tw-flex-none">
              {views.filter((v) => v.show).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={`tw-whitespace-nowrap tw-rounded-full tw-border-0 tw-px-4 tw-py-1.5 tw-text-[13.5px] tw-cursor-pointer [font-family:inherit] ${
                    view === v.id ? "tw-bg-surface tw-font-semibold tw-text-brand tw-shadow-1" : "tw-bg-transparent tw-text-ink-2 hover:tw-text-ink"
                  }`}
                >
                  {v.label}
                  {counts[v.id] ? <span className={`tw-ml-1.5 tw-rounded-full tw-px-1.5 tw-text-[11.5px] ${view === v.id ? "tw-bg-brand-soft" : "tw-bg-surface"}`}>{counts[v.id]}</span> : null}
                </button>
              ))}
            </div>
            {isLeader && view === "release" && counts.release ? (
              <button type="button" disabled={busy === "all"} onClick={releaseAll} className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border-0 tw-bg-brand tw-px-4 tw-py-2 tw-text-[13.5px] tw-font-semibold tw-text-white tw-cursor-pointer hover:tw-opacity-90 disabled:tw-opacity-50 [font-family:inherit]">
                <Svg d={I.send} size={14} />
                {busy === "all" ? "Releasing…" : `Release all ${counts.release}`}
              </button>
            ) : null}
          </div>

          {terms && !terms.length ? (
            <div className={`${card} tw-p-8 tw-text-center tw-text-[14px] tw-text-ink-3`}>{"Set up the session and its terms first, under School admin → Academic calendar."}</div>
          ) : units === null ? (
            <SkeletonList rows={5} />
          ) : !groups.length ? (
            <div className={`${card} tw-p-10 tw-text-center`}>
              <p className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">
                {view === "approve" ? "Nothing waiting for approval" : view === "release" ? "Nothing approved and waiting to be released" : view === "mine" ? "You have no subjects with pupils" : "No subjects with pupils yet"}
              </p>
              <p className="tw-m-0 tw-mt-1 tw-text-[13.5px] tw-text-ink-3">
                {view === "mine"
                  ? "A teacher sees the subjects they teach (School admin → Classes & subjects) in classes that have pupils."
                  : view === "approve" || view === "release"
                  ? "Sheets appear here as teachers submit them."
                  : "Give classes their subjects and pupils under School admin → Classes & subjects."}
              </p>
            </div>
          ) : (
            groups.map(([where, list]) => (
              <section key={where} className={`${card} tw-overflow-hidden`}>
                <header className="tw-flex tw-items-center tw-justify-between tw-bg-bg tw-px-5 tw-py-2.5">
                  <h3 className="tw-m-0 tw-text-[14px] tw-font-bold tw-text-ink">{where}</h3>
                  <span className="tw-text-[12.5px] tw-text-ink-3">{`${list.length} subject${list.length === 1 ? "" : "s"}`}</span>
                </header>
                <ul className="tw-m-0 tw-list-none tw-p-0">
                  {list.map((u) => {
                    const s = sheetOf.get(u.key);
                    const status = s?.status as Status | undefined;
                    const mineToMark = canTeach(u) && (!status || status === "draft" || status === "returned");
                    return (
                      <li key={u.key}>
                        <button
                          type="button"
                          onClick={() => open(u)}
                          disabled={busy === u.key}
                          className="tw-flex tw-w-full tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-1 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-bg-transparent tw-px-5 tw-py-3 tw-text-left tw-cursor-pointer tw-transition-colors hover:tw-bg-brand-soft disabled:tw-opacity-60 [font-family:inherit]"
                        >
                          <span className="tw-flex tw-min-w-[200px] tw-flex-1 tw-flex-col">
                            <span className="tw-text-[14.5px] tw-font-semibold tw-text-ink">{u.title}</span>
                            <span className="tw-text-[12.5px] tw-text-ink-3">{`${u.teacher ? displayName(u.teacher) : "No teacher yet"} · ${u.pupils} pupil${u.pupils === 1 ? "" : "s"}`}</span>
                          </span>
                          {status ? <Chip tone={statusTone(status)}>{STATUS_LABEL[status]}</Chip> : <Chip tone="muted">{"Not started"}</Chip>}
                          <span className="tw-inline-flex tw-min-w-[120px] tw-items-center tw-justify-end tw-gap-1 tw-text-[13px] tw-font-semibold tw-text-brand">
                            {busy === u.key ? "Opening…" : mineToMark ? (status ? "Continue marking" : "Enter marks") : status === "submitted" && isLeader ? "Review" : status ? "View" : ""}
                            {status || mineToMark ? <Svg d={I.chevron} size={15} /> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </Page>
    </div>
  );
};

export default Results;
