import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSchool } from "../context/SchoolContext";
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
  const { schoolId } = useSchool();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    if (!user || !schoolId) return;
    // Top up the due-soon and overdue reminders first, so what is listed is
    // current even where pg_cron is not running.
    generateDueReminders()
      .catch(() => {})
      .then(() => fetchNotifications({ schoolId }))
      .then(setItems)
      .catch(() => setItems([]));
  }, [user, schoolId]);

  useEffect(load, [load]);

  // New notifications arrive over realtime, so a tutor sees a join request
  // without refreshing.
  useEffect(() => {
    if (!user || !schoolId) return undefined;
    const channel = subscribeToNotifications(user.id, schoolId, (row) =>
      setItems((current) =>
        current.some((item) => item.id === row.id) ? current : [row, ...current]
      )
    );
    return () => channel.unsubscribe();
  }, [user, schoolId]);

  // Click outside closes the panel.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // fetchNotifications only ever returns unread rows, so every item here is
  // pending by definition — the count is just the list length.
  const unread = items.length;

  const openItem = async (item) => {
    setOpen(false);
    // Attended to — drop it rather than leaving it sitting there read but
    // still listed.
    setItems((current) => current.filter((row) => row.id !== item.id));
    markNotificationRead(item.id, schoolId).catch(() => load());
    if (item.link) navigate(item.link);
  };

  const readAll = async () => {
    setItems([]);
    markAllNotificationsRead(user.id, schoolId).catch(() => load());
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
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>{"Notifications"}</strong>
            {unread > 0 ? (
              <button type="button" className="notif-clear" onClick={readAll}>
                {"Mark all as read"}
              </button>
            ) : null}
          </div>

          <div className="notif-list">
            {items.length === 0 ? (
              <div className="notif-empty">
                <span className="notif-empty-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="26" height="26">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 8.5a6 6 0 1 1 12 0v3.4c0 1 .3 2 .9 2.8l.9 1.3a.9.9 0 0 1-.7 1.4H4.9a.9.9 0 0 1-.7-1.4l.9-1.3c.6-.8.9-1.8.9-2.8V8.5Z"
                    />
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      d="M10.2 20a2 2 0 0 0 3.6 0"
                    />
                  </svg>
                </span>
                <p>{"Nothing new."}</p>
                <p className="notif-empty-hint">
                  {"Announcements, join requests and due-soon reminders show up here."}
                </p>
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="notif-item unread"
                  onClick={() => openItem(item)}
                >
                  {/* An unread dot on the left, so the row that needs a look
                      reads at a glance without colouring the whole card. */}
                  <span className="notif-dot" aria-hidden="true" />
                  <span className="notif-body">
                    <span className="notif-title">{item.title}</span>
                    {item.body ? <span className="notif-desc">{item.body}</span> : null}
                    <span className="notif-time">{formatDate(item.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
};

export default Notifications;
