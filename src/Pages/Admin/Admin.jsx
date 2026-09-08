import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import {
  fetchAllProfiles,
  fetchAllCourses,
  updateProfile,
  deleteProfile,
  updateCourse,
  deleteCourse,
} from "../../lib/api";
import {
  Page,
  Card,
  Button,
  Badge,
  Notice,
  Empty,
  Tabs,
  displayName,
  formatDate,
} from "../../Components/UI";

const UsersTab = () => {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => {
    setLoading(true);
    fetchAllProfiles()
      .then(setProfiles)
      .catch((err) => setError(err.message || "Could not load users."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter((row) =>
      [row.first_name, row.surname, row.username, row.email]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [profiles, query]);

  const handleRoleChange = async (row, role) => {
    setError("");
    setNotice("");
    try {
      await updateProfile(row.id, { role });
      setNotice(`${displayName(row)} is now a ${role}.`);
      load();
    } catch (err) {
      setError(err.message || "Could not change that role.");
    }
  };

  const handleDelete = async (row) => {
    setError("");
    setNotice("");
    const confirmed = window.confirm(
      `Remove ${displayName(row)} from the classroom? Their enrollments, submissions and messages go with them. The login itself stays until you delete it in the Supabase dashboard.`
    );
    if (!confirmed) return;

    try {
      await deleteProfile(row.id);
      load();
    } catch (err) {
      setError(err.message || "Could not remove that user.");
    }
  };

  return (
    <>
      <input
        className="input" style={{ maxWidth: "340px", margin: "16px 0" }}
        placeholder="Search by name, username or email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>
      {loading ? <Empty>{"Loading users..."}</Empty> : null}
      {!loading && filtered.length === 0 ? <Empty>{"No users match."}</Empty> : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "6px 16px" }}>
          <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{"Name"}</th>
                <th>{"Email"}</th>
                <th>{"Role"}</th>
                <th>{"Joined"}</th>
                <th>{""}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isSelf = row.id === user?.id;
                return (
                  <tr key={row.id}>
                    <td>
                      {displayName(row)}
                      {isSelf ? (
                        <span style={{ marginLeft: "8px" }}>
                          <Badge tone="success">{"you"}</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td>{row.email || "—"}</td>
                    <td>
                      {/* Changing your own role away from admin would lock you
                          out of this page, so it is disabled for yourself. */}
                      <select
                        value={row.role}
                        disabled={isSelf}
                        onChange={(e) => handleRoleChange(row, e.target.value)}
                        className="select" style={{ padding: "6px 8px", width: "auto" }}
                      >
                        <option value="student">{"student"}</option>
                        <option value="tutor">{"tutor"}</option>
                        <option value="admin">{"admin"}</option>
                      </select>
                    </td>
                    <td>
                      {formatDate(row.created_at, { withTime: false })}
                    </td>
                    <td>
                      <Button
                        variant="danger"
                        disabled={isSelf}
                        onClick={() => handleDelete(row)}
                        size="sm"
                      >
                        {"Remove"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      ) : null}
    </>
  );
};

const CoursesTab = () => {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    fetchAllCourses()
      .then(setCourses)
      .catch((err) => setError(err.message || "Could not load courses."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleArchiveToggle = async (course) => {
    setError("");
    try {
      await updateCourse(course.id, { archived: !course.archived });
      load();
    } catch (err) {
      setError(err.message || "Could not update that course.");
    }
  };

  const handleDelete = async (course) => {
    setError("");
    const confirmed = window.confirm(
      `Delete ${course.code}? This permanently removes its materials, assignments, submissions and chat. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await deleteCourse(course.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that course.");
    }
  };

  return (
    <>
      <div style={{ margin: "16px 0" }}>
        <Link to="/Teach/New">
          <Button>{"Create a course"}</Button>
        </Link>
      </div>

      <Notice tone="error">{error}</Notice>
      {loading ? <Empty>{"Loading courses..."}</Empty> : null}

      {courses.length > 0 ? (
        <Card className="pad-0" style={{ padding: "6px 16px" }}>
          <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{"Code"}</th>
                <th>{"Title"}</th>
                <th>{"Class"}</th>
                <th>{"Owner"}</th>
                <th>{""}</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <td>
                    <Link
                      to={`/Levels/${course.level_year}/Courses/${course.code}`}
                      style={{ color: "inherit" }}
                    >
                      {course.code}
                    </Link>
                    {course.archived ? (
                      <span style={{ marginLeft: "8px" }}>
                        <Badge tone="warn">{"archived"}</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td>{course.title || "—"}</td>
                  <td>{course.level_year}</td>
                  <td>
                    {course.owner ? displayName(course.owner) : "Catalogue"}
                  </td>
                  <td>
                    <span style={{ display: "flex", gap: "8px" }}>
                      <Link to={`/Teach/${course.id}/Edit`}>
                        <Button
                          variant="secondary"
                          size="sm"
                        >
                          {"Edit"}
                        </Button>
                      </Link>
                      <Button
                        variant="secondary"
                        onClick={() => handleArchiveToggle(course)}
                        size="sm"
                      >
                        {course.archived ? "Unarchive" : "Archive"}
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => handleDelete(course)}
                        size="sm"
                      >
                        {"Delete"}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      ) : null}
    </>
  );
};

const Admin = () => {
  const [tab, setTab] = useState("users");

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Admin portal"
        subtitle="Manage every account and every course on the platform."
      >
        <Tabs
          tabs={[
            { id: "users", label: "Users" },
            { id: "courses", label: "Courses" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "users" ? <UsersTab /> : <CoursesTab />}
      </Page>
    </div>
  );
};

export default Admin;
