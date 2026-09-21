import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { eyeOff } from "react-icons-kit/feather/eyeOff";
import { eye } from "react-icons-kit/feather/eye";
import AuthLayout from "../../Components/AuthLayout";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import { fetchMySchoolMembership, fetchMyApplicantAccount, createApplicantAccount } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Field, Button } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

// A separate URL from the staff/student/parent /Login, not the same form
// wearing a different badge depending on how you arrived — that's what
// this replaced, and it broke: whatever "from" state happened to be
// sitting in browser history quietly decided the destination, so the exact
// same page could send the exact same person to their applicant portal on
// one visit and the staff Dashboard on the next, with no way to tell which
// was about to happen before clicking Sign in.
//
// It also has to REFUSE any account with no genuine applicant
// relationship to this tenant, not just route it elsewhere — a login form
// that accepts any valid credentials and calls that "an applicant is
// signed in" is wrong regardless of which page it lands on afterward.
// Two checks, in order:
//   1. school_members (fetchMySchoolMembership) — a real staff/student/
//      parent account. Always rejected here.
//   2. applicant_accounts (fetchMyApplicantAccount) — a real applicant at
//      THIS school. Missing this is normally also a rejection, EXCEPT for
//      the one legitimate case that looks identical: someone who signed
//      up moments ago at /Apply/Account, whose account is still waiting
//      on email confirmation, so the eager creation ApplyAccount.jsx
//      normally does never got to run. `pending_applicant_school_id` in
//      their auth metadata (set only by /Apply/Account, at signup, for
//      exactly this school) is what tells the two apart — an unrelated
//      account has no such marker, or one pointing at a different school.
//      When it matches, the account is created here, on the spot, instead
//      of rejecting a real first-time applicant.
const ApplicantLogin = () => {
  const { signIn, signOut, session } = useAuth();
  const navigate = useNavigate();
  const slug = resolveSlug();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const { setError } = useActionFeedback();
  const [submitting, setSubmitting] = useState(false);

  const rejectUnlessApplicant = async (user) => {
    const { data } = await supabase.rpc("public_school", { target_slug: slug });
    const schoolId = data?.length ? data[0].id : null;
    if (!schoolId) return; // Unknown slug is a different problem — not this page's to solve.

    const reject = async (message) => {
      await signOut().catch(() => {});
      throw new Error(message);
    };

    const membership = await fetchMySchoolMembership(schoolId, user.id).catch(() => null);
    if (membership) {
      await reject(
        "That account belongs to this school's staff, student or parent sign-in, not the applicant portal. Use the main sign-in page instead."
      );
    }

    const applicantAccount = await fetchMyApplicantAccount(schoolId, user.id).catch(() => null);
    if (applicantAccount) return;

    if (user.user_metadata?.pending_applicant_school_id === schoolId) {
      // Read straight from the database rather than AuthContext's `profile`
      // state, which fetches asynchronously after sign-in and may not have
      // settled yet at this point — the same class of race SchoolContext
      // hit with membership (see its own comment).
      const { data: row } = await supabase
        .from("profiles")
        .select("first_name, surname")
        .eq("id", user.id)
        .maybeSingle();
      await createApplicantAccount({
        schoolId,
        firstName: row?.first_name || "",
        surname: row?.surname || "",
        email: user.email,
      }).catch(() => {});
      return;
    }

    await reject("That account has no application with this school. Create an applicant account first.");
  };

  useEffect(() => {
    if (!session) return;
    rejectUnlessApplicant(session.user)
      .then(() => navigate("/Applications", { replace: true }))
      .catch((err) => setError(err.message || "Could not sign you in."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }

    setSubmitting(true);
    try {
      const { user } = await signIn({ email: email.trim(), password });
      await rejectUnlessApplicant(user);
      navigate("/Applications", { replace: true });
    } catch (err) {
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
      badge="Applicant sign in"
      subtitle="Sign in to continue tracking your application."
      footer={
        <>
          <p>
            {"New applicant? "}
            <Link to="/Apply/Account">{"Create an applicant account"}</Link>
          </p>
          <p>
            {"Staff, student or parent instead? "}
            <Link to="/Login">{"Sign in here"}</Link>
          </p>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Field label="Email">
          <input
            required
            autoFocus
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
    </AuthLayout>
  );
};

export default ApplicantLogin;
