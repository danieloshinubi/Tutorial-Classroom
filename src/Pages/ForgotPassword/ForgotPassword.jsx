import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import AuthLayout from "../../Components/AuthLayout";
import { Field, Button, Notice } from "../../Components/UI";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { sendPasswordReset } = useAuth();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordReset(email.trim());
      // Deliberately the same message whether or not the address exists, so
      // this form cannot be used to discover which emails are registered.
      setNotice("If that address has an account, a reset link is on its way.");
    } catch (err) {
      setError(err.message || "Could not send the reset link.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Forgot password" subtitle="We will email you a link to set a new one.">

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

          <Notice tone="error">{error}</Notice>
          <Notice tone="success">{notice}</Notice>

          <Button type="submit" className="btn-block" disabled={submitting}>
            {submitting ? "Sending..." : "Send reset link"}
          </Button>
        </form>

        <p className="auth-foot">
          {"Remember it? "}
          <Link to="/Login">{"Sign in"}</Link>
        </p>
    </AuthLayout>
  );
};

export default ForgotPassword;
