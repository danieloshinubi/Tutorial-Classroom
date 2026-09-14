import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { fetchCoursesOwnedBy, updateCourse, deleteCourse } from "../../lib/api";
import {
  Page,
  Card,
  Grid,
  Badge,
  Button,
  Empty,
  Notice,
} from "../../Components/UI";

const Teach = () => {
  const { user } = useAuth();
  const { schoolId, labelFor } = useSchool();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    if (!user || !schoolId) return;
    setLoading(true);
    fetchCoursesOwnedBy({ schoolId, userId: user.id })
      .then(setCourses)
      .catch((err) => setError(err.message || "Could not load your courses."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user, schoolId]);

  const handleArchiveToggle = async (course) => {
    setError("");
    try {
      await updateCourse(course.id, { archived: !course.archived }, schoolId);
      load();
    } catch (err) {
      setError(err.message || "Could not update that course.");
    }
  };

  const handleDelete = async (course) => {
    setError("");
    // Deleting cascades to the course's materials, assignments, submissions
    // and chat, so make the consequence explicit before it happens.
    const confirmed = window.confirm(
      `Delete ${course.code}? This permanently removes its materials, assignments, submissions and chat. This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await deleteCourse(course.id, schoolId);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that course.");
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Teaching"
        action={
          <Link to="/Teach/New">
            <Button>{"Create a course"}</Button>
          </Link>
        }
      >
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading..."}</Empty> : null}
        {!loading && courses.length === 0 ? (
          <Empty>{"You have not created any courses yet."}</Empty>
        ) : null}

        <Grid wide>
          {courses.map((course) => (
            <Card key={course.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <strong style={{ fontSize: "18px" }}>{course.code}</strong>
                <span style={{ display: "flex", gap: "6px" }}>
                  <Badge>{labelFor(course.level_year)}</Badge>
                  {course.archived ? <Badge tone="warn">{"archived"}</Badge> : null}
                </span>
              </div>
              <p style={{ color: "#555" }}>{course.title || "No title yet"}</p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <Link to={`/Courses/${course.code}`}>
                  <Button variant="secondary">{"Open"}</Button>
                </Link>
                <Link to={`/Teach/${course.id}/Edit`}>
                  <Button variant="secondary">{"Edit"}</Button>
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => handleArchiveToggle(course)}
                >
                  {course.archived ? "Unarchive" : "Archive"}
                </Button>
                <Button variant="danger" onClick={() => handleDelete(course)}>
                  {"Delete"}
                </Button>
              </div>
            </Card>
          ))}
        </Grid>
      </Page>
    </div>
  );
};

export default Teach;
