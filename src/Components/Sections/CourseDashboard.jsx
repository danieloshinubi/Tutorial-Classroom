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
import { useSchool } from "../../context/SchoolContext";
import {
  fetchCourseByCode,
  fetchMyEnrollment,
  requestEnrollment,
  unenroll,
} from "../../lib/api";
import { Page, Button, Badge, Notice, Empty, Tabs } from "../UI";

const CourseDashboard = () => {
  const { code } = useParams();
  const { user, profile } = useAuth();
  const { schoolId, isAdmin: isSchoolAdmin, labelFor } = useSchool();

  const [course, setCourse] = useState(null);
  const [membership, setMembership] = useState(null);
  const [tab, setTab] = useState("stream");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // A tutor who owns this course, or any admin, can author its content.
  const canManage =
    isSchoolAdmin ||
    profile?.role === "admin" ||
    (course && course.owner_id && course.owner_id === user?.id);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchCourseByCode({ schoolId, code });
      if (!data) {
        setError(`No course found with the code ${code}.`);
        setCourse(null);
        return;
      }
      setCourse(data);
      if (user) {
        setMembership(await fetchMyEnrollment({ userId: user.id, courseId: data.id }));
      }
    } catch (err) {
      setError(err.message || "Could not load this course.");
    } finally {
      setLoading(false);
    }
  }, [code, user, schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleJoin = async () => {
    setBusy(true);
    setError("");
    try {
      const row = await requestEnrollment({ courseId: course.id });
      setMembership(row);
    } catch (err) {
      setError(err.message || "Could not send your request.");
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    setBusy(true);
    setError("");
    try {
      await unenroll({ userId: user.id, courseId: course.id });
      setMembership(null);
    } catch (err) {
      setError(err.message || "Could not leave the course.");
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
            <Button variant="secondary">{"Back to courses"}</Button>
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
              <Badge>{labelFor(course.level_year)}</Badge>
              {canManage ? <Badge>{"you manage this"}</Badge> : null}
            </div>
            <h1>{course.code}</h1>
            <p className="hero-sub">{course.title || "No title yet"}</p>
          </div>
          {membership?.status === "approved" ? (
            <Button variant="secondary" disabled={busy} onClick={handleLeave}>
              {"Leave course"}
            </Button>
          ) : membership?.status === "pending" ? (
            <Button variant="secondary" disabled>
              {"Request pending"}
            </Button>
          ) : (
            <Button disabled={busy} onClick={handleJoin}>
              {membership?.status === "declined" ? "Ask again" : "Request to join"}
            </Button>
          )}
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
