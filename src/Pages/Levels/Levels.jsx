import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { fetchLevelsForSchool } from "../../lib/api";
import { useSchool } from "../../context/SchoolContext";
import { Page, Grid, Empty, Notice, bandClass } from "../../Components/UI";

const Levels = () => {
  const { schoolId, isAdmin } = useSchool();
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!schoolId) return undefined;
    let active = true;

    fetchLevelsForSchool(schoolId)
      .then((data) => {
        if (active) setLevels(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load levels.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [schoolId]);

  return (
    <div className="shell">
      <Navbar />
      <Page title="Courses" subtitle="Choose a class to see the courses it offers.">
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading levels..."}</Empty> : null}
        {!loading && !error && levels.length === 0 ? (
          <Empty>
            {isAdmin ? (
              <>
                {"No classes yet. "}
                <Link to="/School">{"Set up your classes"}</Link>
                {" before adding courses."}
              </>
            ) : (
              "This school has not set up its classes yet."
            )}
          </Empty>
        ) : null}

        <Grid>
          {levels.map((level) => (
            <Link
              key={level.year}
              to={`/Levels/${level.year}/Courses`}
              className="card-link"
            >
              <article className="tile">
                <div className={bandClass(String(level.year))}>{level.label}</div>
                <div className="tile-body">
                  <span className="tile-title">{level.label}</span>
                  <span className="tile-sub">{"View courses"}</span>
                </div>
              </article>
            </Link>
          ))}
        </Grid>
      </Page>
    </div>
  );
};

export default Levels;
