import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  fetchNotifications,
  generateDueReminders,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
} from "../lib/api";
import { formatDate } from "./UI";

const Notifications = () => {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    if (!user) return;
    // Top up the due-soon and overdue reminders first, so what is listed is
    // current even where pg_cron is not running.
    generateDueReminders()
      .catch(() => {})
      .then(fetchNotifications)
      .then(setItems)
      .catch(() => setItems([]));
  }, [user]);

  useEffect(load, [load]);

  // New notifications arrive over realtime, so a tutor sees a join request
  // without refreshing.
  useEffect(() => {
    if (!user) return undefined;
    const channel = subscribeToNotifications(user.id, (row) =>
      setItems((current) =>
        current.some((item) => item.id === row.id) ? current : [row, ...current]
      )
    );
    return () => channel.unsubscribe();
  }, [user]);

  // Click outside closes the panel.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter((item) => !item.read_at).length;

  const openItem = async (item) => {
    setOpen(false);
    if (!item.read_at) {
      setItems((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row
        )
      );
      markNotificationRead(item.id).catch(() => load());
    }
    if (item.link) navigate(item.link);
  };

  const readAll = async () => {
    setItems((current) =>
      current.map((row) => ({ ...row, read_at: row.read_at || new Date().toISOString() }))
    );
    markAllNotificationsRead(user.id).catch(() => load());
  };

  if (!user) return null;

  return (
    <span ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="bell"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((value) => !value)}
      >
        {/* A drawn bell rather than the U+1F514 emoji: the emoji renders at
            each OS's own colour, size and style — orange with a red count on
            Windows, dark on Android — and always looked out of place beside
            the rest of the navbar. This one inherits currentColor and
            responds to :hover like every other control here. */}
        <svg
          className="bell-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 8.5a6 6 0 1 1 12 0v3.4c0 1 .3 2 .9 2.8l.9 1.3a.9.9 0 0 1-.7 1.4H4.9a.9.9 0 0 1-.7-1.4l.9-1.3c.6-.8.9-1.8.9-2.8V8.5Z"
          />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            d="M10.2 20a2 2 0 0 0 3.6 0"
          />
        </svg>
        {unread > 0 ? <span className="bell-count">{unread > 9 ? "9+" : unread}</span> : null}
      </button>

      {open ? (
        <div className="notif-panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 10px",
            }}
          >
            <strong style={{ fontSize: 14 }}>{"Notifications"}</strong>
            {unread > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={readAll}>
                {"Mark all read"}
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p style={{ padding: 16, color: "var(--ink-3)", fontSize: 14, margin: 0 }}>
              {"Nothing yet."}
            </p>
          ) : null}

          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`notif-item${item.read_at ? "" : " unread"}`}
              style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer" }}
              onClick={() => openItem(item)}
            >
              <div className="notif-title">{item.title}</div>
              {item.body ? (
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
                  {item.body}
                </div>
              ) : null}
              <div className="notif-time">{formatDate(item.created_at)}</div>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
};

export default Notifications;
