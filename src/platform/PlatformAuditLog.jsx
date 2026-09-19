import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPlatformAuditLog } from "../lib/platformApi";
import { Page, Card, Badge, Empty, Button, formatDate } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import { downloadCsv } from "../lib/csv";

const ACTION_TONE = { INSERT: "success", UPDATE: "brand", DELETE: "danger" };

// classroom.audit_log has recorded every plan change and suspension since
// 062_audit_log.sql — and, as of 136, every platform-admin grant/revoke —
// but nothing has ever read it back for platform staff themselves. This is
// that read: what THIS console's own actions have done, across every
// school, not a tenant's own internal activity (137's own RPC keeps that
// line — only schools/platform_admins/payment_gateways rows are reachable
// here, the same tables platform staff actually act on).
const PlatformAuditLog = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  const load = useCallback(() => {
    setLoading(true);
    fetchPlatformAuditLog({ limit: 200 })
      .then(setRows)
      .catch((err) => setError(err.message || "Could not load the audit log."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const exportCsv = () => {
    downloadCsv("platform-audit-log", rows, [
      { key: (r) => formatDate(r.created_at, { withTime: true }), label: "When" },
      { key: (r) => r.school_name || "", label: "School" },
      { key: "table_name", label: "Table" },
      { key: "action", label: "Action" },
      { key: (r) => (r.changed_fields || []).join("; "), label: "Changed" },
      { key: "actor_label", label: "By" },
    ]);
  };

  return (
    <Page
      title="Audit log"
      subtitle="What this console's own actions have changed, across every school"
      action={<Button variant="secondary" disabled={!rows.length} onClick={exportCsv}>{"Export CSV"}</Button>}
    >
      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && rows.length === 0 ? <Empty>{"Nothing recorded yet."}</Empty> : null}

      {rows.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"When"}</th>
                  <th>{"School"}</th>
                  <th>{"Table"}</th>
                  <th>{"Action"}</th>
                  <th>{"Changed"}</th>
                  <th>{"By"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                      {formatDate(r.created_at, { withTime: true })}
                    </td>
                    <td>
                      {r.school_id ? (
                        <Link to={`/Tenants/${r.school_id}`}>{r.school_name}</Link>
                      ) : (
                        <span style={{ color: "var(--ink-3)" }}>{"— platform —"}</span>
                      )}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>{r.table_name}</td>
                    <td><Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge></td>
                    <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {(r.changed_fields || []).join(", ") || "—"}
                    </td>
                    <td>{r.actor_label || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </Page>
  );
};

export default PlatformAuditLog;
