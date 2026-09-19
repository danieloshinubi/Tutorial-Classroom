import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPlatformGateways } from "../lib/platformApi";
import { Page, Card, Badge, Empty, Select, Modal, Button, formatDate } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import { downloadCsv } from "../lib/csv";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "confirmed", label: "Confirmed" },
  { value: "unconfirmed", label: "Not confirmed" },
  { value: "none", label: "No gateway picked" },
];

const statusOf = (g) => {
  if (!g.provider) return "none";
  return g.confirmed_at ? "confirmed" : "unconfirmed";
};

const STATUS_TONE = { confirmed: "success", unconfirmed: "warn", none: "muted" };
const STATUS_LABEL = { confirmed: "confirmed", unconfirmed: "not confirmed", none: "none picked" };

// A cross-school view of what Overview's "Gateways never confirmed" card only
// ever showed a slice of — every school's payment gateway, not just the ones
// currently at risk, so a support call about ANY school's gateway status can
// be answered here rather than by opening that school first.
const PlatformGateways = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState(null);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    setLoading(true);
    fetchPlatformGateways()
      .then(setRows)
      .catch((err) => setError(err.message || "Could not load gateways."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((g) => {
      if (status && statusOf(g) !== status) return false;
      if (needle && !(g.school_name || "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, status, query]);

  const exportCsv = () => {
    downloadCsv("gateways", filtered, [
      { key: "school_name", label: "School" },
      { key: (g) => g.provider || "", label: "Provider" },
      { key: (g) => g.mode || "", label: "Mode" },
      { key: (g) => STATUS_LABEL[statusOf(g)], label: "Status" },
      { key: (g) => (g.confirmed_at ? formatDate(g.confirmed_at) : ""), label: "Confirmed" },
    ]);
  };

  return (
    <Page
      title="Gateways"
      subtitle="Every school's payment gateway, and whether it was ever actually confirmed"
      action={<Button variant="secondary" disabled={!filtered.length} onClick={exportCsv}>{"Export CSV"}</Button>}
      toolbar={
        <div className="filters">
          <Select
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            style={{ minWidth: 180 }}
          />
          <input
            className="input"
            placeholder="Search by school"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
    >
      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && filtered.length === 0 ? <Empty>{"No gateway matches."}</Empty> : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"School"}</th>
                  <th>{"Provider"}</th>
                  <th>{"Mode"}</th>
                  <th>{"Status"}</th>
                  <th>{"Confirmed"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <tr key={g.school_id}>
                    <td>
                      <Link to={`/Tenants/${g.school_id}`}><strong>{g.school_name}</strong></Link>
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{g.provider || "—"}</td>
                    <td>{g.mode || "—"}</td>
                    <td>
                      <Badge tone={STATUS_TONE[statusOf(g)]}>{STATUS_LABEL[statusOf(g)]}</Badge>
                    </td>
                    <td style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                      {g.confirmed_at ? formatDate(g.confirmed_at) : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="link-action" onClick={() => setViewing(g)}>
                        {"View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {viewing ? (
        <Modal
          title={viewing.school_name}
          subtitle="Payment gateway"
          onClose={() => setViewing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setViewing(null)}>{"Close"}</Button>
              <Link to={`/Tenants/${viewing.school_id}`}>
                <Button>{"Open school"}</Button>
              </Link>
            </>
          }
        >
          <dl className="facts">
            <div><dt>{"Provider"}</dt><dd style={{ textTransform: "capitalize" }}>{viewing.provider || "None picked yet"}</dd></div>
            <div><dt>{"Mode"}</dt><dd>{viewing.mode || "—"}</dd></div>
            <div><dt>{"Active"}</dt><dd>{viewing.is_active ? "Yes" : "No"}</dd></div>
            <div><dt>{"Confirmed"}</dt><dd>{viewing.confirmed_at ? formatDate(viewing.confirmed_at) : "Never — credentials were saved but never verified"}</dd></div>
            <div><dt>{"Requires confirmation"}</dt><dd>{viewing.require_confirmation ? "Yes" : "No"}</dd></div>
          </dl>
          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            {"Credentials themselves live in the vault and are never readable from here — fixing a broken gateway happens on the school's own Payment settings page."}
          </p>
        </Modal>
      ) : null}
    </Page>
  );
};

export default PlatformGateways;
