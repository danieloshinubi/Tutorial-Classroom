import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useSchoolIfAny } from "./SchoolContext";
import {
  fetchChatOverview,
  fetchModuleAttention,
  markModuleSeen,
  subscribeToMyChannels,
  subscribeToChatActivity,
  subscribeToNotifications,
  subscribeToMail,
} from "../lib/api";

// What the menu shows beside each module: unread chats and the "something
// waiting for you" dots (supabase/212, 213).
//
// It lives here, once for the whole app, rather than in the Navbar: every
// page renders its own Navbar, so state kept there was thrown away and
// fetched again, and its live channels closed and reopened, on every click.
// Here the counts load once, stay live, and refresh only when something
// happens: a message, a notification, opening a module, coming back to the
// window, or once a minute.

const NavDataContext = createContext({ chatUnread: 0, attention: {} });

// Modules whose dot means "new since you last opened it" (supabase/213).
const SEEN_MODULES = [
  { id: "news", path: "/News" },
  { id: "reports", path: "/Reports" },
  { id: "attendance", path: "/Attendance" },
  { id: "courses", path: "/Courses" },
];

// Page changes refresh the dots at most this often; a burst of clicks is one
// request, not one each.
const MIN_REFRESH_MS = 15000;

export const NavDataProvider = ({ children }) => {
  const { user } = useAuth();
  const schoolCtx = useSchoolIfAny();
  const schoolId = schoolCtx?.schoolId || null;
  const userId = user?.id || null;
  const location = useLocation();

  const [chatUnread, setChatUnread] = useState(0);
  const [attention, setAttention] = useState({});
  const lastAttentionAt = useRef(0);

  const loadChat = useCallback(() => {
    if (!userId || !schoolId) return;
    fetchChatOverview(schoolId)
      .then((rows) => setChatUnread(rows.reduce((sum, r) => sum + (r.unread_count || 0), 0)))
      .catch(() => {});
  }, [userId, schoolId]);

  const loadAttention = useCallback(() => {
    if (!userId || !schoolId) return;
    lastAttentionAt.current = Date.now();
    fetchModuleAttention(schoolId)
      .then((counts) => setAttention(counts || {}))
      .catch(() => {});
  }, [userId, schoolId]);

  // Live: chats, and notifications (most things that put a dot on a module
  // also notify someone, so a notification is the cue to recount).
  useEffect(() => {
    if (!userId || !schoolId) {
      setChatUnread(0);
      setAttention({});
      return undefined;
    }
    loadChat();
    loadAttention();
    const subs = [
      subscribeToMyChannels(userId, loadChat),
      subscribeToChatActivity(userId, loadChat),
      subscribeToNotifications(userId, schoolId, loadAttention),
      // New or read mail moves the Mail item's unread count.
      subscribeToMail(userId, loadAttention),
    ];
    const timer = setInterval(loadAttention, 60000);
    const onFocus = () => {
      loadChat();
      loadAttention();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      subs.forEach((s) => s.unsubscribe());
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId, schoolId, loadChat, loadAttention]);

  // Opening News, Reports, Attendance or Courses clears its "new" dot; any
  // other page change refreshes the dots if they are getting old.
  useEffect(() => {
    if (!userId || !schoolId) return;
    const path = location.pathname.toLowerCase();
    const here = SEEN_MODULES.find((m) => path.startsWith(m.path.toLowerCase()));
    if (here) {
      markModuleSeen(schoolId, here.id).catch(() => {}).finally(loadAttention);
    } else if (Date.now() - lastAttentionAt.current > MIN_REFRESH_MS) {
      loadAttention();
    }
  }, [location.pathname, userId, schoolId, loadAttention]);

  const value = useMemo(() => ({ chatUnread, attention }), [chatUnread, attention]);
  return <NavDataContext.Provider value={value}>{children}</NavDataContext.Provider>;
};

export const useNavData = () => useContext(NavDataContext);
