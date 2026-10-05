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
import { formatDate, useClampToViewport } from "./UI";
import MailAlerts, { showMailAlert } from "../Pages/Mail/MailAlerts";

const Notifications = () => {
  const { user } = useAuth();
  const { schoolId } = useSchool();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  // The bell doesn't sit at the true right edge of the screen on a phone
  // (the account menu does) — a panel anchored to open rightward FROM the
  // bell overshoots past the left edge there. See useClampToViewport.
  useClampToViewport(open, panelRef);
  const navigate = useNavigate();

  const load = useCallback(() => {
    if (!user || !schoolId) return;
    // Top up the due-soon and overdue reminders first, so what is listed is
    // current even where pg_cron is not running.
    generateDueReminders()
      .catch(() => {})
      .then(() => fetchNotifications({ schoolId, includeRead: true }))
      .then(setItems)
      .catch(() => setItems([]));
  }, [user, schoolId]);

  useEffect(load, [load]);

  // Something else marked notifications read (the payslips page): recount.
  useEffect(() => {
    window.addEventListener("schoolivio:notifications-changed", load);
    return () => window.removeEventListener("schoolivio:notifications-changed", load);
  }, [load]);

  // New notifications arrive over realtime, so a tutor sees a join request
  // without refreshing.
  useEffect(() => {
    if (!user || !schoolId) return undefined;
    const channel = subscribeToNotifications(user.id, schoolId, (row) => {
      setItems((current) =>
        current.some((item) => item.id === row.id) ? current : [row, ...current]
      );
      // Someone just opened your mail (supabase/241): a card pops up at once.
      if (String(row.kind || "").startsWith("mail_")) showMailAlert(row);
    });
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

  // Read notifications stay, under "Earlier". They used to vanish the moment
  // they were opened, so a parent who tapped "First Term fees for Ada" had
  // no way back to it — nothing on the page said what the bill was for, and
  // the notification was the only record of it arriving.
  const pending = items.filter((row) => !row.read_at);
  const earlier = items.filter((row) => row.read_at);
  const unread = pending.length;

  const openItem = async (item) => {
    setOpen(false);
    if (!item.read_at) {
      const now = new Date().toISOString();
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read_at: now } : row)));
      markNotificationRead(item.id, schoolId).catch(() => load());
    }
    if (item.link) navigate(item.link);
  };

  const readAll = async () => {
    const now = new Date().toISOString();
    setItems((current) => current.map((row) => (row.read_at ? row : { ...row, read_at: now })));
    markAllNotificationsRead(user.id, schoolId).catch(() => load());
  };

  const renderItem = (item) => (
    <button
      key={item.id}
      type="button"
      className={`notif-item${item.read_at ? "" : " unread"}`}
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
  );

  if (!user) return null;

  return (
    <span ref={wrapRef} style={{ position: "relative" }}>
      <MailAlerts />
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
        <div className="notif-panel" role="dialog" aria-label="Notifications" ref={panelRef}>
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
                <p>{"Nothing yet."}</p>
                <p className="notif-empty-hint">
                  {"Bills, announcements, join requests and due-soon reminders show up here."}
                </p>
              </div>
            ) : (
              <>
                {pending.length === 0 ? (
                  <p className="notif-caught-up">{"You're all caught up."}</p>
                ) : (
                  pending.map(renderItem)
                )}
                {earlier.length ? (
                  <>
                    <div className="notif-section">{"Earlier"}</div>
                    {earlier.map(renderItem)}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
};

export default Notifications;
