import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import { useSchoolIfAny } from "./SchoolContext";
import { supabase } from "../lib/supabaseClient";
import { fetchSchoolPresence, touchPresence } from "../lib/api";

// Who is online right now, and when everyone else was last seen, the way
// Teams and WhatsApp show it (supabase/219).
//
// Online: every open copy of the app joins the school's private presence
// topic and Realtime keeps the list, so it changes the moment someone opens
// or closes the app. Last seen: the app tells the database it is still here
// every two minutes, so even a closed laptop lid leaves an accurate time.

const PresenceContext = createContext({
  markSeen: () => {},
  status: () => "offline",
  isOnline: () => false,
  lastSeen: () => null,
  lastSignIn: () => null,
});

const HEARTBEAT_MS = 120000;
// Like Teams: still in the app, but nothing touched for this long (or the
// tab is in the background) shows as Away rather than Online.
const AWAY_AFTER_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "wheel", "pointermove"];

export const PresenceProvider = ({ children }) => {
  const { user } = useAuth();
  const schoolCtx = useSchoolIfAny();
  const schoolId = schoolCtx?.schoolId || null;
  const userId = user?.id || null;

  // user id -> "online" | "away", for everyone with the app open now.
  const [here, setHere] = useState(() => new Map());
  const [times, setTimes] = useState({});

  const loadTimes = useCallback(() => {
    if (!userId || !schoolId) return;
    fetchSchoolPresence(schoolId)
      .then((rows) => {
        const next = {};
        rows.forEach((r) => {
          next[r.user_id] = { seen: r.last_seen_at, signIn: r.last_sign_in_at };
        });
        setTimes(next);
      })
      .catch(() => {});
  }, [userId, schoolId]);

  useEffect(() => {
    if (!userId || !schoolId) {
      setHere(new Map());
      setTimes({});
      return undefined;
    }

    const beat = () => touchPresence().catch(() => {});
    beat();
    loadTimes();

    let state = document.visibilityState === "hidden" ? "away" : "online";
    let joined = false;
    const channel = supabase.channel(`presence:${schoolId}`, {
      config: { private: true, presence: { key: userId } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        // Someone with the app open in several places is online if any of
        // them is in use.
        const next = new Map();
        Object.entries(channel.presenceState()).forEach(([id, metas]) => {
          next.set(id, (metas || []).some((m) => m.state !== "away") ? "online" : "away");
        });
        setHere(next);
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        // They just left: their last seen is now, without waiting for a reload.
        setTimes((cur) => ({ ...cur, [key]: { ...(cur[key] || {}), seen: new Date().toISOString() } }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          joined = true;
          channel.track({ state, at: new Date().toISOString() });
        }
      });

    const setState = (next) => {
      if (next === state) return;
      state = next;
      if (joined) channel.track({ state, at: new Date().toISOString() });
    };
    let idleTimer;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setState("away"), AWAY_AFTER_MS);
    };
    const onActivity = () => {
      if (document.visibilityState === "hidden") return;
      setState("online");
      armIdle();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    armIdle();

    const timer = setInterval(() => {
      beat();
      loadTimes();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setState("online");
        armIdle();
        beat();
        loadTimes();
      } else {
        setState("away");
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      clearTimeout(idleTimer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [userId, schoolId, loadTimes]);

  // Someone was just seen doing something (a message from them arrived), so
  // their last seen is now, before the next refresh says so.
  const markSeen = useCallback((id) => {
    if (!id) return;
    setTimes((cur) => ({ ...cur, [id]: { ...(cur[id] || {}), seen: new Date().toISOString() } }));
  }, []);

  const value = useMemo(
    () => ({
      markSeen,
      // "online", "away" or "offline".
      status: (id) => (id && here.get(id)) || "offline",
      isOnline: (id) => !!id && here.get(id) === "online",
      lastSeen: (id) => times[id]?.seen || null,
      lastSignIn: (id) => times[id]?.signIn || null,
    }),
    [here, times, markSeen]
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
};

export const usePresence = () => useContext(PresenceContext);
