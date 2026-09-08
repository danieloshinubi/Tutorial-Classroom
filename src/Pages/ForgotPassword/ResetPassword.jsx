import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Field, Button, Notice } from "../../Components/UI";

// Landing page for the link emailed by ForgotPassword. Supabase puts a
// recovery session in the URL, and detectSessionInUrl picks it up, so by the
// time this renders the user is authenticated well enough to set a password.
const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { updatePassword } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      setNotice("Password updated. Taking you to your dashboard...");
      setTimeout(() => navigate("/Dashboard", { replace: true }), 1200);
    } catch (err) {
      setError(err.message || "Could not update your password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{"Set a new password"}</h1>
        <p className="auth-sub">{"Choose something you have not used before."}</p>

        <form onSubmit={handleSubmit}>
          <Field label="New password">
            <input
              required
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password">
            <input
              required
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Notice tone="error">{error}</Notice>
          <Notice tone="success">{notice}</Notice>

          <Button type="submit" className="btn-block" disabled={submitting}>
            {submitting ? "Updating..." : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
