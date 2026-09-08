import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  fetchMessages,
  fetchMessageById,
  postMessage,
  subscribeToMessages,
} from "../../lib/api";
import { Card, Notice, displayName } from "../UI";

const ClassChat = ({ courseId }) => {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

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
        {messages.map((message) => (
          <li key={message.id} className="chat-item">
            <div className="chat-meta">
              <span className="chat-author">{displayName(message.profiles)}</span>
              <span className="chat-time">
                {new Date(message.created_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="chat-body">{message.body}</p>
          </li>
        ))}
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
