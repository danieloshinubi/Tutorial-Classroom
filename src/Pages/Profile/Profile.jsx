import React, { useEffect, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import { updateProfile, uploadAvatar, removeAvatar } from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
  displayName,
  } from "../../Components/UI";
import { ImageUpload } from "../../Components/ImageUpload";
import { useActionFeedback } from "../../Components/Toast";

const Profile = () => {
  const { profile, user, refreshProfile } = useAuth();
  const { role, school } = useSchool();
  const [form, setForm] = useState({
    first_name: "",
    surname: "",
    username: "",
    bio: "",
    avatar_url: "",
  });
  const [saving, setSaving] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  // Seed the form once the profile arrives from the auth context.
  useEffect(() => {
    if (!profile) return;
    setForm({
      first_name: profile.first_name || "",
      surname: profile.surname || "",
      username: profile.username || "",
      bio: profile.bio || "",
      avatar_url: profile.avatar_url || "",
    });
  }, [profile]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  // What the rest of the app shows for someone with no name — displayName()
  // is the single source of that fallback, so this quotes exactly what
  // colleagues actually see rather than guessing at it.
  const nameMissing = !`${form.first_name} ${form.surname}`.trim();
  const fallbackName = displayName(profile);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);

    try {
      await updateProfile(user.id, {
        first_name: form.first_name.trim(),
        surname: form.surname.trim(),
        username: form.username.trim() || null,
        bio: form.bio.trim() || null,
        avatar_url: form.avatar_url.trim() || null,
      });
      await refreshProfile();
      setNotice("Profile saved.");
    } catch (err) {
      setError(err.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="shell">
      <Navbar />
      <Page title="Your profile">
        <Card style={{ maxWidth: "620px" }}>
          <p style={{ marginTop: 0, color: "#555" }}>
            {user?.email}
            {role ? (
              <span style={{ marginLeft: "10px" }}>
                <Badge tone={role === "owner" || role === "admin" ? "danger" : role === "teacher" ? "brand" : undefined}>
                  {`${role}${school ? ` at ${school.name}` : ""}`}
                </Badge>
              </span>
            ) : null}
          </p>

          {/* A profile with no name is not a broken form, but it looks like
              one — blank boxes read as "this failed to load". It also has a
              visible consequence the person never sees explained: every name
              in the app falls back to their email address, so colleagues see
              an email where a name should be. Say both things plainly. */}
          {nameMissing ? (
            <Notice tone="warn">
              {`Your name isn't set yet, so everywhere else in the app you appear as “${fallbackName}”. Fill in your first name and surname below, then save.`}
            </Notice>
          ) : null}

          <form onSubmit={handleSubmit}>
            <Field label="Firstname">
              <input
                className="input"
                placeholder="e.g. Daniel"
                value={form.first_name}
                onChange={update("first_name")}
              />
            </Field>
            <Field label="Surname">
              <input
                className="input"
                placeholder="e.g. Oshinubi"
                value={form.surname}
                onChange={update("surname")}
              />
            </Field>
            <Field label="Username" hint="Optional — a short handle. Your name is what's shown around the app.">
              <input
                className="input"
                placeholder="Optional"
                value={form.username}
                onChange={update("username")}
              />
            </Field>
            <Field label="Photo">
              <ImageUpload
                value={form.avatar_url}
                onUpload={async (file) => {
                  const url = await uploadAvatar({ userId: user.id, file });
                  setForm((current) => ({ ...current, avatar_url: url }));
                }}
                onRemove={async () => {
                  await removeAvatar(form.avatar_url);
                  setForm((current) => ({ ...current, avatar_url: "" }));
                }}
              />
            </Field>
            <Field label="Bio" hint="Shown on the tutors page.">
              <textarea
                className="textarea"
                value={form.bio}
                onChange={update("bio")}
              />
            </Field>


            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </Button>
          </form>
        </Card>
      </Page>
    </div>
  );
};

export default Profile;
