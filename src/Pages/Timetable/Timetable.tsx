import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { Page, Card, Button, Field, Notice, Empty, Modal, Switch, Select, SkeletonCards, Tabs, displayName } from "../../Components/UI";
import { ExportMenu } from "../../Components/ExportButton";
import { useActionFeedback } from "../../Components/Toast";
import { useConfirm } from "../../Components/Confirm";
import { useSchool } from "../../context/SchoolContext";
import { useAuth } from "../../context/AuthContext";
import {
  DAY_NAMES,
  DAY_SHORT,
  clearSlot,
  copyTimetable,
  deletePeriod,
  fetchFamilyTimetables,
  fetchSlots,
  fetchTimetableSetup,
  saveDays,
  savePeriod,
  setSlot,
  type ClassSubject,
  type FamilyMember,
  type Period,
  type Slot,
  type TimetableSetup,
} from "../../lib/timetableApi";

// The school timetable (supabase/222).
//
// The principal (and owners and admins) build it: the school's periods and
// days, then each class's week, one cell at a time. The database refuses a
// clash outright and says who is already where, so a teacher can never be
// put in two classes at once and a room can never be double-booked.
// Everyone else reads it: a teacher sees their own week across classes,
// students their class, parents their children's classes.

type View = { kind: "class"; id: string } | { kind: "teacher"; id: string };

const MANAGERS = ["owner", "admin", "principal"];
const OTHER = "__other";

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

// Every 5 minutes from 06:00 to 19:00, for the period start and end pickers.
const TIME_OPTIONS = (() => {
  const out: { value: string; label: string }[] = [];
  for (let m = 6 * 60; m <= 19 * 60; m += 5) {
    const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    out.push({ value: v, label: v });
  }
  return out;
})();

const subjectName = (cs: ClassSubject | undefined) => cs?.subject?.name || "Subject";
const teacherName = (cs: ClassSubject | undefined) => (cs?.teacher ? displayName(cs.teacher) : "");

interface CellEdit {
  day: number;
  period: Period;
  slot: Slot | null;
}

const Timetable = () => {
  const { schoolId, roles, moduleGrants } = useSchool();
  const { user } = useAuth();
  // The id, not the user object: effects below must not re-run when the
  // object is recreated for the same person.
  const userId = user?.id || null;
  const { setError, setNotice } = useActionFeedback();
  const confirmAction = useConfirm();

  // Their Timetable setting first (supabase/234): Can edit sets the
  // timetable whatever their role; View only and No access never do; nothing
  // set leaves it to the role (principal, admin, proprietor).
  const setting = moduleGrants?.timetable;
  const canManage = setting === "edit" || (!setting && roles.some((r) => MANAGERS.includes(r)));
  const isTeacher = roles.includes("teacher");
  // Students see their own class; parents pick a child and see that child's
  // class. Parents have no class of their own.
  const isFamily = !canManage && !isTeacher && roles.some((r) => r === "student" || r === "parent");
  const isParent = roles.includes("parent");

  const [setup, setSetup] = useState<TimetableSetup | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [termId, setTermId] = useState<string>("");
  const [view, setView] = useState<View | null>(null);
  const [family, setFamily] = useState<FamilyMember[] | null>(null);
  const [who, setWho] = useState<string>("");
  const [tab, setTab] = useState<"week" | "periods">("week");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CellEdit | null>(null);
  const [copyFrom, setCopyFrom] = useState("");

  const loadSetup = useCallback(async () => {
    if (!schoolId) return;
    try {
      const s = await fetchTimetableSetup(schoolId);
      setSetup(s);
      setTermId((cur) => cur || s.terms.find((t) => t.is_current)?.id || s.terms[0]?.id || "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  const loadSlots = useCallback(async () => {
    if (!schoolId || !termId) return;
    try {
      setSlots(await fetchSlots(schoolId, termId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [schoolId, termId, setError]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // A student's own class, or each of a parent's children by name.
  useEffect(() => {
    if (!isFamily || !userId || !schoolId) return;
    fetchFamilyTimetables(userId, schoolId)
      .then((rows) => {
        setFamily(rows);
        setWho((cur) => cur || rows[0]?.studentId || "");
      })
      .catch((err) => setError((err as Error).message));
  }, [isFamily, userId, schoolId, setError]);

  const member = family?.find((m) => m.studentId === who) || null;

  // A family member's timetable is their class's.
  useEffect(() => {
    if (!isFamily) return;
    setView(member?.classId ? { kind: "class", id: member.classId } : null);
  }, [isFamily, member?.classId]);

  const classes = useMemo(() => setup?.classes || [], [setup]);

  const teachers = useMemo(() => {
    const byId = new Map<string, ClassSubject["teacher"]>();
    (setup?.classSubjects || []).forEach((cs) => {
      if (cs.teacher && cs.teacher_id) byId.set(cs.teacher_id, cs.teacher);
    });
    return Array.from(byId.entries())
      .map(([id, t]) => ({ id, name: displayName(t) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [setup]);

  // A sensible first view: a teacher's own week; otherwise the first class.
  useEffect(() => {
    if (view || !setup || isFamily) return;
    if (isTeacher && !canManage && userId) setView({ kind: "teacher", id: userId });
    else if (classes[0]) setView({ kind: "class", id: classes[0].id });
  }, [view, setup, isFamily, isTeacher, canManage, userId, classes]);

  const csById = useMemo(() => new Map((setup?.classSubjects || []).map((cs) => [cs.id, cs])), [setup]);
  const classById = useMemo(() => new Map((setup?.classes || []).map((c) => [c.id, c])), [setup]);
  const days = setup?.days || [1, 2, 3, 4, 5];
  const periods = setup?.periods || [];

  const slotAt = (day: number, periodId: string): Slot | undefined => {
    if (!view) return undefined;
    return slots.find(
      (s) =>
        s.day === day &&
        s.period_id === periodId &&
        (view.kind === "class" ? s.class_id === view.id : s.teacher_id === view.id)
    );
  };

  // Who is busy where in one day and period, to warn while choosing.
  const busyAt = (day: number, periodId: string, exceptClass: string) => {
    const teachersBusy = new Map<string, string>();
    const roomsBusy = new Map<string, string>();
    slots
      .filter((s) => s.day === day && s.period_id === periodId && s.class_id !== exceptClass)
      .forEach((s) => {
        const cls = classById.get(s.class_id)?.name || "another class";
        if (s.teacher_id) teachersBusy.set(s.teacher_id, cls);
        if (s.room) roomsBusy.set(s.room.trim().toLowerCase(), cls);
      });
    return { teachersBusy, roomsBusy };
  };

  const term = setup?.terms.find((t) => t.id === termId);
  const viewName =
    isFamily && member && !member.isSelf && view?.kind === "class"
      ? `${member.name} · ${classById.get(view.id)?.name || "Class"}`
      : view?.kind === "class"
      ? classById.get(view.id)?.name || "Class"
      : view?.kind === "teacher"
      ? view.id === userId
        ? "My timetable"
        : teachers.find((t) => t.id === view.id)?.name || "Teacher"
      : "";

  const exportRows = useMemo(() => {
    if (!view) return [];
    const rows: Record<string, string>[] = [];
    days.forEach((day) =>
      periods.forEach((p) => {
        const s = slotAt(day, p.id);
        const cs = s?.class_subject_id ? csById.get(s.class_subject_id) : undefined;
        rows.push({
          day: DAY_NAMES[day],
          period: p.name,
          time: `${hhmm(p.starts_at)}–${hhmm(p.ends_at)}`,
          class: s ? classById.get(s.class_id)?.name || "" : "",
          subject: p.is_break ? "Break" : s ? (cs ? subjectName(cs) : s.label || "") : "",
          teacher: cs ? teacherName(cs) : "",
          room: s?.room || "",
        });
      })
    );
    return rows;
    // slotAt reads view/slots, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, slots, days, periods, csById, classById]);

  const runCopy = async () => {
    if (!copyFrom || !termId) return;
    const from = setup?.terms.find((t) => t.id === copyFrom);
    const ok = await confirmAction({
      title: `Copy the timetable from ${from?.name || "that term"}?`,
      body: "Every class's cells from that term are copied into this one. Cells already set for this term are kept as they are.",
      confirmLabel: "Copy",
    });
    if (!ok) return;
    try {
      const n = await copyTimetable(copyFrom, termId);
      setNotice(n ? `Copied ${n} cell${n === 1 ? "" : "s"}.` : "Nothing to copy: every cell was already set.");
      setCopyFrom("");
      loadSlots();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const termOptions = (setup?.terms || []).map((t) => ({
    value: t.id,
    label: `${t.name}${t.sessions?.name ? ` · ${t.sessions.name}` : ""}${t.is_current ? " (current)" : ""}`,
  }));

  const viewOptions = [
    ...(isTeacher && userId ? [{ value: `teacher:${userId}`, label: "My timetable" }] : []),
    ...classes.map((c) => ({ value: `class:${c.id}`, label: c.name })),
    ...(canManage ? teachers.map((t) => ({ value: `teacher:${t.id}`, label: `Teacher: ${t.name}` })) : []),
  ];

  const toolbar = (
    <div className="tt-toolbar">
      {canManage ? (
        <Tabs
          tabs={[
            { id: "week", label: "Timetable" },
            { id: "periods", label: "Periods & days" },
          ]}
          active={tab}
          onChange={(id: string) => setTab(id as "week" | "periods")}
        />
      ) : null}
    </div>
  );

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Timetable"
        subtitle={canManage ? "Set each class's week. Clashes are refused: no teacher or room can be in two places at once." : "Who is teaching what, and when."}
        toolbar={canManage ? toolbar : null}
      >
        <div className="tt-page">
          {loading ? <SkeletonCards count={2} lines={4} /> : null}

          {!loading && setup && !setup.terms.length ? (
            <Empty>{"No terms yet. Add the school's terms under School admin → Calendar first."}</Empty>
          ) : null}

          {!loading && setup && setup.terms.length && tab === "periods" && canManage && schoolId ? (
            <PeriodsPanel schoolId={schoolId} days={days} periods={periods} onChanged={loadSetup} />
          ) : null}

          {!loading && setup && setup.terms.length && tab === "week" ? (
            <>
              <div className="tt-controls">
                <Field label="Term">
                  <Select value={termId} onChange={(v: string) => setTermId(v)} options={termOptions} />
                </Field>
                {isFamily ? (
                  // A parent picks which child; a student just sees their own.
                  family && (isParent || family.length > 1) && family.length ? (
                    <Field label={isParent ? "Child" : "Whose"}>
                      <Select
                        value={who}
                        onChange={(v: string) => setWho(v)}
                        options={family.map((m) => ({
                          value: m.studentId,
                          label: `${m.name} · ${m.classId ? classById.get(m.classId)?.name || "Class" : "not in a class yet"}`,
                        }))}
                      />
                    </Field>
                  ) : null
                ) : (
                  <Field label="Show">
                    <Select
                      value={view ? `${view.kind}:${view.id}` : ""}
                      onChange={(v: string) => {
                        const [kind, id] = v.split(":");
                        setView({ kind: kind as "class" | "teacher", id });
                      }}
                      options={viewOptions}
                      placeholder={classes.length ? "Choose…" : "No classes"}
                    />
                  </Field>
                )}
                <span className="tt-spacer" />
                {canManage ? (
                  <div className="tt-copy">
                    <Select
                      value={copyFrom}
                      onChange={(v: string) => setCopyFrom(v)}
                      options={[{ value: "", label: "Copy from another term…" }, ...termOptions.filter((t) => t.value !== termId)]}
                    />
                    <Button variant="secondary" disabled={!copyFrom} onClick={runCopy}>
                      {"Copy"}
                    </Button>
                  </div>
                ) : null}
                {view && periods.length ? (
                  <ExportMenu
                    filename={`timetable-${viewName}-${term?.name || ""}`.replace(/\s+/g, "-").toLowerCase()}
                    sheetName="Timetable"
                    rows={exportRows}
                    columns={[
                      { key: "day", label: "Day" },
                      { key: "period", label: "Period" },
                      { key: "time", label: "Time" },
                      { key: "class", label: "Class" },
                      { key: "subject", label: "Subject" },
                      { key: "teacher", label: "Teacher" },
                      { key: "room", label: "Room" },
                    ]}
                  />
                ) : null}
              </div>

              {!periods.length ? (
                canManage ? (
                  <Card className="tt-start">
                    <h3>{"First, the school's periods"}</h3>
                    <p>
                      {"Add the time slots of a school day once (Period 1, Period 2, Break…). Then come back here, pick a class, and tap each period to choose its subject."}
                    </p>
                    <Button onClick={() => setTab("periods")}>{"Set up periods"}</Button>
                  </Card>
                ) : (
                  <Empty>{"The timetable has not been set yet."}</Empty>
                )
              ) : isFamily && family && !family.length ? (
                <Empty>
                  {isParent
                    ? "No children are linked to your account yet. Ask the school to link them, and their timetables will show here."
                    : "You have not been placed in a class yet, so there is no timetable to show."}
                </Empty>
              ) : isFamily && member && !member.classId ? (
                <Empty>
                  {member.isSelf
                    ? "You have not been placed in a class yet, so there is no timetable to show."
                    : `${member.name} has not been placed in a class yet, so there is no timetable to show.`}
                </Empty>
              ) : view ? (
                <>
                {canManage && view.kind === "class" ? (
                  <p className="tt-hint">{"Tap any period to choose its subject from this class's subjects. To see a teacher's week, choose them under Show."}</p>
                ) : null}
                <div className="table-wrap tt-wrap">
                  <table className="tt-grid">
                    <thead>
                      <tr>
                        <th className="tt-corner">{viewName}</th>
                        {days.map((d) => (
                          <th key={d}>
                            <span className="tt-day-long">{DAY_NAMES[d]}</span>
                            <span className="tt-day-short">{DAY_SHORT[d]}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((p) =>
                        p.is_break ? (
                          <tr key={p.id} className="tt-break">
                            <th>
                              <span className="tt-period">{p.name}</span>
                              <span className="tt-time">{`${hhmm(p.starts_at)}–${hhmm(p.ends_at)}`}</span>
                            </th>
                            <td colSpan={days.length}>{p.name}</td>
                          </tr>
                        ) : (
                          <tr key={p.id}>
                            <th>
                              <span className="tt-period">{p.name}</span>
                              <span className="tt-time">{`${hhmm(p.starts_at)}–${hhmm(p.ends_at)}`}</span>
                            </th>
                            {days.map((d) => {
                              const s = slotAt(d, p.id);
                              const cs = s?.class_subject_id ? csById.get(s.class_subject_id) : undefined;
                              const editable = canManage && view.kind === "class";
                              const body = s ? (
                                <>
                                  <span className="tt-subject">{cs ? subjectName(cs) : s.label}</span>
                                  {view.kind === "teacher" ? (
                                    <span className="tt-meta">{classById.get(s.class_id)?.name}</span>
                                  ) : cs?.teacher ? (
                                    <span className="tt-meta">{teacherName(cs)}</span>
                                  ) : null}
                                  {s.room ? <span className="tt-room">{s.room}</span> : null}
                                </>
                              ) : editable ? (
                                <span className="tt-add">{"+ Add subject"}</span>
                              ) : null;
                              return (
                                <td key={d} className={s ? "tt-filled" : "tt-empty"}>
                                  {editable ? (
                                    <button
                                      type="button"
                                      className="tt-cell"
                                      aria-label={`${DAY_NAMES[d]}, ${p.name}`}
                                      onClick={() => setEditing({ day: d, period: p, slot: s || null })}
                                    >
                                      {body}
                                    </button>
                                  ) : (
                                    <div className="tt-cell">{body}</div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
                </>
              ) : (
                <Empty>{"Choose a class to see its timetable."}</Empty>
              )}
            </>
          ) : null}
        </div>
      </Page>

      {editing && view?.kind === "class" && termId ? (
        <CellEditor
          cell={editing}
          classId={view.id}
          className={classById.get(view.id)?.name || "Class"}
          termId={termId}
          options={(setup?.classSubjects || []).filter((cs) => cs.class_id === view.id)}
          busy={busyAt(editing.day, editing.period.id, view.id)}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            if (msg) setNotice(msg);
            loadSlots();
          }}
        />
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------ one cell */

const CellEditor = ({
  cell,
  classId,
  className,
  termId,
  options,
  busy,
  onClose,
  onSaved,
}: {
  cell: CellEdit;
  classId: string;
  className: string;
  termId: string;
  options: ClassSubject[];
  busy: { teachersBusy: Map<string, string>; roomsBusy: Map<string, string> };
  onClose: () => void;
  onSaved: (message?: string) => void;
}) => {
  const [choice, setChoice] = useState<string>(cell.slot?.class_subject_id || (cell.slot?.label ? OTHER : ""));
  const [label, setLabel] = useState(cell.slot?.label || "");
  const [room, setRoom] = useState(cell.slot?.room || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const chosen = options.find((o) => o.id === choice);
  const teacherClash = chosen?.teacher_id ? busy.teachersBusy.get(chosen.teacher_id) : undefined;
  const roomClash = room.trim() ? busy.roomsBusy.get(room.trim().toLowerCase()) : undefined;

  const sorted = [...options].sort((a, b) => subjectName(a).localeCompare(subjectName(b)));
  const selectOptions = [
    { value: "", label: "Choose…" },
    ...sorted.map((o) => {
      const where = o.teacher_id ? busy.teachersBusy.get(o.teacher_id) : undefined;
      const who = teacherName(o);
      return {
        value: o.id,
        label: `${subjectName(o)}${who ? ` · ${who}` : ""}${where ? ` (busy: ${where})` : ""}`,
      };
    }),
    { value: OTHER, label: "Something else (Assembly, Games, Library…)" },
  ];

  const save = async () => {
    setError("");
    if (!choice) return setError("Choose a subject, or Something else.");
    if (choice === OTHER && !label.trim()) return setError("Write what happens then, for example Assembly.");
    setSaving(true);
    try {
      await setSlot({
        termId,
        classId,
        day: cell.day,
        periodId: cell.period.id,
        classSubjectId: choice === OTHER ? null : choice,
        label: choice === OTHER ? label.trim() : null,
        room: room.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await clearSlot(termId, classId, cell.day, cell.period.id);
      onSaved("Cleared.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${className} · ${DAY_NAMES[cell.day]}`}
      subtitle={`${cell.period.name}, ${hhmm(cell.period.starts_at)}–${hhmm(cell.period.ends_at)}`}
      onClose={onClose}
      footer={
        <div className="btn-row" style={{ justifyContent: "space-between", width: "100%" }}>
          {cell.slot ? (
            <Button variant="ghost" disabled={saving} onClick={clear}>
              {"Clear this period"}
            </Button>
          ) : (
            <span />
          )}
          <span className="btn-row">
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              {"Cancel"}
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </span>
        </div>
      }
    >
      <Notice tone="error">{error}</Notice>
      {!options.length ? (
        <Notice tone="muted">{"No subjects are set for this class yet. Add them under School admin → Classes & subjects; you can still put in something else."}</Notice>
      ) : null}
      <Field label="Subject">
        <Select value={choice} onChange={(v: string) => setChoice(v)} options={selectOptions} searchable />
      </Field>
      {teacherClash ? <Notice tone="warn">{`${teacherName(chosen)} is already teaching ${teacherClash} at this time.`}</Notice> : null}
      {choice === OTHER ? (
        <Field label="What happens then">
          <input className="input" maxLength={60} value={label} placeholder="Assembly" onChange={(e) => setLabel(e.target.value)} />
        </Field>
      ) : null}
      <Field label="Room" hint="Optional. A room can hold only one class at a time.">
        <input className="input" maxLength={40} value={room} placeholder="e.g. Lab 1" onChange={(e) => setRoom(e.target.value)} />
      </Field>
      {roomClash ? <Notice tone="warn">{`${room.trim()} is already being used by ${roomClash} at this time.`}</Notice> : null}
    </Modal>
  );
};

/* ------------------------------------------------- periods and days */

const PeriodsPanel = ({
  schoolId,
  days,
  periods,
  onChanged,
}: {
  schoolId: string;
  days: number[];
  periods: Period[];
  onChanged: () => void;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const confirmAction = useConfirm();
  // The next period, pre-filled: the next number, starting when the last
  // one ends and lasting as long as it did (40 minutes to begin with).
  const nextBlank = () => {
    const lessons = periods.filter((p) => !p.is_break).length;
    const last = periods.length ? periods[periods.length - 1] : null;
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const start = last ? toMin(hhmm(last.ends_at)) : 8 * 60;
    const length = last && !last.is_break ? toMin(hhmm(last.ends_at)) - toMin(hhmm(last.starts_at)) : 40;
    return {
      id: undefined as string | undefined,
      name: `Period ${lessons + 1}`,
      startsAt: toTime(start),
      endsAt: toTime(Math.min(start + length, 23 * 60 + 55)),
      isBreak: false,
    };
  };
  const [form, setForm] = useState(nextBlank);
  // Once the list changes (a period added or removed), suggest the next one.
  useEffect(() => {
    setForm((cur) => (cur.id ? cur : nextBlank()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods]);
  const [busy, setBusy] = useState(false);

  const toggleBreak = (on: boolean) =>
    setForm((cur) => ({
      ...cur,
      isBreak: on,
      // A break is usually just called Break; keep anything typed by hand.
      name: on && /^Period d+$/.test(cur.name) ? "Break" : !on && cur.name === "Break" ? nextBlank().name : cur.name,
    }));

  const toggleDay = async (day: number, on: boolean) => {
    const next = on ? Array.from(new Set([...days, day])) : days.filter((d) => d !== day);
    if (!next.length) return setError("Keep at least one school day.");
    try {
      await saveDays(schoolId, next);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Give the period a name, for example Period 1 or Break.");
    if (form.endsAt <= form.startsAt) return setError("A period has to end after it starts.");
    setBusy(true);
    try {
      const position = form.id ? periods.find((p) => p.id === form.id)?.position || 0 : periods.length + 1;
      await savePeriod(schoolId, { ...form, position });
      setNotice(form.id ? "Period saved." : "Period added.");
      setForm({ ...nextBlank(), id: undefined });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Period) => {
    const ok = await confirmAction({
      title: `Remove ${p.name}?`,
      body: "It is taken out of every class's timetable, in every term.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await deletePeriod(p.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="tt-stack">
      <Card>
        <h3 style={{ marginTop: 0 }}>{"School days"}</h3>
        <div className="tt-days">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <Switch key={d} compact label={DAY_NAMES[d]} checked={days.includes(d)} onChange={(on: boolean) => toggleDay(d, on)} />
          ))}
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>{form.id ? `Edit ${form.name || "period"}` : "Add a period"}</h3>
        <form onSubmit={submit} className="tt-period-form">
          <Field label="Period name" hint="The time slot, not the subject. Subjects are chosen for each class on the Timetable tab.">
            <input className="input" maxLength={40} value={form.name} placeholder="Period 1" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Starts">
            <Select value={form.startsAt} onChange={(v: string) => setForm({ ...form, startsAt: v })} options={TIME_OPTIONS} />
          </Field>
          <Field label="Ends">
            <Select value={form.endsAt} onChange={(v: string) => setForm({ ...form, endsAt: v })} options={TIME_OPTIONS} />
          </Field>
          <Switch compact label="It is a break" checked={form.isBreak} onChange={toggleBreak} />
          <div className="btn-row">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : form.id ? "Save" : "Add"}
            </Button>
            {form.id ? (
              <Button type="button" variant="secondary" onClick={() => setForm(nextBlank())}>
                {"Cancel"}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {periods.length ? (
        <Card className="pad-0">
          <div className="table-wrap table-wrap-plain">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Period"}</th>
                  <th>{"Time"}</th>
                  <th>{""}</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className={p.is_break ? "tt-break-row" : undefined}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.is_break ? <span className="tt-tag">{"Break"}</span> : null}
                    </td>
                    <td>{`${hhmm(p.starts_at)}–${hhmm(p.ends_at)}`}</td>
                    <td>
                      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setForm({ id: p.id, name: p.name, startsAt: hhmm(p.starts_at), endsAt: hhmm(p.ends_at), isBreak: p.is_break })
                          }
                        >
                          {"Edit"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(p)}>
                          {"Remove"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Empty>{"No periods yet. Add the first one above, for example Period 1, 08:00 to 08:40."}</Empty>
      )}
    </div>
  );
};

export default Timetable;
