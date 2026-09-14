import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchClasses,
  createClass,
  updateClass,
  deleteClass,
  fetchClassRoster,
  addStudentToClass,
  removeStudentFromClass,
  fetchSubjects,
  createSubject,
  deleteSubject,
  fetchClassSubjects,
  assignSubjectToClass,
  updateClassSubject,
  removeClassSubject,
  fetchSchoolMembers,
  fetchSessions,
} from "../../lib/api";
import {
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  Select,
  displayName,
} from "../../Components/UI";

// A class is a roster, not a level: "JSS 2" is the level, "JSS 2B" is the
// class with pupils in it and a form teacher over it.
const ClassesPanel = () => {
  const { schoolId, levels, labelFor } = useSchool();

  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [staff, setStaff] = useState([]);
  const [students, setStudents] = useState([]);

  const [openClass, setOpenClass] = useState(null);
  const [roster, setRoster] = useState([]);
  const [taught, setTaught] = useState([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({ name: "", levelYear: "", sessionId: "", formTeacherId: "" });
  const [subject, setSubject] = useState({ code: "", name: "" });
  const [addStudentId, setAddStudentId] = useState("");
  const [addSubject, setAddSubject] = useState({ subjectId: "", teacherId: "" });

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [c, s, sess, members] = await Promise.all([
        fetchClasses(schoolId),
        fetchSubjects(schoolId),
        fetchSessions(schoolId),
        fetchSchoolMembers(schoolId),
      ]);
      setClasses(c);
      setSubjects(s);
      setSessions(sess);
      setStaff(members.filter((m) => ["teacher", "admin", "owner"].includes(m.role)));
      setStudents(members.filter((m) => m.role === "student"));
      setForm((f) => ({
        ...f,
        levelYear: f.levelYear || (levels[0]?.year ?? ""),
        sessionId: f.sessionId || sess.find((x) => x.is_current)?.id || sess[0]?.id || "",
      }));
    } catch (err) {
      setError(err.message || "Could not load classes.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, levels]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (row) => {
    if (openClass === row.id) return setOpenClass(null);
    setOpenClass(row.id);
    setBusy(true);
    try {
      const [r, cs] = await Promise.all([
        fetchClassRoster(row.id, schoolId),
        fetchClassSubjects(row.id, schoolId),
      ]);
      setRoster(r);
      setTaught(cs);
    } catch (err) {
      setError(err.message || "Could not open that class.");
    } finally {
      setBusy(false);
    }
  };

  const refreshDetail = async (classId) => {
    const [r, cs] = await Promise.all([
      fetchClassRoster(classId, schoolId),
      fetchClassSubjects(classId, schoolId),
    ]);
    setRoster(r);
    setTaught(cs);
  };

  const handleCreateClass = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Give the class a name, such as JSS 2B.");
    if (form.levelYear === "") return setError("Choose which class level it belongs to.");

    setBusy(true);
    try {
      await createClass({
        schoolId,
        sessionId: form.sessionId,
        levelYear: Number(form.levelYear),
        name: form.name.trim(),
        formTeacherId: form.formTeacherId,
      });
      setForm((f) => ({ ...f, name: "", formTeacherId: "" }));
      load();
    } catch (err) {
      setError(
        err.code === "23505"
          ? "There is already a class with that name this session."
          : err.message || "Could not create that class."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteClass = async (row) => {
    if (
      !window.confirm(
        `Delete ${row.name}? Its roster and subject assignments go with it. Pupil accounts are not touched.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteClass(row.id, schoolId);
      setOpenClass(null);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that class.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddSubject = async (event) => {
    event.preventDefault();
    setError("");
    if (!subject.name.trim()) return setError("Give the subject a name.");
    setBusy(true);
    try {
      await createSubject({ schoolId, code: subject.code.trim(), name: subject.name.trim() });
      setSubject({ code: "", name: "" });
      load();
    } catch (err) {
      setError(
        err.code === "23505"
          ? `${subject.name.trim()} already exists.`
          : err.message || "Could not add that subject."
      );
    } finally {
      setBusy(false);
    }
  };

  const placeStudent = async () => {
    if (!addStudentId || !openClass) return;
    setBusy(true);
    setError("");
    try {
      await addStudentToClass({ classId: openClass, studentId: addStudentId, schoolId });
      setAddStudentId("");
      await refreshDetail(openClass);
    } catch (err) {
      setError(
        err.code === "23505"
          ? "That pupil is already in this class."
          : err.message || "Could not add that pupil."
      );
    } finally {
      setBusy(false);
    }
  };

  const teachSubject = async () => {
    if (!addSubject.subjectId || !openClass) return;
    setBusy(true);
    setError("");
    try {
      await assignSubjectToClass({
        schoolId,
        classId: openClass,
        subjectId: addSubject.subjectId,
        teacherId: addSubject.teacherId,
      });
      setAddSubject({ subjectId: "", teacherId: "" });
      await refreshDetail(openClass);
    } catch (err) {
      setError(
        err.code === "23505"
          ? "That subject is already assigned to this class."
          : err.message || "Could not assign that subject."
      );
    } finally {
      setBusy(false);
    }
  };

  const unplacedStudents = useMemo(
    () => students.filter((s) => !roster.some((r) => r.student.id === s.profiles.id)),
    [students, roster]
  );

  return (
    <>
      <Notice tone="error">{error}</Notice>

      {levels.length === 0 ? (
        <Notice tone="error">
          {"Add class levels first — a class belongs to one. See the Class levels tab."}
        </Notice>
      ) : null}

      <div className="split" style={{ alignItems: "start" }}>
        <div>
          <h3>{"Classes"}</h3>
          {loading ? <Empty>{"Loading..."}</Empty> : null}
          {!loading && classes.length === 0 ? (
            <Empty>{"No classes yet."}</Empty>
          ) : null}

          {classes.map((row) => (
            <Card key={row.id} style={{ marginBottom: 10 }}>
              <div className="page-head" style={{ marginBottom: 0 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{row.name}</strong>
                  <span style={{ marginLeft: 8 }}>
                    <Badge>{labelFor(row.level_year)}</Badge>
                  </span>
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
                    {row.form_teacher
                      ? `Form teacher: ${displayName(row.form_teacher)}`
                      : "No form teacher"}
                  </div>
                </div>
                <span className="btn-row">
                  <Button variant="secondary" size="sm" onClick={() => openDetail(row)}>
                    {openClass === row.id ? "Close" : "Manage"}
                  </Button>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => handleDeleteClass(row)}>
                    {"Delete"}
                  </Button>
                </span>
              </div>

              {openClass === row.id ? (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                  <Field label="Form teacher">
                    <Select
                      className="select"
                      value={row.form_teacher_id || ""}
                      onChange={async (v) => {
                        await updateClass(row.id, schoolId, { form_teacher_id: v || null });
                        load();
                      }}
                      options={[
                        { value: "", label: "Nobody" },
                        ...staff.map((m) => ({ value: m.profiles.id, label: displayName(m.profiles) })),
                      ]}
                    />
                  </Field>

                  <h4 style={{ marginBottom: 8 }}>{`Pupils (${roster.length})`}</h4>
                  {roster.length === 0 ? (
                    <p style={{ color: "var(--ink-3)", fontSize: 13.5 }}>{"Nobody placed yet."}</p>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                      {roster.map((r) => (
                        <div
                          key={r.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "7px 11px",
                            background: "var(--bg)",
                            borderRadius: "var(--r-sm)",
                          }}
                        >
                          <span style={{ flex: 1 }}>{displayName(r.student)}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={async () => {
                              await removeStudentFromClass(r.id, schoolId);
                              refreshDetail(row.id);
                            }}
                          >
                            {"Remove"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                    <Select
                      className="select"
                      value={addStudentId}
                      onChange={setAddStudentId}
                      options={[
                        { value: "", label: unplacedStudents.length ? "Add a pupil" : "Every pupil is placed" },
                        ...unplacedStudents.map((s) => ({ value: s.profiles.id, label: displayName(s.profiles) })),
                      ]}
                    />
                    <Button size="sm" disabled={busy || !addStudentId} onClick={placeStudent}>
                      {"Add"}
                    </Button>
                  </div>

                  <h4 style={{ marginBottom: 8 }}>{`Subjects (${taught.length})`}</h4>
                  {taught.length === 0 ? (
                    <p style={{ color: "var(--ink-3)", fontSize: 13.5 }}>{"No subjects assigned."}</p>
                  ) : (
                    <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                      {taught.map((t) => (
                        <div
                          key={t.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                            padding: "7px 11px",
                            background: "var(--bg)",
                            borderRadius: "var(--r-sm)",
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 120 }}>{t.subjects?.name}</span>
                          <Select
                            className="select"
                            style={{ width: "auto", padding: "5px 8px" }}
                            value={t.teacher_id || ""}
                            onChange={async (v) => {
                              await updateClassSubject(t.id, schoolId, {
                                teacher_id: v || null,
                              });
                              refreshDetail(row.id);
                            }}
                            options={[
                              { value: "", label: "No teacher" },
                              ...staff.map((m) => ({ value: m.profiles.id, label: displayName(m.profiles) })),
                            ]}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={async () => {
                              await removeClassSubject(t.id, schoolId);
                              refreshDetail(row.id);
                            }}
                          >
                            {"Remove"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Select
                      className="select"
                      style={{ flex: 1, minWidth: 140 }}
                      value={addSubject.subjectId}
                      onChange={(v) => setAddSubject((c) => ({ ...c, subjectId: v }))}
                      options={[
                        { value: "", label: subjects.length ? "Add a subject" : "No subjects yet" },
                        ...subjects.map((s) => ({ value: s.id, label: s.name })),
                      ]}
                    />
                    <Select
                      className="select"
                      style={{ flex: 1, minWidth: 140 }}
                      value={addSubject.teacherId}
                      onChange={(v) => setAddSubject((c) => ({ ...c, teacherId: v }))}
                      options={[
                        { value: "", label: "Teacher (optional)" },
                        ...staff.map((m) => ({ value: m.profiles.id, label: displayName(m.profiles) })),
                      ]}
                    />
                    <Button size="sm" disabled={busy || !addSubject.subjectId} onClick={teachSubject}>
                      {"Assign"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ))}
        </div>

        <div>
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{"Add a class"}</h3>
            <form onSubmit={handleCreateClass}>
              <Field label="Name" hint="JSS 2B, Primary 4 Gold — whatever you call it.">
                <input
                  className="input"
                  value={form.name}
                  placeholder="JSS 2B"
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                />
              </Field>
              <Field label="Class level">
                <Select
                  className="select"
                  value={form.levelYear}
                  onChange={(v) => setForm((c) => ({ ...c, levelYear: v }))}
                  options={[
                    { value: "", label: "Choose" },
                    ...levels.map((l) => ({ value: l.year, label: l.label })),
                  ]}
                />
              </Field>
              {sessions.length ? (
                <Field label="Session">
                  <Select
                    className="select"
                    value={form.sessionId}
                    onChange={(v) => setForm((c) => ({ ...c, sessionId: v }))}
                    options={sessions.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </Field>
              ) : null}
              <Field label="Form teacher">
                <Select
                  className="select"
                  value={form.formTeacherId}
                  onChange={(v) => setForm((c) => ({ ...c, formTeacherId: v }))}
                  options={[
                    { value: "", label: "Decide later" },
                    ...staff.map((m) => ({ value: m.profiles.id, label: displayName(m.profiles) })),
                  ]}
                />
              </Field>
              <Button type="submit" disabled={busy || levels.length === 0}>
                {"Add class"}
              </Button>
            </form>
          </Card>

          <Card>
            <h3 style={{ marginTop: 0 }}>{`Subjects (${subjects.length})`}</h3>
            <form onSubmit={handleAddSubject}>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "90px 1fr" }}>
                <Field label="Code">
                  <input
                    className="input"
                    value={subject.code}
                    placeholder="MTH"
                    onChange={(e) => setSubject((c) => ({ ...c, code: e.target.value }))}
                  />
                </Field>
                <Field label="Name">
                  <input
                    className="input"
                    value={subject.name}
                    placeholder="Mathematics"
                    onChange={(e) => setSubject((c) => ({ ...c, name: e.target.value }))}
                  />
                </Field>
              </div>
              <Button type="submit" disabled={busy}>{"Add subject"}</Button>
            </form>

            {subjects.length ? (
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {subjects.map((s) => (
                  <span
                    key={s.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 10px",
                      background: "var(--bg)",
                      borderRadius: "999px",
                      fontSize: 13.5,
                    }}
                  >
                    {s.name}
                    <button
                      type="button"
                      aria-label={`Delete ${s.name}`}
                      style={{
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        color: "var(--ink-3)",
                        padding: 0,
                      }}
                      onClick={async () => {
                        if (!window.confirm(`Delete ${s.name}? It is removed from every class.`)) return;
                        await deleteSubject(s.id, schoolId);
                        load();
                      }}
                    >
                      {"×"}
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
};

export default ClassesPanel;
