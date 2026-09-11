import React, { useEffect, useRef, useState } from "react";
import { subscribeToApplicationEvents } from "../lib/api";

// A small floating "N updates — reload" prompt for a page showing one
// application's live state. Rather than forcing a hard page refresh (or
// leaving the viewer to guess when to hit refresh themselves), it counts
// real-time events on that application's timeline and, on click, re-runs
// the page's own data load — the same fresh data a refresh would give,
// without losing scroll position or any in-progress form input elsewhere
// on the page.
export const useLiveApplicationUpdates = (applicationId) => {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    if (!applicationId) return undefined;
    setCount(0);
    countRef.current = 0;
    const channel = subscribeToApplicationEvents(applicationId, () => {
      countRef.current += 1;
      setCount(countRef.current);
    });
    return () => channel.unsubscribe();
  }, [applicationId]);

  const reset = () => {
    countRef.current = 0;
    setCount(0);
  };

  return { count, reset };
};

export const LiveUpdateBanner = ({ count, onReload, label }) => {
  if (!count) return null;
  return (
    <div className="live-update-banner">
      <span>
        {label || `${count} new update${count === 1 ? "" : "s"} on this application`}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={onReload}>
        {"Click to reload"}
      </button>
    </div>
  );
};
