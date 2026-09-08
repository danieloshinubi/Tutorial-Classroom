import React, { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { eyeOff } from "react-icons-kit/feather/eyeOff";
import { eye } from "react-icons-kit/feather/eye";
import GoogleButton from "../../Components/GoogleButton";
import { useAuth } from "../../context/AuthContext";
import { Field, Button, Notice } from "../../Components/UI";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || "/Dashboard";

  // Someone who is already signed in should not sit on the login screen.
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
      setError(err.message || "Could not sign you in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{"Welcome back"}</h1>
        <p className="auth-sub">{"Sign in to your classroom"}</p>

        <form onSubmit={handleSubmit}>
          <Field label="Email">
            <input
              required
              type="email"
              className="input"
              placeholder="you@example.com"
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
                placeholder="••••••••"
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

          <div style={{ textAlign: "right", marginTop: -6, marginBottom: 14 }}>
            <Link to="/Forgot-Password" style={{ fontSize: 13.5 }}>
              {"Forgot password?"}
            </Link>
          </div>

          <Notice tone="error">{error}</Notice>

          <Button type="submit" className="btn-block" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <GoogleButton redirectPath={redirectTo} label="Sign in with Google" />

        <p className="auth-foot">
          {"Don't have an account? "}
          <Link to="/Signup">{"Sign up"}</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
