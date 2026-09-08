import React, { useEffect, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { updateProfile } from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
} from "../../Components/UI";

const Profile = () => {
  const { profile, user, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    first_name: "",
    surname: "",
    username: "",
    bio: "",
    level_year: "",
    avatar_url: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Seed the form once the profile arrives from the auth context.
  useEffect(() => {
    if (!profile) return;
    setForm({
      first_name: profile.first_name || "",
      surname: profile.surname || "",
      username: profile.username || "",
      bio: profile.bio || "",
      level_year: profile.level_year ? String(profile.level_year) : "",
      avatar_url: profile.avatar_url || "",
    });
  }, [profile]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

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
        level_year: form.level_year ? Number(form.level_year) : null,
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
    <>
      <Navbar />
      <Page title="Your profile">
        <Card style={{ maxWidth: "620px" }}>
          <p style={{ marginTop: 0, color: "#555" }}>
            {user?.email}
            {profile ? (
              <span style={{ marginLeft: "10px" }}>
                <Badge
                  tone={
                    profile.role === "admin"
                      ? "admin"
                      : profile.role === "tutor"
                      ? "tutor"
                      : "default"
                  }
                >
                  {profile.role}
                </Badge>
              </span>
            ) : null}
          </p>

          <form onSubmit={handleSubmit}>
            <Field label="Firstname">
              <input
                className="input"
                value={form.first_name}
                onChange={update("first_name")}
              />
            </Field>
            <Field label="Surname">
              <input
                className="input"
                value={form.surname}
                onChange={update("surname")}
              />
            </Field>
            <Field label="Username">
              <input
                className="input"
                value={form.username}
                onChange={update("username")}
              />
            </Field>
            <Field label="Level" hint="Students only — leave blank if it does not apply.">
              <select
                className="select"
                value={form.level_year}
                onChange={update("level_year")}
              >
                <option value="">{"Not set"}</option>
                <option value="100">{"100"}</option>
                <option value="200">{"200"}</option>
                <option value="300">{"300"}</option>
                <option value="400">{"400"}</option>
              </select>
            </Field>
            <Field label="Avatar image URL">
              <input
                className="input"
                value={form.avatar_url}
                onChange={update("avatar_url")}
                placeholder="https://..."
              />
            </Field>
            <Field label="Bio" hint="Shown on the tutors page.">
              <textarea
                className="textarea"
                value={form.bio}
                onChange={update("bio")}
              />
            </Field>

            <Notice tone="error">{error}</Notice>
            <Notice tone="success">{notice}</Notice>

            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </Button>
          </form>
        </Card>
      </Page>
    </>
  );
};

export default Profile;
