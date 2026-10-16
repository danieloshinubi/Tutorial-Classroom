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
import { fetchCourseByCode, fetchMyEnrollment, fetchParticipants, requestEnrollment, unenroll } from "../../lib/api";
import { courseStaff } from "../../lib/courseTeamApi";
import { Page, Button, Badge, Tabs } from "../UI";
import { useActionFeedback } from "../Toast";
import { useUrlState } from "../../lib/useUrlState";
import Loading from "../Loading";

// One course: its stream, materials, assignments, exams and people
// (TypeScript, 2026-10-14). Who runs it is the database's answer
// (course_staff → can_manage_course, supabase/260): its lead, its
// co-teachers, the subject teacher of a class's subject, admins and the
// principal, so a teacher added to a course (or taking one over) runs it
// fully, not as a pupil. A link can open a tab directly (?tab=people, from
// a join-request notification), and whoever runs the course sees how many
// pupils are waiting to join.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Course = { id: string; code: string; title: string | null; description: string | null; level_year: number; owner_id: string | null; school_id: string };
const TAB_IDS = ["stream", "materials", "assignments", "exams", "midexams", "people"];

const CourseDashboard = () => {
  const { code } = useParams();
  const { user } = useAuth() as { user: { id: string } | null };
  const { schoolId, labelFor } = useSchool();
  const { setError } = useActionFeedback();
  const [course, setCourse] = useState<Course | null>(null);
  const [membership, setMembership] = useState<{ status: string } | null>(null);
  const [canManage, setCanManage] = useState(false);
  // The open tab lives in the address, so a reload stays on it.
  const [tab, setTab] = useUrlState("tab", "stream", TAB_IDS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const data = (await fetchCourseByCode({ schoolId, code })) as Course | null;
      if (!data) {
        setError(`No course found with the code ${code}.`);
        setCourse(null);
        return;
      }
      setCourse(data);
      const [mine, staff] = await Promise.all([
        user ? fetchMyEnrollment({ userId: user.id, courseId: data.id }) : Promise.resolve(null),
        courseStaff(data.id).catch(() => ({ can_manage: false, teachers: [] })),
      ]);
      setMembership(mine as { status: string } | null);
      setCanManage(!!staff.can_manage);
    } catch (err) {
      setError((err as Error).message || "Could not load this course.");
    } finally {
      setLoading(false);
    }
  }, [code, user, schoolId, setError]);
  useEffect(() => {
    load();
  }, [load]);

  const loadWaiting = useCallback(() => {
    if (!course?.id || !schoolId || !canManage) return setWaiting(0);
    fetchParticipants({ courseId: course.id, schoolId })
      .then((rows: any[]) => setWaiting(rows.filter((r) => r.status === "pending").length))
      .catch(() => setWaiting(0));
  }, [course?.id, schoolId, canManage]);
  useEffect(loadWaiting, [loadWaiting]);

  // After the People tab changes who teaches it, the rights may change too.
  const peopleChanged = () => {
    loadWaiting();
    if (course) courseStaff(course.id).then((s) => setCanManage(!!s.can_manage)).catch(() => undefined);
  };

  const handleJoin = async () => {
    if (!course) return;
    setBusy(true);
    try {
      setMembership((await requestEnrollment({ courseId: course.id, note: undefined })) as { status: string });
    } catch (err) {
      setError((err as Error).message || "Could not send your request.");
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!course || !user) return;
    setBusy(true);
    try {
      await unenroll({ userId: user.id, courseId: course.id, schoolId });
      setMembership(null);
    } catch (err) {
      setError((err as Error).message || "Could not leave the course.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page>
          <Loading label="Loading course" />
        </Page>
      </div>
    );
  }

  if (!course || !schoolId) {
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

  // The database already refuses a non-member this course's content.
  // Saying so is kinder than five empty tabs.
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
          <span
            className="tw-ml-1.5 tw-inline-flex tw-h-[18px] tw-min-w-[18px] tw-items-center tw-justify-center tw-rounded-full tw-bg-danger tw-px-[5px] tw-text-[11px] tw-font-bold tw-leading-none tw-text-white"
            aria-label={`${waiting} waiting to join`}
          >
            {waiting}
          </span>
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
              {canManage ? <Badge>{"you teach this"}</Badge> : null}
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

        {course.description ? <p style={{ color: "var(--ink-2)", marginTop: 18 }}>{course.description}</p> : null}

        {canManage && waiting > 0 && tab !== "people" ? (
          <div className="tw-mt-4 tw-flex tw-flex-wrap tw-items-center tw-gap-2.5 tw-rounded-2xl tw-bg-warn-soft tw-px-4 tw-py-2.5 tw-text-warn-ink [font-family:inherit]">
            <span className="tw-h-2 tw-w-2 tw-shrink-0 tw-rounded-full tw-bg-warn-ink" aria-hidden="true" />
            <span className="tw-min-w-[180px] tw-flex-1 tw-text-[14px] tw-font-semibold">
              {waiting === 1 ? "1 pupil is asking to join this course." : `${waiting} pupils are asking to join this course.`}
            </span>
            <Button size="sm" onClick={() => setTab("people")}>
              {"Review"}
            </Button>
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
                ? "Your request is with the teacher. Once it is approved the stream, materials, assignments and exams appear here."
                : membership?.status === "declined"
                ? "Your last request was declined. You can ask again, or speak to the teacher."
                : "Request to join and the teacher will decide. Until then the course content, including its exams, stays closed."}
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
            {tab === "materials" ? <MaterialsTab courseId={course.id} canManage={canManage} /> : null}
            {tab === "assignments" ? <AssignmentsTab courseId={course.id} canManage={canManage} /> : null}
            {tab === "exams" ? <ExamsTab courseId={course.id} canManage={canManage} kind="exam" schoolId={schoolId} /> : null}
            {tab === "midexams" ? <ExamsTab courseId={course.id} canManage={canManage} kind="midterm" schoolId={schoolId} /> : null}
            {tab === "people" ? <PeopleTab course={course} canManage={canManage} schoolId={schoolId} onChanged={peopleChanged} /> : null}
          </>
        )}
      </Page>
    </div>
  );
};

export default CourseDashboard;
