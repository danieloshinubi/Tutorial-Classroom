import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useActionFeedback } from "../Toast";
import { confirmDialog } from "../Confirm";
import { Select, SkeletonList, displayName, initials, formatDate, type Profile } from "../UI";
import { fetchParticipants, decideEnrollment, removeParticipant } from "../../lib/api";
import { addCourseTeacher, courseStaff, makeCourseLead, removeCourseTeacher, schoolTeachingStaff, type TeacherPerson } from "../../lib/courseTeamApi";

// A course's People tab (TypeScript + Tailwind, 2026-10-14): its teachers,
// the pupils asking to join, and the pupils in it.
//
// Teachers (supabase/260): the lead, co-teachers and, for a course of a
// class's subject, that subject's teacher, all with the same rights. Anyone
// who runs the course adds or removes co-teachers and can hand the lead to
// one of them (the old lead stays on), so a teacher taking over a class can
// run it from day one. A member of staff who asked to join as if a pupil can
// be made a teacher straight from their request.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = { status: "pending" | "approved" | "declined"; requested_at: string; decided_at: string | null; message: string | null; profiles: any };

const Avatar = ({ p, size = 40 }: { p: Profile & { avatar_url?: string | null }; size?: number }) =>
  p.avatar_url ? (
    <img src={p.avatar_url} alt="" className="tw-shrink-0 tw-rounded-full tw-object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="tw-inline-flex tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-font-bold tw-text-brand" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {initials(p)}
    </span>
  );

const Chip = ({ tone = "muted", children }: { tone?: "brand" | "muted" | "warn" | "good"; children: React.ReactNode }) => (
  <span
    className={`tw-inline-flex tw-items-center tw-whitespace-nowrap tw-rounded-full tw-px-2.5 tw-py-0.5 tw-text-[12px] tw-font-semibold ${
      tone === "brand" ? "tw-bg-brand-soft tw-text-brand" : tone === "warn" ? "tw-bg-warn-soft tw-text-warn-ink" : tone === "good" ? "tw-bg-success-soft tw-text-success" : "tw-bg-bg tw-text-ink-2"
    }`}
  >
    {children}
  </span>
);

const btn = (kind: "primary" | "secondary" | "danger" = "secondary") =>
  `tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-px-3.5 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-cursor-pointer tw-transition-colors disabled:tw-cursor-not-allowed disabled:tw-opacity-50 [font-family:inherit] ${
    kind === "primary"
      ? "tw-border-0 tw-bg-brand tw-text-white hover:tw-opacity-90"
      : kind === "danger"
      ? "tw-border tw-border-solid tw-border-danger-soft tw-bg-surface tw-text-danger hover:tw-bg-danger-soft"
      : "tw-border tw-border-solid tw-border-line tw-bg-surface tw-text-ink hover:tw-border-brand hover:tw-text-brand"
  }`;

const Section = ({ title, count, countTone, hint, children }: { title: string; count?: number; countTone?: "warn" | "muted"; hint?: string; children: React.ReactNode }) => (
  <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-shadow-1">
    <header className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-5 tw-py-3">
      <h3 className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">{title}</h3>
      {count != null ? <Chip tone={countTone === "warn" && count > 0 ? "warn" : "muted"}>{count}</Chip> : null}
      {hint ? <span className="tw-ml-auto tw-text-[12.5px] tw-text-ink-3">{hint}</span> : null}
    </header>
    {children}
  </section>
);

const Person = ({ p, sub, chips, children }: { p: any; sub?: string; chips?: React.ReactNode; children?: React.ReactNode }) => (
  <li className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-5 tw-py-3 last:tw-border-b-0">
    <Avatar p={p} />
    <span className="tw-flex tw-min-w-[160px] tw-flex-1 tw-flex-col">
      <span className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
        <span className="tw-text-[14.5px] tw-font-semibold tw-text-ink">{displayName(p)}</span>
        {chips}
      </span>
      {sub ? <span className="tw-text-[12.5px] tw-text-ink-3">{sub}</span> : null}
    </span>
    {children ? <span className="tw-flex tw-flex-wrap tw-gap-2">{children}</span> : null}
  </li>
);

const Empty = ({ children }: { children: React.ReactNode }) => <p className="tw-m-0 tw-px-5 tw-py-4 tw-text-[13.5px] tw-text-ink-3">{children}</p>;

const PeopleTab = ({ course, canManage, schoolId, onChanged }: { course: { id: string; code: string; title?: string | null }; canManage: boolean; schoolId: string; onChanged?: () => void }) => {
  const { setError, setNotice } = useActionFeedback();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [teachers, setTeachers] = useState<TeacherPerson[] | null>(null);
  const [staff, setStaff] = useState<TeacherPerson[]>([]);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!schoolId) return;
    fetchParticipants({ courseId: course.id, schoolId })
      .then((r: Row[]) => setRows(r))
      .catch((err: Error) => {
        setRows([]);
        setError(err.message || "Could not load participants.");
      });
    courseStaff(course.id)
      .then((s) => setTeachers(s.teachers))
      .catch(() => setTeachers([]));
  }, [course.id, schoolId, setError]);
  useEffect(load, [load]);
  useEffect(() => {
    if (canManage && schoolId) schoolTeachingStaff(schoolId).then(setStaff).catch(() => setStaff([]));
  }, [canManage, schoolId]);

  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await work();
      if (done) setNotice(done);
      load();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const teacherIds = useMemo(() => new Set((teachers || []).map((t) => t.id)), [teachers]);
  const staffIds = useMemo(() => new Set(staff.map((s) => s.id)), [staff]);
  const pending = (rows || []).filter((r) => r.status === "pending");
  const approved = (rows || []).filter((r) => r.status === "approved");
  const declined = (rows || []).filter((r) => r.status === "declined");
  const addable = staff.filter((s) => !teacherIds.has(s.id)).sort((a, b) => displayName(a).localeCompare(displayName(b)));

  const addTeacher = (id: string, name: string) => run(`t:${id}`, () => addCourseTeacher(course.id, id), `${name} now teaches ${course.code}, with the same rights as you.`);

  return (
    <div className="tw-flex tw-flex-col tw-gap-5 [font-family:inherit]">
      {/* Teachers */}
      <Section title="Teachers" count={teachers?.length} hint="Every teacher here can do everything the lead can.">
        {teachers === null ? (
          <div className="tw-p-4"><SkeletonList rows={1} avatar /></div>
        ) : !teachers.length ? (
          <Empty>{"No teacher yet."}</Empty>
        ) : (
          <ul className="tw-m-0 tw-list-none tw-p-0">
            {teachers.map((t) => (
              <Person
                key={t.id}
                p={t}
                sub={t.email || undefined}
                chips={t.lead ? <Chip tone="brand">{"Lead"}</Chip> : t.via_subject ? <Chip>{"Subject teacher"}</Chip> : <Chip>{"Co-teacher"}</Chip>}
              >
                {canManage && !t.lead && !t.via_subject ? (
                  <>
                    <button
                      type="button"
                      className={btn()}
                      disabled={busy !== null}
                      onClick={async () => {
                        if (await confirmDialog({ title: `Make ${displayName(t)} the lead teacher?`, body: "The current lead stays on as a co-teacher. Everyone keeps the same rights.", confirmLabel: "Make lead", tone: "primary" }))
                          run(`l:${t.id}`, () => makeCourseLead(course.id, t.id), `${displayName(t)} is now the lead teacher.`);
                      }}
                    >
                      {"Make lead"}
                    </button>
                    <button
                      type="button"
                      className={btn("danger")}
                      disabled={busy !== null}
                      onClick={async () => {
                        if (await confirmDialog({ title: `Remove ${displayName(t)} as a teacher?`, body: `They will no longer be able to run ${course.code}.`, confirmLabel: "Remove", tone: "danger" }))
                          run(`r:${t.id}`, () => removeCourseTeacher(course.id, t.id), `${displayName(t)} no longer teaches ${course.code}.`);
                      }}
                    >
                      {"Remove"}
                    </button>
                  </>
                ) : null}
              </Person>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-bg-bg tw-px-5 tw-py-3">
            <div className="tw-min-w-[240px] tw-flex-1">
              <Select
                searchable
                value={adding}
                onChange={setAdding}
                placeholder={addable.length ? "Add a teacher…" : "Every teacher already teaches this course"}
                options={addable.map((s) => ({ value: s.id, label: `${displayName(s)}${s.role && s.role !== "teacher" ? ` · ${s.role === "owner" ? "proprietor" : s.role}` : ""}` }))}
              />
            </div>
            <button
              type="button"
              className={btn("primary")}
              disabled={!adding || busy !== null}
              onClick={() => {
                const s = staff.find((x) => x.id === adding);
                if (s) addTeacher(s.id, displayName(s)).then(() => setAdding(""));
              }}
            >
              {"Add teacher"}
            </button>
          </div>
        ) : null}
      </Section>

      {/* Requests */}
      {canManage ? (
        <Section title="Asking to join" count={pending.length} countTone="warn">
          {rows === null ? (
            <div className="tw-p-4"><SkeletonList rows={2} avatar /></div>
          ) : !pending.length ? (
            <Empty>{"No one is waiting."}</Empty>
          ) : (
            <ul className="tw-m-0 tw-list-none tw-p-0">
              {pending.map((r) => {
                const p = r.profiles;
                const isStaff = staffIds.has(p.id);
                return (
                  <React.Fragment key={p.id}>
                    <Person p={p} sub={`Asked ${formatDate(r.requested_at)}${r.message ? ` · “${r.message}”` : ""}`} chips={isStaff ? <Chip>{"Staff"}</Chip> : null}>
                      {isStaff ? (
                        <button type="button" className={btn("primary")} disabled={busy !== null} onClick={() => addTeacher(p.id, displayName(p))}>
                          {"Add as teacher"}
                        </button>
                      ) : null}
                      <button type="button" className={btn(isStaff ? "secondary" : "primary")} disabled={busy !== null} onClick={() => run(`a:${p.id}`, () => decideEnrollment({ courseId: course.id, userId: p.id, approve: true }), `${displayName(p)} joined ${course.code}.`)}>
                        {isStaff ? "Approve as pupil" : "Approve"}
                      </button>
                      <button type="button" className={btn()} disabled={busy !== null} onClick={() => run(`d:${p.id}`, () => decideEnrollment({ courseId: course.id, userId: p.id, approve: false }))}>
                        {"Decline"}
                      </button>
                    </Person>
                  </React.Fragment>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}

      {/* Pupils */}
      <Section title="Pupils" count={approved.length}>
        {rows === null ? (
          <div className="tw-p-4"><SkeletonList rows={4} avatar /></div>
        ) : !approved.length ? (
          <Empty>{canManage ? "Nobody has joined this course yet." : "Only the course's teachers can see the full class list."}</Empty>
        ) : (
          <ul className="tw-m-0 tw-list-none tw-p-0">
            {approved.map((r) => (
              <Person key={r.profiles.id} p={r.profiles} sub={r.decided_at ? `Joined ${formatDate(r.decided_at, { withTime: false })}` : undefined} chips={staffIds.has(r.profiles.id) ? <Chip>{"Staff"}</Chip> : null}>
                {canManage && staffIds.has(r.profiles.id) ? (
                  <button type="button" className={btn()} disabled={busy !== null} onClick={() => addTeacher(r.profiles.id, displayName(r.profiles))}>
                    {"Make a teacher"}
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    className={btn("danger")}
                    disabled={busy !== null}
                    onClick={async () => {
                      if (await confirmDialog({ title: `Remove ${displayName(r.profiles)} from ${course.code}?`, confirmLabel: "Remove", tone: "danger" }))
                        run(`x:${r.profiles.id}`, () => removeParticipant({ courseId: course.id, userId: r.profiles.id }));
                    }}
                  >
                    {"Remove"}
                  </button>
                ) : null}
              </Person>
            ))}
          </ul>
        )}
      </Section>

      {canManage && declined.length ? (
        <Section title="Declined" count={declined.length}>
          <ul className="tw-m-0 tw-list-none tw-p-0">
            {declined.map((r) => (
              <Person key={r.profiles.id} p={r.profiles} sub={r.decided_at ? formatDate(r.decided_at) : undefined}>
                <button type="button" className={btn()} disabled={busy !== null} onClick={() => run(`a:${r.profiles.id}`, () => decideEnrollment({ courseId: course.id, userId: r.profiles.id, approve: true }))}>
                  {"Approve after all"}
                </button>
              </Person>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
};

export default PeopleTab;
