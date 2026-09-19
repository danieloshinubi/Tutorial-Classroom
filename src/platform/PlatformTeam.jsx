import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchPlatformAdmins, addPlatformAdmin, removePlatformAdmin } from "../lib/platformApi";
import { Page, Card, Button, Badge, Empty, Field, Modal, formatDate, SkeletonTable } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import { downloadCsv } from "../lib/csv";

// Who has access to this console. classroom.platform_admins existed since
// day one with no RPC and no UI at all — granting or revoking access, or
// even seeing who currently has it, meant a raw SQL statement. This is the
// whole feature: a list, a way to add someone by email, a way to remove
// them (never yourself — see 136's own guard).
const PlatformTeam = () => {
  const { user } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const { setError, setNotice } = useActionFeedback();

  const [showAdd, setShowAdd] = useState(false);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchPlatformAdmins()
      .then(setAdmins)
      .catch((err) => setError(err.message || "Could not load the team."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    try {
      await addPlatformAdmin(email.trim());
      setNotice(`${email.trim()} can now sign in to this console.`);
      setEmail("");
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err.message || "Could not grant access.");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (admin) => {
    if (!window.confirm(`Revoke ${admin.email}'s access to this console?`)) return;
    setBusyId(admin.user_id);
    try {
      await removePlatformAdmin(admin.user_id);
      setNotice(`${admin.email} no longer has console access.`);
      load();
    } catch (err) {
      setError(err.message || "Could not revoke that.");
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = () => {
    downloadCsv("platform-team", admins, [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: (a) => formatDate(a.added_at, { withTime: false }), label: "Added" },
    ]);
  };

  return (
    <Page
      title="Team"
      subtitle="Everyone with access to this console"
      action={
        <div className="btn-row">
          <Button variant="secondary" disabled={!admins.length} onClick={exportCsv}>{"Export CSV"}</Button>
          <Button onClick={() => setShowAdd(true)}>{"Grant access"}</Button>
        </div>
      }
    >
      {loading ? <SkeletonTable rows={5} cols={4} /> : null}

      {!loading && admins.length === 0 ? <Empty>{"Nobody has console access yet."}</Empty> : null}

      {admins.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Name"}</th>
                  <th>{"Email"}</th>
                  <th>{"Added"}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => {
                  const isSelf = a.user_id === user?.id;
                  return (
                    <tr key={a.user_id}>
                      <td><strong>{a.name || "—"}</strong></td>
                      <td>{a.email}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                        {formatDate(a.added_at, { withTime: false })}
                      </td>
                      <td>
                        {isSelf ? (
                          <Badge tone="brand">{"you"}</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="danger-outline"
                            disabled={busyId === a.user_id}
                            onClick={() => handleRemove(a)}
                          >
                            {"Revoke"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {showAdd ? (
        <Modal
          title="Grant console access"
          subtitle="They need an existing Schoolivio account — this doesn't create one."
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>
                {"Cancel"}
              </Button>
              <Button type="submit" form="grant-access-form" disabled={adding}>
                {adding ? "Granting..." : "Grant access"}
              </Button>
            </>
          }
        >
          <form id="grant-access-form" onSubmit={handleAdd}>
            <Field label="Email">
              <input
                type="email"
                autoFocus
                className="input"
                placeholder="name@schoolivio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
};

export default PlatformTeam;
