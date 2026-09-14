import React, { useCallback, useEffect, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { RichTextEditor } from "../../Components/RichTextEditor";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchTicket,
  fetchTickets,
  fetchTicketMessages,
  addTicketMessage,
  sendTicketEmailReply,
  updateTicket,
  fetchTicketGroups,
  fetchSchoolMembers,
  fetchTicketGroupHistory,
} from "../../lib/api";
import { Page, Notice, Empty, Select, displayName, initials, formatDate } from "../../Components/UI";

const PRIORITY = ["low", "medium", "high", "urgent"];
const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const STATUS_LABEL = { open: "Open", pending: "Pending", resolved: "Resolved", closed: "Closed" };

// Same cohort the module itself is gated to (modules.js "tickets" entry) —
// an agent has to be someone who can actually see this ticket, so a
// student or parent who happens to also be a school_members row never
// shows up here as someone to assign work to.
const TICKET_STAFF_ROLES = ["owner", "admin", "principal", "bursar", "admissions", "teacher"];

// owner/admin can always be assigned anything, matching their cross-
// department oversight (classroom.can_access_ticket) — everyone else in
// the Agent list has to actually belong to this ticket's own department.
const RUNS_THE_SCHOOL = ["owner", "admin"];

// An inbound email can come from someone with no Schoolivio account at all
// — ticket_messages.external_from ("Jane Doe <jane@example.com>") is what
// stands in for the profile embed then. Shaped to look enough like one that
// displayName()/initials() need no special case.
const parseExternalFrom = (raw) => {
  if (!raw) return null;
  const match = raw.match(/^(.*?)\s*<(.+)>$/);
  if (match) return { first_name: match[1] || "", email: match[2] };
  return { email: raw };
};

const parseAddresses = (raw) =>
  (raw || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);

// An empty Tiptap document still serialises to "<p></p>" — plain .trim()
// on that string is never falsy, so emptiness has to be checked on the
// text content, not the markup.
const isHtmlEmpty = (html) => !html || !html.replace(/<[^>]+>/g, "").trim();

const TicketDetail = () => {
  const { ticketId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { schoolId } = useSchool();

  const [ticket, setTicket] = useState(null);
  const [others, setOthers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [composeKind, setComposeKind] = useState("reply");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");

  const [pending, setPending] = useState({});
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const t = await fetchTicket(ticketId, schoolId);
      setTicket(t);
      setPending({});
      const [msgs, all] = await Promise.all([
        fetchTicketMessages(ticketId, { schoolId }),
        schoolId ? fetchTickets({ schoolId, status: "unresolved" }) : Promise.resolve([]),
      ]);
      setMessages(msgs);
      setOthers(all.filter((o) => o.id !== ticketId));
    } catch (err) {
      setError(err.message || "Could not load this ticket.");
    } finally {
      setLoading(false);
    }
  }, [ticketId, schoolId]);

  useEffect(() => { load(); }, [load]);

  // Prefill To with the requester's address once, the first time this
  // ticket loads — never stomps on it again if staff edits it afterward.
  // Cc/Bcc typed into the "New ticket" form arrive the same one-time way,
  // via router state from TicketsList's handleCreate — nothing was sent
  // yet at creation, so there's nothing to thread onto except this.
  useEffect(() => {
    if (ticket && !toInput) {
      setToInput(ticket.requester?.email || ticket.requester_email || "");
      if (location.state?.prefillCc) setCcInput(location.state.prefillCc);
      if (location.state?.prefillBcc) setBccInput(location.state.prefillBcc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);

  useEffect(() => {
    if (!schoolId) return;
    fetchTicketGroups(schoolId).then(setGroups).catch(() => {});
    fetchSchoolMembers(schoolId)
      .then((rows) => setMembers(rows.filter((r) => TICKET_STAFF_ROLES.includes(r.role))))
      .catch(() => {});
  }, [schoolId]);

  const toggleHistory = async () => {
    const opening = !showHistory;
    setShowHistory(opening);
    if (opening && !historyLoaded) {
      setHistoryLoading(true);
      try {
        setHistory(await fetchTicketGroupHistory(ticketId, schoolId));
        setHistoryLoaded(true);
      } catch (err) {
        setError(err.message || "Could not load this ticket's history.");
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  const sendingByEmail = ticket?.channel === "email" && composeKind === "reply";

  const send = async (e) => {
    e.preventDefault();
    if (sendingByEmail ? isHtmlEmpty(composeBody) : !composeBody.trim()) return;
    if (sendingByEmail && parseAddresses(toInput).length === 0) {
      setError("At least one recipient is required.");
      return;
    }
    setSending(true);
    setError("");
    try {
      if (sendingByEmail) {
        await sendTicketEmailReply({
          ticketId,
          schoolId,
          body: composeBody.trim(),
          to: parseAddresses(toInput),
          cc: parseAddresses(ccInput),
          bcc: parseAddresses(bccInput),
        });
      } else {
        await addTicketMessage({ ticketId, kind: composeKind, body: composeBody.trim(), schoolId });
      }
      setComposeBody("");
      const [t, msgs] = await Promise.all([fetchTicket(ticketId, schoolId), fetchTicketMessages(ticketId, { schoolId })]);
      setTicket(t);
      setMessages(msgs);
    } catch (err) {
      setError(err.message || "Could not send that.");
    } finally {
      setSending(false);
    }
  };

  const setField = (field, value) => setPending((c) => ({ ...c, [field]: value }));

  const addTag = () => {
    const value = tagInput.trim();
    if (!value) return;
    const current = pending.tags ?? ticket.tags ?? [];
    if (!current.includes(value)) setField("tags", [...current, value]);
    setTagInput("");
  };

  const removeTag = (value) => {
    const current = pending.tags ?? ticket.tags ?? [];
    setField("tags", current.filter((t) => t !== value));
  };

  const hasPending = Object.keys(pending).length > 0;

  const applyUpdate = async () => {
    if (!hasPending) return;
    setSaving(true);
    setError("");
    setSaveNotice("");
    try {
      const changes = { ...pending };
      if ("groupId" in changes && !changes.groupId) changes.clearGroup = true;
      if ("assignedTo" in changes && !changes.assignedTo) changes.clearAssignee = true;
      await updateTicket({ id: ticketId, schoolId, ...changes });
      try {
        // update_ticket returns the flat classroom.tickets row, with no
        // requester/assignee/group embed — refetch the full shape rather
        // than rendering the byline/avatar/Requester field off a row
        // missing them.
        const fresh = await fetchTicket(ticketId, schoolId);
        setTicket(fresh);
        setPending({});
        setSaveNotice("Updated.");
      } catch {
        // Moving a ticket into another department is exactly what just
        // cost the caller their own access to it — can_access_ticket()
        // re-evaluates against the new group immediately, so this refetch
        // finding nothing means the handoff worked, not that it failed.
        navigate("/Tickets");
      }
    } catch (err) {
      setError(err.message || "Could not update this ticket.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page wide><Empty>{"Loading ticket..."}</Empty></Page>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Ticket" wide>
          <Notice tone="error">{error}</Notice>
          <Link to="/Tickets">{"Back to all tickets"}</Link>
        </Page>
      </div>
    );
  }

  // A ticket raised on someone's behalf can carry just a name, just an
  // email, or both, with no linked account for any of them — going through
  // parseExternalFrom's "Name <email>" round-trip breaks on an empty email
  // (no closing "<>" to match), so this builds the fallback profile directly.
  const requesterProfile = ticket.requester || (
    (ticket.requester_name || ticket.requester_email)
      ? { first_name: ticket.requester_name || "", email: ticket.requester_email || "" }
      : null
  );
  const requesterName = displayName(requesterProfile);
  const currentTags = pending.tags ?? ticket.tags ?? [];

  // A department group (role set) only offers its own members plus
  // owner/admin — a bursary ticket has no reason to list a teacher. A
  // free-form group (no role) or no group at all falls back to every
  // ticket-staff member, since there's no department to narrow it to.
  const currentGroup = groups.find((g) => g.id === (pending.groupId ?? ticket.group_id));
  const assignableMembers = currentGroup?.role
    ? members.filter((m) => m.role === currentGroup.role || RUNS_THE_SCHOOL.includes(m.role))
    : members;

  return (
    <div className="shell">
      <Navbar />
      <Page
        wide
        toolbar={
          <div className="tix-crumb" style={{ marginBottom: 0 }}>
            <Link to="/Tickets">{"All unresolved tickets"}</Link>
            <span>{" › "}</span>
            <span>{`#${ticket.number}`}</span>
            {/* Plain app tokens here, not --tix-* — this sits above .tix-shell,
                same reason .tix-crumb itself already does. */}
            <button type="button" className="tix-history-btn" onClick={toggleHistory}>
              {showHistory ? "Hide transfer history" : "Transfer history"}
            </button>
          </div>
        }
      >
        {showHistory ? (
          <div className="tix-history">
            {historyLoading ? <p className="tix-history-hint">{"Loading..."}</p> : null}
            {!historyLoading && history.length === 0 ? (
              <p className="tix-history-hint">{"This ticket hasn't moved between departments."}</p>
            ) : null}
            {history.map((h, i) => (
              <div key={i} className="tix-history-row">
                <span>{`${h.from_group_name || "No group"} → ${h.to_group_name || "No group"}`}</span>
                <span className="tix-history-meta">{`${h.actor_label || "Someone"} · ${formatDate(h.changed_at)}`}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="tix-shell tix-detail">
          <aside className="tix-detail-list">
            {others.length === 0 ? (
              <p className="tix-filters-hint">{"No other open tickets."}</p>
            ) : (
              others.map((o) => (
                <Link key={o.id} to={`/Tickets/${o.id}`} className="tix-detail-list-item">
                  <span className="tix-avatar sm">{initials(o.requester)}</span>
                  <span>
                    <span className="tix-detail-list-subject">{o.subject}</span>
                    <span className="tix-detail-list-num">{`#${o.number}`}</span>
                  </span>
                </Link>
              ))
            )}
          </aside>

          <section className="tix-thread">
            <div className="tix-thread-head">
              <h1>{ticket.subject}</h1>
            </div>
            <p className="tix-thread-byline">{`${requesterName} raised this ticket`}</p>

            <div className="tix-compose">
              <div className="tix-compose-tabs">
                <button type="button" className={composeKind === "reply" ? "active" : ""} onClick={() => setComposeKind("reply")}>{"Reply"}</button>
                <button type="button" className={composeKind === "note" ? "active" : ""} onClick={() => setComposeKind("note")}>{"Note"}</button>
              </div>
              <form onSubmit={send}>
                {sendingByEmail ? (
                  <div className="tix-mailfields">
                    <div className="tix-mailfield">
                      <label>{"To"}</label>
                      <input className="tix-input full" value={toInput} onChange={(e) => setToInput(e.target.value)} placeholder="name@example.com" />
                    </div>
                    <div className="tix-mailfield">
                      <label>{"Cc"}</label>
                      <input className="tix-input full" value={ccInput} onChange={(e) => setCcInput(e.target.value)} />
                    </div>
                    <div className="tix-mailfield">
                      <label>{"Bcc"}</label>
                      <input className="tix-input full" value={bccInput} onChange={(e) => setBccInput(e.target.value)} />
                    </div>
                  </div>
                ) : null}
                {sendingByEmail ? (
                  <RichTextEditor value={composeBody} onChange={setComposeBody} placeholder="Type your response here..." />
                ) : (
                  <textarea
                    className="tix-textarea"
                    placeholder={composeKind === "note" ? "Add an internal note — only staff see this..." : "Type your response here..."}
                    rows={3}
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                  />
                )}
                <div className="tix-compose-actions">
                  <button
                    type="submit"
                    className="tix-btn tix-btn-primary"
                    disabled={sending || (sendingByEmail ? isHtmlEmpty(composeBody) : !composeBody.trim())}
                  >
                    {sending ? "Sending..." : composeKind === "note" ? "Add note" : sendingByEmail ? "Send email" : "Send reply"}
                  </button>
                </div>
              </form>
            </div>

            <Notice tone="error">{error}</Notice>

            <div className="tix-msg original">
              <span className="tix-avatar">{initials(requesterProfile)}</span>
              <div className="tix-msg-body">
                <div className="tix-msg-head">
                  <strong>{requesterName}</strong>
                  <span className="tix-msg-time">{formatDate(ticket.created_at)}</span>
                </div>
                {ticket.description ? (
                  ticket.description_format === "html" ? (
                    <div className="tix-msg-html" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(ticket.description) }} />
                  ) : (
                    <p>{ticket.description}</p>
                  )
                ) : (
                  <p>{"(no description)"}</p>
                )}
              </div>
            </div>

            {messages.map((m) => {
              const authorProfile = m.author || parseExternalFrom(m.external_from);
              return (
                <div key={m.id} className={`tix-msg ${m.kind === "note" ? "note" : ""}`}>
                  <span className="tix-avatar">{initials(authorProfile)}</span>
                  <div className="tix-msg-body">
                    <div className="tix-msg-head">
                      <strong>{displayName(authorProfile)}</strong>
                      {m.kind === "note" ? <span className="tix-badge note-tag">Note</span> : null}
                      {m.send_status === "failed" ? <span className="tix-badge failed">Not delivered</span> : null}
                      <span className="tix-msg-time">{formatDate(m.created_at)}</span>
                    </div>
                    {m.body_format === "html" ? (
                      <div
                        className="tix-msg-html"
                        // Either side can be HTML now — the rich-text reply
                        // composer, or a real inbound email kept in its
                        // original formatting. Sanitized regardless, since
                        // dangerouslySetInnerHTML is the one place stored
                        // markup actually gets rendered, and an inbound
                        // email is untrusted content from the open internet.
                        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(m.body) }}
                      />
                    ) : (
                      <p>{m.body}</p>
                    )}
                    {m.send_status === "failed" && m.send_error ? (
                      <p className="tix-msg-error">{m.send_error}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>

          <aside className="tix-properties">
            <div className="tix-properties-head">{"Properties"}</div>

            <div className="tix-prop">
              <label>{"Tags"}</label>
              <div className="tix-tags">
                {currentTags.map((t) => (
                  <span key={t} className="tix-tag">
                    {t}
                    <button type="button" onClick={() => removeTag(t)}>{"×"}</button>
                  </span>
                ))}
              </div>
              <input
                className="tix-input"
                placeholder="Add a tag, press Enter"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              />
            </div>

            <div className="tix-prop">
              <label>{"Status"}</label>
              <Select
                className="tix-select full"
                value={pending.status ?? ticket.status}
                onChange={(v) => setField("status", v)}
                options={Object.keys(STATUS_LABEL).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              />
            </div>

            <div className="tix-prop">
              <label>{"Priority"}</label>
              <Select
                className="tix-select full"
                value={pending.priority ?? ticket.priority}
                onChange={(v) => setField("priority", v)}
                options={PRIORITY.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              />
            </div>

            <div className="tix-prop">
              <label>{"Group"}</label>
              <Select
                className="tix-select full"
                value={pending.groupId ?? ticket.group_id ?? ""}
                onChange={(v) => setField("groupId", v)}
                options={[{ value: "", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
              />
            </div>

            <div className="tix-prop">
              <label>{"Agent"}</label>
              <Select
                className="tix-select full"
                value={pending.assignedTo ?? ticket.assigned_to ?? ""}
                onChange={(v) => setField("assignedTo", v)}
                options={[
                  { value: "", label: "Unassigned" },
                  ...assignableMembers.map((m) => ({ value: m.user_id, label: displayName(m.profiles) })),
                ]}
              />
            </div>

            <div className="tix-prop">
              <label>{"Requester"}</label>
              <div className="tix-readonly">{ticket.requester?.email || ticket.requester_email || "—"}</div>
            </div>

            {saveNotice ? <Notice tone="success">{saveNotice}</Notice> : null}
            <button type="button" className="tix-btn tix-btn-primary full" disabled={!hasPending || saving} onClick={applyUpdate}>
              {saving ? "Updating..." : "Update"}
            </button>
          </aside>
        </div>
      </Page>
    </div>
  );
};

export default TicketDetail;
