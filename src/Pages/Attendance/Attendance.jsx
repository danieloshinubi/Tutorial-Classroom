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
import { analyseAttendance } from "../../lib/analysis";
import { todayISO, daysAgoISO } from "../../lib/dates";
import {
  Page,
  Field,
  Button,
  Select,
  DatePicker,
  DateTimePicker,
  Notice,
  Badge,
  Tabs,
  displayName,
  initials,
  formatDate,
  SkeletonList,
  SkeletonTable,
} from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

// Attendance, laid out around what each person comes here to do.
//
// Marking a class is the everyday job, so it got the most attention: a live
// tally of who is present and absent, a roster that reads at a glance (a
// two-way Present / Absent switch per pupil, absent pupils tinted), a save
// bar that stays in view however long the class list is, and a clear line
// saying whether this session has been saved and whether anything has changed
// since. The sessions already marked for the class in the last fortnight are
// one tap away — a session is identified by its exact date and time, so
// re-opening one used to mean typing the same minute again, and getting it a
// minute out silently started a second session instead.
//
// The record views lead with what the range adds up to (how many marks, what
// share present, how many absences) before the rows, and a parent sees each
// child's summary before the log.

// A date-and-time picker value for "now", in the device's own time.
const nowLocalISO = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

// The reverse, for a stored instant: what the picker should show for it.
const toPickerValue = (iso) => {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

// daysAgoISO / todayISO come from src/lib/dates.js: local calendar dates.
// These were built with toISOString() (UTC), which is yesterday for the
// first hour after midnight in Lagos.

// "Today 08:00", "Yesterday 11:00", "Mon 22 Sep, 08:00".
const sessionLabel = (iso) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((start - day) / 86400000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
};

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

const Summary = ({ items }) => (
  <div className="at-summary">
    {items.map((item) => (
      <div key={item.label} className="at-summary-item">
        <span className={`at-summary-value${item.tone ? ` ${item.tone}` : ""}`}>{item.value}</span>
        <span className="at-summary-label">{item.label}</span>
      </div>
    ))}
  </div>
);

const EmptyState = ({ title, children }) => (
  <div className="at-empty">
    <strong>{title}</strong>
    {children ? <span>{children}</span> : null}
  </div>
);

const Avatar = ({ person }) =>
  person?.avatar_url ? (
    <img className="at-avatar" src={person.avatar_url} alt="" />
  ) : (
    <span className="at-avatar brand-mark" aria-hidden="true">
      {initials(person || {})}
    </span>
  );

/* ------------------------------------------------------------------- mark */
// A class session is identified by date+time, not just a day — the same
// class taught at 8am by one teacher and 11am by another gets two separate
// sessions, each marked on its own. Every unmarked pupil defaults to
// Present, so a teacher only has to touch the exceptions.
const MarkAttendance = ({ schoolId }) => {
  const [classes, setClasses] = useState([]);
  const [classesLoaded, setClassesLoaded] = useState(false);
  const [classId, setClassId] = useState("");
  const [sessionAt, setSessionAt] = useState(nowLocalISO());
  const [roster, setRoster] = useState([]);
  const [draft, setDraft] = useState({});
  const [recent, setRecent] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { error, setError, setNotice } = useActionFeedback();

  useEffect(() => {
    if (!schoolId) return;
    fetchMarkableClasses(schoolId)
      .then((rows) => {
        setClasses(rows);
        setClassId((current) => current || rows[0]?.id || "");
      })
      .catch((err) => setError(err.message || "Could not load your classes."))
      .finally(() => setClassesLoaded(true));
  }, [schoolId, setError]);

  const loadRoster = useCallback(() => {
    if (!classId || !schoolId || !sessionAt) return;
    setLoading(true);
    setError("");
    fetchAttendanceForClass({ classId, schoolId, sessionAt })
      .then((rows) => {
        setRoster(rows);
        setDraft(Object.fromEntries(rows.map((row) => [row.student.id, row.mark?.status || "present"])));
      })
      .catch((err) => setError(err.message || "Could not load this class's roster."))
      .finally(() => setLoading(false));
  }, [classId, schoolId, sessionAt, setError]);

  useEffect(loadRoster, [loadRoster]);

  // The sessions already marked for this class in the last two weeks, newest
  // first, so an existing one can be reopened without retyping its minute.
  const loadRecent = useCallback(() => {
    if (!classId || !schoolId) return;
    fetchAttendanceRecords({ schoolId, classId, from: daysAgoISO(14), to: todayISO() })
      .then((rows) => {
        const seen = new Map();
        rows.forEach((r) => {
          if (!seen.has(r.session_at)) seen.set(r.session_at, { at: r.session_at, total: 0, absent: 0 });
          const s = seen.get(r.session_at);
          s.total += 1;
          if (r.status === "absent") s.absent += 1;
        });
        setRecent([...seen.values()].slice(0, 8));
      })
      .catch(() => setRecent([]));
  }, [classId, schoolId]);

  useEffect(loadRecent, [loadRecent]);

  const setStatus = (studentId, status) => setDraft((current) => ({ ...current, [studentId]: status }));
  const markAll = (status) => setDraft(Object.fromEntries(roster.map((row) => [row.student.id, status])));

  const alreadySaved = roster.some((row) => row.mark);
  const changed = roster.filter((row) => (row.mark?.status || "present") !== draft[row.student.id]).length;
  // First save of a session always counts as a change: nothing is stored yet.
  const dirty = !alreadySaved || changed > 0;
  const absent = roster.filter((row) => draft[row.student.id] === "absent").length;
  const present = roster.length - absent;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((row) => displayName(row.student).toLowerCase().includes(needle));
  }, [roster, query]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveAttendance({
        schoolId,
        classId,
        sessionAt,
        records: roster.map((row) => ({ student_id: row.student.id, status: draft[row.student.id] })),
      });
      setNotice(`Attendance saved for ${sessionLabel(new Date(sessionAt).toISOString())}.`);
      loadRoster();
      loadRecent();
    } catch (err) {
      setError(err.message || "Could not save attendance.");
    } finally {
      setSaving(false);
    }
  };

  if (classesLoaded && classes.length === 0 && !error) {
    return (
      <EmptyState title="No class to mark">
        {"You can mark a class you are the form teacher of, or teach a subject in. The school office sets that up under School admin → Classes & subjects."}
      </EmptyState>
    );
  }

  const selectedKey = new Date(sessionAt).getTime();

  return (
    <div className="at-mark">
      <section className="at-card at-sheet-head">
        <div className="at-sheet-fields">
          <Field label="Class">
            <Select
              className="select"
              value={classId}
              onChange={setClassId}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field label="Lesson date and time">
            <DateTimePicker value={sessionAt} onChange={setSessionAt} />
          </Field>
        </div>

        <div className="at-recent">
          <span className="at-recent-label">{"Already marked"}</span>
          {recent.length ? (
            <div className="at-recent-list">
              <button
                type="button"
                className={`at-chip${recent.some((r) => new Date(r.at).getTime() === selectedKey) ? "" : " active"}`}
                onClick={() => setSessionAt(nowLocalISO())}
              >
                {"New session now"}
              </button>
              {recent.map((r) => (
                <button
                  key={r.at}
                  type="button"
                  className={`at-chip${new Date(r.at).getTime() === selectedKey ? " active" : ""}`}
                  onClick={() => setSessionAt(toPickerValue(r.at))}
                  title={`${r.total - r.absent} present, ${r.absent} absent`}
                >
                  {sessionLabel(r.at)}
                  {r.absent ? <span className="at-chip-note">{`${r.absent} absent`}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <span className="at-recent-none">{"Nothing marked for this class in the last two weeks."}</span>
          )}
        </div>
      </section>

      <section className="at-card at-sheet">
        {loading ? (
          <SkeletonList rows={5} avatar />
        ) : roster.length === 0 ? (
          <EmptyState title="No pupils in this class yet">
            {"Pupils are added to a class under School admin → Classes & subjects."}
          </EmptyState>
        ) : (
          <>
            <div className="at-sheet-top">
              <div className="at-tally" aria-live="polite">
                <span className="at-tally-item present">
                  <strong>{present}</strong>
                  {" present"}
                </span>
                <span className={`at-tally-item absent${absent ? " has" : ""}`}>
                  <strong>{absent}</strong>
                  {" absent"}
                </span>
                <span className="at-tally-item">
                  {`of ${roster.length}`}
                </span>
              </div>
              <div className="at-sheet-actions">
                {roster.length > 12 ? (
                  <input
                    className="input at-search"
                    placeholder="Find a pupil"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                ) : null}
                <Button type="button" variant="secondary" size="sm" onClick={() => markAll("present")}>
                  {"All present"}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => markAll("absent")}>
                  {"All absent"}
                </Button>
              </div>
            </div>

            <div className="at-roster" role="list">
              {visible.map((row) => {
                const status = draft[row.student.id] || "present";
                const name = displayName(row.student);
                return (
                  <div key={row.student.id} role="listitem" className={`at-pupil${status === "absent" ? " absent" : ""}`}>
                    <Avatar person={row.student} />
                    <span className="at-pupil-name">{name}</span>
                    <div className="at-seg" role="radiogroup" aria-label={`${name}: attendance`}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={status === "present"}
                        className={status === "present" ? "on present" : ""}
                        onClick={() => setStatus(row.student.id, "present")}
                      >
                        {"Present"}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={status === "absent"}
                        className={status === "absent" ? "on absent" : ""}
                        onClick={() => setStatus(row.student.id, "absent")}
                      >
                        {"Absent"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {visible.length === 0 ? (
                <div className="at-roster-none">{"No pupil by that name in this class."}</div>
              ) : null}
            </div>

            {/* Stays in view at the bottom of the screen however long the
                class list is, so saving never means scrolling to the end. */}
            <div className="at-savebar">
              <span className="at-savebar-state">
                {!alreadySaved
                  ? "Not saved yet. Everyone starts as present — change only who is absent."
                  : changed
                  ? `${changed} change${changed === 1 ? "" : "s"} not saved yet.`
                  : "Saved. Any change you make updates this session."}
              </span>
              <Button onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "Saving..." : alreadySaved ? "Save changes" : "Save attendance"}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

/* ---------------------------------------------------------------- records */
const CLASS_STATUS_TONE = { present: "success", absent: "danger" };

const RECORD_EXPORT_COLUMNS = [
  { key: "session_at", label: "Session" },
  { key: "classes.name", label: "Class" },
  { key: "student.first_name", label: "First name" },
  { key: "student.surname", label: "Surname" },
  { key: "status", label: "Status" },
  { key: "note", label: "Note" },
];

const RangeBar = ({ from, to, setFrom, setTo, children }) => (
  <div className="at-rangebar">
    <Field label="From">
      <DatePicker value={from} onChange={setFrom} />
    </Field>
    <Field label="To">
      <DatePicker value={to} onChange={setTo} />
    </Field>
    <div className="at-rangebar-end">{children}</div>
  </div>
);

const AttendanceRecords = ({ schoolId }) => {
  const [records, setRecords] = useState([]);
  const [from, setFrom] = useState(daysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [onlyAbsent, setOnlyAbsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    fetchAttendanceRecords({ schoolId, from, to })
      .then(setRecords)
      .catch((err) => setError(err.message || "Could not load attendance records."))
      .finally(() => setLoading(false));
  }, [schoolId, from, to, setError]);

  useEffect(load, [load]);

  const absences = records.filter((r) => r.status === "absent").length;
  const sessions = new Set(records.map((r) => `${r.classes?.id}|${r.session_at}`)).size;
  const rate = pct(records.length - absences, records.length);
  const shown = onlyAbsent ? records.filter((r) => r.status === "absent") : records;

  return (
    <section className="at-card">
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <ExportButton columns={RECORD_EXPORT_COLUMNS} rows={records} filename={`class-attendance-${from}-to-${to}.csv`} />
      </RangeBar>

      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : records.length === 0 ? (
        <EmptyState title="Nothing marked in this range">
          {"Widen the dates, or mark a class under Mark attendance."}
        </EmptyState>
      ) : (
        <>
          <Summary
            items={[
              { label: `lesson${sessions === 1 ? "" : "s"} marked`, value: sessions },
              { label: "present", value: rate === null ? "—" : `${rate}%`, tone: rate !== null && rate < 75 ? "warn" : "" },
              { label: `absence${absences === 1 ? "" : "s"}`, value: absences, tone: absences ? "danger" : "" },
            ]}
          />
          <div className="at-filter-row">
            <button type="button" className={`at-chip${!onlyAbsent ? " active" : ""}`} onClick={() => setOnlyAbsent(false)}>
              {`Everyone (${records.length})`}
            </button>
            <button type="button" className={`at-chip${onlyAbsent ? " active" : ""}`} onClick={() => setOnlyAbsent(true)}>
              {`Absences only (${absences})`}
            </button>
          </div>
          {shown.length === 0 ? (
            <EmptyState title="No absences in this range">{"Everyone marked was present."}</EmptyState>
          ) : (
            <div className="table-wrap table-wrap-plain">
              <table className="data">
                <thead>
                  <tr>
                    <th>{"Lesson"}</th>
                    <th>{"Class"}</th>
                    <th>{"Pupil"}</th>
                    <th>{"Status"}</th>
                    <th>{"Marked by"}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id}>
                      <td className="at-when">{sessionLabel(row.session_at)}</td>
                      <td>{row.classes?.name}</td>
                      <td>{displayName(row.student)}</td>
                      <td><Badge tone={CLASS_STATUS_TONE[row.status]}>{row.status === "present" ? "Present" : "Absent"}</Badge></td>
                      <td className="at-muted">{row.marker ? displayName(row.marker) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};

/* --------------------------------------------------------- school attendance */
const SOURCE_LABEL = { biometric: "Biometric", card: "Card", manual: "Manual" };

const SCHOOL_EXPORT_COLUMNS = [
  { key: "resumed_at", label: "Resumed at" },
  { key: "person.first_name", label: "First name" },
  { key: "person.surname", label: "Surname" },
  { key: "source", label: "Source" },
  { key: "note", label: "Note" },
];

const SchoolAttendance = ({ schoolId }) => {
  const [records, setRecords] = useState([]);
  const [from, setFrom] = useState(daysAgoISO(6));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    fetchSchoolAttendanceRecords({ schoolId, from, to })
      .then(setRecords)
      .catch((err) => setError(err.message || "Could not load school attendance."))
      .finally(() => setLoading(false));
  }, [schoolId, from, to, setError]);

  useEffect(load, [load]);

  const people = new Set(records.map((r) => r.person?.id).filter(Boolean)).size;
  const manual = records.filter((r) => r.source === "manual").length;
  const usual = analyseAttendance([], records).averageResumptionTime;

  return (
    <section className="at-card">
      <p className="at-hint">
        {"Resumption for students and staff alike: every scan from a connected device, plus anything the front desk logs by hand."}
      </p>
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <ExportButton columns={SCHOOL_EXPORT_COLUMNS} rows={records} filename={`school-attendance-${from}-to-${to}.csv`} />
      </RangeBar>

      {loading ? (
        <SkeletonTable rows={5} cols={4} />
      ) : records.length === 0 ? (
        <EmptyState title="No resumptions in this range">
          {"Connect a scanner under Devices, or log an arrival under Log resumption."}
        </EmptyState>
      ) : (
        <>
          <Summary
            items={[
              { label: `resumption${records.length === 1 ? "" : "s"}`, value: records.length },
              { label: `${people === 1 ? "person" : "people"}`, value: people },
              { label: "usual arrival", value: usual || "—" },
              { label: "logged by hand", value: manual },
            ]}
          />
          <div className="table-wrap table-wrap-plain">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Resumed"}</th>
                  <th>{"Person"}</th>
                  <th>{"How"}</th>
                  <th>{"Note"}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => (
                  <tr key={row.id}>
                    <td className="at-when">{sessionLabel(row.resumed_at)}</td>
                    <td>{displayName(row.person)}</td>
                    <td><Badge tone={row.source === "manual" ? undefined : "brand"}>{SOURCE_LABEL[row.source]}</Badge></td>
                    <td className="at-muted">{row.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};

/* ------------------------------------------------------------ log resumption */
// The interim, always-available path — a front desk logging an arrival by
// hand — usable today regardless of whether a biometric device is
// physically connected yet.
const LogResumption = ({ schoolId }) => {
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState("");
  const [resumedAt, setResumedAt] = useState(nowLocalISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  useEffect(() => {
    if (!schoolId) return;
    fetchSchoolPeopleForAttendance(schoolId)
      .then((rows) => {
        setPeople(rows);
        setPersonId((current) => current || rows[0]?.id || "");
      })
      .catch((err) => setError(err.message || "Could not load this school's people."));
  }, [schoolId, setError]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!personId) {
      setError("Choose who resumed.");
      return;
    }
    setSaving(true);
    try {
      await logSchoolAttendance({ schoolId, personId, resumedAt, note });
      const person = people.find((p) => p.id === personId);
      setNotice(`Logged ${person ? displayName(person.profile) : "that person"}'s resumption.`);
      setNote("");
      setResumedAt(nowLocalISO());
    } catch (err) {
      setError(err.message || "Could not log that resumption.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="at-card at-narrow">
      <h2 className="at-card-title">{"Log a resumption"}</h2>
      <p className="at-hint">
        {"For a student or staff member who arrived without scanning in, or before a scanner is connected."}
      </p>
      <form onSubmit={handleSubmit}>
        <Field label="Who resumed">
          <Select
            className="select"
            value={personId}
            onChange={setPersonId}
            options={people.map((p) => ({
              value: p.id,
              label: `${displayName(p.profile)} — ${p.role}`,
            }))}
          />
        </Field>
        <Field label="Time they arrived">
          <DateTimePicker value={resumedAt} onChange={setResumedAt} />
        </Field>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Late — traffic" />
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? "Logging..." : "Log resumption"}
        </Button>
      </form>
    </section>
  );
};

/* -------------------------------------------------------------------- devices */
const Devices = ({ schoolId }) => {
  const [devices, setDevices] = useState([]);
  const [issuedKey, setIssuedKey] = useState(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    if (!schoolId) return;
    fetchAttendanceDevices(schoolId).then(setDevices).catch((err) => setError(err.message));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");
    setCreating(true);
    try {
      const result = await createAttendanceDevice({ schoolId, label });
      setIssuedKey({ label: label || "Biometric device", key: result.api_key });
      setLabel("");
      load();
    } catch (err) {
      setError(err.message || "Could not connect that device.");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (device) => {
    setError("");
    try {
      await setAttendanceDeviceActive({ deviceId: device.id, schoolId, isActive: !device.is_active });
      load();
    } catch (err) {
      setError(err.message || "Could not update that device.");
    }
  };

  return (
    <section className="at-card at-narrow at-wide-narrow">
      <h2 className="at-card-title">{"Scanners and card readers"}</h2>
      <p className="at-hint">
        {"A device (or a small bridge script talking to an existing biometric or card system) calls the "}
        <code>record_school_attendance</code>
        {" endpoint with its key, plus the person's email, each time someone scans in. Give the key to whoever sets up the scanner."}
      </p>

      {issuedKey ? (
        <Notice tone="success">
          {`"${issuedKey.label}" connected. Its key is shown only once — copy it now: `}
          <code style={{ userSelect: "all" }}>{issuedKey.key}</code>
        </Notice>
      ) : null}

      <form onSubmit={handleCreate} className="at-device-form">
        <input
          className="input"
          placeholder="Name it, e.g. Front gate scanner"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" disabled={creating}>
          {creating ? "Connecting..." : "Connect a device"}
        </Button>
      </form>

      {devices.length === 0 ? (
        <EmptyState title="No devices connected yet">
          {"Until one is, the front desk can log arrivals under Log resumption."}
        </EmptyState>
      ) : (
        <ul className="at-devices">
          {devices.map((d) => (
            <li key={d.id} className="at-device">
              <span className={`at-device-dot${d.is_active ? " on" : ""}`} aria-hidden="true" />
              <div className="at-device-text">
                <span className="at-device-name">{d.label}</span>
                <span className="at-muted">
                  {`Connected ${formatDate(d.created_at, { withTime: false })}`}
                  {d.last_used_at ? ` · last scan ${sessionLabel(d.last_used_at)}` : " · no scans yet"}
                </span>
              </div>
              <Badge tone={d.is_active ? "success" : undefined}>{d.is_active ? "Active" : "Revoked"}</Badge>
              <Button type="button" variant="secondary" size="sm" onClick={() => toggleActive(d)}>
                {d.is_active ? "Revoke" : "Reactivate"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/* ------------------------------------------------------------ my children */
const MyChildrenAttendance = ({ schoolId }) => {
  const { user } = useAuth();
  const [classRecords, setClassRecords] = useState([]);
  const [schoolRecords, setSchoolRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  useEffect(() => {
    if (!schoolId || !user?.id) return;
    setLoading(true);
    Promise.all([
      fetchMyChildrenAttendance({ schoolId, guardianId: user.id }),
      fetchMyChildrenSchoolAttendance({ schoolId, guardianId: user.id }),
    ])
      .then(([classRows, schoolRows]) => {
        setClassRecords(classRows);
        setSchoolRecords(schoolRows);
      })
      .catch((err) => setError(err.message || "Could not load attendance."))
      .finally(() => setLoading(false));
  }, [schoolId, user?.id, setError]);

  // One summary per child, using the same analyseAttendance() the child's
  // report page uses, so the two always agree.
  const children = useMemo(() => {
    const byChild = new Map();
    const add = (person, key, row) => {
      if (!person?.id) return;
      if (!byChild.has(person.id)) byChild.set(person.id, { person, classRows: [], schoolRows: [] });
      byChild.get(person.id)[key].push(row);
    };
    classRecords.forEach((r) => add(r.student, "classRows", r));
    schoolRecords.forEach((r) => add(r.person, "schoolRows", r));
    return [...byChild.values()].map((c) => ({
      ...c,
      summary: analyseAttendance(c.classRows, c.schoolRows),
      lastAbsence: c.classRows.find((r) => r.status === "absent"),
    }));
  }, [classRecords, schoolRecords]);

  if (loading) {
    return (
      <section className="at-card">
        <SkeletonList rows={3} avatar />
      </section>
    );
  }

  if (children.length === 0) {
    return (
      <EmptyState title="Nothing recorded yet">
        {"Class marks and school resumption for your children will appear here once the school starts recording them."}
      </EmptyState>
    );
  }

  const log = [
    ...classRecords.map((r) => ({
      id: `c-${r.id}`,
      at: r.session_at,
      child: displayName(r.student),
      what: r.classes?.name || "Class",
      status: r.status,
    })),
    ...schoolRecords.map((r) => ({
      id: `s-${r.id}`,
      at: r.resumed_at,
      child: displayName(r.person),
      what: `Arrived at school (${SOURCE_LABEL[r.source] || r.source})`,
      status: "arrived",
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div className="at-stack">
      <div className="at-kids">
        {children.map(({ person, summary, lastAbsence }) => (
          <section key={person.id} className="at-card at-kid">
            <div className="at-kid-head">
              <Avatar person={person} />
              <span className="at-kid-name">{displayName(person)}</span>
            </div>
            <div className="at-kid-figures">
              <div>
                <span className="at-kid-label">{"In class"}</span>
                <span className="at-kid-value">
                  {summary.classAttendanceRate === null ? "—" : `${summary.classAttendanceRate}%`}
                </span>
                <Badge tone={summary.classBand.tone}>{summary.classBand.label}</Badge>
              </div>
              <div>
                <span className="at-kid-label">{"Usual arrival"}</span>
                <span className="at-kid-value">{summary.averageResumptionTime || "—"}</span>
              </div>
            </div>
            <p className="at-kid-note">
              {summary.sessionsRecorded === 0
                ? "No lessons marked yet."
                : `Present at ${summary.presentCount} of ${summary.sessionsRecorded} lessons marked.`}
              {lastAbsence ? ` Last absent ${sessionLabel(lastAbsence.session_at)}.` : ""}
            </p>
          </section>
        ))}
      </div>

      <section className="at-card">
        <h2 className="at-card-title">{"Everything recorded"}</h2>
        <div className="table-wrap table-wrap-plain">
          <table className="data">
            <thead>
              <tr>
                <th>{"When"}</th>
                {children.length > 1 ? <th>{"Child"}</th> : null}
                <th>{"What"}</th>
                <th>{"Status"}</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr key={row.id}>
                  <td className="at-when">{sessionLabel(row.at)}</td>
                  {children.length > 1 ? <td>{row.child}</td> : null}
                  <td>{row.what}</td>
                  <td>
                    {row.status === "arrived" ? (
                      <Badge tone="brand">{"Arrived"}</Badge>
                    ) : (
                      <Badge tone={CLASS_STATUS_TONE[row.status]}>{row.status === "present" ? "Present" : "Absent"}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

/* -------------------------------------------------------------- my attendance */
// Any signed-in person's own school-attendance (resumption) history — the
// same self-read RLS a student's own class-attendance rows already get.
// This is what makes "staff can monitor when staff resume" mean something
// for the staff member themselves too, not only for leadership looking in.
const MyAttendance = ({ schoolId }) => {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  useEffect(() => {
    if (!schoolId || !user?.id) return;
    setLoading(true);
    fetchMySchoolAttendance({ schoolId, personId: user.id })
      .then(setRecords)
      .catch((err) => setError(err.message || "Could not load your attendance."))
      .finally(() => setLoading(false));
  }, [schoolId, user?.id, setError]);

  if (loading) return <section className="at-card"><SkeletonTable rows={4} cols={3} /></section>;

  if (records.length === 0) {
    return (
      <EmptyState title="No resumptions recorded for you yet">
        {"Each time you scan in at a connected device, or the front desk logs your arrival, it appears here."}
      </EmptyState>
    );
  }

  const usual = analyseAttendance([], records).averageResumptionTime;
  const days = new Set(records.map((r) => new Date(r.resumed_at).toDateString())).size;

  return (
    <section className="at-card">
      <Summary
        items={[
          { label: `day${days === 1 ? "" : "s"} recorded`, value: days },
          { label: "usual arrival", value: usual || "—" },
          { label: "last resumed", value: sessionLabel(records[0].resumed_at) },
        ]}
      />
      <div className="table-wrap table-wrap-plain">
        <table className="data">
          <thead>
            <tr><th>{"Resumed"}</th><th>{"How"}</th><th>{"Note"}</th></tr>
          </thead>
          <tbody>
            {records.map((row) => (
              <tr key={row.id}>
                <td className="at-when">{sessionLabel(row.resumed_at)}</td>
                <td>{SOURCE_LABEL[row.source]}</td>
                <td className="at-muted">{row.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

/* --------------------------------------------------------------------- */
const Attendance = () => {
  const { schoolId, isAdmin, isPrincipal, isTeacher, isParent } = useSchool();
  // Leadership: the same bar classroom.has_role_in(...'owner','admin',
  // 'principal') sets for school-attendance RLS — mark/records stay open to
  // any teacher too, per classroom.can_mark_attendance.
  const isLeadership = isAdmin || isPrincipal;
  const canMark = isLeadership || isTeacher;

  const tabs = [
    canMark ? { id: "mark", label: "Mark attendance" } : null,
    canMark ? { id: "records", label: "Class records" } : null,
    isLeadership ? { id: "school", label: "School attendance" } : null,
    isLeadership ? { id: "log", label: "Log resumption" } : null,
    isLeadership ? { id: "devices", label: "Devices" } : null,
    isParent ? { id: "children", label: "My children" } : null,
    { id: "mine", label: "My attendance" },
  ].filter(Boolean);

  const [tab, setTab] = useState(tabs[0]?.id);
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeadership, canMark, isParent]);

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Attendance"
        subtitle="Class attendance, and school resumption for students and staff."
        toolbar={tabs.length > 1 ? <Tabs tabs={tabs} active={tab} onChange={setTab} /> : undefined}
      >
        {tab === "mark" ? <MarkAttendance schoolId={schoolId} /> : null}
        {tab === "records" ? <AttendanceRecords schoolId={schoolId} /> : null}
        {tab === "school" ? <SchoolAttendance schoolId={schoolId} /> : null}
        {tab === "log" ? <LogResumption schoolId={schoolId} /> : null}
        {tab === "devices" ? <Devices schoolId={schoolId} /> : null}
        {tab === "children" ? <MyChildrenAttendance schoolId={schoolId} /> : null}
        {tab === "mine" ? <MyAttendance schoolId={schoolId} /> : null}
      </Page>
    </div>
  );
};

export default Attendance;
