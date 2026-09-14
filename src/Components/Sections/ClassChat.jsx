import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  fetchMessages,
  fetchMessageById,
  postMessage,
  updateMessage,
  deleteMessage,
  subscribeToMessages,
  fetchCommentsFor,
  postComment,
  updateComment,
  deleteComment,
  fetchMessageReactions,
  toggleMessageReaction,
} from "../../lib/api";
import { Card, Notice, Button, displayName } from "../UI";
import Reactions from "../Reactions";
import EmojiInput from "../EmojiInput";

// A textarea that grows with what is being typed, so a long announcement is
// visible while it is written instead of scrolling inside two lines.
const Growing = React.forwardRef(({ value, minRows = 3, ...rest }, ref) => {
  const inner = useRef(null);
  const node = ref || inner;

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, node]);

  return <textarea ref={node} rows={minRows} value={value} {...rest} />;
});

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

// Comments on one announcement. Kept collapsed until there is something to
// read or the reader opens it, so a busy stream stays skimmable.
const Comments = ({ message, comments, onPost, onEdit, onRemove }) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState("");

  const rows = comments || [];
  const showing = open || rows.length > 0;

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await onPost(message.id, body);
      setDraft("");
      setOpen(true);
    } catch (err) {
      setError(err.message || "Could not add that comment.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (comment) => {
    const body = editDraft.trim();
    if (!body || body === comment.body) {
      setEditingId(null);
      return;
    }
    try {
      await onEdit(comment, body);
      setEditingId(null);
    } catch (err) {
      setError(err.message || "Could not save that change.");
    }
  };

  if (!showing) {
    return (
      <button type="button" className="comment-toggle" onClick={() => setOpen(true)}>
        {"Add a comment"}
      </button>
    );
  }

  return (
    <div className="comments">
      {rows.length ? (
        <div className="comment-count">
          {rows.length === 1 ? "1 comment" : `${rows.length} comments`}
        </div>
      ) : null}

      {rows.map((comment) => {
        const mine = comment.user_id === user?.id;
        return (
          <div key={comment.id} className="comment">
            <div className="chat-meta">
              <span className="chat-author">{displayName(comment.profiles)}</span>
              <span className="chat-time">{timeOf(comment.created_at)}</span>
              {comment.edited_at ? <span className="chat-time">{"· edited"}</span> : null}
              {mine && editingId !== comment.id ? (
                <span className="chat-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(comment.id);
                      setEditDraft(comment.body);
                    }}
                  >
                    {"Edit"}
                  </button>
                  <button type="button" onClick={() => onRemove(comment)}>
                    {"Delete"}
                  </button>
                </span>
              ) : null}
            </div>

            {editingId === comment.id ? (
              <div className="composer composer-inline">
                <Growing
                  autoFocus
                  minRows={2}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div className="btn-row">
                  <Button size="sm" onClick={() => saveEdit(comment)}>
                    {"Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    {"Cancel"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="chat-body">{comment.body}</p>
            )}
          </div>
        );
      })}

      <Notice tone="error">{error}</Notice>

      <div className="composer composer-inline">
        <Growing
          minRows={2}
          value={draft}
          placeholder="Add a comment..."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="btn-row">
          <Button size="sm" disabled={busy || !draft.trim()} onClick={send}>
            {"Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
};

const ClassChat = ({ courseId, schoolId }) => {
  const [messages, setMessages] = useState([]);
  const [comments, setComments] = useState({});
  const [reactions, setReactions] = useState({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draftEdit, setDraftEdit] = useState("");

  const { user } = useAuth();
  const composerRef = useRef(null);

  // Guards against both the realtime echo of a message this client just
  // inserted and any duplicate delivery from the channel.
  const addMessage = useCallback((message) => {
    setMessages((current) =>
      current.some((existing) => existing.id === message.id)
        ? current
        : [...current, message]
    );
  }, []);

  useEffect(() => {
    let active = true;

    fetchMessages(courseId)
      .then(async (data) => {
        if (!active) return;
        setMessages(data);
        const ids = data.map((m) => m.id);
        const [byMessage, byReaction] = await Promise.all([
          fetchCommentsFor(ids).catch(() => ({})),
          fetchMessageReactions(ids, courseId, user?.id).catch(() => ({})),
        ]);
        if (active) {
          setComments(byMessage);
          setReactions(byReaction);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load the class stream.");
      });

    const channel = subscribeToMessages(courseId, async (row) => {
      // The realtime payload has no joined profile, so refetch the row to
      // get the author's name with it.
      const full = await fetchMessageById({ schoolId, id: row.id }).catch(() => null);
      if (active) addMessage(full || row);
    });

    return () => {
      active = false;
      channel.unsubscribe();
    };
  }, [courseId, addMessage, user, schoolId]);

  const saveEdit = async (message) => {
    const body = draftEdit.trim();
    if (!body || body === message.body) {
      setEditingId(null);
      return;
    }
    setError("");
    try {
      const saved = await updateMessage({ id: message.id, body });
      setMessages((current) =>
        current.map((row) => (row.id === saved.id ? saved : row))
      );
      setEditingId(null);
    } catch (err) {
      setError(err.message || "Could not save that change.");
    }
  };

  const removeMessage = async (message) => {
    if (!window.confirm("Delete this post and its comments?")) return;
    setError("");
    try {
      await deleteMessage({ id: message.id, schoolId });
      setMessages((current) => current.filter((row) => row.id !== message.id));
    } catch (err) {
      setError(err.message || "Could not delete that post.");
    }
  };

  const addComment = async (messageId, body) => {
    const saved = await postComment({ messageId, userId: user.id, body });
    setComments((current) => ({
      ...current,
      [messageId]: [...(current[messageId] || []), saved],
    }));
  };

  const editComment = async (comment, body) => {
    const saved = await updateComment({ id: comment.id, body });
    setComments((current) => ({
      ...current,
      [comment.message_id]: (current[comment.message_id] || []).map((row) =>
        row.id === saved.id ? saved : row
      ),
    }));
  };

  const removeComment = async (comment) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await deleteComment({ id: comment.id, schoolId });
      setComments((current) => ({
        ...current,
        [comment.message_id]: (current[comment.message_id] || []).filter(
          (row) => row.id !== comment.id
        ),
      }));
    } catch (err) {
      setError(err.message || "Could not delete that comment.");
    }
  };

  // Optimistic: a reaction is a one-tap thing, and waiting for the round trip
  // before the count moves feels broken. If the write fails we put it back.
  const react = async (messageId, emoji, mine) => {
    const before = reactions;
    setReactions((current) => {
      const target = { ...(current[messageId] || {}) };
      const tally = target[emoji] || { count: 0, mine: false };
      const next = mine
        ? { count: tally.count - 1, mine: false }
        : { count: tally.count + 1, mine: true };
      if (next.count <= 0) delete target[emoji];
      else target[emoji] = next;
      return { ...current, [messageId]: target };
    });

    try {
      await toggleMessageReaction({ messageId, userId: user.id, emoji, mine });
    } catch (err) {
      setReactions(before);
      setError(err.message || "Could not save that reaction.");
    }
  };

  // Only this handler publishes. Enter inside the box makes a new line, so a
  // half-written announcement is never posted by accident.
  const handleSend = async (event) => {
    if (event) event.preventDefault();
    setError("");

    const body = draft.trim();
    if (!body || !user) return;

    setSending(true);
    try {
      const saved = await postMessage({ courseId, userId: user.id, body });
      addMessage(saved);
      setDraft("");
    } catch (err) {
      setError(err.message || "Could not post that.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <h3>{"Class stream"}</h3>

      {/* The composer sits above the stream: writing is what this panel is
          for, and a long post should not push the box off screen. */}
      <div className="composer composer-block">
        <Growing
          ref={composerRef}
          minRows={4}
          value={draft}
          placeholder="Share something with the class. Enter starts a new line — press Post when you are ready."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="composer-foot">
          <span className="composer-hint">
            <EmojiInput targetRef={composerRef} value={draft} onChange={setDraft} />
            {"Enter makes a new line. Nothing is published until you press Post."}
          </span>
          <Button size="sm" disabled={sending || !draft.trim()} onClick={handleSend}>
            {sending ? "Posting..." : "Post"}
          </Button>
        </div>
      </div>

      <Notice tone="error">{error}</Notice>

      <ul className="chat-list">
        {messages.length === 0 ? (
          <li className="chat-item" style={{ color: "var(--ink-3)" }}>
            {"No announcements yet — say something to the class."}
          </li>
        ) : null}
        {[...messages]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .map((message) => {
            const mine = message.user_id === user?.id;
            return (
              <li key={message.id} className="chat-item">
                <div className="chat-meta">
                  <span className="chat-author">{displayName(message.profiles)}</span>
                  <span className="chat-time">{timeOf(message.created_at)}</span>
                  {message.edited_at ? (
                    <span className="chat-time">{"· edited"}</span>
                  ) : null}
                  {mine && editingId !== message.id ? (
                    <span className="chat-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(message.id);
                          setDraftEdit(message.body);
                        }}
                      >
                        {"Edit"}
                      </button>
                      <button type="button" onClick={() => removeMessage(message)}>
                        {"Delete"}
                      </button>
                    </span>
                  ) : null}
                </div>

                {editingId === message.id ? (
                  <div className="composer composer-inline">
                    <Growing
                      autoFocus
                      minRows={3}
                      value={draftEdit}
                      onChange={(e) => setDraftEdit(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div className="btn-row">
                      <Button size="sm" onClick={() => saveEdit(message)}>
                        {"Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        {"Cancel"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="chat-body">{message.body}</p>
                )}

                <Reactions
                  tallies={reactions[message.id]}
                  onToggle={(emoji, mine) => react(message.id, emoji, mine)}
                />

                <Comments
                  message={message}
                  comments={comments[message.id]}
                  onPost={addComment}
                  onEdit={editComment}
                  onRemove={removeComment}
                />
              </li>
            );
          })}
      </ul>
    </Card>
  );
};

export default ClassChat;
