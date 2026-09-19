import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTenants } from "../lib/platformApi";
import { Page, Card, Badge, Empty, Select, Button, formatDate } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import ExtendTrialModal from "./ExtendTrialModal";

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_OPTIONS = [
  { value: "", label: "All trials" },
  { value: "at_risk", label: "At risk (within 7 days)" },
  { value: "expired", label: "Expired" },
  { value: "healthy", label: "Healthy" },
];

const statusOf = (t) => {
  if (!t.trial_ends_at) return "healthy";
  const msLeft = new Date(t.trial_ends_at) - Date.now();
  if (msLeft < 0) return "expired";
  if (msLeft < 7 * DAY_MS) return "at_risk";
  return "healthy";
};

const STATUS_TONE = { at_risk: "warn", expired: "danger", healthy: "success" };
const STATUS_LABEL = { at_risk: "at risk", expired: "expired", healthy: "healthy" };

// Every school still on a trial, in one place — Overview's "Trials expiring
// soon" card only ever shows the ones about to lock out; this is the full
// list, including trials with plenty of runway left.
const PlatformTrials = () => {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [extending, setExtending] = useState(null);
  const { setError, setNotice } = useActionFeedback();

  const load = useCallback(() => {
    setLoading(true);
    fetchTenants()
      .then(setTenants)
      .catch((err) => setError(err.message || "Could not load schools."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const trials = useMemo(() => tenants.filter((t) => t.plan === "trial"), [tenants]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return trials
      .filter((t) => (status ? statusOf(t) === status : true))
      .filter((t) => (needle ? (t.name || "").toLowerCase().includes(needle) : true))
      .sort((a, b) => new Date(a.trial_ends_at || 0) - new Date(b.trial_ends_at || 0));
  }, [trials, status, query]);

  return (
    <Page
      title="Trials"
      subtitle={`${trials.length} school${trials.length === 1 ? "" : "s"} currently on a trial plan`}
      toolbar={
        <div className="filters">
          <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} style={{ minWidth: 220 }} />
          <input
            className="input"
            placeholder="Search schools"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
    >
      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && filtered.length === 0 ? <Empty>{"No trial matches."}</Empty> : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"School"}</th>
                  <th>{"Students"}</th>
                  <th>{"Trial ends"}</th>
                  <th>{"Status"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td><Link to={`/Tenants/${t.id}`}><strong>{t.name}</strong></Link></td>
                    <td>{t.students}</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                      {t.trial_ends_at ? formatDate(t.trial_ends_at, { withTime: false }) : "not set"}
                    </td>
                    <td><Badge tone={STATUS_TONE[statusOf(t)]}>{STATUS_LABEL[statusOf(t)]}</Badge></td>
                    <td style={{ textAlign: "right" }}>
                      <Button size="sm" variant="secondary" onClick={() => setExtending(t)}>{"Extend"}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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

export default PlatformTrials;
