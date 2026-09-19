import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { fetchTickets, createTicket, fetchTicketGroups } from "../../lib/api";
import { Page, Card, Field, Button, Badge, Empty, SkeletonList, Select, formatDate } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

const STATUS_TONE = { open: "brand", pending: "warn", resolved: "success", closed: undefined };
const STATUS_LABEL = { open: "Open", pending: "Pending", resolved: "Resolved", closed: "Closed" };

// Anyone at the school can raise something here — a broken tap, a question
// about a bill, anything that needs a person to look at it. Staff manage the
// full queue at /Tickets; this is the same thread from the other side, with
// none of the staff-only levers (status, priority, assignee) exposed.
const NewTicketForm = ({ groups, onCreate, onCancel }) => {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  const [saving, setSaving] = useState(false);
  const { setError } = useActionFeedback();

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) {
      setError("Tell us what this is about.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onCreate({ subject: subject.trim(), description: description.trim(), groupId: groupId || null });
    } catch (err) {
      setError(err.message || "Could not send that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <form onSubmit={submit}>
        <Field label="What's this about?">
          <input
            className="input"
            autoFocus
            value={subject}
            placeholder="Broken projector in Room 3"
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label="Details" hint="The more you tell us, the faster we can help.">
          <textarea
            className="input textarea"
            value={description}
            placeholder="Describe what's happening..."
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {groups.length ? (
          <Field label="Who's this for?" hint="Picking the right department gets you to the right person faster.">
            <Select
              value={groupId}
              onChange={setGroupId}
              options={[
                { value: "", label: "Not sure — let the school route it" },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
          </Field>
        ) : null}
        <div className="btn-row">
          <Button type="submit" disabled={saving}>
            {saving ? "Sending..." : "Send"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {"Cancel"}
          </Button>
        </div>
      </form>
    </Card>
  );
};

const MyTickets = () => {
  const { schoolId, school } = useSchool();
  const [tickets, setTickets] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    // Row level security scopes this to the caller's own tickets — a
    // student or parent never sees anyone else's, no matter the filter.
    fetchTickets({ schoolId, status: "all" })
      .then(setTickets)
      .catch((err) => setError(err.message || "Could not load your requests."))
      .finally(() => setLoading(false));
  }, [schoolId, setError]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!schoolId) return;
    fetchTicketGroups(schoolId).then(setGroups).catch(() => {});
  }, [schoolId]);

  const handleCreate = async (payload) => {
    await createTicket({ schoolId, ...payload });
    setShowNew(false);
    load();
  };

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Help Desk"
        subtitle={school ? `Raise a request with ${school.name}` : "Raise a request"}
        action={
          <Button onClick={() => setShowNew((v) => !v)}>
            {showNew ? "Cancel" : "Raise a ticket"}
          </Button>
        }
      >
        {showNew ? <NewTicketForm groups={groups} onCreate={handleCreate} onCancel={() => setShowNew(false)} /> : null}

        {loading ? <SkeletonList rows={4} avatar={false} /> : null}
        {!loading && tickets.length === 0 ? (
          <Empty>{"You haven't raised anything yet."}</Empty>
        ) : null}

        {tickets.map((t) => (
          <Link key={t.id} to={`/Support/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <Card style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.subject}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>
                  {`#${t.number} · Raised ${formatDate(t.created_at)}`}
                </div>
              </div>
              <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
            </Card>
          </Link>
        ))}
      </Page>
    </div>
  );
};

export default MyTickets;
