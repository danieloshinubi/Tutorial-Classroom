import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPlatformMailboxHealth } from "../lib/platformApi";
import { Page, Card, Badge, Empty, Select, Modal, Button, formatDate } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import { downloadCsv } from "../lib/csv";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ok", label: "Healthy" },
  { value: "error", label: "Failed poll" },
  { value: "unknown", label: "Never polled" },
];

const statusOf = (m) => m.last_poll_status || "unknown";
const STATUS_TONE = { ok: "success", error: "danger", unknown: "muted" };
const STATUS_LABEL = { ok: "healthy", error: "failed poll", unknown: "never polled" };

// Cross-school view of every school's support mailbox — Overview's own card
// only ever surfaces the broken ones; this is where "is THIS school's
// mailbox actually working" gets answered directly, healthy or not.
const PlatformMailboxes = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState(null);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    setLoading(true);
    fetchPlatformMailboxHealth()
      .then(setRows)
      .catch((err) => setError(err.message || "Could not load mailboxes."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((m) => {
      if (status && statusOf(m) !== status) return false;
      if (needle && !(m.school_name || "").toLowerCase().includes(needle) && !(m.address || "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, status, query]);

  const exportCsv = () => {
    downloadCsv("mailboxes", filtered, [
      { key: "school_name", label: "School" },
      { key: "address", label: "Address" },
      { key: (m) => (m.last_poll_at ? formatDate(m.last_poll_at) : "never"), label: "Last poll" },
      { key: (m) => STATUS_LABEL[statusOf(m)], label: "Status" },
    ]);
  };

  return (
    <Page
      title="Mailboxes"
      subtitle="Every school's support mailbox, and whether its last connection succeeded"
      action={<Button variant="secondary" disabled={!filtered.length} onClick={exportCsv}>{"Export CSV"}</Button>}
      toolbar={
        <div className="filters">
          <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} style={{ minWidth: 180 }} />
          <input
            className="input"
            placeholder="Search by school or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
    >
      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && filtered.length === 0 ? <Empty>{"No mailbox matches."}</Empty> : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"School"}</th>
                  <th>{"Address"}</th>
                  <th>{"Last poll"}</th>
                  <th>{"Status"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.mailbox_id}>
                    <td><Link to={`/Tenants/${m.school_id}`}><strong>{m.school_name}</strong></Link></td>
                    <td style={{ color: "var(--ink-3)" }}>{m.address}</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                      {m.last_poll_at ? formatDate(m.last_poll_at) : "never"}
                    </td>
                    <td><Badge tone={STATUS_TONE[statusOf(m)]}>{STATUS_LABEL[statusOf(m)]}</Badge></td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="link-action" onClick={() => setViewing(m)}>{"View"}</button>
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
          subtitle="Support mailbox"
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
            <div><dt>{"Address"}</dt><dd>{viewing.address}</dd></div>
            <div><dt>{"Last poll"}</dt><dd>{viewing.last_poll_at ? formatDate(viewing.last_poll_at) : "Never attempted"}</dd></div>
            <div><dt>{"Status"}</dt><dd>{STATUS_LABEL[statusOf(viewing)]}</dd></div>
            {viewing.last_poll_error ? <div><dt>{"Last error"}</dt><dd>{viewing.last_poll_error}</dd></div> : null}
          </dl>
          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            {"Mailbox credentials live on the school's own Support settings page — a failed poll usually means a changed password or a revoked app-access token there."}
          </p>
        </Modal>
      ) : null}
    </Page>
  );
};

export default PlatformMailboxes;
