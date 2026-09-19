import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { eyeOff } from "react-icons-kit/feather/eyeOff";
import { eye } from "react-icons-kit/feather/eye";
import GoogleButton from "../../Components/GoogleButton";
import { useAuth } from "../../context/AuthContext";
import AuthLayout from "../../Components/AuthLayout";
import { Field, Button } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

// Shared by the student (/Signup) and tutor (/SignupTutor) pages — the only
// differences are the heading, the role sent to Supabase, and the footer links.
const SignupForm = ({ heading, subheading, role, footer }) => {
  const [form, setForm] = useState({
    firstName: "",
    surname: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [visible, setVisible] = useState(false);
  const { setError, setNotice } = useActionFeedback();
  const [submitting, setSubmitting] = useState(false);

  const { signUp } = useAuth();
  const navigate = useNavigate();

  const updateField = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const { firstName, surname, username, email, password, confirmPassword } = form;

    if (!firstName.trim() || !surname.trim() || !username.trim()) {
      setError("Firstname, surname and username are all required.");
      return;
    }
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
      const data = await signUp({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        surname: surname.trim(),
        username: username.trim(),
        role,
      });

      // With email confirmation switched on, Supabase returns a user but no
      // session — there is nothing to redirect to until they confirm.
      if (data.session) {
        navigate("/Dashboard", { replace: true });
      } else {
        setNotice(
          "Account created. Check your email for a confirmation link, then sign in."
        );
      }
    } catch (err) {
      setError(err.message || "Could not create your account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={heading}
      subtitle={subheading}
      footer={
        <>
          <p>
            {"Already registered? "}
            <Link to="/Login">{"Sign in"}</Link>
          </p>
          {footer}
        </>
      }
    >

        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Field label="Firstname">
              <input
                required
                className="input"
                value={form.firstName}
                onChange={updateField("firstName")}
                autoComplete="given-name"
              />
            </Field>
            <Field label="Surname">
              <input
                required
                className="input"
                value={form.surname}
                onChange={updateField("surname")}
                autoComplete="family-name"
              />
            </Field>
          </div>

          <Field label="Username">
            <input
              required
              className="input"
              value={form.username}
              onChange={updateField("username")}
              autoComplete="username"
            />
          </Field>

          <Field label="Email">
            <input
              required
              type="email"
              className="input"
              placeholder="you@example.com"
              value={form.email}
              onChange={updateField("email")}
              autoComplete="email"
            />
          </Field>

          <Field label="Password" hint="At least 6 characters.">
            <span className="input-icon">
              <input
                required
                type={visible ? "text" : "password"}
                className="input"
                value={form.password}
                onChange={updateField("password")}
                autoComplete="new-password"
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

          <Field label="Confirm password">
            <input
              required
              type={visible ? "text" : "password"}
              className="input"
              value={form.confirmPassword}
              onChange={updateField("confirmPassword")}
              autoComplete="new-password"
            />
          </Field>

          <Button type="submit" className="btn-block" disabled={submitting}>
            {submitting ? "Creating account..." : "Create account"}
          </Button>
        </form>

        {/* Google accounts always land as students — the tutor role is set by
            an admin afterwards, since anyone can sign in with Google. */}
        {role === "student" ? <GoogleButton label="Sign up with Google" /> : null}
    </AuthLayout>
  );
};

export default SignupForm;
