import React, { useEffect, useRef, useState } from "react";
import { Icon } from "react-icons-kit";
import { refreshCw } from "react-icons-kit/feather/refreshCw";
import {
  subscribeToApplicationEvents,
  subscribeToTicketsList,
  subscribeToApplicationsList,
  subscribeToTicketThread,
} from "../lib/api";

// A small floating "N updates — reload" prompt for a page showing live
// state someone else might change underneath the viewer. Rather than
// forcing a hard page refresh (or leaving the viewer to guess when to hit
// refresh themselves), it counts real-time events and, on click, re-runs
// the page's own data load — the same fresh data a refresh would give,
// without losing scroll position or any in-progress form input elsewhere
// on the page.
//
// One counter shape, four subscriptions: a single application's own
// timeline, a school's whole tickets list, a school's whole admissions
// queue, and one ticket's own message thread. All four need their
// underlying table added to the supabase_realtime publication (see
// 060_application_events_realtime.sql and
// 122_tickets_and_applications_realtime.sql) or no event ever arrives here
// no matter how correct this subscription code is.
const useRealtimeCounter = (key, subscribe) => {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    if (!key) return undefined;
    setCount(0);
    countRef.current = 0;
    const channel = subscribe(() => {
      countRef.current += 1;
      setCount(countRef.current);
    });
    return () => channel.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reset = () => {
    countRef.current = 0;
    setCount(0);
  };

  return { count, reset };
};

export const useLiveApplicationUpdates = (applicationId) =>
  useRealtimeCounter(applicationId, (onChange) =>
    subscribeToApplicationEvents(applicationId, onChange)
  );

export const useLiveTicketsListUpdates = (schoolId) =>
  useRealtimeCounter(schoolId, (onChange) => subscribeToTicketsList(schoolId, onChange));

export const useLiveApplicationsListUpdates = (schoolId) =>
  useRealtimeCounter(schoolId, (onChange) => subscribeToApplicationsList(schoolId, onChange));

export const useLiveTicketThreadUpdates = (ticketId) =>
  useRealtimeCounter(ticketId, (onChange) => subscribeToTicketThread(ticketId, onChange));

export const LiveUpdateBanner = ({ count, onReload, label }) => {
  const [spinning, setSpinning] = useState(false);

  if (!count) return null;

  const handleReload = () => {
    setSpinning(true);
    onReload();
    window.setTimeout(() => setSpinning(false), 600);
  };

  return (
    <div className="live-update-banner">
      <span>{label || `${count} new update${count === 1 ? "" : "s"}`}</span>
      <button type="button" className="live-update-btn" onClick={handleReload}>
        <span className={`live-update-icon${spinning ? " spinning" : ""}`}>
          <Icon icon={refreshCw} size={15} />
        </span>
        {"Reload"}
      </button>
    </div>
  );
};
