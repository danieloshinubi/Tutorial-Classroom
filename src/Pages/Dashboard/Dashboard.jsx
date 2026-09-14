import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { fetchMyCourses, fetchCoursesOwnedBy } from "../../lib/api";
import ParentDashboard from "./ParentDashboard";
import {
  Page,
  Card,
  Grid,
  Badge,
  Empty,
  Notice,
  Button,
  displayName,
} from "../../Components/UI";

const CourseCard = ({ course, labelFor }) => (
  <Link
    to={`/Courses/${course.code}`}
    style={{ textDecoration: "none", color: "inherit" }}
  >
    <Card style={{ height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
        <strong style={{ fontSize: "18px" }}>{course.code}</strong>
        <Badge>{labelFor(course.level_year)}</Badge>
      </div>
      <p style={{ margin: "8px 0 0", color: "#555" }}>
        {course.title || "No title yet"}
      </p>
    </Card>
  </Link>
);

const Dashboard = () => {
  const { profile, user } = useAuth();
  const { schoolId, labelFor, isStaff, isParent } = useSchool();
  const [enrolled, setEnrolled] = useState([]);
  const [teaching, setTeaching] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");


  useEffect(() => {
    if (!user || !schoolId) return undefined;
    let active = true;
    setLoading(true);

    const work = [fetchMyCourses({ schoolId, userId: user.id })];
    if (isStaff) work.push(fetchCoursesOwnedBy({ schoolId, userId: user.id }));

    Promise.all(work)
      .then(([mine, owned]) => {
        if (!active) return;
        setEnrolled(mine);
        setTeaching(owned || []);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load your courses.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user, schoolId, isStaff]);

  // A parent is not a student. Offering them courses to join, and telling
  // them they have not joined any, describes a relationship they do not have
  // with the school — their business here is their children, the fees and
  // what the school has announced.
  if (isParent) {
    return (
      <div className="shell">
        <Navbar />
        <ParentDashboard />
      </div>
    );
  }

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={`Welcome back, ${profile ? displayName(profile) : ""}`}
        action={
          isStaff ? (
            <Link to="/Teach/New">
              <Button>{"Create a course"}</Button>
            </Link>
          ) : (
            <Link to="/Courses">
              <Button>{"Browse courses"}</Button>
            </Link>
          )
        }
      >
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading your courses..."}</Empty> : null}

        {isStaff ? (
          <section>
            <h2 style={{ fontSize: "19px", marginTop: "24px" }}>{"Courses you teach"}</h2>
            {!loading && teaching.length === 0 ? (
              <Empty>
                {"You are not teaching anything yet — create your first course."}
              </Empty>
            ) : null}
            <Grid>
              {teaching.map((course) => (
                <CourseCard key={course.id} course={course} labelFor={labelFor} />
              ))}
            </Grid>
          </section>
        ) : null}

        <section>
          <h2 style={{ fontSize: "19px", marginTop: "28px" }}>{"Your courses"}</h2>
          {!loading && enrolled.length === 0 ? (
            <Empty>
              {"You have not joined any courses yet. Pick a level to get started."}
            </Empty>
          ) : null}
          <Grid>
            {enrolled.map((course) => (
              <CourseCard key={course.id} course={course} labelFor={labelFor} />
            ))}
          </Grid>
        </section>
      </Page>
    </div>
  );
};

export default Dashboard;
