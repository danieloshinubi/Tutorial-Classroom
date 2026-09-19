import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchOverview,
  fetchTenants,
  fetchPlatformGateways,
  fetchPlatformMailboxHealth,
} from "../lib/platformApi";
import { Page, Card, Empty, Badge, Button, formatDate } from "../Components/UI";
import { StatRow } from "../Components/Charts";
import { useActionFeedback } from "../Components/Toast";
import ExtendTrialModal from "./ExtendTrialModal";

const DAY_MS = 24 * 60 * 60 * 1000;

// What the platform looks like from above: how many schools, how many are
// actually being used, and which ones were added recently. A tenant that was
// created and never touched is the number worth watching, so "quiet" is shown
// rather than left for someone to work out.
const Overview = () => {
  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [extending, setExtending] = useState(null);
  const { setError, setNotice } = useActionFeedback();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchOverview(),
      fetchTenants(),
      fetchPlatformGateways().catch(() => []),
      fetchPlatformMailboxHealth().catch(() => []),
    ])
      .then(([o, t, g, m]) => {
        setStats(o);
        setTenants(t);
        setGateways(g);
        setMailboxes(m);
      })
      .catch((err) => setError(err.message || "Could not load the platform."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const quiet = tenants.filter((t) => (t.students || 0) === 0);
  const newest = [...tenants]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6);

  // Expiring within a week, or already past due — either way, the school
  // finds out by hitting a hard wall (TrialGate.jsx) unless someone here
  // reaches out or extends it first.
  const trialsAtRisk = tenants
    .filter((t) => t.plan === "trial" && t.trial_ends_at)
    .filter((t) => new Date(t.trial_ends_at) - Date.now() < 7 * DAY_MS)
    .sort((a, b) => new Date(a.trial_ends_at) - new Date(b.trial_ends_at));

  const unconfirmedGateways = gateways.filter((g) => g.provider && !g.confirmed_at);
  const brokenMailboxes = mailboxes.filter((m) => m.last_poll_status === "error");

  return (
    <Page title="Platform" subtitle="Every school on Schoolivio">
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

      {!loading && trialsAtRisk.length ? (
        <Card style={{ marginTop: 22, borderColor: "var(--warn-ink)" }}>
          <h3 style={{ marginTop: 0 }}>{"Trials expiring soon"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
            {"Within a week, or already past due — each one hits a hard lockout (TrialGate) with no way back in except emailing support, unless someone extends it first."}
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {trialsAtRisk.map((t) => {
              const expired = new Date(t.trial_ends_at) < new Date();
              return (
                <div key={t.id} className="doc-row">
                  <div>
                    <Link to={`/Tenants/${t.id}`}><strong>{t.name}</strong></Link>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {`${expired ? "Expired" : "Expires"} ${formatDate(t.trial_ends_at, { withTime: false })}`}
                    </div>
                  </div>
                  <div className="doc-actions">
                    <Badge tone={expired ? "danger" : "warn"}>{expired ? "locked out" : "at risk"}</Badge>
                    <Button size="sm" variant="secondary" onClick={() => setExtending(t)}>
                      {"Extend"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {!loading && (unconfirmedGateways.length || brokenMailboxes.length) ? (
        <div className="split" style={{ marginTop: 22 }}>
          {unconfirmedGateways.length ? (
            <Card>
              <h3 style={{ marginTop: 0 }}>{"Gateways never confirmed"}</h3>
              <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
                {"An owner picked a provider but never actually confirmed the credentials — online payments may not be working."}
              </p>
              <div className="btn-row" style={{ flexWrap: "wrap" }}>
                {unconfirmedGateways.map((g) => (
                  <Link key={g.school_id} to={`/Tenants/${g.school_id}`} className="chip-link">
                    <Badge tone="warn">{g.school_name}</Badge>
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}
          {brokenMailboxes.length ? (
            <Card>
              <h3 style={{ marginTop: 0 }}>{"Mailboxes with a failed poll"}</h3>
              <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
                {"The last connection attempt failed — support emails to these addresses may be going unseen."}
              </p>
              <div className="btn-row" style={{ flexWrap: "wrap" }}>
                {brokenMailboxes.map((m) => (
                  <Link key={m.mailbox_id} to={`/Tenants/${m.school_id}`} className="chip-link">
                    <Badge tone="danger">{`${m.school_name} · ${m.address}`}</Badge>
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
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

      {extending ? (
        <ExtendTrialModal
          school={extending}
          onClose={() => setExtending(null)}
          onDone={(_updated, message) => {
            setExtending(null);
            setNotice(message);
            load();
          }}
        />
      ) : null}
    </Page>
  );
};

export default Overview;
