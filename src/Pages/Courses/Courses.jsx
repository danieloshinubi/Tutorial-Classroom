import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { fetchCourses, fetchSessions } from "../../lib/api";
import {
  Page,
  Grid,
  Empty,
  Notice,
  Button,
  Badge,
  bandClass,
  Select,
} from "../../Components/UI";

// Every course in the school, in one place. Courses used to be reached through
// a level — /Levels/100/Courses/AZ-900 — but a course's identity is its code
// and the session it runs in, not the level it happens to sit under.
const Courses = () => {
  const { schoolId, isStaff } = useSchool();

  const [courses, setCourses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionFilter, setSessionFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [rows, sess] = await Promise.all([
        fetchCourses({ schoolId }),
        fetchSessions(schoolId).catch(() => []),
      ]);
      setCourses(rows);
      setSessions(sess);
      // Default to the year being taught rather than everything ever run.
      const current = sess.find((s) => s.is_current);
      if (current && rows.some((r) => r.session_id === current.id)) {
        setSessionFilter(current.id);
      }
    } catch (err) {
      setError(err.message || "Could not load courses.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (sessionFilter !== "all" && c.session_id !== sessionFilter) return false;
      if (!needle) return true;
      return [c.code, c.title].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
    });
  }, [courses, query, sessionFilter]);

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Courses"
        subtitle={loading ? "" : `${filtered.length} of ${courses.length}`}
        action={
          isStaff ? (
            <Link to="/Teach/New">
              <Button>{"Create a course"}</Button>
            </Link>
          ) : null
        }
        toolbar={
          <div className="filters">
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Search by code or title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {sessions.length > 0 ? (
            <Select
              className="select"
              style={{ width: "auto" }}
              value={sessionFilter}
              onChange={setSessionFilter}
              options={[
                { value: "all", label: "All sessions" },
                ...sessions.map((s) => ({
                  value: s.id,
                  label: s.is_current ? `${s.name} (current)` : s.name,
                })),
              ]}
            />
          ) : null}
          </div>
        }
      >

        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading courses..."}</Empty> : null}

        {!loading && courses.length === 0 ? (
          <Empty>
            {isStaff
              ? "No courses yet. Create the first one."
              : "This school has no courses yet."}
          </Empty>
        ) : null}

        {!loading && courses.length > 0 && filtered.length === 0 ? (
          <Empty>{"Nothing matches that search."}</Empty>
        ) : null}

        <Grid>
          {filtered.map((course) => (
            <Link
              key={course.id}
              // The session rides in the query string so the same code in a
              // different year is still reachable by a clean URL.
              to={
                course.session_id
                  ? `/Courses/${course.code}?session=${course.session_id}`
                  : `/Courses/${course.code}`
              }
              className="card-link"
            >
              <article className="tile">
                <div className={bandClass(course.code)}>{course.code}</div>
                <div className="tile-body">
                  <span className="tile-title">{course.title || course.code}</span>
                  {course.sessions ? (
                    <span>
                      <Badge tone={course.sessions.is_current ? "brand" : undefined}>
                        {course.sessions.name}
                      </Badge>
                    </span>
                  ) : (
                    <span className="tile-sub">{"No session set"}</span>
                  )}
                </div>
              </article>
            </Link>
          ))}
        </Grid>
      </Page>
    </div>
  );
};

export default Courses;
