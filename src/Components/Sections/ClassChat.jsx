import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  fetchMessages,
  fetchMessageById,
  postMessage,
  updateMessage,
  deleteMessage,
  subscribeToMessages,
} from "../../lib/api";
import { Card, Notice, Button, displayName } from "../UI";

const ClassChat = ({ courseId }) => {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draftEdit, setDraftEdit] = useState("");

  const { user } = useAuth();
  const listRef = useRef(null);

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
      .then((data) => {
        if (active) setMessages(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load the class chat.");
      });

    const channel = subscribeToMessages(courseId, async (row) => {
      // The realtime payload has no joined profile, so refetch the row to
      // get the author's name with it.
      const full = await fetchMessageById(row.id).catch(() => null);
      if (active) addMessage(full || row);
    });

    return () => {
      active = false;
      channel.unsubscribe();
    };
  }, [courseId, addMessage]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

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
    if (!window.confirm("Delete this message?")) return;
    setError("");
    try {
      await deleteMessage(message.id);
      setMessages((current) => current.filter((row) => row.id !== message.id));
    } catch (err) {
      setError(err.message || "Could not delete that message.");
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();
    setError("");

    const body = draft.trim();
    if (!body || !user) return;

    setSending(true);
    try {
      const saved = await postMessage({ courseId, userId: user.id, body });
      addMessage(saved);
      setDraft("");
    } catch (err) {
      setError(err.message || "Could not send that message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <h3>{"Class stream"}</h3>

      <ul className="chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <li className="chat-item" style={{ color: "var(--ink-3)" }}>
            {"No announcements yet — say something to the class."}
          </li>
        ) : null}
        {messages.map((message) => {
          const mine = message.user_id === user?.id;
          return (
            <li key={message.id} className="chat-item">
              <div className="chat-meta">
                <span className="chat-author">{displayName(message.profiles)}</span>
                <span className="chat-time">
                  {new Date(message.created_at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
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
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input
                    className="input"
                    autoFocus
                    value={draftEdit}
                    onChange={(e) => setDraftEdit(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(message);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button size="sm" onClick={() => saveEdit(message)}>
                    {"Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    {"Cancel"}
                  </Button>
                </div>
              ) : (
                <p className="chat-body">{message.body}</p>
              )}
            </li>
          );
        })}
      </ul>

      <Notice tone="error">{error}</Notice>

      <form onSubmit={handleSend} className="composer">
        <input
          type="text"
          value={draft}
          placeholder="Announce something to the class..."
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={sending || !draft.trim()}
        >
          {"Send"}
        </button>
      </form>
    </Card>
  );
};

export default ClassChat;
