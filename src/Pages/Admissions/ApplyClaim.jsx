import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import { useAuth } from "../../context/AuthContext";
import { claimApplication } from "../../lib/api";
import { Field, Button, Notice } from "../../Components/UI";

// The bridge for an application that was submitted without an account (the
// public /Apply form) — arrived at from "Check an application"'s new "Sign
// in or create an account" links. Reference + email (already known from
// that page) identify WHICH application to attach; signing up or signing in
// establishes WHO is attaching it. Once both are in hand, claim_application()
// links them and this hands off to the exact same dashboard an accounted
// applicant already has.
const ApplyClaim = () => {
  const slug = resolveSlug();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session, signUp, signIn, signOut } = useAuth();

  const [school, setSchool] = useState(null);
  const [claimRef, setClaimRef] = useState(searchParams.get("reference") || "");
  const [claimEmail, setClaimEmail] = useState(searchParams.get("email") || "");
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState({
    firstName: "",
    surname: "",
    accountEmail: searchParams.get("email") || "",
    password: "",
    confirm: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  // True the moment sign-up/sign-in on THIS page succeeds — used to skip the
  // "is this you?" confirmation only in that case. Someone who was already
  // signed in when they landed here (a shared device, a stray bookmark)
  // still sees it, since silently attaching someone else's application to
  // whatever account happens to be logged in would be a real mix-up.
  const justAuthenticatedRef = useRef(false);

  useEffect(() => {
    supabase
      .rpc("public_school", { target_slug: slug })
      .then(({ data }) => {
        if (data?.length) setSchool(data[0]);
      })
      .catch(() => {});
  }, [slug]);

  const doClaim = () => {
    if (!claimRef.trim() || !claimEmail.trim()) {
      setError("Enter both the reference and the email you applied with.");
      return;
    }
    setClaiming(true);
    setError("");
    claimApplication({ reference: claimRef.trim(), email: claimEmail.trim() })
      .then((app) => {
        navigate(`/Applications/${app.id}`, { replace: true });
      })
      .catch((err) => {
        setError(err.message || "Could not claim that application.");
      })
      .finally(() => setClaiming(false));
  };

  // Sign-up/sign-in just succeeded on this page — go straight ahead, no
  // extra click needed for what the person just explicitly asked to do.
  useEffect(() => {
    if (session && justAuthenticatedRef.current) {
      justAuthenticatedRef.current = false;
      doClaim();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSignUp = async (event) => {
    event.preventDefault();
    setError("");

    if (!claimRef.trim() || !claimEmail.trim()) {
      setError("Enter the reference and the email you applied with.");
      return;
    }
    if (!form.firstName.trim() || !form.surname.trim()) {
      setError("Your first name and surname are both required.");
      return;
    }
    if (!form.accountEmail.trim()) {
      setError("An email address is required for your account.");
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
      const username = `${form.accountEmail.split("@")[0]}-${Math.floor(Math.random() * 10000)}`;
      const result = await signUp({
        email: form.accountEmail.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        username,
        role: "student",
      });
      if (result.session) {
        justAuthenticatedRef.current = true;
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

  const handleSignIn = async (event) => {
    event.preventDefault();
    setError("");
    if (!claimRef.trim() || !claimEmail.trim()) {
      setError("Enter the reference and the email you applied with.");
      return;
    }
    if (!form.accountEmail.trim() || !form.password) {
      setError("Enter your account's email and password.");
      return;
    }

    setSubmitting(true);
    try {
      justAuthenticatedRef.current = true;
      await signIn({ email: form.accountEmail.trim(), password: form.password });
      // The effect above claims once `session` updates.
    } catch (err) {
      justAuthenticatedRef.current = false;
      setError(err.message || "Could not sign in.");
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
            {`We sent a confirmation link to ${form.accountEmail}. Click it, then come back to this page and sign in to pick up right where you left off.`}
          </p>
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <Button onClick={() => { setAwaitingConfirmation(false); setMode("signin"); }}>
              {"Go to sign in"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (claiming) {
    return (
      <div className="apply">
        <div className="apply-inner apply-done">
          <h1>{"Linking your application..."}</h1>
        </div>
      </div>
    );
  }

  // Already signed in when we got here — a shared device, a stray bookmark,
  // a browser tab left open from something else entirely. Confirm rather
  // than silently attaching this application to whichever account that is.
  if (session) {
    return (
      <div className="apply">
        <header className="apply-head">
          <div className="apply-inner">
            <h1>{"Manage your application"}</h1>
          </div>
        </header>
        <main className="apply-inner">
          <div className="card" style={{ maxWidth: 460 }}>
            <p style={{ marginTop: 0 }}>
              {`You're signed in as ${session.user?.email || "this account"}.`}
            </p>
            <p style={{ color: "var(--ink-2)", fontSize: 14 }}>
              {`Claim ${claimRef || "this application"} (${claimEmail || "—"}) under this account?`}
            </p>
            <Notice tone="error">{error}</Notice>
            <div className="btn-row">
              <Button onClick={doClaim} disabled={claiming}>{"Yes, claim it"}</Button>
              <Button variant="secondary" onClick={() => signOut()}>{"Not you? Sign out"}</Button>
            </div>
          </div>
        </main>
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
          <h1>{"Manage your application"}</h1>
          <p className="apply-lede">
            {"Sign in or create an account and we'll attach the application below to it — after that you can see full details, edit anything the school flags, and get notified the moment something changes."}
          </p>
        </div>
      </header>

      <main className="apply-inner">
        <div className="apply-grid" style={{ maxWidth: 460, marginBottom: 8 }}>
          <Field label="Reference">
            <input
              className="input"
              placeholder="JNC/2026/0007"
              value={claimRef}
              onChange={(e) => setClaimRef(e.target.value)}
            />
          </Field>
          <Field label="Email you applied with">
            <input
              type="email"
              className="input"
              value={claimEmail}
              onChange={(e) => setClaimEmail(e.target.value)}
            />
          </Field>
        </div>

        <div className="btn-row" style={{ maxWidth: 460, marginBottom: 16 }}>
          <Button
            type="button"
            size="sm"
            variant={mode === "signup" ? "primary" : "secondary"}
            onClick={() => setMode("signup")}
          >
            {"Create an account"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "signin" ? "primary" : "secondary"}
            onClick={() => setMode("signin")}
          >
            {"I already have one"}
          </Button>
        </div>

        {mode === "signup" ? (
          <form onSubmit={handleSignUp} className="apply-form" style={{ maxWidth: 460 }}>
            <div className="apply-grid">
              <Field label="First name">
                <input required className="input" value={form.firstName} onChange={update("firstName")} />
              </Field>
              <Field label="Surname">
                <input required className="input" value={form.surname} onChange={update("surname")} />
              </Field>
            </div>
            <Field label="Account email" hint="Doesn't have to be the same email you applied with.">
              <input required type="email" className="input" value={form.accountEmail} onChange={update("accountEmail")} />
            </Field>
            <Field label="Password" hint="At least 6 characters.">
              <input required type="password" className="input" value={form.password} onChange={update("password")} />
            </Field>
            <Field label="Confirm password">
              <input required type="password" className="input" value={form.confirm} onChange={update("confirm")} />
            </Field>

            <Notice tone="error">{error}</Notice>

            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating account..." : "Create account and continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="apply-form" style={{ maxWidth: 460 }}>
            <Field label="Account email">
              <input required type="email" className="input" value={form.accountEmail} onChange={update("accountEmail")} />
            </Field>
            <Field label="Password">
              <input required type="password" className="input" value={form.password} onChange={update("password")} />
            </Field>

            <Notice tone="error">{error}</Notice>

            <Button type="submit" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in and continue"}
            </Button>
          </form>
        )}

        <p style={{ marginTop: 24, fontSize: 14 }}>
          <Link to="/Apply/Status">{"Back to check an application"}</Link>
        </p>
      </main>
    </div>
  );
};

export default ApplyClaim;
