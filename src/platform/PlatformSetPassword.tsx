import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { clearPasswordChangeFlag } from "../lib/api";
import { Button, Field, Notice } from "../Components/UI";
import { Mark } from "../Components/Logo";

// The console's first sign-in on a temporary password (Team → Add someone):
// nothing else opens until it is replaced, the same rule school accounts
// follow (SetPassword.jsx). Laid out like the console's own sign-in page.
const PlatformSetPassword = () => {
  const { updatePassword, refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Choose a password of at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setSaving(true);
    try {
      await updatePassword(password);
      await clearPasswordChangeFlag();
      await refreshProfile();
    } catch (err) {
      setError((err as Error).message || "Could not set your password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="platform-login">
      <div className="platform-login-panel">
        <div className="platform-login-panel-inner">
          <div className="platform-login-panel-mark">
            <Mark size={34} tone="white" />
          </div>
          <div className="platform-login-panel-word">{"Schoolivio"}</div>
          <p className="platform-login-panel-sub">{"The platform console — every school on Schoolivio, in one place."}</p>
        </div>
      </div>

      <div className="platform-login-right">
        <form className="platform-login-card" onSubmit={submit}>
          <h1>{"Choose your password"}</h1>
          <p className="platform-login-lede">
            {"You signed in with a temporary password from the Schoolivio team. Replace it to open the console."}
          </p>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field label="New password" hint="At least 8 characters.">
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" disabled={saving} style={{ width: "100%", marginTop: 6 }}>
            {saving ? "Saving..." : "Save and continue"}
          </Button>
          <p className="platform-login-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => signOut()}>
              {"Sign out instead"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default PlatformSetPassword;
