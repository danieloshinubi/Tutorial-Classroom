import React, { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { eyeOff } from "react-icons-kit/feather/eyeOff";
import { eye } from "react-icons-kit/feather/eye";
import AuthLayout from "../../Components/AuthLayout";
import GoogleButton from "../../Components/GoogleButton";
import { useAuth } from "../../context/AuthContext";
import { Field, Button, Notice } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

const Login = () => {
  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // A trial signup happens on a different origin (schoolivio.com) than this
  // school's own subdomain, so the session it created can't follow across —
  // browser storage is scoped per-origin. Rather than a silent, confusing
  // bounce to a blank login screen, the handoff carries the email (never the
  // password) and a one-time welcome flag.
  const params = new URLSearchParams(location.search);

  // location.state carries an in-app link's "come back here" (e.g. ApplyAccount's
  // sign-in link). A hard navigation — the inactivity sign-out in
  // AuthContext.jsx, which has to fully reset the app — can't carry that,
  // so it passes the same thing as a ?from= query param instead. Only ever
  // trust it as a same-origin relative path: a leading "/" but never "//"
  // (browsers treat that as protocol-relative to another host), so this can
  // never become an open redirect off a crafted link.
  const fromParam = params.get("from");
  const safeFromParam = fromParam && fromParam.startsWith("/") && !fromParam.startsWith("//")
    ? fromParam
    : null;
  const redirectTo = location.state?.from?.pathname || safeFromParam || "/Dashboard";
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const { setError } = useActionFeedback();
  const [submitting, setSubmitting] = useState(false);

  // Someone already signed in should not sit on the login screen.
  useEffect(() => {
    if (session) navigate(redirectTo, { replace: true });
  }, [session, navigate, redirectTo]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }

    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // Supabase says "Invalid login credentials" for both a wrong password
      // and an unknown address. Say what to do instead of restating that.
      setError(
        /invalid login/i.test(err.message || "")
          ? "That email and password do not match. Check both, or use forgot password."
          : err.message || "Could not sign you in."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the email address your school gave you."
      footer={
        <p>
          {"New here? "}
          <Link to="/Signup">{"Create an account"}</Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit}>
        {params.get("welcome") === "1" ? (
          <Notice tone="success">
            {"Your school's workspace is ready — sign in with the password you just chose to get started."}
          </Notice>
        ) : null}
        {params.get("reason") === "inactivity" ? (
          <Notice tone="muted">
            {"You were signed out after 7 minutes of inactivity. Sign in again to continue."}
          </Notice>
        ) : null}
        <Field label="Email">
          <input
            required
            autoFocus
            type="email"
            className="input"
            placeholder="you@school.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>

        <Field label="Password">
          <span className="input-icon">
            <input
              required
              type={visible ? "text" : "password"}
              className="input"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="eye"
              aria-label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible((v) => !v)}
            >
              <Icon icon={visible ? eye : eyeOff} size={18} />
            </button>
          </span>
        </Field>

        <div className="forgot-row">
          <Link to="/Forgot-Password">{"Forgot password?"}</Link>
        </div>

        <Button type="submit" className="btn-block" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <GoogleButton redirectPath={redirectTo} label="Sign in with Google" />
    </AuthLayout>
  );
};

export default Login;