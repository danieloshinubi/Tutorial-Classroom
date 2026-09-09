import React, { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { eyeOff } from "react-icons-kit/feather/eyeOff";
import { eye } from "react-icons-kit/feather/eye";
import AuthLayout from "../../Components/AuthLayout";
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

        <Notice tone="error">{error}</Notice>

        <Button type="submit" className="btn-block" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <GoogleButton redirectPath={redirectTo} label="Sign in with Google" />
    </AuthLayout>
  );
};

export default Login;
