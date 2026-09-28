import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "react-icons-kit";
import { bell } from "react-icons-kit/feather/bell";
import { share } from "react-icons-kit/feather/share";
import { Button } from "./UI";
import { useSchool } from "../context/SchoolContext";
import { pushState, startPush, turnOnPush } from "../lib/push";
import { useActionFeedback } from "./Toast";

// Asks, once per device, to turn on notifications, from a small card rather
// than the browser's own permission box popping up unasked (which people
// reflexively block, and which iPhone refuses without a tap anyway). "Not
// now" hides it for a week. On an iPhone in Safari it explains the Home
// Screen step instead, since push only works from there.
//
// It also re-saves an already-granted device's subscription on every load,
// so a browser that rotated it quietly keeps receiving.
const DISMISS_KEY = "schoolivio.pushPromptDismissedAt";
const WEEK = 7 * 24 * 60 * 60 * 1000;

const dismissedRecently = () => {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return at && Date.now() - at < WEEK;
  } catch {
    return false;
  }
};

const PushPrompt = () => {
  const { schoolId } = useSchool();
  const [state, setState] = useState(() => pushState());
  const [hidden, setHidden] = useState(() => dismissedRecently());
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  useEffect(() => {
    if (state === "granted" && schoolId) startPush(schoolId);
    // Register the worker early even before permission, so turning on is fast.
    if (state === "default") startPush(schoolId);
  }, [state, schoolId]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Not remembered; it will ask again next time.
    }
    setHidden(true);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const result = await turnOnPush(schoolId);
      setState(result);
      if (result === "granted") setNotice("Notifications are on for this device.");
      else if (result === "denied") setError("Notifications were blocked. You can allow them in this browser's site settings, then turn them on in Account settings.");
    } catch (err) {
      setError(err.message || "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  };

  if (hidden || !schoolId) return null;
  if (state !== "default" && state !== "ios-needs-home-screen") return null;

  // Into <body>, not the page grid the navigation sits in.
  return createPortal(
    <aside className="pp-card" role="dialog" aria-label="Turn on notifications">
      <span className="pp-icon" aria-hidden="true"><Icon icon={bell} size={20} /></span>
      <div className="pp-body">
        {state === "default" ? (
          <>
            <strong>{"Get messages instantly"}</strong>
            <p>{"Turn on notifications to hear about new chats and updates on this device straight away, even when Schoolivio is closed."}</p>
            <div className="pp-actions">
              <Button size="sm" disabled={busy} onClick={turnOn}>{busy ? "Turning on..." : "Turn on"}</Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>{"Not now"}</Button>
            </div>
          </>
        ) : (
          <>
            <strong>{"Get notifications on your iPhone"}</strong>
            <ol className="pp-steps">
              <li>
                {"Tap "}
                <span className="pp-share"><Icon icon={share} size={13} /></span>
                {" Share at the bottom of Safari"}
              </li>
              <li>{"Choose Add to Home Screen"}</li>
              <li>{"Open Schoolivio from your Home Screen and turn notifications on"}</li>
            </ol>
            <div className="pp-actions">
              <Button size="sm" variant="secondary" onClick={dismiss}>{"Got it"}</Button>
            </div>
          </>
        )}
      </div>
    </aside>,
    document.body
  );
};

export default PushPrompt;
