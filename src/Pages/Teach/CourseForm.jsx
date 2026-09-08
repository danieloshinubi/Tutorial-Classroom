import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  createCourse,
  updateCourse,
  fetchLevelsForSchool,
  fetchAllCourses,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Notice,
} from "../../Components/UI";

// Handles both /Teach/New and /Teach/:courseId/Edit.
const CourseForm = () => {
  const { courseId } = useParams();
  const isEditing = Boolean(courseId);

  const { user } = useAuth();
  const { schoolId } = useSchool();
  const navigate = useNavigate();

  const [levels, setLevels] = useState([]);
  const [form, setForm] = useState({
    code: "",
    title: "",
    description: "",
    level_year: "100",
  });
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!schoolId) return;
    fetchLevelsForSchool(schoolId)
      .then(setLevels)
      .catch(() => setLevels([]));
  }, [schoolId]);

  useEffect(() => {
    if (!isEditing) return;
    fetchAllCourses()
      .then((all) => {
        const course = all.find((row) => row.id === courseId);
        if (!course) {
          setError("That course no longer exists.");
          return;
        }
        setForm({
          code: course.code,
          title: course.title || "",
          description: course.description || "",
          level_year: String(course.level_year),
        });
      })
      .catch((err) => setError(err.message || "Could not load the course."))
      .finally(() => setLoading(false));
  }, [courseId, isEditing]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

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
        level_year: Number(form.level_year),
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
          ? `A course with the code ${code} already exists.`
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
              <Field label="Level">
                <select
                  className="select"
                  value={form.level_year}
                  onChange={update("level_year")}
                >
                  {levels.map((level) => (
                    <option key={level.year} value={level.year}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </Field>
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
