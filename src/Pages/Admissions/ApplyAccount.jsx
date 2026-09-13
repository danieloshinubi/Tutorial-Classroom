import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import { useAuth } from "../../context/AuthContext";
import { Field, Button, Notice } from "../../Components/UI";

// The accounted flow's real front door. /Apply/Start (where you pick a
// session and begin the form itself) sits behind ProtectedRoute — it needs
// a real signed-in session, but nothing anywhere used to lead a fresh
// applicant to one. This page is that missing step: a small, public,
// school-scoped signup that hands straight off to /Apply/Start once it
// succeeds, rather than routing through the general tenant /Signup (which
// has its own, unrelated problem — a brand-new self-signup can never
// resolve access to the tenant it signed up on).
const ApplyAccount = () => {
  const slug = resolveSlug();
  const navigate = useNavigate();
  const { signUp, session } = useAuth();

  const [school, setSchool] = useState(null);
  const [form, setForm] = useState({
    firstName: "",
    surname: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  useEffect(() => {
    supabase
      .rpc("public_school", { target_slug: slug })
      .then(({ data }) => {
        if (data?.length) setSchool(data[0]);
      })
      .catch(() => {});
  }, [slug]);

  // Already signed in (came back from confirming an email, or just never
  // signed out) — no reason to sit on a signup form.
  useEffect(() => {
    if (session) navigate("/Apply/Start", { replace: true });
  }, [session, navigate]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!form.firstName.trim() || !form.surname.trim()) {
      setError("Your first name and surname are both required.");
      return;
    }
    if (!form.email.trim()) {
      setError("An email address is required.");
      return;
    }
    if (form.password.length < 6) {
      setError("Choose a password at least 6 characters long.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const username = `${form.email.split("@")[0]}-${Math.floor(Math.random() * 10000)}`;
      const result = await signUp({
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        username,
        role: "student",
      });

      if (result.session) {
        navigate("/Apply/Start", { replace: true });
      } else {
        setAwaitingConfirmation(true);
      }
    } catch (err) {
      setError(
        /already registered|already exists/i.test(err.message || "")
          ? "An account already exists for that email. Sign in instead."
          : err.message || "Could not create your account."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (awaitingConfirmation) {
    return (
      <div className="apply">
        <div className="apply-inner apply-done">
          <span className="apply-tick" aria-hidden="true">{"✓"}</span>
          <h1>{"Check your email"}</h1>
          <p className="apply-lede">
            {`We sent a confirmation link to ${form.email}. Click it, then come back and sign in to start your application.`}
          </p>
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <Link to="/Login" className="btn btn-primary">{"Go to sign in"}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="apply">
      <header className="apply-head">
        <div className="apply-inner">
          <div className="apply-brand">
            {school?.logo_url ? (
              <img src={school.logo_url} alt="" />
            ) : (
              <span>{(school?.name || "S").charAt(0).toUpperCase()}</span>
            )}
            <span>{school?.name || "Schoolivio"}</span>
          </div>
          <h1>{"Create your applicant account"}</h1>
          <p className="apply-lede">
            {school
              ? `Track your application to ${school.name} online, pay fees as they come up, and hear back the moment your offer changes — no need to check back by email.`
              : "Track your application online, pay fees as they come up, and hear back the moment anything changes."}
          </p>
        </div>
      </header>

      <main className="apply-inner">
        <form onSubmit={handleSubmit} className="apply-form" style={{ maxWidth: 460 }}>
          <div className="apply-grid">
            <Field label="First name">
              <input required className="input" value={form.firstName} onChange={update("firstName")} />
            </Field>
            <Field label="Surname">
              <input required className="input" value={form.surname} onChange={update("surname")} />
            </Field>
          </div>
          <Field label="Email">
            <input required type="email" className="input" value={form.email} onChange={update("email")} />
          </Field>
          <Field label="Password" hint="At least 6 characters.">
            <input required type="password" className="input" value={form.password} onChange={update("password")} />
          </Field>
          <Field label="Confirm password">
            <input required type="password" className="input" value={form.confirm} onChange={update("confirm")} />
          </Field>

          <Notice tone="error">{error}</Notice>

          <div className="apply-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating account..." : "Create account and continue"}
            </Button>
            <Link to="/Login" style={{ fontSize: 14 }}>
              {"Already have an account? Sign in"}
            </Link>
          </div>
        </form>

        <p style={{ marginTop: 24, fontSize: 14 }}>
          {"Prefer not to create an account? "}
          <Link to="/Apply">{"Apply without one"}</Link>
        </p>
      </main>
    </div>
  );
};

export default ApplyAccount;
