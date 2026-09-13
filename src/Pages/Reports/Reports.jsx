import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { fetchReportableStudents, fetchChildren } from "../../lib/api";
import {
  Page,
  Card,
  Grid,
  Button,
  Notice,
  Empty,
  Badge,
  displayName,
  initials,
} from "../../Components/UI";

// Lists whoever this viewer may report on: a parent sees their children, a
// tutor sees the students in their courses, an administrator sees everyone.
// The list comes from the database, so the page cannot show more than the
// viewer is entitled to.
const Reports = () => {
  const { user } = useAuth();
  const { schoolId, isParent, isAdmin } = useSchool();

  const [students, setStudents] = useState([]);
  const [children, setChildren] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    // Waiting for the school: without this the query goes out with
    // school_id=eq.null and Postgres rejects "null" as a uuid.
    if (!schoolId || !user) return;
    setLoading(true);
    try {
      const [all, mine] = await Promise.all([
        fetchReportableStudents(schoolId),
        fetchChildren(user.id).catch(() => []),
      ]);
      setStudents(all);
      setChildren(mine);
    } catch (err) {
      setError(err.message || "Could not load students.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, user]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((s) =>
      [s.first_name, s.surname, s.email]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle))
    );
  }, [students, query]);

  const childIds = new Set(children.map((c) => c.student.id));

  const Person = ({ id, first_name, surname, email, avatar_url, tag }) => (
    <Link to={`/Reports/${id}`} className="card-link">
      <Card style={{ height: "100%" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {avatar_url ? (
            <img
              src={avatar_url}
              alt=""
              style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <span
              className="brand-mark"
              style={{ width: 42, height: 42, borderRadius: "50%", fontSize: 14 }}
            >
              {initials({ first_name, surname, email })}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>
              {displayName({ first_name, surname, email })}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {email}
            </div>
          </div>
        </div>
        {tag ? (
          <div style={{ marginTop: 12 }}>
            <Badge tone="brand">{tag}</Badge>
          </div>
        ) : null}
      </Card>
    </Link>
  );

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Reports"
        subtitle={
          isParent
            ? "How your children are doing"
            : "How your students are progressing"
        }
      >
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {/* Children first — a parent who also teaches should not have to hunt
            for their own child in a list of students. */}
        {children.length > 0 ? (
          <section>
            <h2>{children.length === 1 ? "Your child" : "Your children"}</h2>
            <Grid>
              {children.map((row) => (
                <Person
                  key={row.id}
                  id={row.student.id}
                  {...row.student}
                  tag={row.relationship || "Your child"}
                />
              ))}
            </Grid>
          </section>
        ) : null}

        {!loading && students.length === 0 && children.length === 0 ? (
          <Empty>
            {isParent
              ? "No children are linked to your account yet. Ask the school to link them."
              : "No students to report on yet. Students appear here once they join a course you teach."}
          </Empty>
        ) : null}

        {students.length > 0 ? (
          <section className="section">
            <div className="page-head" style={{ marginBottom: 12 }}>
              <h2>{isAdmin ? "All students" : "Your students"}</h2>
              <input
                className="input"
                style={{ maxWidth: 260 }}
                placeholder="Search students"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {filtered.length === 0 ? <Empty>{"Nobody matches."}</Empty> : null}

            <Grid>
              {filtered
                .filter((s) => !childIds.has(s.student_id))
                .map((s) => (
                  <Person key={s.student_id} id={s.student_id} {...s} />
                ))}
            </Grid>
          </section>
        ) : null}

        {/* A student looking at their own progress. */}
        {!isParent && !isAdmin && students.length === 0 && children.length === 0 ? (
          <div style={{ marginTop: 20 }}>
            <Link to={`/Reports/${user?.id}`}>
              <Button variant="secondary">{"See my own report"}</Button>
            </Link>
          </div>
        ) : null}
      </Page>
    </div>
  );
};

export default Reports;
