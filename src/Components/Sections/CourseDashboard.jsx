import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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
  fetchParticipants,
  requestEnrollment,
  unenroll,
} from "../../lib/api";
import { Page, Button, Badge, Empty, Tabs } from "../UI";
import { useActionFeedback } from "../Toast";

const CourseDashboard = () => {
  const { code } = useParams();
  const { user } = useAuth();
  const { schoolId, isAdmin: isSchoolAdmin, labelFor } = useSchool();

  const [course, setCourse] = useState(null);
  const [membership, setMembership] = useState(null);
  // A link can open a tab directly: the join-request notification opens
  // People (?tab=people, supabase/259).
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get("tab") || "stream");
  // Pupils asking to join, for whoever runs the course: shown on the People
  // tab and in a banner until someone answers them.
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();
  const [busy, setBusy] = useState(false);

  // A tutor who owns this course, or any admin, can author its content.
  const canManage =
    isSchoolAdmin || (course && course.owner_id && course.owner_id === user?.id);

  const load = useCallback(async () => {
    // Waiting for the school: without this the query goes out with
    // school_id=eq.null and Postgres rejects "null" as a uuid.
    if (!schoolId) return;
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
  }, [code, user, schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t) setTab(t);
  }, [searchParams]);

  const loadWaiting = useCallback(() => {
    if (!course?.id || !schoolId || !canManage) return setWaiting(0);
    fetchParticipants({ courseId: course.id, schoolId })
      .then((rows) => setWaiting(rows.filter((r) => r.status === "pending").length))
      .catch(() => setWaiting(0));
  }, [course?.id, schoolId, canManage]);
  useEffect(loadWaiting, [loadWaiting]);

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
      await unenroll({ userId: user.id, courseId: course.id, schoolId });
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
          <Link to="/Courses">
            <Button variant="secondary">{"Back to courses"}</Button>
          </Link>
        </Page>
      </div>
    );
  }

  // The database already refuses to hand a non-member any of this course's
  // content. Saying so is kinder than five empty tabs.
  const hasAccess = canManage || membership?.status === "approved";

  const tabs = [
    { id: "stream", label: "Stream" },
    { id: "materials", label: "Materials" },
    { id: "assignments", label: "Assignments" },
    { id: "exams", label: "Exams" },
    { id: "midexams", label: "Mid-exams" },
    {
      id: "people",
      label: waiting ? (
        <>
          {"People"}
          <span className="tab-count" aria-label={`${waiting} waiting to join`}>{waiting}</span>
        </>
      ) : (
        "People"
      ),
    },
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
          {canManage ? null : membership?.status === "approved" ? (
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

        {canManage && waiting > 0 && tab !== "people" ? (
          <div className="join-waiting">
            <span className="join-waiting-dot" aria-hidden="true" />
            <span className="join-waiting-text">
              {waiting === 1 ? "1 pupil is asking to join this course." : `${waiting} pupils are asking to join this course.`}
            </span>
            <Button size="sm" onClick={() => setTab("people")}>{"Review"}</Button>
          </div>
        ) : null}

        {hasAccess ? (
          <div style={{ marginTop: 22 }}>
            <Tabs tabs={tabs} active={tab} onChange={setTab} />
          </div>
        ) : null}

        {!hasAccess ? (
          <div className="locked">
            <h2>{"You are not in this course yet"}</h2>
            <p>
              {membership?.status === "pending"
                ? "Your request is with the tutor. Once it is approved the stream, materials, assignments and exams appear here."
                : membership?.status === "declined"
                ? "Your last request was declined. You can ask again, or speak to the tutor."
                : "Request to join and the tutor will decide. Until then the course content, including its exams, stays closed."}
            </p>
            {membership?.status === "pending" ? null : (
              <Button disabled={busy} onClick={handleJoin}>
                {membership?.status === "declined" ? "Ask again" : "Request to join"}
              </Button>
            )}
          </div>
        ) : (
          <>
            {tab === "stream" ? (
              <div className="split">
                <ClassChat courseId={course.id} schoolId={schoolId} />
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
              <ExamsTab courseId={course.id} canManage={canManage} kind="exam" schoolId={schoolId} />
            ) : null}

            {tab === "midexams" ? (
              <ExamsTab courseId={course.id} canManage={canManage} kind="midterm" schoolId={schoolId} />
            ) : null}

            {tab === "people" ? (
              <PeopleTab course={course} canManage={canManage} schoolId={schoolId} onChanged={loadWaiting} />
            ) : null}
          </>
        )}

      </Page>
    </div>
  );
};

export default CourseDashboard;
