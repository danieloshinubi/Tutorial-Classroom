import React, { useCallback, useEffect, useRef, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchNotices,
  createNotice,
  updateNotice,
  publishNotice,
  deleteNotice,
  fetchNoticeReplies,
  replyToNotice,
  deleteNoticeReply,
  updateNoticeReply,
  fetchNoticeReactions,
  toggleNoticeReaction,
  sendNoticeEmail,
  NOTICE_AUDIENCES,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  Select,
  DateTimePicker,
  displayName,
  formatDate,
} from "../../Components/UI";
import Reactions from "../../Components/Reactions";
import EmojiInput from "../../Components/EmojiInput";

const AUDIENCE_LABEL = Object.fromEntries(NOTICE_AUDIENCES);

// datetime-local wants local wall-clock time, not UTC. Handing it an ISO
// string shifts the event by the timezone offset every time it is edited.
const forInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

// Replies live under the notice they answer, because a question about a
// closure or a levy is nearly always the same question the next parent has.
const Replies = ({ notice, replies, onReply, onEdit, onRemove, canModerate }) => {
  const { user } = useAuth();
  const replyRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");

  const rows = replies || [];
  const showing = open || rows.length > 0;

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await onReply(notice.id, body);
      setDraft("");
      setOpen(true);
    } catch (err) {
      setError(err.message || "Could not post that reply.");
    } finally {
      setBusy(false);
    }
  };

  if (!showing) {
    return (
      <button type="button" className="comment-toggle" onClick={() => setOpen(true)}>
        {"Reply"}
      </button>
    );
  }

  return (
    <div className="comments">
      {rows.length ? (
        <div className="comment-count">
          {rows.length === 1 ? "1 reply" : `${rows.length} replies`}
        </div>
      ) : null}

      {rows.map((reply) => {
        const mine = reply.user_id === user?.id;
        return (
          <div key={reply.id} className="comment">
            <div className="chat-meta">
              <span className="chat-author">{displayName(reply.profiles)}</span>
              <span className="chat-time">{formatDate(reply.created_at)}</span>
              {reply.edited_at ? <span className="chat-time">{"· edited"}</span> : null}
              {(mine || canModerate) && editingId !== reply.id ? (
                <span className="chat-actions">
                  {mine ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(reply.id);
                        setEditDraft(reply.body);
                      }}
                    >
                      {"Edit"}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onRemove(reply)}>
                    {"Delete"}
                  </button>
                </span>
              ) : null}
            </div>

            {editingId === reply.id ? (
              <div className="composer composer-inline">
                <textarea
                  rows={2}
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div className="btn-row">
                  <Button
                    size="sm"
                    onClick={async () => {
                      const body = editDraft.trim();
                      if (!body || body === reply.body) {
                        setEditingId(null);
                        return;
                      }
                      try {
                        await onEdit(reply, body);
                        setEditingId(null);
                      } catch (err) {
                        setError(err.message || "Could not save that change.");
                      }
                    }}
                  >
                    {"Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    {"Cancel"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="chat-body">{reply.body}</p>
            )}
          </div>
        );
      })}

      <Notice tone="error">{error}</Notice>

      <div className="composer composer-inline">
        <textarea
          ref={replyRef}
          rows={2}
          value={draft}
          placeholder="Reply to the school..."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="btn-row">
          <EmojiInput targetRef={replyRef} value={draft} onChange={setDraft} />
          <Button size="sm" disabled={busy || !draft.trim()} onClick={send}>
            {"Post reply"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// The school's own noticeboard: news, events and general notices, addressed
// to everybody or to one group. A class stream reaches one course; this
// reaches the school.
const News = () => {
  const { user } = useAuth();
  const { schoolId, school, roles } = useSchool();
  const bodyRef = useRef(null);

  // Posting is the office's job — a teacher has their class stream.
  const canPost = roles.some((r) => ["owner", "admin", "principal"].includes(r));

  const [notices, setNotices] = useState([]);
  const [replies, setReplies] = useState({});
  const [reactions, setReactions] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [composing, setComposing] = useState(false);
  // Which published notice is being corrected, if any. The composer is
  // reused rather than duplicated, so an edit offers exactly the fields the
  // original was written with.
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("everyone");
  const [isEvent, setIsEvent] = useState(false);
  const [eventAt, setEventAt] = useState("");
  const [eventPlace, setEventPlace] = useState("");
  const [pinned, setPinned] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const rows = await fetchNotices(schoolId);
      setNotices(rows);
      const ids = rows.map((r) => r.id);
      const [byNotice, byReaction] = await Promise.all([
        fetchNoticeReplies(ids).catch(() => ({})),
        fetchNoticeReactions(ids, user?.id, schoolId).catch(() => ({})),
      ]);
      setReplies(byNotice);
      setReactions(byReaction);
    } catch (err) {
      setError(err.message || "Could not load the noticeboard.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, user]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setTitle("");
    setBody("");
    setAudience("everyone");
    setIsEvent(false);
    setEventAt("");
    setEventPlace("");
    setPinned(false);
    setComposing(false);
    setEditingId(null);
  };

  // Load a notice back into the composer.
  const startEdit = (row) => {
    setEditingId(row.id);
    setTitle(row.title);
    setBody(row.body);
    setAudience(row.audience);
    setIsEvent(row.is_event);
    setEventAt(forInput(row.event_at));
    setEventPlace(row.event_place || "");
    setPinned(row.pinned);
    setComposing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveEdit = async () => {
    setError("");
    setNotice("");

    if (!title.trim() || !body.trim()) {
      setError("A notice needs a heading and something to say.");
      return;
    }
    if (isEvent && !eventAt) {
      setError("An event needs a date and time.");
      return;
    }

    setBusy(true);
    try {
      await updateNotice({
        id: editingId,
        schoolId,
        title: title.trim(),
        body: body.trim(),
        audience,
        pinned,
        isEvent,
        eventAt: isEvent && eventAt ? new Date(eventAt).toISOString() : null,
        eventPlace: eventPlace.trim(),
      });
      // Nobody is re-notified: correcting a typo should not send the whole
      // school a second alert about the same notice.
      setNotice("Updated. The notice now shows as edited.");
      reset();
      load();
    } catch (err) {
      setError(err.message || "Could not save that change.");
    } finally {
      setBusy(false);
    }
  };

  const post = async (publishNow) => {
    setError("");
    setNotice("");

    if (!title.trim() || !body.trim()) {
      setError("A notice needs a heading and something to say.");
      return;
    }
    if (isEvent && !eventAt) {
      setError("An event needs a date and time.");
      return;
    }

    setBusy(true);
    try {
      const created = await createNotice({
        schoolId,
        title: title.trim(),
        body: body.trim(),
        audience,
        isEvent,
        eventAt: eventAt ? new Date(eventAt).toISOString() : null,
        eventPlace: eventPlace.trim(),
        pinned,
        authorId: user.id,
      });
      if (publishNow) {
        await publishNotice(created.id, schoolId);
        const emailNote = await emailNotice(created.id);
        setNotice(
          (audience === "everyone"
            ? "Posted. Everyone at the school has been notified."
            : `Posted. All ${AUDIENCE_LABEL[audience].toLowerCase()} have been notified.`) + emailNote
        );
      } else {
        setNotice("Saved as a draft. Nobody has been notified yet.");
      }
      reset();
      load();
    } catch (err) {
      setError(err.message || "Could not post that.");
    } finally {
      setBusy(false);
    }
  };

  // Best-effort: publishing (and its in-app notification) already
  // succeeded by the time this runs, so a mail-side hiccup is reported as
  // a note, not an error that implies the notice itself failed to post.
  const emailNotice = async (noticeId) => {
    try {
      const result = await sendNoticeEmail({ noticeId, schoolId });
      if (result?.sent) return ` Emailed to ${result.count} ${result.count === 1 ? "person" : "people"}.`;
      return " No mailbox connected — not emailed.";
    } catch (err) {
      return ` Could not email it: ${err.message}`;
    }
  };

  const send = async (row) => {
    setError("");
    try {
      await publishNotice(row.id, schoolId);
      const emailNote = await emailNotice(row.id);
      setNotice(`Sent.${emailNote}`);
      load();
    } catch (err) {
      setError(err.message || "Could not send that notice.");
    }
  };

  const togglePin = async (row) => {
    try {
      await updateNotice({ id: row.id, schoolId, pinned: !row.pinned });
      load();
    } catch (err) {
      setError(err.message || "Could not change that notice.");
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.title}" and its replies?`)) return;
    try {
      await deleteNotice(row.id, schoolId);
      setNotices((current) => current.filter((r) => r.id !== row.id));
    } catch (err) {
      setError(err.message || "Could not delete that notice.");
    }
  };

  const onReply = async (noticeId, replyBody) => {
    const saved = await replyToNotice({ noticeId, schoolId, userId: user.id, body: replyBody });
    setReplies((current) => ({
      ...current,
      [noticeId]: [...(current[noticeId] || []), saved],
    }));
  };

  // Optimistic, and put back if the write fails.
  const react = async (noticeId, emoji, mine) => {
    const before = reactions;
    setReactions((current) => {
      const target = { ...(current[noticeId] || {}) };
      const tally = target[emoji] || { count: 0, mine: false };
      const next = mine
        ? { count: tally.count - 1, mine: false }
        : { count: tally.count + 1, mine: true };
      if (next.count <= 0) delete target[emoji];
      else target[emoji] = next;
      return { ...current, [noticeId]: target };
    });
    try {
      await toggleNoticeReaction({ noticeId, userId: user.id, emoji, mine });
    } catch (err) {
      setReactions(before);
      setError(err.message || "Could not save that reaction.");
    }
  };

  const onEditReply = async (reply, replyBody) => {
    const saved = await updateNoticeReply({ id: reply.id, body: replyBody });
    setReplies((current) => ({
      ...current,
      [reply.notice_id]: (current[reply.notice_id] || []).map((r) =>
        r.id === saved.id ? saved : r
      ),
    }));
  };

  const onRemoveReply = async (reply) => {
    if (!window.confirm("Delete this reply?")) return;
    try {
      await deleteNoticeReply(reply.id, schoolId);
      setReplies((current) => ({
        ...current,
        [reply.notice_id]: (current[reply.notice_id] || []).filter(
          (r) => r.id !== reply.id
        ),
      }));
    } catch (err) {
      setError(err.message || "Could not delete that reply.");
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="News and events"
        subtitle={school ? `From ${school.name}` : "From the school"}
        action={
          canPost ? (
            <Button
              onClick={() => {
                if (composing) {
                  reset();
                } else {
                  setEditingId(null);
                  setComposing(true);
                }
              }}
            >
              {composing ? "Cancel" : "Write a notice"}
            </Button>
          ) : null
        }
      >
        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{notice}</Notice>

        {composing ? (
          <Card style={{ marginBottom: 24 }}>
            <h3>{editingId ? "Editing a notice" : "A new notice"}</h3>
            {editingId ? (
              <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
                {"Saving marks it edited. Nobody is notified again — a correction should not alert the school twice about the same notice."}
              </p>
            ) : null}

            <Field label="Heading">
              <input
                className="input"
                autoFocus
                value={title}
                placeholder="Resumption date for second term"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>

            <Field label="What you want to say">
              <textarea
                ref={bodyRef}
                className="input"
                rows={6}
                value={body}
                placeholder="Write it out in full. Enter starts a new line — nothing is sent until you press Post."
                onChange={(e) => setBody(e.target.value)}
                style={{ resize: "vertical", lineHeight: 1.55 }}
              />
              <div style={{ marginTop: 6 }}>
                <EmojiInput targetRef={bodyRef} value={body} onChange={setBody} />
              </div>
            </Field>

            <div className="split">
              <Field
                label="Who it is for"
                hint="Enforced in the database, not just hidden — a staff notice cannot be read by a parent."
              >
                <Select
                  className="select"
                  value={audience}
                  onChange={setAudience}
                  options={NOTICE_AUDIENCES.map(([value, label]) => ({ value, label }))}
                />
              </Field>

              <Field label="Keep it at the top">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                  />
                  <span>{"Pin this notice"}</span>
                </label>
              </Field>
            </div>

            <Field label="Is it an event?">
              <label className="check">
                <input
                  type="checkbox"
                  checked={isEvent}
                  onChange={(e) => setIsEvent(e.target.checked)}
                />
                <span>{"This happens at a particular time and place"}</span>
              </label>
            </Field>

            {isEvent ? (
              <div className="split">
                <Field label="When">
                  <DateTimePicker value={eventAt} onChange={setEventAt} />
                </Field>
                <Field label="Where">
                  <input
                    className="input"
                    value={eventPlace}
                    placeholder="School hall"
                    onChange={(e) => setEventPlace(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            <div className="btn-row" style={{ marginTop: 8 }}>
              {editingId ? (
                <>
                  <Button disabled={busy} onClick={saveEdit}>
                    {busy ? "Saving..." : "Save changes"}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={reset}>
                    {"Cancel"}
                  </Button>
                </>
              ) : (
                <>
                  <Button disabled={busy} onClick={() => post(true)}>
                    {busy ? "Posting..." : "Post and notify"}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => post(false)}>
                    {"Save as draft"}
                  </Button>
                </>
              )}
            </div>
          </Card>
        ) : null}

        {loading ? <Empty>{"Loading..."}</Empty> : null}
        {!loading && notices.length === 0 ? (
          <Empty>
            {canPost
              ? "Nothing on the noticeboard yet. Write the first notice."
              : "Nothing from the school yet. News and events will appear here."}
          </Empty>
        ) : null}

        {notices.map((row) => (
          <Card key={row.id} style={{ marginBottom: 16 }}>
            <div className="btn-row" style={{ marginBottom: 8, flexWrap: "wrap" }}>
              {row.pinned ? <Badge tone="brand">{"pinned"}</Badge> : null}
              {row.is_event ? <Badge tone="success">{"event"}</Badge> : null}
              {!row.published_at ? <Badge tone="warn">{"draft"}</Badge> : null}
              {row.audience !== "everyone" ? (
                <Badge>{AUDIENCE_LABEL[row.audience]}</Badge>
              ) : null}
            </div>

            <h3 style={{ margin: "0 0 4px" }}>{row.title}</h3>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>
              {row.author_name}
              {row.published_at ? ` · ${formatDate(row.published_at)}` : " · not sent yet"}
              {row.edited_at ? " · edited" : ""}
            </div>

            {row.is_event ? (
              <div className="event-when">
                <strong>{formatDate(row.event_at)}</strong>
                {row.event_place ? <span>{` · ${row.event_place}`}</span> : null}
              </div>
            ) : null}

            <p className="chat-body" style={{ fontSize: 15 }}>
              {row.body}
            </p>

            {canPost ? (
              <div className="btn-row" style={{ marginTop: 12 }}>
                {!row.published_at ? (
                  <Button size="sm" onClick={() => send(row)}>
                    {"Send it"}
                  </Button>
                ) : null}
                {/* Published or not — a notice already sent is exactly the one
                    most likely to need a correction. */}
                <Button size="sm" variant="secondary" onClick={() => startEdit(row)}>
                  {"Edit"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => togglePin(row)}>
                  {row.pinned ? "Unpin" : "Pin"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(row)}>
                  {"Delete"}
                </Button>
              </div>
            ) : null}

            {row.published_at ? (
              <Reactions
                tallies={reactions[row.id]}
                onToggle={(emoji, mine) => react(row.id, emoji, mine)}
              />
            ) : null}

            {row.published_at ? (
              <Replies
                notice={row}
                replies={replies[row.id]}
                onReply={onReply}
                onEdit={onEditReply}
                onRemove={onRemoveReply}
                canModerate={canPost}
              />
            ) : null}
          </Card>
        ))}
      </Page>
    </div>
  );
};

export default News;
