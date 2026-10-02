import React, { useEffect, useState } from "react";
import { Card, Notice, Button, Switch, Field } from "../../Components/UI";
import { useSchool } from "../../context/SchoolContext";
import { updateSchool } from "../../lib/api";

const MIN_MINUTES = 2;
const MAX_MINUTES = 240;

// The inactivity sign-out, for everyone at this school (supabase/207).
// AuthContext runs the timer; this only sets the school's policy. A warning
// still shows 30 seconds before anyone is signed out.
const SecurityPanel = () => {
  const { school, reload } = useSchool();
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState("10");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!school) return;
    setEnabled(school.idle_lockout_enabled !== false);
    setMinutes(String(school.idle_lockout_minutes ?? 10));
  }, [school]);

  const savedEnabled = school?.idle_lockout_enabled !== false;
  const savedMinutes = String(school?.idle_lockout_minutes ?? 10);
  const dirty = enabled !== savedEnabled || (enabled && minutes !== savedMinutes);

  const save = async () => {
    setError("");
    setNote("");
    const n = Number(minutes);
    if (enabled && (!Number.isInteger(n) || n < MIN_MINUTES || n > MAX_MINUTES)) {
      setError(`Choose a whole number of minutes from ${MIN_MINUTES} to ${MAX_MINUTES}.`);
      return;
    }
    setSaving(true);
    try {
      await updateSchool(school.id, {
        idle_lockout_enabled: enabled,
        ...(enabled ? { idle_lockout_minutes: n } : {}),
      });
      await reload();
      setNote(
        enabled
          ? `Saved. Anyone idle for ${n} minutes is signed out. It applies to each person the next time they load the app.`
          : "Saved. Nobody is signed out for being idle. It applies to each person the next time they load the app."
      );
    } catch (err) {
      setError(err.message || "Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ maxWidth: 640 }}>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 14 }}>
        {"A school's records include children's details, so a screen left signed in on a shared or unattended device is a risk. Choose whether idle screens sign out, and after how long. It applies to everyone at the school."}
      </p>

      <Notice tone="error">{error}</Notice>
      {note ? <Notice tone="success">{note}</Notice> : null}

      <Switch
        checked={enabled}
        onChange={(on) => { setEnabled(on); setNote(""); }}
        label="Sign people out when idle"
        hint="No mouse, keyboard, touch or scrolling for the time below. A warning shows 30 seconds before, and any movement keeps them signed in."
      />

      {enabled ? (
        <div style={{ maxWidth: 220, marginTop: 14 }}>
          <Field label="Minutes of inactivity" hint={`From ${MIN_MINUTES} to ${MAX_MINUTES}. The default is 10.`}>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              step={1}
              value={minutes}
              onChange={(e) => { setMinutes(e.target.value); setNote(""); }}
            />
          </Field>
        </div>
      ) : (
        <Notice tone="muted">{"Turned off: people stay signed in until they sign out themselves."}</Notice>
      )}

      <div className="btn-row" style={{ marginTop: 16 }}>
        <Button onClick={save} disabled={saving || !dirty}>{saving ? "Saving..." : "Save"}</Button>
      </div>
    </Card>
  );
};

export default SecurityPanel;
