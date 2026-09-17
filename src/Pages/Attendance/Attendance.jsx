import React, { useCallback, useEffect, useState } from "react";
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
import {
  Page,
  Card,
  Field,
  Button,
  Select,
  DatePicker,
  DateTimePicker,
  Notice,
  Empty,
  Badge,
  Tabs,
  displayName,
  formatDate,
} from "../../Components/UI";

const nowLocalISO = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const todayRangeISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------------- mark */
// A class session is identified by date+time, not just a day — the same
// class taught at 8am by one teacher and 11am by another gets two separate
// sessions, each marked on its own. Every unmarked pupil defaults to
// Present, so a teacher only has to touch the exceptions.
const MarkAttendance = ({ schoolId }) => {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [sessionAt, setSessionAt] = useState(nowLocalISO());
  const [roster, setRoster] = useState([]);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!schoolId) return;
    fetchMarkableClasses(schoolId)
      .then((rows) => {
        setClasses(rows);
        setClassId((current) => current || rows[0]?.id || "");
      })
      .catch((err) => setError(err.message || "Could not load your classes."));
  }, [schoolId]);

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
  }, [classId, schoolId, sessionAt]);

  useEffect(loadRoster, [loadRoster]);

  const setStatus = (studentId, status) => setDraft((current) => ({ ...current, [studentId]: status }));
  const markAll = (status) => setDraft(Object.fromEntries(roster.map((row) => [row.student.id, status])));

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
      setNotice(`Attendance saved for ${formatDate(sessionAt)}.`);
      loadRoster();
    } catch (err) {
      setError(err.message || "Could not save attendance.");
    } finally {
      setSaving(false);
    }
  };

  if (classes.length === 0 && !error) {
    return <Empty>{"You have no class to mark attendance for."}</Empty>;
  }

  return (
    <Card>
      <div className="btn-row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Field label="Class">
          <Select
            className="select"
            style={{ minWidth: 200 }}
            value={classId}
            onChange={setClassId}
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Session date & time" hint="When this specific class period is taking place.">
          <DateTimePicker value={sessionAt} onChange={setSessionAt} />
        </Field>
      </div>

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      {loading ? (
        <Empty>{"Loading roster..."}</Empty>
      ) : roster.length === 0 ? (
        <Empty>{"This class has no pupils yet."}</Empty>
      ) : (
        <>
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{"Mark everyone:"}</span>
            <Button type="button" variant="secondary" size="sm" onClick={() => markAll("present")}>
              {"All present"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => markAll("absent")}>
              {"All absent"}
            </Button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {roster.map((row) => {
              const status = draft[row.student.id] || "present";
              return (
                <div
                  key={row.student.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-sm)",
                  }}
                >
                  <span>{displayName(row.student)}</span>
                  <div className="btn-row">
                    <Button
                      type="button"
                      size="sm"
                      variant={status === "present" ? "primary" : "secondary"}
                      onClick={() => setStatus(row.student.id, "present")}
                    >
                      {"Present"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={status === "absent" ? "primary" : "secondary"}
                      onClick={() => setStatus(row.student.id, "absent")}
                    >
                      {"Absent"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <Button style={{ marginTop: 16 }} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save attendance"}
          </Button>
        </>
      )}
    </Card>
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

const AttendanceRecords = ({ schoolId }) => {
  const [records, setRecords] = useState([]);
  const [from, setFrom] = useState(todayRangeISO());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    fetchAttendanceRecords({ schoolId, from, to })
      .then(setRecords)
      .catch((err) => setError(err.message || "Could not load attendance records."))
      .finally(() => setLoading(false));
  }, [schoolId, from, to]);

  useEffect(load, [load]);

  return (
    <Card>
      <div className="btn-row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Field label="From">
          <DatePicker value={from} onChange={setFrom} />
        </Field>
        <Field label="To">
          <DatePicker value={to} onChange={setTo} />
        </Field>
        <div style={{ alignSelf: "flex-end" }}>
          <ExportButton columns={RECORD_EXPORT_COLUMNS} rows={records} filename={`class-attendance-${from}-to-${to}.csv`} />
        </div>
      </div>

      <Notice tone="error">{error}</Notice>

      {loading ? (
        <Empty>{"Loading..."}</Empty>
      ) : records.length === 0 ? (
        <Empty>{"No attendance marked in this range yet."}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{"Session"}</th>
                <th>{"Class"}</th>
                <th>{"Pupil"}</th>
                <th>{"Status"}</th>
                <th>{"Marked by"}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.session_at)}</td>
                  <td>{row.classes?.name}</td>
                  <td>{displayName(row.student)}</td>
                  <td><Badge tone={CLASS_STATUS_TONE[row.status]}>{row.status === "present" ? "Present" : "Absent"}</Badge></td>
                  <td>{row.marker ? displayName(row.marker) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
  const [from, setFrom] = useState(todayRangeISO());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    fetchSchoolAttendanceRecords({ schoolId, from, to })
      .then(setRecords)
      .catch((err) => setError(err.message || "Could not load school attendance."))
      .finally(() => setLoading(false));
  }, [schoolId, from, to]);

  useEffect(load, [load]);

  return (
    <Card>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 13.5 }}>
        {"Fed by a biometric device or card reader connected under “Devices”, plus any front-desk entries logged under “Log resumption”. Covers students and staff alike."}
      </p>
      <div className="btn-row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <Field label="From">
          <DatePicker value={from} onChange={setFrom} />
        </Field>
        <Field label="To">
          <DatePicker value={to} onChange={setTo} />
        </Field>
        <div style={{ alignSelf: "flex-end" }}>
          <ExportButton columns={SCHOOL_EXPORT_COLUMNS} rows={records} filename={`school-attendance-${from}-to-${to}.csv`} />
        </div>
      </div>

      <Notice tone="error">{error}</Notice>

      {loading ? (
        <Empty>{"Loading..."}</Empty>
      ) : records.length === 0 ? (
        <Empty>{"No resumptions recorded in this range yet."}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{"Resumed at"}</th>
                <th>{"Person"}</th>
                <th>{"Source"}</th>
                <th>{"Note"}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.resumed_at)}</td>
                  <td>{displayName(row.person)}</td>
                  <td><Badge tone={row.source === "manual" ? undefined : "brand"}>{SOURCE_LABEL[row.source]}</Badge></td>
                  <td>{row.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!schoolId) return;
    fetchSchoolPeopleForAttendance(schoolId)
      .then((rows) => {
        setPeople(rows);
        setPersonId((current) => current || rows[0]?.id || "");
      })
      .catch((err) => setError(err.message || "Could not load this school's people."));
  }, [schoolId]);

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
    } catch (err) {
      setError(err.message || "Could not log that resumption.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ maxWidth: 480 }}>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 13.5 }}>
        {"For a student or staff member arriving without (or before) a connected biometric device."}
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
        <Field label="Time of resumption">
          <DateTimePicker value={resumedAt} onChange={setResumedAt} />
        </Field>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Late — traffic" />
        </Field>
        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{notice}</Notice>
        <Button type="submit" disabled={saving}>
          {saving ? "Logging..." : "Log resumption"}
        </Button>
      </form>
    </Card>
  );
};

/* -------------------------------------------------------------------- devices */
const Devices = ({ schoolId }) => {
  const [devices, setDevices] = useState([]);
  const [issuedKey, setIssuedKey] = useState(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!schoolId) return;
    fetchAttendanceDevices(schoolId).then(setDevices).catch((err) => setError(err.message));
  }, [schoolId]);

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
    <Card style={{ maxWidth: 640 }}>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 13.5 }}>
        {"A device (or a small bridge script talking to an existing biometric/card system) calls the "}
        <code>record_school_attendance</code>
        {" endpoint with this key, plus the person's email, each time someone scans in. Point your vendor's integration or webhook at it once you have a key."}
      </p>

      {issuedKey ? (
        <Notice tone="success">
          {`"${issuedKey.label}" connected. Key (shown once — copy it now): `}
          <code style={{ userSelect: "all" }}>{issuedKey.key}</code>
        </Notice>
      ) : null}
      <Notice tone="error">{error}</Notice>

      <form onSubmit={handleCreate} className="btn-row" style={{ marginBottom: 20 }}>
        <input
          className="input"
          placeholder="Label, e.g. Front gate scanner"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <Button type="submit" disabled={creating}>
          {creating ? "Connecting..." : "Connect a device"}
        </Button>
      </form>

      {devices.length === 0 ? (
        <Empty>{"No devices connected yet."}</Empty>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {devices.map((d) => (
            <div
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-sm)",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{d.label}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {`Connected ${formatDate(d.created_at, { withTime: false })}`}
                  {d.last_used_at ? ` · last used ${formatDate(d.last_used_at)}` : " · never used yet"}
                </div>
              </div>
              <div className="btn-row">
                <Badge tone={d.is_active ? "success" : undefined}>{d.is_active ? "Active" : "Revoked"}</Badge>
                <Button type="button" variant="secondary" size="sm" onClick={() => toggleActive(d)}>
                  {d.is_active ? "Revoke" : "Reactivate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

/* ------------------------------------------------------------ my children */
const MyChildrenAttendance = ({ schoolId }) => {
  const { user } = useAuth();
  const [classRecords, setClassRecords] = useState([]);
  const [schoolRecords, setSchoolRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
  }, [schoolId, user?.id]);

  if (loading) return <Empty>{"Loading..."}</Empty>;

  return (
    <>
      <Notice tone="error">{error}</Notice>
      <Card>
        <h3 style={{ marginTop: 0 }}>{"Class attendance"}</h3>
        {classRecords.length === 0 ? (
          <Empty>{"Nothing marked yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>{"Session"}</th><th>{"Child"}</th><th>{"Class"}</th><th>{"Status"}</th></tr>
              </thead>
              <tbody>
                {classRecords.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.session_at)}</td>
                    <td>{displayName(row.student)}</td>
                    <td>{row.classes?.name}</td>
                    <td><Badge tone={CLASS_STATUS_TONE[row.status]}>{row.status === "present" ? "Present" : "Absent"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{"School attendance (resumption)"}</h3>
        {schoolRecords.length === 0 ? (
          <Empty>{"No resumptions recorded yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>{"Resumed at"}</th><th>{"Child"}</th><th>{"Source"}</th></tr>
              </thead>
              <tbody>
                {schoolRecords.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.resumed_at)}</td>
                    <td>{displayName(row.person)}</td>
                    <td>{SOURCE_LABEL[row.source]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (!schoolId || !user?.id) return;
    setLoading(true);
    fetchMySchoolAttendance({ schoolId, personId: user.id })
      .then(setRecords)
      .catch((err) => setError(err.message || "Could not load your attendance."))
      .finally(() => setLoading(false));
  }, [schoolId, user?.id]);

  if (loading) return <Empty>{"Loading..."}</Empty>;

  return (
    <Card>
      <Notice tone="error">{error}</Notice>
      {records.length === 0 ? (
        <Empty>{"No resumptions recorded for you yet."}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{"Resumed at"}</th><th>{"Source"}</th><th>{"Note"}</th></tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.resumed_at)}</td>
                  <td>{SOURCE_LABEL[row.source]}</td>
                  <td>{row.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
