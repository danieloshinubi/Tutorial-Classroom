import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { search as searchIcon } from "react-icons-kit/feather/search";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchTickets,
  fetchTicketGroups,
  createTicketGroup,
  createTicket,
  updateTicket,
} from "../../lib/api";
import { Page, Button, Empty, Field, Modal, Select, SkeletonList, displayName, initials } from "../../Components/UI";
import { useLiveTicketsListUpdates, LiveUpdateBanner } from "../../Components/LiveUpdateBanner";
import { useActionFeedback } from "../../Components/Toast";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

// The views across the top of the list. "Unresolved" (open + pending) is the
// working queue, so it comes first and is where the page opens.
const STATUS_TABS = [
  ["unresolved", "Unresolved"],
  ["open", "Open"],
  ["pending", "Pending"],
  ["resolved", "Resolved"],
  ["closed", "Closed"],
  ["all", "All"],
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

// "New" means nobody has replied yet. Overdue is left out until due dates
// exist, so the badge only ever claims what this data can support.
const isNew = (ticket) => !ticket.first_response_at && ticket.status === "open";

const TicketRow = ({ ticket, onQuickUpdate }) => {
  const name = displayName(ticket.requester || (ticket.requester_name || ticket.requester_email
    ? { first_name: ticket.requester_name || "", email: ticket.requester_email || "" }
    : null));

  return (
    // The whole row opens the ticket (the subject link stretches over it,
    // see .tk-row-link); the status picker sits above that link so it can
    // still be changed without opening anything.
    <div className={`tk-row tk-p-${ticket.priority}`}>
      <span className="tix-avatar">{initials(ticket.requester || { first_name: name })}</span>
      <div className="tk-row-main">
        <div className="tk-row-title">
          <Link to={`/Tickets/${ticket.id}`} className="tk-row-link">{ticket.subject}</Link>
          <span className="tk-row-num">{`#${ticket.number}`}</span>
          {isNew(ticket) ? <span className="tk-badge tk-badge-new">{"New"}</span> : null}
        </div>
        <div className="tk-row-meta">
          <span>{name}</span>
          <span aria-hidden="true">{"·"}</span>
          <span>{`Created ${timeAgo(ticket.created_at)}`}</span>
          {ticket.channel === "email" ? (
            <>
              <span aria-hidden="true">{"·"}</span>
              <span>{"By email"}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="tk-row-side">
        <span className={`tk-pill tk-pri tk-pri-${ticket.priority}`}>
          <span className="tk-dot" aria-hidden="true" />
          {PRIORITY_LABEL[ticket.priority]}
        </span>
        <span className="tk-row-group">{ticket.group?.name || "No group"}</span>
        <span className={`tk-row-agent${ticket.assignee ? "" : " is-empty"}`}>
          {ticket.assignee ? (
            <>
              <span className="tix-avatar sm">{initials(ticket.assignee)}</span>
              <span className="tk-row-agent-name">{displayName(ticket.assignee)}</span>
            </>
          ) : (
            "Unassigned"
          )}
        </span>
        <div className="tk-row-status">
          <Select
            className="select"
            value={ticket.status}
            onChange={(v) => onQuickUpdate(ticket, { status: v })}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
};

const NewTicketModal = ({ groups, onCreate, onClose }) => {
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
    <Modal
      title="New ticket"
      subtitle="Log a request that came in by phone, in person or by message."
      onClose={onClose}
      wide
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{"Cancel"}</Button>
          <Button type="submit" form="tk-new-ticket" disabled={saving || !subject.trim()}>
            {saving ? "Creating..." : "Create ticket"}
          </Button>
        </>
      }
    >
      <form id="tk-new-ticket" onSubmit={submit}>
        <Field label="Subject">
          <input
            className="input"
            placeholder="e.g. Projector in Room 12 not working"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Description">
          <textarea
            className="textarea"
            placeholder="What happened, where, and anything already tried."
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {/* Raising this on someone else's behalf — a phone call, a walk-in
            — rather than it defaulting to whoever is filling the form in.
            Selects sit in a div, not Field's <label>: a label forwards its
            click to the picker's button and reopens it. */}
        <div className="tk-form-grid">
          <div className="tk-field">
            <span className="tk-field-label">{"Priority"}</span>
            <Select
              className="select"
              value={priority}
              onChange={setPriority}
              options={PRIORITY.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            />
          </div>
          <div className="tk-field">
            <span className="tk-field-label">{"Group"}</span>
            <Select
              className="select"
              value={groupId}
              onChange={setGroupId}
              options={[{ value: "", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />
          </div>
          <Field label="Requester's name" hint="Leave blank if it is you.">
            <input className="input" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />
          </Field>
          <Field label="Requester's email" hint="Lets you email them from this ticket.">
            <input className="input" type="email" value={requesterEmail} onChange={(e) => setRequesterEmail(e.target.value)} />
          </Field>
          {requesterEmail.trim() ? (
            <>
              <Field label="Cc">
                <input className="input" placeholder="Optional" value={cc} onChange={(e) => setCc(e.target.value)} />
              </Field>
              <Field label="Bcc">
                <input className="input" placeholder="Optional" value={bcc} onChange={(e) => setBcc(e.target.value)} />
              </Field>
            </>
          ) : null}
        </div>
      </form>
    </Modal>
  );
};

const GroupsModal = ({ groups, onAdd, onClose }) => {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const { setError } = useActionFeedback();

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onAdd(name.trim());
      setName("");
    } catch (err) {
      setError(err.message || "Could not add that group.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Ticket groups" subtitle="Name your own: IT Support, Facilities, Front Office." onClose={onClose}>
      <form onSubmit={submit} className="tk-group-add">
        <input className="input" placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Adding..." : "Add"}</Button>
      </form>
      {groups.length === 0 ? (
        <p className="tk-muted">{"No groups yet."}</p>
      ) : (
        <ul className="tk-group-list">
          {groups.map((g) => <li key={g.id}>{g.name}</li>)}
        </ul>
      )}
    </Modal>
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
  const [showGroups, setShowGroups] = useState(false);

  const [statusFilter, setStatusFilter] = useState("unresolved");
  const [groupFilter, setGroupFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [search, setSearch] = useState("");

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

  const handleAddGroup = async (name) => {
    const g = await createTicketGroup({ schoolId, name });
    setGroups((c) => [...c, g]);
  };

  const handleQuickUpdate = async (ticket, changes) => {
    setTickets((rows) => rows.map((r) => (r.id === ticket.id ? { ...r, ...changes } : r)));
    try {
      await updateTicket({ id: ticket.id, schoolId, ...changes });
    } catch {
      load();
    }
  };

  // One line of what needs attention in the list as it stands.
  const newCount = tickets.filter(isNew).length;
  const urgentCount = tickets.filter((t) => t.priority === "urgent" || t.priority === "high").length;
  const unassignedCount = tickets.filter((t) => !t.assigned_to).length;
  const filtered = Boolean(groupFilter || priorityFilter || search.trim());

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Tickets"
        subtitle={school ? `Support requests at ${school.name}` : "Support requests"}
        action={
          <div className="btn-row">
            <Button variant="secondary" onClick={() => setShowGroups(true)}>{"Groups"}</Button>
            <Button onClick={() => setShowNew(true)}>{"New ticket"}</Button>
          </div>
        }
        wide
      >
        <LiveUpdateBanner
          count={live.count}
          onReload={() => { live.reset(); load(); }}
          label={`${live.count} new update${live.count === 1 ? "" : "s"} on tickets`}
        />

        <div className="tk-list-card">
          <div className="tk-toolbar">
            <div className="tk-tabs" role="tablist" aria-label="Show tickets">
              {STATUS_TABS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === value}
                  className={`tk-tab${statusFilter === value ? " active" : ""}`}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                  {statusFilter === value && !loading ? <span className="tk-tab-count">{tickets.length}</span> : null}
                </button>
              ))}
            </div>
            <div className="tk-filters">
              <label className="tk-search">
                <Icon icon={searchIcon} size={15} />
                <input
                  className="input"
                  placeholder="Search subject or description"
                  aria-label="Search tickets"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="tk-filter">
                <Select
                  className="select"
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  options={[{ value: "", label: "Any priority" }, ...PRIORITY.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]}
                />
              </div>
              <div className="tk-filter">
                <Select
                  className="select"
                  value={groupFilter}
                  onChange={setGroupFilter}
                  options={[{ value: "", label: "Any group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                />
              </div>
              {filtered ? (
                <button
                  type="button"
                  className="tk-clear"
                  onClick={() => { setSearch(""); setGroupFilter(""); setPriorityFilter(""); }}
                >
                  {"Clear"}
                </button>
              ) : null}
            </div>
          </div>

          {!loading && tickets.length > 0 ? (
            <div className="tk-summary">
              <span><strong>{tickets.length}</strong>{` ticket${tickets.length === 1 ? "" : "s"}`}</span>
              {newCount ? <span className="tk-summary-new"><strong>{newCount}</strong>{" new"}</span> : null}
              {urgentCount ? <span className="tk-summary-urgent"><strong>{urgentCount}</strong>{" high or urgent"}</span> : null}
              {unassignedCount ? <span><strong>{unassignedCount}</strong>{" unassigned"}</span> : null}
            </div>
          ) : null}

          <div className="tk-list">
            {/* The skeleton only stands in for a list that has never loaded.
                A reload (typing in search, a new filter) keeps the rows on
                screen until the new ones arrive, rather than flashing. */}
            {loading && tickets.length === 0 ? <div className="tk-list-pad"><SkeletonList rows={5} avatar={true} /></div> : null}
            {!loading && tickets.length === 0 ? (
              <div className="tk-list-pad">
                <Empty>
                  {filtered
                    ? "No tickets match these filters."
                    : statusFilter === "unresolved"
                    ? "Nothing waiting. Everyone's caught up."
                    : "No tickets here."}
                </Empty>
              </div>
            ) : null}
            {tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} onQuickUpdate={handleQuickUpdate} />
            ))}
          </div>
        </div>
      </Page>

      {showNew ? <NewTicketModal groups={groups} onCreate={handleCreate} onClose={() => setShowNew(false)} /> : null}
      {showGroups ? <GroupsModal groups={groups} onAdd={handleAddGroup} onClose={() => setShowGroups(false)} /> : null}
    </div>
  );
};

export default TicketsList;
