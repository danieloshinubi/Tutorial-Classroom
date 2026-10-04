import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchPlatformAdmins, removePlatformAdmin } from "../lib/platformApi";
import { createPlatformAdmin, type CreatedAdmin } from "./platformTeamApi";
import { Page, Card, Button, Badge, Empty, Field, Modal, Select, formatDate, SkeletonTable } from "../Components/UI";
import { ACCESS_LABEL, setPlatformAccessType, type AccessMode } from "../lib/schoolAccessApi";
import { useActionFeedback } from "../Components/Toast";
import { ExportMenu } from "../Components/ExportButton";
import { confirmDialog } from "../Components/Confirm";

// Who has access to this console, and adding someone to it the way a school
// adds a member of staff: name and email, an account made there and then, a
// temporary password shown once and replaced at their first sign-in
// (platform-create-admin, supabase/223). Someone who already has a
// Schoolivio account just gets access and keeps their own password.
// Revoking is never possible for yourself (136).
//
// Each account also has a way into schools (supabase/224): it asks each
// school, which approves it for a set time, or it is break-glass and may
// enter any school at any time, with the school told every time.

interface Admin {
  user_id: string;
  name: string | null;
  email: string;
  added_at: string;
  access_type: AccessMode;
}

const blankForm = { firstName: "", surname: "", email: "", accessType: "approval" as AccessMode };
const ACCESS_OPTIONS = (Object.keys(ACCESS_LABEL) as AccessMode[]).map((v) => ({ value: v, label: ACCESS_LABEL[v] }));

const PlatformTeam = () => {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { setError, setNotice } = useActionFeedback();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState("");
  // Shown once, right after creating: the only time the password exists
  // anywhere anyone can read it.
  const [issued, setIssued] = useState<CreatedAdmin | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchPlatformAdmins()
      .then((rows: Admin[]) => setAdmins(rows))
      .catch((err: Error) => setError(err.message || "Could not load the team."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!form.firstName.trim() || !form.surname.trim()) return setFormError("Enter their first name and surname.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setFormError("Enter a valid email address.");
    setAdding(true);
    try {
      const result = await createPlatformAdmin({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        accessType: form.accessType,
      });
      setShowAdd(false);
      setForm(blankForm);
      if (result.password) {
        setIssued(result);
        setCopied(false);
      } else {
        setNotice(`${result.email} already had a Schoolivio account. They now have console access (${ACCESS_LABEL[result.accessType].toLowerCase()}) and sign in with their own password.`);
      }
      load();
    } catch (err) {
      setFormError((err as Error).message || "Could not add that person.");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (admin: Admin) => {
    if (!(await confirmDialog(`Revoke ${admin.email}'s access to this console?`))) return;
    setBusyId(admin.user_id);
    try {
      await removePlatformAdmin(admin.user_id);
      setNotice(`${admin.email} no longer has console access.`);
      load();
    } catch (err) {
      setError((err as Error).message || "Could not revoke that.");
    } finally {
      setBusyId(null);
    }
  };

  const changeType = async (admin: Admin, type: AccessMode) => {
    if (type === admin.access_type) return;
    if (type === "breakglass") {
      const ok = await confirmDialog({
        title: `Give ${admin.name || admin.email} break-glass access?`,
        body: "They will be able to enter any school at any time without asking. Each school is told whenever they do.",
        confirmLabel: "Give break-glass",
      });
      if (!ok) return;
    }
    setBusyId(admin.user_id);
    try {
      await setPlatformAccessType(admin.user_id, type);
      setNotice(`${admin.name || admin.email}: ${ACCESS_LABEL[type].toLowerCase()}.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const copyDetails = async () => {
    if (!issued?.password) return;
    try {
      await navigator.clipboard.writeText(`${issued.email}  ${issued.password}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // Spooled as Excel, CSV or PDF, whichever is picked (ExportMenu).
  const exportColumns = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: (a: Admin) => ACCESS_LABEL[a.access_type] || a.access_type, label: "School access" },
    { key: (a: Admin) => formatDate(a.added_at, { withTime: false }), label: "Added" },
  ];

  return (
    <Page
      title="Team"
      subtitle="Everyone with access to this console"
      action={
        <div className="btn-row">
          <ExportMenu filename="platform-team" rows={admins} columns={exportColumns} />
          <Button
            onClick={() => {
              setFormError("");
              setShowAdd(true);
            }}
          >
            {"Add someone"}
          </Button>
        </div>
      }
    >
      {issued ? (
        <Card className="team-issued">
          <h3>{`${issued.name} can now sign in to the console`}</h3>
          <p>{"Give them these details. They will be asked to choose their own password the first time they sign in."}</p>
          <div className="team-issued-grid">
            <div className="file-chip">
              <span style={{ flex: 1 }}>
                <span className="file-meta">{"Email"}</span>
                <div className="team-mono">{issued.email}</div>
              </span>
            </div>
            <div className="file-chip">
              <span style={{ flex: 1 }}>
                <span className="file-meta">{"Temporary password"}</span>
                <div className="team-mono team-password">{issued.password}</div>
              </span>
              <Button size="sm" variant="secondary" onClick={copyDetails}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <p className="team-issued-note">
            {"This password is shown once and is not stored anywhere you can read it again. If it is lost, revoke their access and add them again."}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setIssued(null)}>
            {"Done"}
          </Button>
        </Card>
      ) : null}

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
                  <th>{"School access"}</th>
                  <th>{"Added"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => {
                  const isSelf = a.user_id === user?.id;
                  return (
                    <tr key={a.user_id}>
                      <td>
                        <strong>{a.name || "—"}</strong>
                      </td>
                      <td>{a.email}</td>
                      <td>
                        {isSelf ? (
                          <span className="team-access-self">{ACCESS_LABEL[a.access_type]}</span>
                        ) : (
                          <Select
                            value={a.access_type}
                            disabled={busyId === a.user_id}
                            onChange={(v) => changeType(a, v as AccessMode)}
                            options={ACCESS_OPTIONS}
                          />
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>{formatDate(a.added_at, { withTime: false })}</td>
                      <td>
                        {isSelf ? (
                          <Badge tone="brand">{"you"}</Badge>
                        ) : (
                          <Button size="sm" variant="danger-outline" disabled={busyId === a.user_id} onClick={() => handleRemove(a)}>
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
          title="Add someone to the console"
          subtitle="Their account is made now with a temporary password, which they replace the first time they sign in. If they already have a Schoolivio account, they keep it and just get access."
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>
                {"Cancel"}
              </Button>
              <Button type="submit" form="add-admin-form" disabled={adding}>
                {adding ? "Adding..." : "Add"}
              </Button>
            </>
          }
        >
          <form id="add-admin-form" onSubmit={handleAdd}>
            {formError ? <p className="team-form-error" role="alert">{formError}</p> : null}
            <div className="team-name-row">
              <Field label="First name">
                <input
                  autoFocus
                  className="input"
                  maxLength={80}
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </Field>
              <Field label="Surname">
                <input className="input" maxLength={80} value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />
              </Field>
            </div>
            <Field
              label="Access to schools"
              hint={
                form.accessType === "breakglass"
                  ? "For emergencies: they can enter any school at any time without asking. The school is told every time."
                  : "Each school must approve them, for as long as it chooses, before they can enter. Access then ends by itself."
              }
            >
              <Select value={form.accessType} onChange={(v) => setForm({ ...form, accessType: v as AccessMode })} options={ACCESS_OPTIONS} />
            </Field>
            <Field label="Email" hint="The address they will sign in with.">
              <input
                type="email"
                className="input"
                placeholder="name@schoolivio.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </form>
        </Modal>
      ) : null}
    </Page>
  );
};

export default PlatformTeam;
