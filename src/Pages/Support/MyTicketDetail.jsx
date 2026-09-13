import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { fetchTicket, fetchTicketMessages, addTicketMessage } from "../../lib/api";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import { Page, Card, Button, Badge, Notice, Empty, displayName, formatDate } from "../../Components/UI";

// A ticket raised by email can carry the sender's real formatting (a
// signature block, paragraphs) rather than plain text — rendered through a
// sanitizer since this content came in from the open internet.
const MessageBody = ({ body, format }) =>
  format === "html" ? (
    <div className="chat-body chat-body-html" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(body) }} />
  ) : (
    <p className="chat-body">{body}</p>
  );

const STATUS_TONE = { open: "brand", pending: "warn", resolved: "success", closed: undefined };
const STATUS_LABEL = { open: "Open", pending: "Pending", resolved: "Resolved", closed: "Closed" };

// The same thread as the staff-side TicketDetail, seen from the other side:
// no status/priority/assignee levers, and RLS keeps any internal note out of
// `messages` before it ever reaches this component.
const MyTicketDetail = () => {
  const { ticketId } = useParams();
  const { user } = useAuth();

  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [t, msgs] = await Promise.all([
        fetchTicket(ticketId),
        fetchTicketMessages(ticketId, { includeNotes: false }),
      ]);
      setTicket(t);
      setMessages(msgs);
    } catch (err) {
      setError(err.message || "Could not load this request.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await addTicketMessage({ ticketId, kind: "reply", body: draft.trim() });
      setDraft("");
      const [t, msgs] = await Promise.all([
        fetchTicket(ticketId),
        fetchTicketMessages(ticketId, { includeNotes: false }),
      ]);
      setTicket(t);
      setMessages(msgs);
    } catch (err) {
      setError(err.message || "Could not send that.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page>
          <Empty>{"Loading..."}</Empty>
        </Page>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Help Desk">
          <Notice tone="error">{error}</Notice>
          <Link to="/Support">{"Back to your requests"}</Link>
        </Page>
      </div>
    );
  }

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={ticket.subject}
        subtitle={`#${ticket.number} · Raised ${formatDate(ticket.created_at)}`}
        action={<Badge tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>}
      >
        <Link to="/Support" style={{ fontSize: 13, color: "var(--ink-2)" }}>
          {"← All your requests"}
        </Link>

        <Card style={{ marginTop: 16 }}>
          <ul className="chat-list">
            <li className="chat-item">
              <div className="chat-meta">
                <span className="chat-author">{"You"}</span>
                <span className="chat-time">{formatDate(ticket.created_at)}</span>
              </div>
              {ticket.description ? (
                <MessageBody body={ticket.description} format={ticket.description_format} />
              ) : (
                <p className="chat-body">{"(no description)"}</p>
              )}
            </li>
            {messages.map((m) => (
              <li key={m.id} className="chat-item">
                <div className="chat-meta">
                  <span className="chat-author">{m.author?.id === user?.id ? "You" : displayName(m.author)}</span>
                  <span className="chat-time">{formatDate(m.created_at)}</span>
                </div>
                <MessageBody body={m.body} format={m.body_format} />
              </li>
            ))}
          </ul>

          <form onSubmit={send} className="composer composer-block" style={{ marginTop: 16 }}>
            <textarea
              rows={3}
              placeholder="Add more detail, or reply to the school..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="composer-foot">
              <span className="composer-hint">{"The school's staff will see this and reply here."}</span>
              <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
          </form>
        </Card>

        <Notice tone="error">{error}</Notice>
      </Page>
    </div>
  );
};

export default MyTicketDetail;
