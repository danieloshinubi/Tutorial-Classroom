import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchTickets,
  fetchTicketGroups,
  createTicketGroup,
  createTicket,
  updateTicket,
} from "../../lib/api";
import { Page, Button, Empty, Select, displayName, initials } from "../../Components/UI";
import { useLiveTicketsListUpdates, LiveUpdateBanner } from "../../Components/LiveUpdateBanner";
import { useActionFeedback } from "../../Components/Toast";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY = ["low", "medium", "high", "urgent"];
const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

const timeAgo = (iso) => {
  // Clamped at zero — the server's clock and the browser's are never
  // perfectly in sync, and a ticket created a moment ago can otherwise
  // read as "-1 minutes ago" if the browser's clock lags behind.
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

// Freshdesk's own state badge — "New" (nobody's replied yet), "Overdue" (past
// its resolution due date, only meaningful once due dates are wired up so
// left off for now) — kept to the two states this data can actually support
// honestly: unanswered, or the customer/requester's own turn.
const StateBadge = ({ ticket }) => {
  if (!ticket.first_response_at && ticket.status === "open") {
    return <span className="tix-badge new">New</span>;
  }
  return null;
};

const TicketRow = ({ ticket, onQuickUpdate }) => {
  const name = displayName(ticket.requester);

  return (
    <div className="tix-row">
      <label className="tix-row-check">
        <input type="checkbox" />
      </label>
      <span className="tix-avatar">{initials(ticket.requester)}</span>
      <div className="tix-row-main">
        <StateBadge ticket={ticket} />
        <Link to={`/Tickets/${ticket.id}`} className="tix-row-subject">
          {ticket.subject} <span className="tix-row-number">{`#${ticket.number}`}</span>
        </Link>
        <div className="tix-row-meta">
          <span>{name}</span>
          <span className="tix-dot">{"·"}</span>
          <span>{`Created ${timeAgo(ticket.created_at)}`}</span>
        </div>
      </div>
      <div className="tix-row-side">
        <span className={`tix-priority ${ticket.priority}`}>
          <span className="tix-priority-dot" />
          {PRIORITY_LABEL[ticket.priority]}
        </span>
        <span className="tix-row-group">{ticket.group?.name || "Unassigned"}</span>
        <Select
          className="tix-status-select"
          value={ticket.status}
          onChange={(v) => onQuickUpdate(ticket, { status: v })}
          options={STATUS_OPTIONS}
        />
      </div>
    </div>
  );
};

const NewTicketForm = ({ groups, onCreate, onCancel }) => {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("low");
  const [groupId, setGroupId] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [saving, setSaving] = useState(false);
  const { setError } = useActionFeedback();

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim()) { setError("A subject is required."); return; }
    setSaving(true);
    setError("");
    try {
      await onCreate({
        subject: subject.trim(),
        description: description.trim(),
        priority,
        groupId: groupId || null,
        requesterName: requesterName.trim(),
        requesterEmail: requesterEmail.trim(),
        cc,
        bcc,
      });
    } catch (err) {
      setError(err.message || "Could not create that ticket.");
    } finally {
      setSaving(false);
    }
  };

  return (
    // tix-shell too, not just tix-newform — this form renders above the
    // .tix-shell list, so without it every --tix-* variable its own
    // buttons/selects/inputs read is undefined here, and "Create ticket"
    // renders as an invisible box (found live: exactly this happened).
    <div className="tix-newform tix-shell">
      <form onSubmit={submit}>
        <input
          className="tix-input tix-input-lg"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          autoFocus
        />
        <textarea
          className="tix-textarea"
          placeholder="Describe the issue..."
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Raising this on someone else's behalf — a phone call, a walk-in
            — rather than it defaulting to whoever is filling the form in. */}
        <div className="tix-newform-row" style={{ marginBottom: 10 }}>
          <input
            className="tix-input"
            placeholder="Requester's name (optional)"
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
          />
          <input
            className="tix-input"
            type="email"
            placeholder="Requester's email — lets you email them from this ticket"
            value={requesterEmail}
            onChange={(e) => setRequesterEmail(e.target.value)}
          />
        </div>
        {requesterEmail.trim() ? (
          <div className="tix-newform-row" style={{ marginBottom: 10 }}>
            <input className="tix-input" placeholder="Cc (optional)" value={cc} onChange={(e) => setCc(e.target.value)} />
            <input className="tix-input" placeholder="Bcc (optional)" value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </div>
        ) : null}

        <div className="tix-newform-row">
          <Select
            className="tix-select"
            value={priority}
            onChange={setPriority}
            options={PRIORITY.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          />
          <Select
            className="tix-select"
            value={groupId}
            onChange={setGroupId}
            options={[{ value: "", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
          />
          <span style={{ flex: 1 }} />
          <button type="button" className="tix-btn tix-btn-ghost" onClick={onCancel}>{"Cancel"}</button>
          <button type="submit" className="tix-btn tix-btn-primary" disabled={saving}>
            {saving ? "Creating..." : "Create ticket"}
          </button>
        </div>
      </form>
    </div>
  );
};

const TicketsList = () => {
  const navigate = useNavigate();
  const { schoolId, school } = useSchool();
  const [tickets, setTickets] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();
  const [showNew, setShowNew] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [statusFilter, setStatusFilter] = useState("unresolved");
  const [groupFilter, setGroupFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  const live = useLiveTicketsListUpdates(schoolId);

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchTickets({
      schoolId,
      status: statusFilter,
      groupId: groupFilter || undefined,
      priority: priorityFilter || undefined,
      query: search.trim() || undefined,
    })
      .then(setTickets)
      .catch((err) => setError(err.message || "Could not load tickets."))
      .finally(() => setLoading(false));
  }, [schoolId, statusFilter, groupFilter, priorityFilter, search, setError]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!schoolId) return;
    fetchTicketGroups(schoolId).then(setGroups).catch(() => {});
  }, [schoolId]);

  const handleCreate = async ({ cc, bcc, ...payload }) => {
    const created = await createTicket({ schoolId, ...payload });
    setShowNew(false);
    // Cc/Bcc aren't stored on the ticket itself — nothing's been sent yet,
    // that still happens through the normal Reply composer — they're just
    // carried over so whoever typed them doesn't have to retype them there.
    navigate(`/Tickets/${created.id}`, { state: { prefillCc: cc, prefillBcc: bcc } });
  };

  const handleAddGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const g = await createTicketGroup({ schoolId, name: newGroupName.trim() });
    setGroups((c) => [...c, g]);
    setNewGroupName("");
  };

  const handleQuickUpdate = async (ticket, changes) => {
    setTickets((rows) => rows.map((r) => (r.id === ticket.id ? { ...r, ...changes } : r)));
    try {
      await updateTicket({ id: ticket.id, schoolId, ...changes });
    } catch {
      load();
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Tickets"
        subtitle={school ? `Support requests at ${school.name}` : "Support requests"}
        action={<Button onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "New ticket"}</Button>}
        wide
      >
        <LiveUpdateBanner
          count={live.count}
          onReload={() => { live.reset(); load(); }}
          label={`${live.count} new update${live.count === 1 ? "" : "s"} on tickets`}
        />

        {showNew ? (
          <NewTicketForm groups={groups} onCreate={handleCreate} onCancel={() => setShowNew(false)} />
        ) : null}

        <div className="tix-shell">
          <div className="tix-toolbar">
            <div className="tix-toolbar-title">
              {statusFilter === "unresolved" ? "All unresolved tickets" : `All ${statusFilter} tickets`}
              <span className="tix-count">{tickets.length}</span>
            </div>
            <div className="tix-toolbar-actions">
              <Select
                className="tix-select"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "unresolved", label: "Unresolved" },
                  { value: "open", label: "Open" },
                  { value: "pending", label: "Pending" },
                  { value: "resolved", label: "Resolved" },
                  { value: "closed", label: "Closed" },
                  { value: "all", label: "All" },
                ]}
              />
              <input
                className="tix-input"
                placeholder="Search tickets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="button" className="tix-btn tix-btn-ghost" onClick={() => setShowFilters((v) => !v)}>
                {`Filters${groupFilter || priorityFilter ? " (1)" : ""}`}
              </button>
            </div>
          </div>

          <div className="tix-body">
            <div className="tix-list">
              {loading ? <Empty>{"Loading..."}</Empty> : null}
              {!loading && tickets.length === 0 ? (
                <Empty>{"Nothing here. Everyone's caught up."}</Empty>
              ) : null}
              {tickets.map((t) => (
                <TicketRow key={t.id} ticket={t} onQuickUpdate={handleQuickUpdate} />
              ))}
            </div>

            {showFilters ? (
              <div className="tix-filters">
                <div className="tix-filters-head">{"Filters"}</div>
                <div className="tix-field">
                  <label>{"Group"}</label>
                  <Select
                    className="tix-select"
                    value={groupFilter}
                    onChange={setGroupFilter}
                    options={[{ value: "", label: "Any group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                  />
                </div>
                <div className="tix-field">
                  <label>{"Priority"}</label>
                  <Select
                    className="tix-select"
                    value={priorityFilter}
                    onChange={setPriorityFilter}
                    options={[{ value: "", label: "Any priority" }, ...PRIORITY.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]}
                  />
                </div>
                <hr className="tix-hr" />
                <div className="tix-filters-head">{"Ticket groups"}</div>
                <p className="tix-filters-hint">{"Name your own — IT Support, Facilities, Front Office."}</p>
                <form onSubmit={handleAddGroup} className="tix-field">
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="tix-input"
                      placeholder="New group name"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                    />
                    <button type="submit" className="tix-btn tix-btn-ghost">{"Add"}</button>
                  </div>
                </form>
                <ul className="tix-grouplist">
                  {groups.map((g) => <li key={g.id}>{g.name}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </Page>
    </div>
  );
};

export default TicketsList;
