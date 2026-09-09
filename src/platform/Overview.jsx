import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchOverview, fetchTenants } from "../lib/platformApi";
import { Page, Card, Notice, Empty, Badge } from "../Components/UI";
import { StatRow } from "../Components/Charts";

// What the platform looks like from above: how many schools, how many are
// actually being used, and which ones were added recently. A tenant that was
// created and never touched is the number worth watching, so "quiet" is shown
// rather than left for someone to work out.
const Overview = () => {
  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchOverview(), fetchTenants()])
      .then(([o, t]) => {
        setStats(o);
        setTenants(t);
      })
      .catch((err) => setError(err.message || "Could not load the platform."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const quiet = tenants.filter((t) => (t.students || 0) === 0);
  const newest = [...tenants]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  return (
    <Page title="Platform" subtitle="Every school on Schoolivio">
      <Notice tone="error">{error}</Notice>
      {loading ? <Empty>{"Loading..."}</Empty> : null}

      {stats ? (
        <StatRow
          stats={[
            {
              label: "Schools",
              value: stats.schools,
              note: `${stats.active_schools} active`,
            },
            {
              label: "People",
              value: stats.people,
              note: `${stats.students} students, ${stats.staff} staff`,
            },
            {
              label: "Courses",
              value: stats.courses,
              note: "across every tenant",
            },
            {
              label: "Added this month",
              value: stats.schools_added_30d,
              note: "new schools",
            },
          ]}
        />
      ) : null}

      {!loading && quiet.length ? (
        <Card style={{ marginTop: 22 }}>
          <h3>{"Quiet tenants"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
            {"Created but no students yet — either mid-setup, or stalled and worth a call."}
          </p>
          <div className="btn-row" style={{ flexWrap: "wrap" }}>
            {quiet.map((t) => (
              <Link key={t.id} to={`/Tenants/${t.id}`} className="chip-link">
                <Badge>{t.name}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {newest.length ? (
        <section className="section">
          <h2>{"Recently added"}</h2>
          <Card className="pad-0" style={{ padding: "4px 14px" }}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{"School"}</th>
                    <th>{"Address"}</th>
                    <th>{"Plan"}</th>
                    <th>{"Students"}</th>
                    <th>{"Staff"}</th>
                    <th>{"Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {newest.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link to={`/Tenants/${t.id}`}>
                          <strong>{t.name}</strong>
                        </Link>
                      </td>
                      <td style={{ color: "var(--ink-3)" }}>
                        {`${t.slug}.schoolivio.com`}
                      </td>
                      <td>{t.plan || "trial"}</td>
                      <td>{t.students}</td>
                      <td>{t.teachers}</td>
                      <td>
                        <Badge tone={t.is_active ? "success" : "danger"}>
                          {t.is_active ? "active" : "suspended"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      ) : null}
    </Page>
  );
};

export default Overview;
