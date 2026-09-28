import React, { useEffect, useState } from "react";
import { Card, Switch, Notice } from "./UI";
import { useSchool } from "../context/SchoolContext";
import { useActionFeedback } from "./Toast";
import { pushState, isPushOnHere, turnOnPush, turnOffPush } from "../lib/push";
import { countMyPushDevices, fetchNotificationPrefs, saveNotificationPrefs } from "../lib/api";

// Account settings → Notifications: instant alerts on this device, and
// whether a chat message also emails. Push is per device (each phone or
// browser is turned on separately); the email choice follows the person.
const NotificationSettings = () => {
  const { schoolId } = useSchool();
  const { setError, setNotice } = useActionFeedback();
  const [state, setState] = useState(() => pushState());
  const [onHere, setOnHere] = useState(false);
  const [devices, setDevices] = useState(null);
  const [chatEmail, setChatEmail] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setState(pushState());
    setOnHere(await isPushOnHere());
    setDevices(await countMyPushDevices().catch(() => null));
  };

  useEffect(() => {
    refresh();
    fetchNotificationPrefs().then((p) => setChatEmail(p.chatEmail)).catch(() => {});
  }, []);

  const togglePush = async (on) => {
    setBusy(true);
    try {
      if (on) {
        const result = await turnOnPush(schoolId);
        if (result === "granted") setNotice("Notifications are on for this device.");
        else if (result === "denied") setError("This browser has blocked notifications for Schoolivio. Allow them in its site settings, then try again.");
      } else {
        await turnOffPush();
        setNotice("Notifications are off for this device.");
      }
    } catch (err) {
      setError(err.message || "Could not change notifications.");
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const toggleChatEmail = async (on) => {
    setChatEmail(on);
    try {
      await saveNotificationPrefs({ chatEmail: on });
    } catch (err) {
      setChatEmail(!on);
      setError(err.message || "Could not save that.");
    }
  };

  const others = devices != null ? Math.max(0, devices - (onHere ? 1 : 0)) : 0;

  return (
    <Card style={{ maxWidth: "620px", marginTop: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>{"Notifications"}</h3>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 13.5 }}>
        {"New chat messages and anything that needs your attention arrive as soon as they happen."}
      </p>

      {state === "ios-needs-home-screen" ? (
        <Notice tone="warn">
          {"On iPhone, notifications work once Schoolivio is on your Home Screen: tap Share in Safari, choose Add to Home Screen, then open Schoolivio from there and come back to this page."}
        </Notice>
      ) : state === "unsupported" ? (
        <Notice tone="muted">{"This browser cannot show notifications. Try Chrome, Edge, Firefox or Safari, or add Schoolivio to your phone's Home Screen."}</Notice>
      ) : (
        <Switch
          label="Notifications on this device"
          hint={
            state === "denied"
              ? "Blocked in this browser's settings. Allow notifications for this site there, then switch this on."
              : onHere
              ? "On. Chats and updates pop up here even when Schoolivio is closed."
              : "Off on this device."
          }
          checked={onHere}
          disabled={busy || state === "denied"}
          onChange={togglePush}
        />
      )}
      {others > 0 ? (
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
          {`Also on for ${others} other ${others === 1 ? "device" : "devices"}.`}
        </p>
      ) : null}

      <Switch
        label="Email me about new chat messages"
        hint="One email per conversation until you have read it, sent from your school's mailbox."
        checked={chatEmail}
        onChange={toggleChatEmail}
      />
    </Card>
  );
};

export default NotificationSettings;
