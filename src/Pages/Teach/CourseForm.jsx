import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  createCourse,
  updateCourse,
  fetchLevelsForSchool,
  createLevel,
  fetchCourseById,
  fetchSessions,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Notice,
  Select,
} from "../../Components/UI";

// Handles both /Teach/New and /Teach/:courseId/Edit.
const CourseForm = () => {
  const { courseId } = useParams();
  const isEditing = Boolean(courseId);

  const { user } = useAuth();
  const { schoolId, isAdmin, isPrincipal } = useSchool();
  const navigate = useNavigate();

  const [levels, setLevels] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState({
    code: "",
    title: "",
    description: "",
    level_year: "",
    session_id: "",
  });
  const [loading, setLoading] = useState(isEditing);
  // Did the existing course actually arrive? If the load failed we must not
  // show an empty form that saves blanks over the real row.
  const [loaded, setLoaded] = useState(!isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A tutor should not have to wait for an administrator to define a class
  // before they can create a course, so they can add one right here.
  const [newClass, setNewClass] = useState("");
  const [addingClass, setAddingClass] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    fetchSessions(schoolId)
      .then((rows) => {
        setSessions(rows);
        // Defaults are for a NEW course only. Filling a blank on an existing
        // one would quietly assign it a session its tutor never chose, and
        // then save it.
        if (isEditing) return;
        setForm((current) =>
          current.session_id || rows.length === 0
            ? current
            : {
                ...current,
                session_id: (rows.find((r) => r.is_current) || rows[0]).id,
              }
        );
      })
      .catch(() => setSessions([]));

    fetchLevelsForSchool(schoolId)
      .then((rows) => {
        setLevels(rows);
        // Same again: preselect for a new course, never for an existing one.
        if (isEditing) return;
        setForm((current) =>
          current.level_year || rows.length === 0
            ? current
            : { ...current, level_year: String(rows[0].year) }
        );
      })
      .catch(() => setLevels([]));
  }, [schoolId, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    fetchCourseById(courseId)
      .then((course) => {
        if (!course) {
          setError("That course no longer exists.");
          return;
        }
        setForm({
          code: course.code,
          title: course.title || "",
          description: course.description || "",
          level_year: course.level_year == null ? "" : String(course.level_year),
          session_id: course.session_id || "",
        });
        setLoaded(true);
      })
      .catch((err) => setError(err.message || "Could not load the course."))
      .finally(() => setLoading(false));
  }, [courseId, isEditing]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  // Naming a class is school administration: the name lands in everybody's
  // dropdown. A teacher picks from the list instead — offering them a button
  // the database then refuses is how the raw policy error ended up on screen.
  const canNameClasses = isAdmin || isPrincipal;

  const handleAddClass = async () => {
    const label = newClass.trim();
    if (!label) return;

    setAddingClass(true);
    setError("");
    try {
      // Order is just "next": the tutor names the class, the number only
      // decides where it sits in the list.
      const nextYear = levels.length
        ? Math.max(...levels.map((row) => row.year)) + 1
        : 1;
      const created = await createLevel({ schoolId, year: nextYear, label });
      setLevels((current) => [...current, created]);
      setForm((current) => ({ ...current, level_year: String(created.year) }));
      setNewClass("");
    } catch (err) {
      setError(
        /row-level security/i.test(err.message || "")
          ? "Only an administrator or the principal can name a new class. Ask them to add it, then it will appear in the list."
          : err.message || "Could not add that class."
      );
    } finally {
      setAddingClass(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (isEditing && !loaded) {
      setError("This course has not finished loading — saving now would blank it.");
      return;
    }

    const code = form.code.trim().toUpperCase();
    if (!code) {
      setError("A course code is required.");
      return;
    }


    setSaving(true);
    try {
      const payload = {
        code,
        title: form.title.trim(),
        description: form.description.trim() || null,
        // Both optional now: a course is identified by its code and session.
        level_year: form.level_year ? Number(form.level_year) : null,
        session_id: form.session_id || null,
        school_id: schoolId,
      };

      if (isEditing) {
        await updateCourse(courseId, payload);
      } else {
        await createCourse({ ...payload, owner_id: user.id });
      }
      navigate("/Teach");
    } catch (err) {
      // The unique index on `code` is the usual reason a create fails.
      setError(
        err.code === "23505"
          ? `${code} already exists in that session. Pick a different session, or a different code.`
          : err.message || "Could not save the course."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page title={isEditing ? "Edit course" : "Create a course"}>
        <Card style={{ maxWidth: "620px" }}>
          {loading ? (
            <p>{"Loading..."}</p>
          ) : isEditing && !loaded ? (
            <>
              <Notice tone="error">
                {error || "Could not load that course, so it cannot be edited safely."}
              </Notice>
              <Button variant="secondary" onClick={() => navigate("/Teach")}>
                {"Back to teaching"}
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <Field label="Course code" hint="For example COSC205.">
                <input
                  required
                  className="input"
                  value={form.code}
                  onChange={update("code")}
                />
              </Field>
              <Field label="Title">
                <input
                  className="input"
                  value={form.title}
                  onChange={update("title")}
                  placeholder="Data Structures and Algorithms"
                />
              </Field>
              <Field
                label="Session"
                hint={
                  sessions.length
                    ? "Which academic year this course runs in. The same course can run again in a later session as a separate course."
                    : "No sessions yet — an administrator adds them under School → Calendar."
                }
              >
                <Select
                  className="select"
                  value={form.session_id}
                  onChange={(v) =>
                    setForm((current) => ({ ...current, session_id: v }))
                  }
                  options={[
                    { value: "", label: "No session" },
                    ...sessions.map((s) => ({
                      value: s.id,
                      label: s.is_current ? `${s.name} (current)` : s.name,
                    })),
                  ]}
                />
              </Field>

              <Field
                label="Class or department"
                hint={
                  levels.length
                    ? "Optional. Which class, stream or department this course belongs to."
                    : "Optional. Your school has not set any up yet."
                }
              >
                {levels.length ? (
                  <Select
                    className="select"
                    value={form.level_year}
                    onChange={(v) =>
                      setForm((current) => ({ ...current, level_year: v }))
                    }
                    options={[
                      { value: "", label: "No class" },
                      ...levels.map((level) => ({
                        value: level.year,
                        label: level.label,
                      })),
                    ]}
                  />
                ) : null}
              </Field>

              {canNameClasses ? (
                <Field
                  label={levels.length ? "Add another class" : "Add a class"}
                  hint='Call it whatever your school calls it — "JSS 1", "Year 7", "Grade 4".'
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="input"
                      value={newClass}
                      placeholder="JSS 1"
                      onChange={(e) => setNewClass(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddClass();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={addingClass || !newClass.trim()}
                      onClick={handleAddClass}
                    >
                      {addingClass ? "Adding..." : "Add"}
                    </Button>
                  </div>
                </Field>
              ) : levels.length === 0 ? (
                <Notice tone="muted">
                  {"Your school has not set up its classes or departments yet. An administrator or the principal adds those on the School page — until then, leave this blank."}
                </Notice>
              ) : null}
              <Field label="Description">
                <textarea
                  className="textarea"
                  value={form.description}
                  onChange={update("description")}
                />
              </Field>

              <Notice tone="error">{error}</Notice>

              <div style={{ display: "flex", gap: "10px" }}>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : isEditing ? "Save changes" : "Create course"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate("/Teach")}
                >
                  {"Cancel"}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </Page>
    </div>
  );
};

export default CourseForm;
