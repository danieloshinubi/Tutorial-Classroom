import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { RichTextEditor } from "../../Components/RichTextEditor";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import EmailFrame from "../../Components/EmailFrame";
import { Icon } from "react-icons-kit";
import { ic_fullscreen } from "react-icons-kit/md/ic_fullscreen";
import { ic_fullscreen_exit } from "react-icons-kit/md/ic_fullscreen_exit";
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
import { Page, Button, Select, SkeletonList, displayName, initials, formatDate } from "../../Components/UI";
import { useLiveTicketThreadUpdates, LiveUpdateBanner } from "../../Components/LiveUpdateBanner";
import { useActionFeedback } from "../../Components/Toast";
import FamilyAccountsCard from "./FamilyAccountsCard";

const PRIORITY = ["low", "medium", "high", "urgent"];
const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const STATUS_LABEL = { open: "Open", pending: "Pending", resolved: "Resolved", closed: "Closed" };

// Same cohort the module itself is gated to (modules.js "tickets" entry) —
// an agent has to be someone who can actually see this ticket, so a
// student or parent who happens to also be a school_members row never
// shows up here as someone to assign work to.
const TICKET_STAFF_ROLES = ["owner", "admin", "principal", "bursar", "admissions", "teacher"];

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
  const { setError, setNotice: setSaveNotice } = useActionFeedback();

  const [composeKind, setComposeKind] = useState("reply");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");

  const [pending, setPending] = useState({});
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const live = useLiveTicketThreadUpdates(ticketId);

  // Phone only: the details pane folds away above the conversation.
  const [showDetails, setShowDetails] = useState(false);
  // The composer opened out into a large window over the page, for writing
  // a proper email rather than a line or two at the foot of the thread.
  const [composeExpanded, setComposeExpanded] = useState(false);
  const composeRef = useRef(null);
  const textareaRef = useRef(null);
  const editorRef = useRef(null);
  const convoRef = useRef(null);

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
  }, [ticketId, schoolId, setError]);

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

  useEffect(() => {
    const el = convoRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ticket?.id, messages.length]);

  useEffect(() => {
    if (!composeExpanded) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setComposeExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [composeExpanded]);

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
      setComposeExpanded(false);
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

  // Header buttons: pick Reply or Note, bring the composer into view and put
  // the cursor in it.
  const startCompose = (kind) => {
    setComposeKind(kind);
    requestAnimationFrame(() => {
      composeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (ticket?.channel === "email" && kind === "reply") editorRef.current?.focus();
      else textareaRef.current?.focus();
    });
  };

  // A reload of the same ticket (live updates, after a reply) keeps the page
  // on screen; only a first load, or a different ticket, shows the skeleton.
  if (loading && (!ticket || ticket.id !== ticketId)) {
    return (
      <div className="shell">
        <Navbar />
        <Page wide><SkeletonList rows={4} avatar={true} /></Page>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Ticket" wide>
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
  const requesterEmail = ticket.requester?.email || ticket.requester_email || "";
  const currentTags = pending.tags ?? ticket.tags ?? [];

  // A department group (role set) offers exactly the people who hold that
  // role: the Bursar group lists the bursars, Admissions the admissions
  // staff, IT (Administrators) the admins (supabase/228). A free-form group
  // (no role) or no group at all falls back to every ticket-staff member.
  // Whoever is assigned now stays listed even if their role has changed, so
  // the field never shows blank. One entry per person, A–Z.
  const currentGroup = groups.find((g) => g.id === (pending.groupId ?? ticket.group_id));
  const currentAssignee = pending.assignedTo ?? ticket.assigned_to;
  const assignableMembers = Array.from(
    new Map(
      members
        .filter((m) => !currentGroup?.role || m.role === currentGroup.role || m.user_id === currentAssignee)
        .map((m) => [m.user_id, m])
    ).values()
  ).sort((a, b) => displayName(a.profiles).localeCompare(displayName(b.profiles)));

  const isNote = composeKind === "note";
  const composeEmpty = sendingByEmail ? isHtmlEmpty(composeBody) : !composeBody.trim();
  const composeHint = isNote
    ? "Only staff can see notes."
    : sendingByEmail
    ? "Sent as an email from this ticket's mailbox."
    : `${requesterName} will see this reply.`;

  // A message is the requester's when they wrote it in the app, or when it
  // arrived by email.
  const fromRequester = (m) =>
    m.direction === "inbound" || (ticket.requester_id && m.author?.id === ticket.requester_id);

  return (
    <div className="shell">
      <Navbar />
      <Page
        wide
        toolbar={
          <div className="tix-crumb" style={{ marginBottom: 0 }}>
            <Link to="/Tickets">{"All tickets"}</Link>
            <span>{" › "}</span>
            <span>{`#${ticket.number}`}</span>
            {/* Plain app tokens here, not --tix-* — this sits above the
                ticket panel, same reason .tix-crumb itself already does. */}
            <button type="button" className="tix-history-btn" onClick={toggleHistory}>
              {showHistory ? "Hide transfer history" : "Transfer history"}
            </button>
          </div>
        }
      >
        <LiveUpdateBanner
          count={live.count}
          onReload={() => { live.reset(); load(); }}
          label={`${live.count} new update${live.count === 1 ? "" : "s"} on this ticket`}
        />

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

        {/* Three panes on a wide screen (the queue, the conversation, the
            ticket's details), each scrolling on its own inside a panel that
            fills the page. On a phone they stack and the page scrolls: the
            header, then the details (folded away), then the conversation. */}
        <div className="tk-detail">
          <aside className="tk-queue" aria-label="Other open tickets">
            <div className="tk-pane-title">
              {"Open tickets"}
              <span className="tk-count">{others.length}</span>
            </div>
            {others.length === 0 ? (
              <p className="tk-muted tk-queue-empty">{"No other open tickets."}</p>
            ) : (
              others.map((o) => (
                <Link key={o.id} to={`/Tickets/${o.id}`} className={`tk-queue-item tk-p-${o.priority}`}>
                  <span className="tk-queue-subject">{o.subject}</span>
                  <span className="tk-queue-meta">
                    <span className="tk-dot" aria-hidden="true" />
                    {`#${o.number} · ${displayName(o.requester || (o.requester_name ? { first_name: o.requester_name } : null))}`}
                  </span>
                </Link>
              ))
            )}
          </aside>

          <section className="tk-main">
            <header className="tk-head">
              <div className="tk-head-pills">
                <span className={`tk-pill tk-status tk-status-${ticket.status}`}>{STATUS_LABEL[ticket.status]}</span>
                <span className={`tk-pill tk-pri tk-pri-${ticket.priority}`}>
                  <span className="tk-dot" aria-hidden="true" />
                  {PRIORITY_LABEL[ticket.priority]}
                </span>
                {ticket.channel === "email" ? <span className="tk-pill">{"Email"}</span> : null}
                {ticket.group?.name ? <span className="tk-pill">{ticket.group.name}</span> : null}
              </div>
              <h1 className="tk-subject">{ticket.subject}</h1>
              <div className="tk-head-foot">
                <p className="tk-byline">
                  <strong>{requesterName}</strong>
                  {` raised this ${formatDate(ticket.created_at)}`}
                </p>
                <div className="tk-head-actions">
                  <Button size="sm" onClick={() => startCompose("reply")}>{"Reply"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => startCompose("note")}>{"Add note"}</Button>
                </div>
              </div>
            </header>

            <div className="tk-convo" ref={convoRef}>
              <article className="tk-msg is-requester">
                <span className="tix-avatar">{initials(requesterProfile)}</span>
                <div className="tk-msg-card">
                  <div className="tk-msg-head">
                    <strong>{requesterName}</strong>
                    <span className="tk-badge">{"Requester"}</span>
                    <span className="tk-msg-time">{formatDate(ticket.created_at)}</span>
                  </div>
                  {ticket.description ? (
                    ticket.description_format === "html" ? (
                      <EmailFrame html={ticket.description} title={`Email from ${requesterName}`} />
                    ) : (
                      <p className="tk-msg-text">{ticket.description}</p>
                    )
                  ) : (
                    <p className="tk-msg-text tk-muted">{"(no description)"}</p>
                  )}
                </div>
              </article>

              {messages.map((m) => {
                const authorProfile = m.author || parseExternalFrom(m.external_from);
                const requesterSide = fromRequester(m);
                return (
                  <article
                    key={m.id}
                    className={`tk-msg${m.kind === "note" ? " is-note" : ""}${requesterSide ? " is-requester" : ""}`}
                  >
                    <span className="tix-avatar">{initials(authorProfile)}</span>
                    <div className="tk-msg-card">
                      <div className="tk-msg-head">
                        <strong>{displayName(authorProfile)}</strong>
                        {m.kind === "note" ? <span className="tk-badge tk-badge-note">{"Internal note"}</span> : null}
                        {requesterSide && m.kind !== "note" ? <span className="tk-badge">{"Requester"}</span> : null}
                        {m.send_status === "failed" ? <span className="tk-badge tk-badge-failed">{"Not delivered"}</span> : null}
                        <span className="tk-msg-time">{formatDate(m.created_at)}</span>
                      </div>
                      {m.body_format === "html" && (m.direction === "inbound" || m.direction === "outbound") ? (
                        <EmailFrame html={m.body} title={`Email from ${displayName(authorProfile)}`} />
                      ) : m.body_format === "html" ? (
                        <div
                          className="tix-msg-html tk-msg-body"
                          // Either side can be HTML now — the rich-text reply
                          // composer, or a real inbound email kept in its
                          // original formatting. Sanitized regardless, since
                          // dangerouslySetInnerHTML is the one place stored
                          // markup actually gets rendered, and an inbound
                          // email is untrusted content from the open internet.
                          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(m.body) }}
                        />
                      ) : (
                        <p className="tk-msg-text">{m.body}</p>
                      )}
                      {m.send_status === "failed" && m.send_error ? (
                        <p className="tk-msg-error">{m.send_error}</p>
                      ) : null}
                    </div>
                  </article>
                );
              })}

              {/* After the conversation, where the next message belongs. The
                  header's Reply / Add note buttons bring it into view. */}
              {composeExpanded ? (
                <div className="tk-compose-backdrop" onMouseDown={() => setComposeExpanded(false)} aria-hidden="true" />
              ) : null}
              <div
                className={`tk-compose${isNote ? " is-note" : ""}${composeExpanded ? " is-expanded" : ""}`}
                ref={composeRef}
                role={composeExpanded ? "dialog" : undefined}
                aria-modal={composeExpanded ? "true" : undefined}
                aria-label={composeExpanded ? `Reply to ${requesterName}` : undefined}
              >
                <div className="tk-compose-top">
                <div className="tk-compose-tabs" role="tablist" aria-label="Write">
                  <button type="button" role="tab" aria-selected={!isNote} className={!isNote ? "active" : ""} onClick={() => setComposeKind("reply")}>
                    {sendingByEmail || ticket.channel === "email" ? "Email reply" : "Reply"}
                  </button>
                  <button type="button" role="tab" aria-selected={isNote} className={isNote ? "active" : ""} onClick={() => setComposeKind("note")}>
                    {"Internal note"}
                  </button>
                </div>
                {composeExpanded ? (
                  <span className="tk-compose-title">{`Re: ${ticket.subject}`}</span>
                ) : null}
                <button
                  type="button"
                  className="tk-compose-expand"
                  title={composeExpanded ? "Shrink (Esc)" : "Expand"}
                  aria-label={composeExpanded ? "Shrink the composer" : "Expand the composer"}
                  onClick={() => setComposeExpanded((v) => !v)}
                >
                  <Icon icon={composeExpanded ? ic_fullscreen_exit : ic_fullscreen} size={20} />
                </button>
                </div>
                <form onSubmit={send} className="tk-compose-form">
                  {sendingByEmail ? (
                    <div className="tk-mailfields">
                      <label className="tk-mailfield">
                        <span>{"To"}</span>
                        <input className="input" value={toInput} onChange={(e) => setToInput(e.target.value)} placeholder="name@example.com" />
                      </label>
                      <label className="tk-mailfield">
                        <span>{"Cc"}</span>
                        <input className="input" value={ccInput} onChange={(e) => setCcInput(e.target.value)} />
                      </label>
                      <label className="tk-mailfield">
                        <span>{"Bcc"}</span>
                        <input className="input" value={bccInput} onChange={(e) => setBccInput(e.target.value)} />
                      </label>
                    </div>
                  ) : null}
                  {sendingByEmail ? (
                    <div className="tk-editor">
                      <RichTextEditor ref={editorRef} value={composeBody} onChange={setComposeBody} placeholder="Type your response here..." toolbar="full" />
                    </div>
                  ) : (
                    <textarea
                      ref={textareaRef}
                      className="textarea"
                      placeholder={isNote ? "Add an internal note. Only staff see this." : "Type your response here..."}
                      rows={4}
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                    />
                  )}
                  <div className="tk-compose-foot">
                    <span className="tk-muted">{composeHint}</span>
                    <Button type="submit" disabled={sending || composeEmpty}>
                      {sending ? "Sending..." : isNote ? "Add note" : sendingByEmail ? "Send email" : "Send reply"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </section>

          <aside className={`tk-props${showDetails ? " is-open" : ""}`}>
            {/* Phone only: the details fold away above the conversation,
                with the ones that matter most in the summary line. */}
            <button
              type="button"
              className="tk-props-toggle"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((v) => !v)}
            >
              <span>{"Details"}</span>
              <span className="tk-props-summary">
                {[
                  ticket.assignee ? displayName(ticket.assignee) : "Unassigned",
                  ticket.group?.name || "No group",
                  hasPending ? "Unsaved changes" : null,
                ].filter(Boolean).join(" · ")}
              </span>
              <span className="tk-props-chevron" aria-hidden="true">{"▾"}</span>
            </button>

            <div className="tk-props-body">
              <section className="tk-card">
                <div className="tk-card-title">{"Requester"}</div>
                <div className="tk-person">
                  <span className="tix-avatar">{initials(requesterProfile)}</span>
                  <div className="tk-person-text">
                    <strong>{requesterName}</strong>
                    <span>{requesterEmail || "No email address"}</span>
                  </div>
                </div>
              </section>

              {/* A "New pupil account" ticket: IT makes the pupil's and
                  parent's accounts here (supabase/229). */}
              <FamilyAccountsCard ticketId={ticketId} onDone={load} />

              <section className="tk-card">
                <div className="tk-card-title">{"Properties"}</div>
                <div className="tk-field">
                  <span className="tk-field-label">{"Status"}</span>
                  <Select
                    className="select"
                    value={pending.status ?? ticket.status}
                    onChange={(v) => setField("status", v)}
                    options={Object.keys(STATUS_LABEL).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                  />
                </div>
                <div className="tk-field">
                  <span className="tk-field-label">{"Priority"}</span>
                  <Select
                    className="select"
                    value={pending.priority ?? ticket.priority}
                    onChange={(v) => setField("priority", v)}
                    options={PRIORITY.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                  />
                </div>
                <div className="tk-field">
                  <span className="tk-field-label">{"Group"}</span>
                  <Select
                    className="select"
                    value={pending.groupId ?? ticket.group_id ?? ""}
                    onChange={(v) => {
                      // Moving to another department drops an agent who is not in it.
                      const next = groups.find((g) => g.id === v);
                      const agent = pending.assignedTo ?? ticket.assigned_to;
                      const stays = !next?.role || !agent || members.some((m) => m.user_id === agent && m.role === next.role);
                      setPending((c) => ({ ...c, groupId: v, ...(stays ? {} : { assignedTo: "" }) }));
                    }}
                    options={[{ value: "", label: "No group" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                  />
                </div>
                <div className="tk-field">
                  <span className="tk-field-label">{"Agent"}</span>
                  <Select searchable
                    className="select"
                    value={pending.assignedTo ?? ticket.assigned_to ?? ""}
                    onChange={(v) => setField("assignedTo", v)}
                    options={[
                      { value: "", label: "Unassigned" },
                      ...assignableMembers.map((m) => ({ value: m.user_id, label: displayName(m.profiles) })),
                    ]}
                  />
                </div>
                <div className="tk-field">
                  <span className="tk-field-label">{"Tags"}</span>
                  {currentTags.length > 0 ? (
                    <div className="tk-tags">
                      {currentTags.map((t) => (
                        <span key={t} className="tk-tag">
                          {t}
                          <button type="button" aria-label={`Remove ${t}`} onClick={() => removeTag(t)}>{"×"}</button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <input
                    className="input"
                    placeholder="Add a tag, press Enter"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  />
                </div>
              </section>

              {/* Changes wait here until Update, so a mis-click on a picker
                  never moves a ticket on its own. The bar says so. */}
              <div className={`tk-save${hasPending ? " is-dirty" : ""}`}>
                <span className="tk-save-note">{hasPending ? "Unsaved changes" : "No changes"}</span>
                {hasPending ? (
                  <Button size="sm" variant="secondary" disabled={saving} onClick={() => setPending({})}>{"Discard"}</Button>
                ) : null}
                <Button size="sm" disabled={!hasPending || saving} onClick={applyUpdate}>
                  {saving ? "Updating..." : "Update"}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </Page>
    </div>
  );
};

export default TicketDetail;
