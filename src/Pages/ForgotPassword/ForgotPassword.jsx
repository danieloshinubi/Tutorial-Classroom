import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import { sendBrandedAuthEmail } from "../../lib/api";
import AuthLayout from "../../Components/AuthLayout";
import { Field, Button } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const { setError, setNotice } = useActionFeedback();
  const [submitting, setSubmitting] = useState(false);
  // Resolved the same way AuthLayout resolves the school it shows on this
  // very page — so the reset email can go out through THIS school's own
  // connected mailbox, branded in its colour, instead of Supabase's one
  // fixed template. A school that can't be resolved (or has no mailbox)
  // isn't a blocker: sendPasswordReset below is still the fallback.
  const [schoolId, setSchoolId] = useState(null);

  useEffect(() => {
    let active = true;
    supabase
      .rpc("public_school", { target_slug: resolveSlug() })
      .then(({ data }) => {
        if (active && data?.length) setSchoolId(data[0].id);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
      if (schoolId) {
        await sendBrandedAuthEmail({ schoolId, email: email.trim(), kind: "reset" });
      } else {
        await sendPasswordReset(email.trim());
      }
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
