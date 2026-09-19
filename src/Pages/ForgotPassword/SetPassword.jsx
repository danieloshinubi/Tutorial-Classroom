import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { clearPasswordChangeFlag } from "../../lib/api";
import AuthLayout from "../../Components/AuthLayout";
import { Field, Button } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

// Shown the first time someone signs in with a password an administrator
// issued. There is no way past it — the account is unusable until the
// temporary password is replaced.
const SetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { setError } = useActionFeedback();
  const [saving, setSaving] = useState(false);

  const { updatePassword, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Your new password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await updatePassword(password);
      await clearPasswordChangeFlag();
      await refreshProfile();
      navigate("/Dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Could not set your password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthLayout title="Choose your password" subtitle="Your school gave you a temporary one. Replace it to finish setting up your account.">

        <form onSubmit={handleSubmit}>
          <Field label="New password" hint="At least 6 characters.">
            <input
              required
              autoFocus
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              required
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Button type="submit" className="btn-block" disabled={saving}>
            {saving ? "Saving..." : "Save and continue"}
          </Button>
        </form>

        <p className="auth-foot">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await signOut();
              navigate("/Login", { replace: true });
            }}
          >
            {"Sign out instead"}
          </button>
        </p>
    </AuthLayout>
  );
};

export default SetPassword;
