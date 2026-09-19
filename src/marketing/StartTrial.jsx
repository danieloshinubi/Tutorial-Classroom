import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { checkSlugAvailable, startTrialSchool } from "../lib/marketingApi";
import { schoolUrl } from "../lib/tenant";
import { Mark } from "../Components/Logo";

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40);

const StartTrial = () => {
  const { user, signUp, signIn } = useAuth();

  const [form, setForm] = useState({
    schoolName: "", slug: "", firstName: "", surname: "", email: "", password: "",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState(null); // null | "checking" | "ok" | "taken" | "invalid"
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const checkRef = useRef(0);

  const update = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "schoolName" && !slugTouched) next.slug = slugify(value);
      return next;
    });
  };

  useEffect(() => {
    const candidate = form.slug;
    if (!candidate) { setSlugStatus(null); return; }
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(candidate)) {
      setSlugStatus("invalid");
      return;
    }
    const myCheck = ++checkRef.current;
    setSlugStatus("checking");
    const t = setTimeout(async () => {
      try {
        const available = await checkSlugAvailable(candidate);
        if (checkRef.current === myCheck) setSlugStatus(available ? "ok" : "taken");
      } catch {
        if (checkRef.current === myCheck) setSlugStatus(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form.slug]);

  // The session just created lives on this origin (schoolivio.com) — it
  // cannot follow across to the new school's own subdomain, browser storage
  // being scoped per-origin. Land them on that school's sign-in instead of a
  // /Dashboard they have no session for, with the email prefilled and a
  // one-time welcome note. Never carries the password.
  const goToNewSchool = () => {
    const q = new URLSearchParams({ email: form.email.trim(), welcome: "1" });
    window.location.href = `${schoolUrl(form.slug)}/Login?${q.toString()}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.schoolName.trim()) return setError("Give your school a name.");
    if (slugStatus !== "ok") return setError("Choose an available subdomain first.");

    setSubmitting(true);
    try {
      // Already signed in (came back to finish, or started a second school)
      // — skip straight to creating the school under this account.
      if (user) {
        await startTrialSchool({ name: form.schoolName.trim(), slug: form.slug });
        goToNewSchool();
        return;
      }

      if (!form.firstName.trim() || !form.surname.trim()) {
        setSubmitting(false);
        return setError("Your first and last name are both required.");
      }
      if (!form.email.trim()) {
        setSubmitting(false);
        return setError("An email address is required.");
      }
      if (form.password.length < 6) {
        setSubmitting(false);
        return setError("Password must be at least 6 characters.");
      }

      const result = await signUp({
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        username: form.email.trim().split("@")[0],
        role: "student",
      });

      if (!result.session) {
        // Email confirmation is switched on for this project — nothing more
        // can happen until that's done. Once confirmed, signing in here and
        // submitting again finishes creating the school (the `user` branch
        // above handles that second pass).
        setAwaitingConfirm(true);
        setSubmitting(false);
        return;
      }

      await startTrialSchool({ name: form.schoolName.trim(), slug: form.slug });
      goToNewSchool();
    } catch (err) {
      setError(err.message || "Could not start your trial. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (awaitingConfirm) {
    return (
      <div className="mkt mkt-auth-shell">
        <div className="mkt-auth-card">
          <Mark size={34} />
          <h1>{"Check your email"}</h1>
          <p className="lede">
            {`We sent a confirmation link to ${form.email}. Once you've confirmed it, sign in below and we'll finish creating ${form.schoolName || "your school"}.`}
          </p>
          <button type="button" className="mkt-btn mkt-btn-primary" style={{ width: "100%" }}
            onClick={async () => {
              setError("");
              try {
                await signIn({ email: form.email.trim(), password: form.password });
                setAwaitingConfirm(false);
              } catch (err) {
                setError(err.message || "Not confirmed yet — check your email first.");
              }
            }}>
            {"I've confirmed — sign me in"}
          </button>
          {error ? <div className="mkt-error" style={{ marginTop: 14 }}>{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mkt mkt-auth-shell">
      <div className="mkt-auth-card">
        <Link to="/" className="mkt-back-link">{"← Back to schoolivio.com"}</Link>
        <Mark size={34} />
        <h1>{user ? "Start another school" : "Start your 45-day free trial"}</h1>
        <p className="lede">
          {user
            ? "You're signed in — just name the school and pick its address."
            : "No credit card needed. You'll be the school's owner from the moment it's created."}
        </p>

        {error ? <div className="mkt-error">{error}</div> : null}

        <form onSubmit={submit}>
          <div className="mkt-field">
            <label>{"School name"}</label>
            <input value={form.schoolName} onChange={update("schoolName")} placeholder="Jane-Nath College" />
          </div>

          <div className="mkt-field">
            <label>{"Your school's address"}</label>
            <div className="mkt-slug-row">
              <input
                value={form.slug}
                onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: slugify(e.target.value) })); }}
                placeholder="jane-nath"
              />
              <span className="mkt-slug-suffix">{".schoolivio.com"}</span>
            </div>
            {slugStatus === "checking" ? <p className="mkt-hint muted">{"Checking..."}</p> : null}
            {slugStatus === "ok" ? <p className="mkt-hint ok">{"Available"}</p> : null}
            {slugStatus === "taken" ? <p className="mkt-hint bad">{"That address is already taken"}</p> : null}
            {slugStatus === "invalid" ? <p className="mkt-hint bad">{"Lowercase letters, numbers and hyphens only, 3+ characters"}</p> : null}
          </div>

          {!user ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="mkt-field">
                  <label>{"First name"}</label>
                  <input value={form.firstName} onChange={update("firstName")} />
                </div>
                <div className="mkt-field">
                  <label>{"Surname"}</label>
                  <input value={form.surname} onChange={update("surname")} />
                </div>
              </div>
              <div className="mkt-field">
                <label>{"Email"}</label>
                <input type="email" value={form.email} onChange={update("email")} placeholder="you@example.com" />
              </div>
              <div className="mkt-field">
                <label>{"Password"}</label>
                <input type="password" value={form.password} onChange={update("password")} placeholder="At least 6 characters" />
              </div>
            </>
          ) : null}

          <button type="submit" className="mkt-btn mkt-btn-primary" style={{ width: "100%" }} disabled={submitting}>
            {submitting ? "Creating your school..." : "Create my school's workspace"}
          </button>
        </form>

        {!user ? (
          <p style={{ fontSize: 13, color: "#8a839c", marginTop: 18, textAlign: "center" }}>
            {"Already have a Schoolivio account? "}
            <a href="#signin" onClick={async (e) => {
              e.preventDefault();
              setError("");
              if (!form.email.trim() || !form.password) {
                return setError("Enter your email and password above, then click this link again.");
              }
              try {
                await signIn({ email: form.email.trim(), password: form.password });
              } catch (err) {
                setError(err.message || "Could not sign in.");
              }
            }}>{"Sign in instead"}</a>
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default StartTrial;
