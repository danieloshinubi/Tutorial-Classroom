import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { ExportButton } from "../../Components/ExportButton";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchMarkableClasses,
  fetchAttendanceForClass,
  saveAttendance,
  fetchAttendanceRecords,
  fetchMyChildrenAttendance,
  fetchMyChildrenSchoolAttendance,
  fetchSchoolAttendanceRecords,
  fetchMySchoolAttendance,
  fetchSchoolPeopleForAttendance,
  logSchoolAttendance,
  fetchAttendanceDevices,
  createAttendanceDevice,
  setAttendanceDeviceActive,
} from "../../lib/api";
import { fetchSlots, fetchTimetableSetup } from "../../lib/timetableApi";
import { analyseAttendance } from "../../lib/analysis";
import { todayISO, daysAgoISO } from "../../lib/dates";
import { Page, Button, Select, DatePicker, DateTimePicker, Modal, displayName, initials, formatDate, SkeletonList, SkeletonTable, type Profile } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

// Attendance, rebuilt around two plain ideas (2026-10-06):
//
//   Class register   was each pupil in this lesson? A teacher marks it.
//   Arrivals         what time did someone (student or staff) get to school?
//                    A scanner, a card reader or the front desk records it.
//
// The old page put both under "attendance" with seven tabs side by side and
// called arrivals "resumption", which read like the start of a term. Now:
// a section switcher with a one-line explanation of each, a Today overview
// for leadership, today's lessons taken from the timetable (a register is
// identified by its exact date and time, which teachers used to have to type
// to the minute), tap-a-pupil marking, and the setup jobs (adding an arrival
// by hand, connecting a scanner) as buttons inside Arrivals, not tabs.
// The data and every rule underneath are unchanged.

/* -------------------------------------------------------------- helpers */
type Section = "today" | "register" | "arrivals" | "children" | "mine";

// Loose rows: these come from api.js, which is still JavaScript.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRow = Record<string, any>;

const nowLocal = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const toPicker = (iso: string) => {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// "Today 08:00", "Yesterday 11:00", "Mon 22 Sep, 08:00".
const when = (iso: string) => {
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((start.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return `Today ${time(iso)}`;
  if (diff === 1) return `Yesterday ${time(iso)}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time(iso)}`;
};
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const HOW: Record<string, string> = { biometric: "Fingerprint", card: "Card", manual: "Front desk" };

/* ---------------------------------------------------------------- icons */
const Svg = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const I = {
  today: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  register: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  arrivals: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  children: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  me: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  plus: "M12 5v14M5 12h14",
  scan: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
};

/* ----------------------------------------------------------- small parts */
const card = "tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-shadow-1";
const chip = (on: boolean) =>
  `tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-px-3 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-cursor-pointer tw-transition-colors [font-family:inherit] ${
    on ? "tw-border-brand tw-bg-brand-soft tw-text-brand" : "tw-border-line tw-bg-surface tw-text-ink-2 hover:tw-border-brand hover:tw-text-brand"
  }`;

const Avatar = ({ person, size = 40 }: { person: Profile | null | undefined; size?: number }) =>
  person?.avatar_url ? (
    <img src={person.avatar_url} alt="" className="tw-shrink-0 tw-rounded-full tw-object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="tw-inline-flex tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-font-bold tw-text-brand"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initials(person || {})}
    </span>
  );

const Stat = ({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "warn" | "brand"; hint?: string }) => (
  <div className={`${card} tw-flex tw-flex-col tw-gap-1 tw-p-4`}>
    <span className="tw-text-[12.5px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{label}</span>
    <span
      className={`tw-text-[28px] tw-font-bold tw-leading-none ${
        tone === "good" ? "tw-text-success" : tone === "bad" ? "tw-text-danger" : tone === "warn" ? "tw-text-warn-ink" : tone === "brand" ? "tw-text-brand" : "tw-text-ink"
      }`}
    >
      {value}
    </span>
    {hint ? <span className="tw-text-[12.5px] tw-text-ink-3">{hint}</span> : null}
  </div>
);

const Pill = ({ tone, children }: { tone: "good" | "bad" | "brand" | "muted"; children: React.ReactNode }) => (
  <span
    className={`tw-inline-flex tw-items-center tw-rounded-full tw-px-2.5 tw-py-0.5 tw-text-[12px] tw-font-semibold ${
      tone === "good" ? "tw-bg-success-soft tw-text-success" : tone === "bad" ? "tw-bg-danger-soft tw-text-danger" : tone === "brand" ? "tw-bg-brand-soft tw-text-brand" : "tw-bg-bg tw-text-ink-2"
    }`}
  >
    {children}
  </span>
);

const Empty = ({ icon, title, children, action }: { icon: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) => (
  <div className="tw-flex tw-flex-col tw-items-center tw-gap-2 tw-px-6 tw-py-10 tw-text-center">
    <span className="tw-inline-flex tw-h-12 tw-w-12 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-text-brand">
      <Svg d={icon} size={22} />
    </span>
    <strong className="tw-text-[15px] tw-text-ink">{title}</strong>
    {children ? <p className="tw-m-0 tw-max-w-[440px] tw-text-[13.5px] tw-leading-relaxed tw-text-ink-3">{children}</p> : null}
    {action}
  </div>
);

const Explain = ({ children }: { children: React.ReactNode }) => (
  <p className="tw-m-0 tw-mb-4 tw-max-w-[760px] tw-text-[14px] tw-leading-relaxed tw-text-ink-2">{children}</p>
);

const RangeBar = ({ from, to, setFrom, setTo, children }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; children?: React.ReactNode }) => (
  <div className="tw-flex tw-flex-wrap tw-items-end tw-gap-3">
    <label className="tw-flex tw-w-[180px] tw-flex-col tw-gap-1 mobile:tw-w-[calc(50%-6px)]">
      <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"From"}</span>
      <DatePicker value={from} onChange={setFrom} />
    </label>
    <label className="tw-flex tw-w-[180px] tw-flex-col tw-gap-1 mobile:tw-w-[calc(50%-6px)]">
      <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"To"}</span>
      <DatePicker value={to} onChange={setTo} />
    </label>
    <div className="tw-flex tw-flex-1 tw-flex-wrap tw-justify-end tw-gap-2">{children}</div>
  </div>
);

const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="tw-overflow-x-auto">
    <table className="tw-w-full tw-border-collapse tw-text-[13.5px]">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} className="tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2.5 tw-text-left tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
const Td = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) => (
  <td className={`tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2.5 tw-align-middle ${muted ? "tw-text-ink-3" : "tw-text-ink"}`}>{children}</td>
);

/* ================================================================ TODAY */
// For leadership: how today is going, before any detail.
const TodayView = ({ schoolId, go }: { schoolId: string; go: (s: Section) => void }) => {
  const [marks, setMarks] = useState<AnyRow[] | null>(null);
  const [arrivals, setArrivals] = useState<AnyRow[]>([]);
  const [classes, setClasses] = useState<AnyRow[]>([]);
  const { setError } = useActionFeedback();

  useEffect(() => {
    const today = todayISO();
    Promise.all([
      fetchAttendanceRecords({ schoolId, classId: undefined, from: today, to: today }),
      fetchSchoolAttendanceRecords({ schoolId, personId: undefined, from: today, to: today }),
      fetchMarkableClasses(schoolId),
    ])
      .then(([m, a, c]) => {
        setMarks(m || []);
        setArrivals(a || []);
        setClasses(c || []);
      })
      .catch((err: Error) => setError(err.message || "Could not load today's attendance."));
  }, [schoolId, setError]);

  const absent = useMemo(() => (marks || []).filter((r) => r.status === "absent"), [marks]);
  const absentPupils = new Set(absent.map((r) => r.student?.id)).size;
  const registers = new Set((marks || []).map((r) => `${r.classes?.id}|${r.session_at}`)).size;
  const markedClasses = new Set((marks || []).map((r) => r.classes?.id));
  const notMarked = classes.filter((c) => !markedClasses.has(c.id));
  const byClass = useMemo(() => {
    const m = new Map<string, { name: string; rows: AnyRow[] }>();
    absent.forEach((r) => {
      const k = r.classes?.id || "?";
      if (!m.has(k)) m.set(k, { name: r.classes?.name || "Class", rows: [] });
      m.get(k)!.rows.push(r);
    });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [absent]);

  if (marks === null) return <SkeletonList rows={4} />;

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <Explain>{"How today is going across the school: lesson registers taken, who was marked absent, and who has arrived."}</Explain>
      <div className="tw-grid tw-grid-cols-4 tw-gap-3 mobile:tw-grid-cols-2">
        <Stat label="Registers taken" value={registers} tone="brand" hint={`${markedClasses.size} of ${classes.length} classes`} />
        <Stat label="Absent today" value={absentPupils} tone={absentPupils ? "bad" : "good"} hint={absentPupils ? "pupils missed a lesson" : "nobody so far"} />
        <Stat label="Arrived today" value={new Set(arrivals.map((a) => a.person?.id)).size} hint="students and staff" />
        <Stat label="Not marked yet" value={notMarked.length} tone={notMarked.length ? "warn" : "good"} hint={notMarked.length ? "classes with no register" : "every class done"} />
      </div>

      <div className="tw-grid tw-grid-cols-2 tw-gap-4 mobile:tw-grid-cols-1">
        <section className={`${card} tw-p-5`}>
          <header className="tw-mb-3 tw-flex tw-items-center tw-justify-between tw-gap-2">
            <h3 className="tw-m-0 tw-text-[16px] tw-font-semibold tw-text-ink">{"Absent today"}</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => go("register")}>{"Take a register"}</Button>
          </header>
          {byClass.length ? (
            <div className="tw-flex tw-flex-col tw-gap-3">
              {byClass.map((c) => (
                <div key={c.name}>
                  <div className="tw-mb-1.5 tw-text-[12.5px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{c.name}</div>
                  <div className="tw-flex tw-flex-wrap tw-gap-2">
                    {c.rows.map((r) => (
                      <span key={r.id} className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-bg-danger-soft tw-py-1 tw-pl-1 tw-pr-3 tw-text-[13px] tw-text-danger">
                        <Avatar person={r.student} size={24} />
                        {displayName(r.student)}
                        <span className="tw-text-[11.5px] tw-opacity-75">{time(r.session_at)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={I.check} title={registers ? "Everyone marked was present" : "No registers taken yet today"} />
          )}
          {notMarked.length ? (
            <p className="tw-m-0 tw-mt-4 tw-text-[13px] tw-text-ink-3">{`No register yet: ${notMarked.slice(0, 8).map((c) => c.name).join(", ")}${notMarked.length > 8 ? ` and ${notMarked.length - 8} more` : ""}.`}</p>
          ) : null}
        </section>

        <section className={`${card} tw-p-5`}>
          <header className="tw-mb-3 tw-flex tw-items-center tw-justify-between tw-gap-2">
            <h3 className="tw-m-0 tw-text-[16px] tw-font-semibold tw-text-ink">{"Arrived today"}</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => go("arrivals")}>{"All arrivals"}</Button>
          </header>
          {arrivals.length ? (
            <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0">
              {arrivals.slice(0, 10).map((a) => (
                <li key={a.id} className="tw-flex tw-items-center tw-gap-3">
                  <Avatar person={a.person} size={30} />
                  <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-[13.5px] tw-text-ink">{displayName(a.person)}</span>
                  <span className="tw-text-[12.5px] tw-text-ink-3">{HOW[a.source] || a.source}</span>
                  <span className="tw-w-[54px] tw-text-right tw-text-[13px] tw-font-semibold tw-text-ink">{time(a.resumed_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={I.arrivals} title="No arrivals recorded yet today">{"Arrivals come from a connected scanner or card reader, or the front desk adds them."}</Empty>
          )}
        </section>
      </div>
    </div>
  );
};

/* ============================================================= REGISTER */
interface Lesson {
  key: string;
  classId: string;
  className: string;
  subject: string;
  start: string; // "08:00"
  end: string;
  at: string; // picker value for today at the start
  mine: boolean;
}

// Today's lessons for the classes this person can mark, from the timetable.
const useTodaysLessons = (schoolId: string, classes: AnyRow[], userId: string | undefined) => {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  // Whether the timetable has been looked at (found or not), so the register
  // does not open one class and then jump to the lesson on now.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!classes.length) return;
    let live = true;
    (async () => {
      try {
        const setup = await fetchTimetableSetup(schoolId);
        const term = setup.terms.find((t) => t.is_current) || setup.terms[0];
        if (!term) {
          if (live) setReady(true);
          return;
        }
        const slots = await fetchSlots(schoolId, term.id);
        const day = ((new Date().getDay() + 6) % 7) + 1; // 1 = Monday
        const allowed = new Map(classes.map((c) => [c.id as string, c.name as string]));
        const today = todayISO();
        const out = slots
          .filter((s) => s.day === day && allowed.has(s.class_id))
          .map((s) => {
            const p = setup.periods.find((x) => x.id === s.period_id);
            if (!p || p.is_break) return null;
            const cs = setup.classSubjects.find((x) => x.id === s.class_subject_id);
            const start = p.starts_at.slice(0, 5);
            return {
              key: s.id,
              classId: s.class_id,
              className: allowed.get(s.class_id) || "Class",
              subject: cs?.subject?.name || s.label || p.name,
              start,
              end: p.ends_at.slice(0, 5),
              at: `${today}T${start}`,
              mine: !!userId && (s.teacher_id === userId || cs?.teacher_id === userId),
            } as Lesson;
          })
          .filter((x): x is Lesson => !!x)
          .sort((a, b) => a.start.localeCompare(b.start));
        // A teacher sees their own lessons; someone with none of their own sees all.
        const mine = out.filter((l) => l.mine);
        if (live) {
          setLessons(mine.length ? mine : out);
          setReady(true);
        }
      } catch {
        if (live) {
          setLessons([]);
          setReady(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [schoolId, classes, userId]);
  return { lessons, ready };
};

const TakeRegister = ({ schoolId }: { schoolId: string }) => {
  const { user } = useAuth() as { user: { id: string } | null };
  const [classes, setClasses] = useState<AnyRow[] | null>(null);
  const [classId, setClassId] = useState("");
  const [sessionAt, setSessionAt] = useState(nowLocal());
  const [otherTime, setOtherTime] = useState(false);
  const [roster, setRoster] = useState<AnyRow[]>([]);
  const [draft, setDraft] = useState<Record<string, "present" | "absent">>({});
  const [recent, setRecent] = useState<{ at: string; total: number; absent: number }[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  useEffect(() => {
    fetchMarkableClasses(schoolId)
      .then((rows: AnyRow[]) => {
        setClasses(rows || []);
        setClassId((c) => c || rows?.[0]?.id || "");
      })
      .catch((err: Error) => {
        setClasses([]);
        setError(err.message || "Could not load your classes.");
      });
  }, [schoolId, setError]);

  const markable = useMemo(() => classes || [], [classes]);
  const { lessons, ready } = useTodaysLessons(schoolId, markable, user?.id);
  // The lesson on now (or next) is picked to start with, once.
  const picked = React.useRef(false);
  useEffect(() => {
    if (!ready || picked.current || !lessons.length) return;
    picked.current = true;
    const now = new Date().toTimeString().slice(0, 5);
    const pick = lessons.find((l) => l.start <= now && now < l.end) || lessons.find((l) => l.start > now) || lessons[lessons.length - 1];
    setClassId(pick.classId);
    setSessionAt(pick.at);
  }, [lessons, ready]);

  const loadRoster = useCallback(() => {
    if (!classId || !sessionAt || !ready) return;
    setLoading(true);
    fetchAttendanceForClass({ classId, schoolId, sessionAt })
      .then((rows: AnyRow[]) => {
        setRoster(rows || []);
        setDraft(Object.fromEntries((rows || []).map((r) => [r.student.id, r.mark?.status || "present"])));
      })
      .catch((err: Error) => setError(err.message || "Could not load this class."))
      .finally(() => setLoading(false));
  }, [classId, schoolId, sessionAt, ready, setError]);
  useEffect(loadRoster, [loadRoster]);

  const loadRecent = useCallback(() => {
    if (!classId) return;
    fetchAttendanceRecords({ schoolId, classId, from: daysAgoISO(14), to: todayISO() })
      .then((rows: AnyRow[]) => {
        const seen = new Map<string, { at: string; total: number; absent: number }>();
        (rows || []).forEach((r) => {
          if (!seen.has(r.session_at)) seen.set(r.session_at, { at: r.session_at, total: 0, absent: 0 });
          const s = seen.get(r.session_at)!;
          s.total += 1;
          if (r.status === "absent") s.absent += 1;
        });
        setRecent([...seen.values()].slice(0, 8));
      })
      .catch(() => setRecent([]));
  }, [classId, schoolId]);
  useEffect(loadRecent, [loadRecent]);

  const saved = roster.some((r) => r.mark);
  const changed = roster.filter((r) => (r.mark?.status || "present") !== draft[r.student.id]).length;
  const dirty = !saved || changed > 0;
  const absent = roster.filter((r) => draft[r.student.id] === "absent").length;
  const present = roster.length - absent;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? roster.filter((r) => displayName(r.student).toLowerCase().includes(q)) : roster;
  }, [roster, query]);
  const selected = new Date(sessionAt).getTime();
  const className = classes?.find((c) => c.id === classId)?.name || "";

  const toggle = (id: string) => setDraft((d) => ({ ...d, [id]: d[id] === "absent" ? "present" : "absent" }));
  const markAll = (status: "present" | "absent") => setDraft(Object.fromEntries(roster.map((r) => [r.student.id, status])));

  const save = async () => {
    setSaving(true);
    try {
      await saveAttendance({ schoolId, classId, sessionAt, records: roster.map((r) => ({ student_id: r.student.id, status: draft[r.student.id] })) });
      setNotice(`Register saved: ${className}, ${when(new Date(sessionAt).toISOString())}.`);
      loadRoster();
      loadRecent();
    } catch (err) {
      setError((err as Error).message || "Could not save the register.");
    } finally {
      setSaving(false);
    }
  };

  if (classes === null) return <SkeletonList rows={5} avatar />;
  if (!classes.length) {
    return (
      <section className={card}>
        <Empty icon={I.register} title="You have no class to take a register for">
          {"You can take the register for a class you are the form teacher of, or teach a subject in. The school office sets that up under School admin → Classes & subjects."}
        </Empty>
      </section>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {/* Step 1: which lesson */}
      <section className={`${card} tw-p-5`}>
        <div className="tw-mb-3 tw-flex tw-items-center tw-gap-2">
          <span className="tw-inline-flex tw-h-6 tw-w-6 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand tw-text-[12px] tw-font-bold tw-text-white">{"1"}</span>
          <h3 className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">{"Choose the lesson"}</h3>
        </div>

        {lessons.length ? (
          <>
            <p className="tw-m-0 tw-mb-2 tw-text-[13px] tw-text-ink-3">{"Your lessons today, from the timetable:"}</p>
            <div className="tw-flex tw-flex-wrap tw-gap-2">
              {lessons.map((l) => {
                const on = !otherTime && classId === l.classId && selected === new Date(l.at).getTime();
                return (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => {
                      setOtherTime(false);
                      setClassId(l.classId);
                      setSessionAt(l.at);
                    }}
                    className={`tw-flex tw-flex-col tw-items-start tw-gap-0.5 tw-rounded-xl tw-border tw-border-solid tw-px-3.5 tw-py-2 tw-text-left tw-cursor-pointer tw-transition-colors [font-family:inherit] ${
                      on ? "tw-border-brand tw-bg-brand-soft" : "tw-border-line tw-bg-surface hover:tw-border-brand"
                    }`}
                  >
                    <span className={`tw-text-[12px] tw-font-semibold ${on ? "tw-text-brand" : "tw-text-ink-3"}`}>{`${l.start}–${l.end}`}</span>
                    <span className="tw-text-[14px] tw-font-semibold tw-text-ink">{l.className}</span>
                    <span className="tw-text-[12.5px] tw-text-ink-2">{l.subject}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setOtherTime((v) => !v)} className={`tw-mt-3 ${chip(otherTime)}`}>
              <Svg d={I.edit} size={13} />
              {"A different class or time"}
            </button>
          </>
        ) : null}

        {!lessons.length || otherTime ? (
          <div className="tw-mt-3 tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"Class"}</span>
              <Select value={classId} onChange={setClassId} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"When the lesson started"}</span>
              <DateTimePicker value={sessionAt} onChange={setSessionAt} />
            </label>
            <p className="tw-col-span-2 tw-m-0 tw-text-[12.5px] tw-text-ink-3 mobile:tw-col-span-1">
              {"Each lesson has its own register. The same class at 8:00 and at 11:00 are two registers."}
            </p>
          </div>
        ) : null}

        {recent.length ? (
          <div className="tw-mt-4 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-pt-3">
            <p className="tw-m-0 tw-mb-2 tw-text-[13px] tw-text-ink-3">{`Registers already taken for ${className} (last 2 weeks), tap to open and correct:`}</p>
            <div className="tw-flex tw-flex-wrap tw-gap-2">
              {recent.map((r) => (
                <button
                  key={r.at}
                  type="button"
                  className={chip(selected === new Date(r.at).getTime())}
                  onClick={() => {
                    setOtherTime(true);
                    setSessionAt(toPicker(r.at));
                  }}
                >
                  <Svg d={I.history} size={13} />
                  {when(r.at)}
                  {r.absent ? <span className="tw-font-normal tw-text-danger">{`· ${r.absent} absent`}</span> : <span className="tw-font-normal tw-text-success">{"· all present"}</span>}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Step 2: who is absent */}
      <section className={`${card} tw-p-5`}>
        <div className="tw-mb-1 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <div className="tw-flex tw-items-center tw-gap-2">
            <span className="tw-inline-flex tw-h-6 tw-w-6 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand tw-text-[12px] tw-font-bold tw-text-white">{"2"}</span>
            <h3 className="tw-m-0 tw-text-[15px] tw-font-semibold tw-text-ink">{"Tap anyone who is absent"}</h3>
          </div>
          {saved ? <Pill tone="good">{"Register saved"}</Pill> : <Pill tone="muted">{"Not saved yet"}</Pill>}
        </div>
        <p className="tw-m-0 tw-mb-4 tw-text-[13px] tw-text-ink-3">{"Everyone starts as present. Tap a pupil to mark them absent, tap again to undo."}</p>

        {loading ? (
          <SkeletonList rows={5} avatar />
        ) : !roster.length ? (
          <Empty icon={I.children} title="No pupils in this class yet">{"Pupils are added to a class under School admin → Classes & subjects."}</Empty>
        ) : (
          <>
            <div className="tw-mb-4 tw-flex tw-flex-wrap tw-items-center tw-gap-4">
              <div className="tw-flex tw-items-baseline tw-gap-4">
                <span className="tw-text-[15px] tw-text-ink-2"><strong className="tw-text-[24px] tw-text-success">{present}</strong>{" present"}</span>
                <span className="tw-text-[15px] tw-text-ink-2"><strong className={`tw-text-[24px] ${absent ? "tw-text-danger" : "tw-text-ink-3"}`}>{absent}</strong>{" absent"}</span>
                <span className="tw-text-[13px] tw-text-ink-3">{`of ${roster.length}`}</span>
              </div>
              <div className="tw-h-2 tw-min-w-[120px] tw-flex-1 tw-overflow-hidden tw-rounded-full tw-bg-danger-soft">
                <div className="tw-h-full tw-rounded-full tw-bg-success tw-transition-all" style={{ width: `${(present / roster.length) * 100}%` }} />
              </div>
              <div className="tw-flex tw-flex-wrap tw-gap-2">
                {roster.length > 12 ? (
                  <label className="tw-flex tw-h-9 tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3">
                    <span className="tw-text-ink-3"><Svg d={I.search} size={14} /></span>
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a pupil" className="tw-w-[140px] tw-border-0 tw-bg-transparent tw-text-[13.5px] tw-text-ink tw-outline-none [font-family:inherit]" />
                  </label>
                ) : null}
                <Button type="button" variant="secondary" size="sm" onClick={() => markAll("present")}>{"All present"}</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => markAll("absent")}>{"All absent"}</Button>
              </div>
            </div>

            <div className="tw-grid tw-grid-cols-3 tw-gap-2.5 mobile:tw-grid-cols-1" role="list">
              {shown.map((r) => {
                const out = draft[r.student.id] === "absent";
                const name = displayName(r.student);
                return (
                  <button
                    key={r.student.id}
                    type="button"
                    role="switch"
                    aria-checked={out}
                    aria-label={`${name}: ${out ? "absent" : "present"}`}
                    onClick={() => toggle(r.student.id)}
                    className={`tw-flex tw-items-center tw-gap-3 tw-rounded-xl tw-border-2 tw-border-solid tw-p-3 tw-text-left tw-cursor-pointer tw-transition-all [font-family:inherit] ${
                      out ? "tw-border-danger tw-bg-danger-soft" : "tw-border-line tw-bg-surface hover:tw-border-brand"
                    }`}
                  >
                    <span className={out ? "tw-opacity-60" : ""}><Avatar person={r.student} /></span>
                    <span className={`tw-min-w-0 tw-flex-1 tw-truncate tw-text-[14px] tw-font-semibold ${out ? "tw-text-danger" : "tw-text-ink"}`}>{name}</span>
                    <span
                      className={`tw-inline-flex tw-shrink-0 tw-items-center tw-gap-1 tw-rounded-full tw-px-2.5 tw-py-1 tw-text-[12px] tw-font-bold ${
                        out ? "tw-bg-danger tw-text-white" : "tw-bg-success-soft tw-text-success"
                      }`}
                    >
                      <Svg d={out ? I.x : I.check} size={12} />
                      {out ? "Absent" : "Present"}
                    </span>
                  </button>
                );
              })}
            </div>
            {!shown.length ? <p className="tw-m-0 tw-py-4 tw-text-center tw-text-[13.5px] tw-text-ink-3">{"No pupil by that name in this class."}</p> : null}
          </>
        )}
      </section>

      {/* Stays at the bottom of the screen however long the class is. */}
      {roster.length && !loading ? (
        <div className={`${card} tw-sticky tw-bottom-3 tw-z-10 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-px-5 tw-py-3 tw-shadow-2`}>
          <span className="tw-text-[13.5px] tw-text-ink-2">
            {!saved
              ? `${className} · ${absent ? plural(absent, "pupil") + " absent" : "everyone present"}. Not saved yet.`
              : changed
              ? `${plural(changed, "change")} not saved yet.`
              : "Saved. Any change you make updates this register."}
          </span>
          <Button type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : saved ? "Save changes" : "Save register"}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const RECORD_COLUMNS = [
  { key: "session_at", label: "Lesson", type: "datetime" },
  { key: "classes.name", label: "Class" },
  { key: "student.first_name", label: "First name" },
  { key: "student.surname", label: "Surname" },
  { key: "status", label: "Status" },
];

const RegisterHistory = ({ schoolId }: { schoolId: string }) => {
  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const [from, setFrom] = useState(daysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [onlyAbsent, setOnlyAbsent] = useState(true);
  const { setError } = useActionFeedback();
  useEffect(() => {
    setRows(null);
    fetchAttendanceRecords({ schoolId, classId: undefined, from, to })
      .then((r: AnyRow[]) => setRows(r || []))
      .catch((err: Error) => {
        setRows([]);
        setError(err.message || "Could not load the registers.");
      });
  }, [schoolId, from, to, setError]);

  const all = rows || [];
  const absences = all.filter((r) => r.status === "absent");
  const registers = new Set(all.map((r) => `${r.classes?.id}|${r.session_at}`)).size;
  const rate = pct(all.length - absences.length, all.length);
  const shown = onlyAbsent ? absences : all;

  return (
    <section className={`${card} tw-flex tw-flex-col tw-gap-4 tw-p-5`}>
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <ExportButton columns={RECORD_COLUMNS} rows={all} filename={`class-registers-${from}-to-${to}`} />
      </RangeBar>
      {rows === null ? (
        <SkeletonTable rows={5} cols={4} />
      ) : !all.length ? (
        <Empty icon={I.history} title="No registers in these dates">{"Choose wider dates, or take a register first."}</Empty>
      ) : (
        <>
          <div className="tw-grid tw-grid-cols-3 tw-gap-3 mobile:tw-grid-cols-1">
            <Stat label="Registers taken" value={registers} tone="brand" />
            <Stat label="Present" value={rate === null ? "—" : `${rate}%`} tone={rate !== null && rate < 75 ? "warn" : "good"} hint="of all marks" />
            <Stat label="Absences" value={absences.length} tone={absences.length ? "bad" : "good"} />
          </div>
          <div className="tw-flex tw-gap-2">
            <button type="button" className={chip(onlyAbsent)} onClick={() => setOnlyAbsent(true)}>{`Absences only (${absences.length})`}</button>
            <button type="button" className={chip(!onlyAbsent)} onClick={() => setOnlyAbsent(false)}>{`Everyone (${all.length})`}</button>
          </div>
          {shown.length ? (
            <Table head={["Lesson", "Class", "Pupil", "Status", "Marked by"]}>
              {shown.map((r) => (
                <tr key={r.id}>
                  <Td>{when(r.session_at)}</Td>
                  <Td>{r.classes?.name}</Td>
                  <Td>
                    <span className="tw-inline-flex tw-items-center tw-gap-2">
                      <Avatar person={r.student} size={26} />
                      {displayName(r.student)}
                    </span>
                  </Td>
                  <Td>{r.status === "absent" ? <Pill tone="bad">{"Absent"}</Pill> : <Pill tone="good">{"Present"}</Pill>}</Td>
                  <Td muted>{r.marker ? displayName(r.marker) : "—"}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty icon={I.check} title="No absences in these dates">{"Everyone marked was present."}</Empty>
          )}
        </>
      )}
    </section>
  );
};

const RegisterView = ({ schoolId }: { schoolId: string }) => {
  const [view, setView] = useState<"take" | "history">("take");
  return (
    <div>
      <Explain>{"Was each pupil in the lesson? Pick the lesson, tap anyone who is absent, and save. Parents see the result straight away."}</Explain>
      <div className="tw-mb-4 tw-inline-flex tw-gap-1 tw-rounded-full tw-bg-bg tw-p-1">
        {(["take", "history"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border-0 tw-px-4 tw-py-1.5 tw-text-[13.5px] tw-cursor-pointer [font-family:inherit] ${
              view === v ? "tw-bg-surface tw-font-semibold tw-text-brand tw-shadow-1" : "tw-bg-transparent tw-text-ink-2"
            }`}
          >
            <Svg d={v === "take" ? I.register : I.history} size={14} />
            {v === "take" ? "Take a register" : "Past registers"}
          </button>
        ))}
      </div>
      {view === "take" ? <TakeRegister schoolId={schoolId} /> : <RegisterHistory schoolId={schoolId} />}
    </div>
  );
};

/* ============================================================= ARRIVALS */
const ARRIVAL_COLUMNS = [
  { key: "resumed_at", label: "Arrived", type: "datetime" },
  { key: "person.first_name", label: "First name" },
  { key: "person.surname", label: "Surname" },
  { key: "source", label: "How" },
  { key: "note", label: "Note" },
];

const AddArrival = ({ schoolId, onClose, onAdded }: { schoolId: string; onClose: () => void; onAdded: () => void }) => {
  const [people, setPeople] = useState<AnyRow[]>([]);
  const [personId, setPersonId] = useState("");
  const [at, setAt] = useState(nowLocal());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();
  useEffect(() => {
    fetchSchoolPeopleForAttendance(schoolId)
      .then((r: AnyRow[]) => setPeople(r || []))
      .catch((err: Error) => setError(err.message || "Could not load the school's people."));
  }, [schoolId, setError]);
  const save = async () => {
    if (!personId) return setError("Choose who arrived.");
    setBusy(true);
    try {
      await logSchoolAttendance({ schoolId, personId, resumedAt: at, note });
      const p = people.find((x) => x.id === personId);
      setNotice(`${p ? displayName(p.profile) : "Their"} arrival is recorded.`);
      onAdded();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Could not record that arrival.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add an arrival"
      subtitle="For a student or member of staff who arrived without scanning in."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{"Cancel"}</Button>
          <Button type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Add arrival"}</Button>
        </>
      }
    >
      <div className="tw-flex tw-flex-col tw-gap-3">
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"Who arrived"}</span>
          <Select searchable value={personId} onChange={setPersonId} placeholder="Choose a person" options={people.map((p) => ({ value: p.id, label: `${displayName(p.profile)} — ${p.role}` }))} />
        </label>
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"Time they arrived"}</span>
          <DateTimePicker value={at} onChange={setAt} />
        </label>
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[12.5px] tw-font-semibold tw-text-ink-2">{"Note (optional)"}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Late — traffic" />
        </label>
      </div>
    </Modal>
  );
};

const Scanners = ({ schoolId, onClose }: { schoolId: string; onClose: () => void }) => {
  const [devices, setDevices] = useState<AnyRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ label: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { setError } = useActionFeedback();
  const load = useCallback(() => {
    fetchAttendanceDevices(schoolId)
      .then((r: AnyRow[]) => setDevices(r || []))
      .catch((err: Error) => setError(err.message));
  }, [schoolId, setError]);
  useEffect(load, [load]);
  const connect = async () => {
    setBusy(true);
    try {
      const r = await createAttendanceDevice({ schoolId, label });
      setIssued({ label: label || "Scanner", key: r.api_key });
      setLabel("");
      load();
    } catch (err) {
      setError((err as Error).message || "Could not connect that scanner.");
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (d: AnyRow) => {
    try {
      await setAttendanceDeviceActive({ deviceId: d.id, schoolId, isActive: !d.is_active });
      load();
    } catch (err) {
      setError((err as Error).message || "Could not change that scanner.");
    }
  };
  return (
    <Modal title="Scanners and card readers" subtitle="A fingerprint scanner or card reader at the gate records each arrival by itself." wide onClose={onClose} footer={<Button type="button" variant="secondary" onClick={onClose}>{"Done"}</Button>}>
      <div className="tw-flex tw-flex-col tw-gap-4">
        <div className="tw-rounded-xl tw-bg-bg tw-p-4 tw-text-[13px] tw-leading-relaxed tw-text-ink-2">
          {"To connect one: give it a name and press Connect. You get a key, shown once: pass it to whoever installs the scanner (they set it to call Schoolivio's "}
          <code>{"record_school_attendance"}</code>
          {" endpoint with that key and the person's email at each scan)."}
        </div>
        {issued ? (
          <div className="tw-rounded-xl tw-border tw-border-solid tw-border-success tw-bg-success-soft tw-p-4 tw-text-[13px] tw-text-ink">
            <strong>{`"${issued.label}" is connected.`}</strong>
            {" Copy its key now; it will not be shown again:"}
            <code className="tw-mt-2 tw-block tw-break-all tw-rounded-lg tw-bg-surface tw-p-2 tw-text-[12.5px]" style={{ userSelect: "all" }}>{issued.key}</code>
          </div>
        ) : null}
        <div className="tw-flex tw-flex-wrap tw-gap-2">
          <input className="input tw-min-w-[220px] tw-flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name it, e.g. Front gate scanner" />
          <Button type="button" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect"}</Button>
        </div>
        {devices === null ? (
          <SkeletonList rows={2} />
        ) : devices.length ? (
          <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0">
            {devices.map((d) => (
              <li key={d.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-p-3">
                <span className={`tw-h-2.5 tw-w-2.5 tw-rounded-full ${d.is_active ? "tw-bg-success" : "tw-bg-line"}`} aria-hidden="true" />
                <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
                  <span className="tw-text-[14px] tw-font-semibold tw-text-ink">{d.label}</span>
                  <span className="tw-text-[12.5px] tw-text-ink-3">{`Connected ${formatDate(d.created_at, { withTime: false })} · ${d.last_used_at ? `last scan ${when(d.last_used_at)}` : "no scans yet"}`}</span>
                </span>
                {d.is_active ? <Pill tone="good">{"Working"}</Pill> : <Pill tone="muted">{"Switched off"}</Pill>}
                <Button type="button" variant="secondary" size="sm" onClick={() => toggle(d)}>{d.is_active ? "Switch off" : "Switch on"}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tw-m-0 tw-text-[13px] tw-text-ink-3">{"No scanners yet. Until one is connected, add arrivals by hand."}</p>
        )}
      </div>
    </Modal>
  );
};

const ArrivalsView = ({ schoolId }: { schoolId: string }) => {
  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [adding, setAdding] = useState(false);
  const [scanners, setScanners] = useState(false);
  const [tick, setTick] = useState(0);
  const { setError } = useActionFeedback();
  useEffect(() => {
    setRows(null);
    fetchSchoolAttendanceRecords({ schoolId, personId: undefined, from, to })
      .then((r: AnyRow[]) => setRows(r || []))
      .catch((err: Error) => {
        setRows([]);
        setError(err.message || "Could not load arrivals.");
      });
  }, [schoolId, from, to, tick, setError]);
  const all = rows || [];
  const usual = analyseAttendance([], all).averageResumptionTime;
  return (
    <div>
      <Explain>{"What time students and staff got to school. A scanner or card reader at the gate records it by itself; the front desk can add anyone who didn't scan in."}</Explain>
      <section className={`${card} tw-flex tw-flex-col tw-gap-4 tw-p-5`}>
        <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}>
          <Button type="button" variant="secondary" size="sm" onClick={() => setScanners(true)}>
            <span className="tw-inline-flex tw-items-center tw-gap-1.5"><Svg d={I.scan} size={14} />{"Scanners"}</span>
          </Button>
          <ExportButton columns={ARRIVAL_COLUMNS} rows={all} filename={`arrivals-${from}-to-${to}`} />
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <span className="tw-inline-flex tw-items-center tw-gap-1.5"><Svg d={I.plus} size={14} />{"Add an arrival"}</span>
          </Button>
        </RangeBar>
        {rows === null ? (
          <SkeletonTable rows={5} cols={4} />
        ) : !all.length ? (
          <Empty icon={I.arrivals} title={from === to && from === todayISO() ? "No arrivals recorded yet today" : "No arrivals in these dates"}>
            {"Connect a scanner, or add an arrival by hand."}
          </Empty>
        ) : (
          <>
            <div className="tw-grid tw-grid-cols-3 tw-gap-3 mobile:tw-grid-cols-1">
              <Stat label="People" value={new Set(all.map((r) => r.person?.id)).size} tone="brand" />
              <Stat label="Usual arrival" value={usual || "—"} />
              <Stat label="Added by hand" value={all.filter((r) => r.source === "manual").length} />
            </div>
            <Table head={["Arrived", "Person", "How", "Note"]}>
              {all.map((r) => (
                <tr key={r.id}>
                  <Td>{when(r.resumed_at)}</Td>
                  <Td>
                    <span className="tw-inline-flex tw-items-center tw-gap-2">
                      <Avatar person={r.person} size={26} />
                      {displayName(r.person)}
                    </span>
                  </Td>
                  <Td><Pill tone={r.source === "manual" ? "muted" : "brand"}>{HOW[r.source] || r.source}</Pill></Td>
                  <Td muted>{r.note || "—"}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </section>
      {adding ? <AddArrival schoolId={schoolId} onClose={() => setAdding(false)} onAdded={() => setTick((n) => n + 1)} /> : null}
      {scanners ? <Scanners schoolId={schoolId} onClose={() => setScanners(false)} /> : null}
    </div>
  );
};

/* =========================================================== MY CHILDREN */
const ChildrenView = ({ schoolId }: { schoolId: string }) => {
  const { user } = useAuth() as { user: { id: string } | null };
  const [classRows, setClassRows] = useState<AnyRow[] | null>(null);
  const [schoolRows, setSchoolRows] = useState<AnyRow[]>([]);
  const { setError } = useActionFeedback();
  useEffect(() => {
    if (!user?.id) return;
    Promise.all([fetchMyChildrenAttendance({ schoolId, guardianId: user.id, from: undefined, to: undefined }), fetchMyChildrenSchoolAttendance({ schoolId, guardianId: user.id, from: undefined, to: undefined })])
      .then(([c, s]) => {
        setClassRows(c || []);
        setSchoolRows(s || []);
      })
      .catch((err: Error) => {
        setClassRows([]);
        setError(err.message || "Could not load attendance.");
      });
  }, [schoolId, user?.id, setError]);

  const kids = useMemo(() => {
    const m = new Map<string, { person: AnyRow; c: AnyRow[]; s: AnyRow[] }>();
    const add = (p: AnyRow, k: "c" | "s", r: AnyRow) => {
      if (!p?.id) return;
      if (!m.has(p.id)) m.set(p.id, { person: p, c: [], s: [] });
      m.get(p.id)![k].push(r);
    };
    (classRows || []).forEach((r) => add(r.student, "c", r));
    schoolRows.forEach((r) => add(r.person, "s", r));
    return [...m.values()].map((k) => ({ ...k, summary: analyseAttendance(k.c, k.s), lastAbsence: k.c.find((r) => r.status === "absent") }));
  }, [classRows, schoolRows]);

  if (classRows === null) return <SkeletonList rows={3} avatar />;
  if (!kids.length) {
    return (
      <section className={card}>
        <Empty icon={I.children} title="Nothing recorded yet">{"Your children's lesson registers and arrival times appear here once the school starts recording them."}</Empty>
      </section>
    );
  }
  const log = [
    ...(classRows || []).map((r) => ({ id: `c${r.id}`, at: r.session_at, child: displayName(r.student), what: r.classes?.name || "Lesson", status: r.status as string })),
    ...schoolRows.map((r) => ({ id: `s${r.id}`, at: r.resumed_at, child: displayName(r.person), what: `Arrived at school (${HOW[r.source] || r.source})`, status: "arrived" })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <Explain>{"Whether your child was in each lesson, and what time they got to school."}</Explain>
      <div className="tw-grid tw-grid-cols-2 tw-gap-4 mobile:tw-grid-cols-1">
        {kids.map(({ person, summary, lastAbsence }) => {
          const rate = summary.classAttendanceRate as number | null;
          return (
            <section key={person.id} className={`${card} tw-p-5`}>
              <div className="tw-mb-4 tw-flex tw-items-center tw-gap-3">
                <Avatar person={person} size={44} />
                <span className="tw-text-[16px] tw-font-semibold tw-text-ink">{displayName(person)}</span>
              </div>
              <div className="tw-grid tw-grid-cols-2 tw-gap-3">
                <div>
                  <div className="tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{"In lessons"}</div>
                  <div className={`tw-text-[26px] tw-font-bold ${rate === null ? "tw-text-ink-3" : rate >= 90 ? "tw-text-success" : rate >= 75 ? "tw-text-warn-ink" : "tw-text-danger"}`}>{rate === null ? "—" : `${rate}%`}</div>
                  <div className="tw-text-[12.5px] tw-text-ink-3">{summary.classBand.label}</div>
                </div>
                <div>
                  <div className="tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{"Usual arrival"}</div>
                  <div className="tw-text-[26px] tw-font-bold tw-text-ink">{summary.averageResumptionTime || "—"}</div>
                </div>
              </div>
              <p className="tw-m-0 tw-mt-3 tw-text-[13px] tw-text-ink-2">
                {summary.sessionsRecorded === 0 ? "No lessons marked yet." : `Present at ${summary.presentCount} of ${summary.sessionsRecorded} lessons.`}
                {lastAbsence ? ` Last absent ${when(lastAbsence.session_at)}.` : ""}
              </p>
            </section>
          );
        })}
      </div>
      <section className={`${card} tw-p-5`}>
        <h3 className="tw-m-0 tw-mb-3 tw-text-[16px] tw-font-semibold tw-text-ink">{"Everything recorded"}</h3>
        <Table head={kids.length > 1 ? ["When", "Child", "What", ""] : ["When", "What", ""]}>
          {log.map((r) => (
            <tr key={r.id}>
              <Td>{when(r.at)}</Td>
              {kids.length > 1 ? <Td>{r.child}</Td> : null}
              <Td>{r.what}</Td>
              <Td>{r.status === "arrived" ? <Pill tone="brand">{"Arrived"}</Pill> : r.status === "absent" ? <Pill tone="bad">{"Absent"}</Pill> : <Pill tone="good">{"Present"}</Pill>}</Td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
};

/* ================================================================== ME */
const MyArrivals = ({ schoolId }: { schoolId: string }) => {
  const { user } = useAuth() as { user: { id: string } | null };
  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const { setError } = useActionFeedback();
  useEffect(() => {
    if (!user?.id) return;
    fetchMySchoolAttendance({ schoolId, personId: user.id, from: undefined, to: undefined })
      .then((r: AnyRow[]) => setRows(r || []))
      .catch((err: Error) => {
        setRows([]);
        setError(err.message || "Could not load your arrivals.");
      });
  }, [schoolId, user?.id, setError]);
  if (rows === null) return <SkeletonTable rows={4} cols={3} />;
  return (
    <div>
      <Explain>{"Your own arrival times at school, from the scanner or the front desk."}</Explain>
      {!rows.length ? (
        <section className={card}>
          <Empty icon={I.clock} title="No arrivals recorded for you yet">{"Each time you scan in, or the front desk adds your arrival, it shows here."}</Empty>
        </section>
      ) : (
        <section className={`${card} tw-flex tw-flex-col tw-gap-4 tw-p-5`}>
          <div className="tw-grid tw-grid-cols-2 tw-gap-3">
            <Stat label="Days recorded" value={new Set(rows.map((r) => new Date(r.resumed_at).toDateString())).size} tone="brand" />
            <Stat label="Usual arrival" value={analyseAttendance([], rows).averageResumptionTime || "—"} />
          </div>
          <Table head={["Arrived", "How", "Note"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>{when(r.resumed_at)}</Td>
                <Td><Pill tone={r.source === "manual" ? "muted" : "brand"}>{HOW[r.source] || r.source}</Pill></Td>
                <Td muted>{r.note || "—"}</Td>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </div>
  );
};

/* ================================================================ PAGE */
const Attendance = () => {
  const { schoolId, isAdmin, isPrincipal, isTeacher, isParent, moduleGrants } = useSchool();
  // Their Attendance setting first (supabase/234): Can edit marks any class,
  // View only and No access mark none; nothing set leaves it to the role.
  const setting = moduleGrants?.attendance;
  const isLeadership = setting === "edit" || (!setting && (isAdmin || isPrincipal));
  const canMark = setting === "edit" || (!setting && (isLeadership || isTeacher));

  const sections = [
    isLeadership ? { id: "today" as const, label: "Today", hint: "How today is going", icon: I.today } : null,
    canMark ? { id: "register" as const, label: "Class register", hint: "Who was in each lesson", icon: I.register } : null,
    isLeadership ? { id: "arrivals" as const, label: "Arrivals", hint: "Who got to school, and when", icon: I.arrivals } : null,
    isParent ? { id: "children" as const, label: "My children", hint: "Lessons and arrival times", icon: I.children } : null,
    { id: "mine" as const, label: "My arrivals", hint: "Your own arrival times", icon: I.me },
  ].filter((s): s is { id: Section; label: string; hint: string; icon: string } => !!s);

  const [section, setSection] = useState<Section>(sections[0].id);
  useEffect(() => {
    if (!sections.some((s) => s.id === section)) setSection(sections[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeadership, canMark, isParent]);

  return (
    <div className="shell">
      <Navbar />
      <Page title="Attendance" subtitle="Lesson registers, and arrival times for students and staff.">
        {sections.length > 1 ? (
          <nav className="tw-mb-5 tw-flex tw-gap-2 tw-overflow-x-auto tw-pb-1" aria-label="Attendance sections">
            {sections.map((s) => {
              const on = s.id === section;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-current={on ? "page" : undefined}
                  className={`tw-flex tw-min-w-[170px] tw-shrink-0 tw-items-center tw-gap-3 tw-rounded-2xl tw-border tw-border-solid tw-px-4 tw-py-3 tw-text-left tw-cursor-pointer tw-transition-all [font-family:inherit] mobile:tw-min-w-[150px] ${
                    on ? "tw-border-brand tw-bg-brand-soft tw-shadow-1" : "tw-border-line tw-bg-surface hover:tw-border-brand"
                  }`}
                >
                  <span className={`tw-inline-flex tw-h-9 tw-w-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-xl ${on ? "tw-bg-brand tw-text-white" : "tw-bg-bg tw-text-ink-2"}`}>
                    <Svg d={s.icon} size={17} />
                  </span>
                  <span className="tw-flex tw-flex-col">
                    <span className={`tw-text-[14px] tw-font-semibold ${on ? "tw-text-brand" : "tw-text-ink"}`}>{s.label}</span>
                    <span className="tw-text-[12px] tw-text-ink-3">{s.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        ) : null}

        {!schoolId ? null : section === "today" ? (
          <TodayView schoolId={schoolId} go={setSection} />
        ) : section === "register" ? (
          <RegisterView schoolId={schoolId} />
        ) : section === "arrivals" ? (
          <ArrivalsView schoolId={schoolId} />
        ) : section === "children" ? (
          <ChildrenView schoolId={schoolId} />
        ) : (
          <MyArrivals schoolId={schoolId} />
        )}
      </Page>
    </div>
  );
};

export default Attendance;
