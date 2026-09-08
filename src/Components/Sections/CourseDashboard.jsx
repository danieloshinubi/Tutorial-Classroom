import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../Navbar/Navbar";
import ClassChat from "./ClassChat";
import Upcoming from "./Upcoming";
import MaterialsTab from "./MaterialsTab";
import AssignmentsTab from "./AssignmentsTab";
import ExamsTab from "./ExamsTab";
import PeopleTab from "./PeopleTab";
import { useAuth } from "../../context/AuthContext";
import { fetchCourseByCode, isEnrolled, enroll, unenroll } from "../../lib/api";
import { Page, Button, Badge, Notice, Empty, Tabs } from "../UI";

const CourseDashboard = () => {
  const { code } = useParams();
  const { user, profile } = useAuth();

  const [course, setCourse] = useState(null);
  const [enrolled, setEnrolled] = useState(false);
  const [tab, setTab] = useState("stream");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // A tutor who owns this course, or any admin, can author its content.
  const canManage =
    profile?.role === "admin" ||
    (course && course.owner_id && course.owner_id === user?.id);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchCourseByCode(code);
      if (!data) {
        setError(`No course found with the code ${code}.`);
        setCourse(null);
        return;
      }
      setCourse(data);
      if (user) {
        setEnrolled(await isEnrolled({ userId: user.id, courseId: data.id }));
      }
    } catch (err) {
      setError(err.message || "Could not load this course.");
    } finally {
      setLoading(false);
    }
  }, [code, user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleEnrollToggle = async () => {
    setBusy(true);
    setError("");
    try {
      if (enrolled) {
        await unenroll({ userId: user.id, courseId: course.id });
        setEnrolled(false);
      } else {
        await enroll({ userId: user.id, courseId: course.id });
        setEnrolled(true);
      }
    } catch (err) {
      setError(err.message || "Could not update your enrollment.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page><Empty>{"Loading course..."}</Empty></Page>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Course">
          <Notice tone="error">{error}</Notice>
          <Link to="/Levels">
            <Button variant="secondary">{"Back to levels"}</Button>
          </Link>
        </Page>
      </div>
    );
  }

  const tabs = [
    { id: "stream", label: "Stream" },
    { id: "materials", label: "Materials" },
    { id: "assignments", label: "Assignments" },
    { id: "exams", label: "Exams" },
    { id: "people", label: "People" },
  ];

  return (
    <div className="shell">
      <Navbar />
      <Page>
        <section className="hero">
          <div>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <Badge>{`${course.level_year} level`}</Badge>
              {canManage ? <Badge>{"you manage this"}</Badge> : null}
            </div>
            <h1>{course.code}</h1>
            <p className="hero-sub">{course.title || "No title yet"}</p>
          </div>
          <Button
            variant={enrolled ? "secondary" : "primary"}
            disabled={busy}
            onClick={handleEnrollToggle}
          >
            {enrolled ? "Leave course" : "Join course"}
          </Button>
        </section>

        {course.description ? (
          <p style={{ color: "var(--ink-2)", marginTop: 18 }}>{course.description}</p>
        ) : null}

        <div style={{ marginTop: 22 }}>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>

        <Notice tone="error">{error}</Notice>

        {tab === "stream" ? (
          <div className="split">
            <ClassChat courseId={course.id} />
            <Upcoming courseId={course.id} />
          </div>
        ) : null}

        {tab === "materials" ? (
          <MaterialsTab courseId={course.id} canManage={canManage} />
        ) : null}

        {tab === "assignments" ? (
          <AssignmentsTab courseId={course.id} canManage={canManage} />
        ) : null}

        {tab === "exams" ? (
          <ExamsTab courseId={course.id} canManage={canManage} />
        ) : null}

        {tab === "people" ? (
          <PeopleTab course={course} canManage={canManage} />
        ) : null}
      </Page>
    </div>
  );
};

export default CourseDashboard;
