import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { fetchLevels } from "../../lib/api";
import { Page, Grid, Empty, Notice, bandClass } from "../../Components/UI";

const Levels = () => {
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetchLevels()
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
  }, []);

  return (
    <div className="shell">
      <Navbar />
      <Page title="Courses" subtitle="Choose a level to see the courses it offers.">
        <Notice tone="error">{error}</Notice>
        {loading ? <Empty>{"Loading levels..."}</Empty> : null}
        {!loading && !error && levels.length === 0 ? (
          <Empty>{"No levels yet — run supabase/schema.sql to seed the catalogue."}</Empty>
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
                  <span className="tile-title">{`${level.year} level`}</span>
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
