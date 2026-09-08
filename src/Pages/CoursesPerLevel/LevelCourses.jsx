import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { fetchCoursesForLevel } from "../../lib/api";
import { Page, Grid, Empty, Notice, Button, bandClass } from "../../Components/UI";

// One data-driven page for every year. The four hand-written pages this
// replaces each listed their courses twice — once as data, once as a switch
// that only covered the first few — so most courses never rendered.
const LevelCourses = () => {
  const { year } = useParams();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    fetchCoursesForLevel(Number(year))
      .then((data) => {
        if (active) setCourses(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load courses.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [year]);

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={`${year} level courses`}
        subtitle={loading ? "" : `${courses.length} courses`}
        action={
          <Link to="/Levels">
            <Button variant="secondary">{"All levels"}</Button>
          </Link>
        }
      >
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading courses..."}</Empty> : null}
        {!loading && !error && courses.length === 0 ? (
          <Empty>{"No courses listed for this level."}</Empty>
        ) : null}

        <Grid>
          {courses.map((course) => (
            <Link
              key={course.id}
              to={`/Levels/${year}/Courses/${course.code}`}
              className="card-link"
            >
              <article className="tile">
                <div className={bandClass(course.code)}>{course.code}</div>
                <div className="tile-body">
                  <span className="tile-title">{course.title || course.code}</span>
                  <span className="tile-sub">{`${year} level`}</span>
                </div>
              </article>
            </Link>
          ))}
        </Grid>
      </Page>
    </div>
  );
};

export default LevelCourses;
