import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Field, Button, Notice } from "../Components/UI";
import { Mark } from "../Components/Logo";

// Deliberately not the school sign-in screen.
//
// That one shows the tenant's name and logo, because a parent arriving at
// jane-nath.schoolivio.com should see their school. Nobody arrives here by
// accident, and there is no school to name — so this says plainly whose
// console it is, and where to go instead if you came to the wrong address.
const PlatformLogin = () => {
  const { signIn } = useAuth();
  const inactive = new URLSearchParams(window.location.search).get("reason") === "inactivity";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }

    setBusy(true);
    try {
      await signIn({ email: email.trim(), password });
    } catch (err) {
      setError(
        /invalid login/i.test(err.message || "")
          ? "That email and password do not match."
          : err.message || "Could not sign you in."
      );
    } finally {
      setBusy(false);
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
          <p className="platform-login-panel-sub">
            {"The platform console — every school on Schoolivio, in one place."}
          </p>
          <ul className="platform-login-panel-list">
            <li><span className="platform-login-panel-dot" />{"Trials, billing and onboarding at a glance"}</li>
            <li><span className="platform-login-panel-dot" />{"Gateway and mailbox health across every school"}</li>
            <li><span className="platform-login-panel-dot" />{"A full audit trail of every action taken here"}</li>
          </ul>
        </div>
      </div>

      <div className="platform-login-right">
        <form className="platform-login-card" onSubmit={submit}>
          <h1>{"Sign in"}</h1>
          <p className="platform-login-lede">
            {"For Schoolivio staff. This console manages every school on the platform."}
          </p>

          {inactive ? (
            <Notice tone="muted">
              {"You were signed out after 7 minutes of inactivity. Sign in again to continue."}
            </Notice>
          ) : null}
          <Notice tone="error">{error}</Notice>

          <Field label="Email">
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password">
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" disabled={busy} style={{ width: "100%", marginTop: 6 }}>
            {busy ? "Signing in..." : "Sign in"}
          </Button>

          <p className="platform-login-foot">
            {"Looking for your own school? It lives at its own address — "}
            <code>{"yourschool.schoolivio.com"}</code>
            {"."}
          </p>
        </form>
      </div>
    </div>
  );
};

export default PlatformLogin;
