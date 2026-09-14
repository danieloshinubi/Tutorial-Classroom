import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import LevelsPanel from "./LevelsPanel";
import GuardiansPanel from "./GuardiansPanel";
import AcademicPanel from "./AcademicPanel";
import ClassesPanel from "./ClassesPanel";
import AdmissionsSettingsPanel from "./AdmissionsSettingsPanel";
import StudentRegistrationsPanel from "./StudentRegistrationsPanel";
import {
  fetchSchoolMembers,
  updateMemberRole,
  setMemberActive,
  removeMember,
  addSchoolUser,
  updateSchool,
  updateProfile,
  resetMemberPassword,
  uploadSchoolLogo,
  removeSchoolLogo,
  uploadAvatar,
  removeAvatar,
  fetchTicketMailboxes,
  connectTicketMailbox,
  setMailboxActive,
  deleteTicketMailbox,
} from "../../lib/api";
import { ImageUpload } from "../../Components/ImageUpload";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  Tabs,
  Select,
  displayName,
  initials,
  formatDate,
} from "../../Components/UI";

const ROLES = [
  ["owner", "Proprietor"],
  ["admin", "Administrator"],
  // Approves and releases results. Kept separate from Administrator on
  // purpose: whoever enters marks must not be the one who signs them off, so
  // the database refuses an approval from the person who submitted it.
  ["principal", "Principal"],
  ["bursar", "Bursar"],
  ["admissions", "Admissions"],
  ["teacher", "Teacher"],
  ["student", "Student"],
  ["parent", "Parent"],
];

const ROLE_LABEL = Object.fromEntries(ROLES);

const toneFor = (role) => {
  if (role === "owner" || role === "admin" || role === "principal") return "danger";
  if (role === "teacher") return "brand";
  if (role === "bursar" || role === "admissions") return "warn";
  return undefined;
};

/* ------------------------------------------------------------------ people */
const PeoplePanel = () => {
  const { user } = useAuth();
  const { schoolId } = useSchool();

  const [members, setMembers] = useState([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({
    email: "",
    firstName: "",
    surname: "",
    role: "student",
  });
  const [inviting, setInviting] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ first_name: "", surname: "", username: "", bio: "", avatar_url: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  // Shown once, right after creation — this is the only time the password exists
  // anywhere the administrator can see it.
  const [issued, setIssued] = useState(null);

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchSchoolMembers(schoolId)
      .then(setMembers)
      .catch((err) => setError(err.message || "Could not load the school's people."))
      .finally(() => setLoading(false));
  }, [schoolId]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter((row) => {
      if (roleFilter !== "all" && row.role !== roleFilter) return false;
      if (!needle) return true;
      return [row.profiles.first_name, row.profiles.surname, row.profiles.email]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [members, query, roleFilter]);

  const counts = useMemo(() => {
    const tally = {};
    members.forEach((row) => {
      tally[row.role] = (tally[row.role] || 0) + 1;
    });
    return tally;
  }, [members]);

  const handleInvite = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!invite.email.trim()) {
      setError("An email address is required — that is where the invitation goes.");
      return;
    }

    setInviting(true);
    try {
      const result = await addSchoolUser({ schoolId, ...invite });
      const who =
        [invite.firstName, invite.surname].filter(Boolean).join(" ") || invite.email;

      if (result.password) {
        setIssued({
          name: who,
          email: result.email,
          password: result.password,
          role: ROLE_LABEL[invite.role],
          invited: result.invited,
          emailed: result.emailed,
        });
        setNotice("");
      } else {
        setNotice(`${who} has been emailed a link to set their password.`);
      }

      setInvite({ email: "", firstName: "", surname: "", role: "student" });
      setShowInvite(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (row, role) => {
    setBusyId(row.id);
    setError("");
    try {
      await updateMemberRole({ schoolId, memberId: row.id, role });
      setNotice(`${displayName(row.profiles)} is now ${ROLE_LABEL[role]}.`);
      load();
    } catch (err) {
      setError(err.message || "Could not change that role.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (row) => {
    setBusyId(row.id);
    setError("");
    try {
      await setMemberActive({ schoolId, memberId: row.id, isActive: !row.is_active });
      load();
    } catch (err) {
      setError(err.message || "Could not update that account.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (row) => {
    if (
      !window.confirm(
        `Remove ${displayName(row.profiles)} from this school? Their login stays, but they lose all access here.`
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setError("");
    try {
      await removeMember({ memberId: row.id, schoolId });
      load();
    } catch (err) {
      setError(err.message || "Could not remove that person.");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (row) => {
    setError("");
    setNotice("");
    setEditing(row);
    setEditForm({
      first_name: row.profiles.first_name || "",
      surname: row.profiles.surname || "",
      username: row.profiles.username || "",
      bio: row.profiles.bio || "",
      avatar_url: row.profiles.avatar_url || "",
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setSavingEdit(true);
    setError("");
    try {
      await updateProfile(editing.profiles.id, editForm);
      setNotice(`${displayName(editForm)}'s details have been updated.`);
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message || "Could not save those changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResetPassword = async (row) => {
    if (
      !window.confirm(
        `Reset ${displayName(row.profiles)}'s password? Their current password stops working immediately, and they will need to choose a new one the next time they sign in.`
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await resetMemberPassword({ schoolId, userId: row.profiles.id });
      setIssued({
        kind: "reset",
        name: displayName(row.profiles),
        email: result.email || row.profiles.email,
        password: result.password,
      });
    } catch (err) {
      setError(err.message || "Could not reset that password.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {/* Searching a roster of two hundred means scrolling; the box you
          searched with has to still be there when you get to the bottom. */}
      <div className="panel-top">
        <div className="page-head">
        <div className="btn-row">
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            className="select"
            style={{ width: "auto" }}
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: "all", label: `All roles (${members.length})` },
              ...ROLES.map(([value, label]) => ({
                value,
                label: `${label} (${counts[value] || 0})`,
              })),
            ]}
          />
        </div>
        <Button
          variant={showInvite ? "secondary" : "primary"}
          onClick={() => setShowInvite((open) => !open)}
        >
          {showInvite ? "Cancel" : "Add someone"}
        </Button>
        </div>
      </div>

      {showInvite ? (
        <Card style={{ marginBottom: 18, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>{"Add someone to this school"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 0 }}>
            {invite.role === "parent"
              ? "Parents use their own email address, so they are sent a link and choose their own password."
              : "You will be given a password to pass on. They must replace it the first time they sign in."}
          </p>
          <form onSubmit={handleInvite}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <Field label="First name">
                <input
                  className="input"
                  value={invite.firstName}
                  onChange={(e) => setInvite((c) => ({ ...c, firstName: e.target.value }))}
                />
              </Field>
              <Field label="Surname">
                <input
                  className="input"
                  value={invite.surname}
                  onChange={(e) => setInvite((c) => ({ ...c, surname: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Email">
              <input
                required
                type="email"
                className="input"
                placeholder="name@example.com"
                value={invite.email}
                onChange={(e) => setInvite((c) => ({ ...c, email: e.target.value }))}
              />
            </Field>
            <Field label="Role">
              <Select
                className="select"
                value={invite.role}
                onChange={(v) => setInvite((c) => ({ ...c, role: v }))}
                options={ROLES.map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Button type="submit" disabled={inviting}>
              {inviting
                ? "Working..."
                : invite.role === "parent"
                ? "Send invitation"
                : "Create account"}
            </Button>
          </form>
        </Card>
      ) : null}

      {editing ? (
        <Card style={{ marginBottom: 18, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>{`Edit ${displayName(editing.profiles)}`}</h3>
          <form onSubmit={saveEdit}>
            <Field label="Photo">
              <ImageUpload
                value={editForm.avatar_url}
                onUpload={async (file) => {
                  const url = await uploadAvatar({ userId: editing.profiles.id, file });
                  setEditForm((c) => ({ ...c, avatar_url: url }));
                }}
                onRemove={async () => {
                  await removeAvatar(editForm.avatar_url);
                  setEditForm((c) => ({ ...c, avatar_url: "" }));
                }}
              />
            </Field>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <Field label="First name">
                <input
                  className="input"
                  value={editForm.first_name}
                  onChange={(e) => setEditForm((c) => ({ ...c, first_name: e.target.value }))}
                />
              </Field>
              <Field label="Surname">
                <input
                  className="input"
                  value={editForm.surname}
                  onChange={(e) => setEditForm((c) => ({ ...c, surname: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Username">
              <input
                className="input"
                value={editForm.username}
                onChange={(e) => setEditForm((c) => ({ ...c, username: e.target.value }))}
              />
            </Field>
            <Field label="Bio">
              <textarea
                className="input"
                rows={3}
                value={editForm.bio}
                onChange={(e) => setEditForm((c) => ({ ...c, bio: e.target.value }))}
              />
            </Field>
            <div className="btn-row">
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? "Saving..." : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                {"Cancel"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      {issued ? (
        <Card
          style={{
            marginBottom: 18,
            maxWidth: 640,
            background: "var(--success-soft)",
            borderColor: "transparent",
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            {issued.kind === "reset" ? `${issued.name}'s password has been reset` : `${issued.name} can now sign in`}
          </h3>
          <p style={{ fontSize: 14, marginTop: 0 }}>
            {issued.kind === "reset"
              ? "Their old password stopped working the moment this was issued. Give them this new one — they will be asked to choose their own the next time they sign in."
              : issued.emailed === false
              ? "The invitation email could not be sent — most likely the hourly limit. Give them these details instead; they will choose their own password when they sign in."
              : "Give them these details. They will be asked to choose their own password the first time they sign in."}
          </p>

          <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
            <div className="file-chip">
              <span style={{ flex: 1 }}>
                <span className="file-meta">{"Email"}</span>
                <div style={{ fontFamily: "monospace" }}>{issued.email}</div>
              </span>
            </div>
            <div className="file-chip">
              <span style={{ flex: 1 }}>
                <span className="file-meta">{"Temporary password"}</span>
                <div style={{ fontFamily: "monospace", fontSize: 17, letterSpacing: ".02em" }}>
                  {issued.password}
                </div>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(`${issued.email}  ${issued.password}`)
                    .catch(() => {})
                }
              >
                {"Copy"}
              </Button>
            </div>
          </div>

          <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 0, marginTop: 14 }}>
            {issued.kind === "reset"
              ? "This password is shown once and is not stored anywhere you can read it again. If it is lost, reset it again."
              : "This password is shown once and is not stored anywhere you can read it again. If it is lost, remove the person and add them back."}
          </p>

          <div style={{ marginTop: 14 }}>
            <Button variant="secondary" size="sm" onClick={() => setIssued(null)}>
              {"Done"}
            </Button>
          </div>
        </Card>
      ) : null}

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && filtered.length === 0 ? <Empty>{"Nobody matches."}</Empty> : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Name"}</th>
                  <th>{"Email"}</th>
                  <th>{"Role"}</th>
                  <th>{"Added"}</th>
                  <th>{""}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isSelf = row.profiles.id === user?.id;
                  return (
                    <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.5 }}>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            className="brand-mark"
                            style={{ width: 30, height: 30, borderRadius: "50%", fontSize: 12 }}
                          >
                            {initials(row.profiles)}
                          </span>
                          <span>
                            {displayName(row.profiles)}
                            {isSelf ? (
                              <span style={{ marginLeft: 8 }}>
                                <Badge tone="success">{"you"}</Badge>
                              </span>
                            ) : null}
                            {!row.is_active ? (
                              <span style={{ marginLeft: 8 }}>
                                <Badge>{"suspended"}</Badge>
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td style={{ color: "var(--ink-3)" }}>{row.profiles.email || "—"}</td>
                      <td>
                        {/* Changing your own role away from admin would lock
                            you out of this page, so it is fixed for yourself. */}
                        {isSelf ? (
                          <Badge tone={toneFor(row.role)}>{ROLE_LABEL[row.role]}</Badge>
                        ) : (
                          <Select
                            className="select"
                            style={{ width: "auto", padding: "6px 8px" }}
                            value={row.role}
                            disabled={busyId === row.id}
                            onChange={(v) => changeRole(row, v)}
                            options={ROLES.map(([value, label]) => ({ value, label }))}
                          />
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                        {formatDate(row.created_at, { withTime: false })}
                      </td>
                      <td>
                        <span className="btn-row" style={{ flexWrap: "wrap" }}>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => startEdit(row)}
                          >
                            {"Edit"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isSelf || busyId === row.id}
                            onClick={() => handleResetPassword(row)}
                          >
                            {"Reset password"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isSelf || busyId === row.id}
                            onClick={() => toggleActive(row)}
                          >
                            {row.is_active ? "Suspend" : "Restore"}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={isSelf || busyId === row.id}
                            onClick={() => handleRemove(row)}
                          >
                            {"Remove"}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
};

/* ---------------------------------------------------------------- settings */
const SettingsPanel = () => {
  const { school, reload } = useSchool();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    logo_url: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!school) return;
    setForm({
      name: school.name || "",
      email: school.email || "",
      phone: school.phone || "",
      address: school.address || "",
      logo_url: school.logo_url || "",
    });
  }, [school]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      await updateSchool(school.id, {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        logo_url: form.logo_url.trim() || null,
      });
      await reload();
      setNotice("School details saved.");
    } catch (err) {
      setError(err.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  if (!school) return <Empty>{"Loading..."}</Empty>;

  return (
    <Card style={{ maxWidth: 620 }}>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 14 }}>
        {"This school lives at "}
        <code>{`${school.slug}.schoolivio.com`}</code>
        {". The address cannot be changed here — ask the platform team."}
      </p>
      <form onSubmit={handleSubmit}>
        <Field label="School name">
          <input className="input" value={form.name} onChange={update("name")} />
        </Field>
        <Field label="Contact email">
          <input type="email" className="input" value={form.email} onChange={update("email")} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={update("phone")} />
        </Field>
        <Field label="Address">
          <textarea className="textarea" style={{ minHeight: 80 }} value={form.address} onChange={update("address")} />
        </Field>
        <Field label="Logo" hint="Shown in the navigation bar and on report cards.">
          <ImageUpload
            value={form.logo_url}
            shape="square"
            onUpload={async (file) => {
              const url = await uploadSchoolLogo({ schoolId: school.id, file });
              setForm((current) => ({ ...current, logo_url: url }));
            }}
            onRemove={async () => {
              await removeSchoolLogo(form.logo_url);
              setForm((current) => ({ ...current, logo_url: "" }));
            }}
          />
        </Field>

        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{notice}</Notice>

        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </form>
    </Card>
  );
};

/* ----------------------------------------------------------------- mailboxes */
const POLL_STATUS_TONE = { ok: "success", error: "danger" };

// A school's mailbox is very often hosted on one of these even when the
// address itself is on the school's own domain (e.g. info@theschool.com
// routed through Google Workspace) — the IMAP/SMTP host/port/security a
// provider wants are public, standard facts, not something to retype from
// memory every time.
const PROVIDER_PRESETS = {
  gmail: {
    label: "Gmail / Google Workspace",
    imapHost: "imap.gmail.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.gmail.com", smtpPort: "587", smtpSecurity: "starttls",
  },
  outlook: {
    label: "Outlook.com / Hotmail (personal account)",
    imapHost: "imap-mail.outlook.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp-mail.outlook.com", smtpPort: "587", smtpSecurity: "starttls",
  },
  microsoft365: {
    label: "Microsoft 365 (work/school account)",
    imapHost: "outlook.office365.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.office365.com", smtpPort: "587", smtpSecurity: "starttls",
    hint: "Only works if your Microsoft 365 admin has turned on SMTP AUTH/IMAP for this mailbox — most organizations turn it off by default now. If connecting fails, a dedicated Microsoft 365 sign-in connection is coming soon.",
  },
  yahoo: {
    label: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.mail.yahoo.com", smtpPort: "465", smtpSecurity: "ssl",
  },
  zoho: {
    label: "Zoho Mail",
    imapHost: "imap.zoho.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.zoho.com", smtpPort: "465", smtpSecurity: "ssl",
  },
  icloud: {
    label: "iCloud Mail",
    imapHost: "imap.mail.me.com", imapPort: "993", imapSecurity: "ssl",
    smtpHost: "smtp.mail.me.com", smtpPort: "587", smtpSecurity: "starttls",
  },
};

const EMPTY_SERVER_FIELDS = { imapHost: "", imapPort: "993", imapSecurity: "ssl", smtpHost: "", smtpPort: "587", smtpSecurity: "starttls" };

const ConnectMailboxForm = ({ schoolId, onConnected, onCancel }) => {
  // Two distinct, equally-visible ways in — not one hidden behind the
  // other. "App password" picks a known provider and fills in its server
  // settings; "SMTP / IMAP details" is for anything else, filled in by hand.
  const [method, setMethod] = useState("app_password");
  const [provider, setProvider] = useState("gmail");
  const [form, setForm] = useState({
    label: "Support",
    address: "",
    displayName: "",
    ...PROVIDER_PRESETS.gmail,
    username: "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm((c) => ({ ...c, [field]: e.target.value }));

  // Most providers want the full email address as the username — filled in
  // automatically until the admin types a username of their own.
  const [usernameTouched, setUsernameTouched] = useState(false);
  const setAddress = (e) => {
    const value = e.target.value;
    setForm((c) => ({ ...c, address: value, username: usernameTouched ? c.username : value }));
  };
  const setUsername = (e) => {
    setUsernameTouched(true);
    setForm((c) => ({ ...c, username: e.target.value }));
  };

  const applyProvider = (key) => {
    const preset = PROVIDER_PRESETS[key];
    setForm((c) => ({
      ...c,
      imapHost: preset.imapHost, imapPort: preset.imapPort, imapSecurity: preset.imapSecurity,
      smtpHost: preset.smtpHost, smtpPort: preset.smtpPort, smtpSecurity: preset.smtpSecurity,
    }));
  };

  const pickProvider = (key) => {
    setProvider(key);
    applyProvider(key);
  };

  const pickMethod = (key) => {
    setMethod(key);
    if (key === "app_password") applyProvider(provider);
    else setForm((c) => ({ ...c, ...EMPTY_SERVER_FIELDS }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.address.trim() || !form.imapHost.trim() || !form.smtpHost.trim() || !form.username.trim() || !form.password) {
      setError(
        method === "smtp"
          ? "The address, IMAP host, SMTP host, username and password are all required."
          : "The address, username and app password are all required."
      );
      return;
    }
    setSaving(true);
    try {
      await connectTicketMailbox({
        schoolId,
        label: form.label.trim(),
        address: form.address.trim(),
        displayName: form.displayName.trim(),
        provider: "imap_smtp",
        imapHost: form.imapHost.trim(),
        imapPort: Number(form.imapPort) || 993,
        imapSecurity: form.imapSecurity,
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort) || 587,
        smtpSecurity: form.smtpSecurity,
        username: form.username.trim(),
        password: form.password,
      });
      onConnected();
    } catch (err) {
      setError(err.message || "Could not connect that mailbox.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ marginBottom: 18, maxWidth: 640 }}>
      <h3 style={{ marginTop: 0 }}>{"Connect a mailbox"}</h3>
      <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 0 }}>
        {"Two ways to connect, side by side — pick whichever matches what you have: a known provider and its app password, or your mail server's own SMTP/IMAP details."}
      </p>
      <div style={{ marginBottom: 16 }}>
        <Tabs
          tabs={[
            { id: "app_password", label: "App password" },
            { id: "smtp", label: "SMTP / IMAP details" },
          ]}
          active={method}
          onChange={pickMethod}
        />
      </div>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="Label" hint="Shown to staff if there's more than one mailbox.">
            <input className="input" value={form.label} onChange={set("label")} />
          </Field>
          <Field label="Address">
            <input className="input" type="email" placeholder="info@yourschool.com" value={form.address} onChange={setAddress} />
          </Field>
        </div>

        {method === "app_password" ? (
          <Field label="Provider" hint={PROVIDER_PRESETS[provider].hint || "Fills in the server settings below — check them against your provider if a field looks wrong."}>
            <Select
              className="select"
              value={provider}
              onChange={pickProvider}
              options={Object.entries(PROVIDER_PRESETS).map(([key, preset]) => ({ value: key, label: preset.label }))}
            />
          </Field>
        ) : null}

        <Field label="Display name" hint="How the school's name shows up in a recipient's inbox.">
          <input className="input" placeholder="Jane-Nath College Support" value={form.displayName} onChange={set("displayName")} />
        </Field>

        {method === "smtp" ? (
          <div className="split" style={{ marginTop: 6 }}>
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 13.5 }}>{"Incoming (IMAP)"}</h4>
              <Field label="Host">
                <input className="input" placeholder="mail.yourprovider.com" value={form.imapHost} onChange={set("imapHost")} />
              </Field>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <Field label="Port">
                  <input className="input" value={form.imapPort} onChange={set("imapPort")} />
                </Field>
                <Field label="Security">
                  <Select
                    className="select"
                    value={form.imapSecurity}
                    onChange={(v) => setForm((c) => ({ ...c, imapSecurity: v }))}
                    options={[
                      { value: "ssl", label: "SSL/TLS" },
                      { value: "starttls", label: "STARTTLS" },
                      { value: "none", label: "None" },
                    ]}
                  />
                </Field>
              </div>
            </div>
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: 13.5 }}>{"Outgoing (SMTP)"}</h4>
              <Field label="Host">
                <input className="input" placeholder="mail.yourprovider.com" value={form.smtpHost} onChange={set("smtpHost")} />
              </Field>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <Field label="Port">
                  <input className="input" value={form.smtpPort} onChange={set("smtpPort")} />
                </Field>
                <Field label="Security">
                  <Select
                    className="select"
                    value={form.smtpSecurity}
                    onChange={(v) => setForm((c) => ({ ...c, smtpSecurity: v }))}
                    options={[
                      { value: "starttls", label: "STARTTLS" },
                      { value: "ssl", label: "SSL/TLS" },
                      { value: "none", label: "None" },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "6px 0 14px" }}>
            {`Using ${form.imapHost} (IMAP) and ${form.smtpHost} (SMTP) — the standard settings for ${PROVIDER_PRESETS[provider].label}.`}
          </p>
        )}

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 6 }}>
          <Field label="Username" hint="Usually the full email address.">
            <input className="input" value={form.username} onChange={setUsername} />
          </Field>
          <Field
            label={method === "smtp" ? "Password" : "App password"}
            hint={method === "smtp" ? "Whatever this mailbox's own IMAP/SMTP login expects." : "Not your everyday password — this provider issues a separate app password for this."}
          >
            <input className="input" type="password" value={form.password} onChange={set("password")} />
          </Field>
        </div>

        <Notice tone="error">{error}</Notice>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <Button type="submit" disabled={saving}>{saving ? "Connecting..." : "Connect mailbox"}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>{"Cancel"}</Button>
        </div>
      </form>
    </Card>
  );
};

const MailboxesPanel = () => {
  const { schoolId } = useSchool();
  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [showConnect, setShowConnect] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchTicketMailboxes(schoolId)
      .then(setMailboxes)
      .catch((err) => setError(err.message || "Could not load connected mailboxes."))
      .finally(() => setLoading(false));
  }, [schoolId]);

  useEffect(load, [load]);

  const toggleActive = async (row) => {
    setBusyId(row.id);
    setError("");
    try {
      await setMailboxActive({ id: row.id, isActive: !row.is_active, schoolId });
      load();
    } catch (err) {
      setError(err.message || "Could not update that mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (row) => {
    if (!window.confirm(`Disconnect ${row.address}? Tickets already raised from it stay put — only new mail stops coming in.`)) return;
    setBusyId(row.id);
    setError("");
    try {
      await deleteTicketMailbox(row.id, schoolId);
      load();
    } catch (err) {
      setError(err.message || "Could not disconnect that mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 14, maxWidth: 560 }}>
          {"Connect the school's own support mailbox so an email in becomes a ticket, and a staff reply goes out as a real email — see it at "}
          <code>{"Tickets"}</code>
          {"."}
        </p>
        <Button onClick={() => setShowConnect((v) => !v)}>{showConnect ? "Cancel" : "Connect a mailbox"}</Button>
      </div>

      {showConnect ? (
        <ConnectMailboxForm
          schoolId={schoolId}
          onConnected={() => {
            setShowConnect(false);
            load();
          }}
          onCancel={() => setShowConnect(false)}
        />
      ) : null}

      <Notice tone="error">{error}</Notice>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && mailboxes.length === 0 ? <Empty>{"No mailbox connected yet."}</Empty> : null}

      {mailboxes.map((mb) => (
        <Card key={mb.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600 }}>
                {mb.label}
                {!mb.is_active ? (
                  <span style={{ marginLeft: 8 }}><Badge>{"disconnected"}</Badge></span>
                ) : null}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{mb.address}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
                {mb.last_poll_at ? (
                  <>
                    {"Last checked "}
                    {formatDate(mb.last_poll_at)}
                    {mb.last_poll_status ? (
                      <span style={{ marginLeft: 6 }}>
                        <Badge tone={POLL_STATUS_TONE[mb.last_poll_status]}>{mb.last_poll_status}</Badge>
                      </span>
                    ) : null}
                    {mb.last_poll_status === "error" && mb.last_poll_error ? ` — ${mb.last_poll_error}` : ""}
                  </>
                ) : (
                  "Not checked yet."
                )}
              </div>
            </div>
            <span className="btn-row">
              <Button variant="secondary" size="sm" disabled={busyId === mb.id} onClick={() => toggleActive(mb)}>
                {mb.is_active ? "Pause" : "Resume"}
              </Button>
              <Button variant="danger" size="sm" disabled={busyId === mb.id} onClick={() => disconnect(mb)}>
                {"Disconnect"}
              </Button>
            </span>
          </div>
        </Card>
      ))}
    </>
  );
};

const SchoolAdmin = () => {
  const { school } = useSchool();
  const [tab, setTab] = useState("people");

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="School administration"
        subtitle={school ? `${school.name} · ${school.slug}.schoolivio.com` : ""}
        toolbar={
          <Tabs
            tabs={[
              { id: "people", label: "People" },
              { id: "academic", label: "Calendar" },
              { id: "classes", label: "Classes & subjects" },
              { id: "levels", label: "Classes & departments" },
              { id: "admissions", label: "Admissions settings" },
              { id: "students", label: "Students" },
              { id: "guardians", label: "Parents & children" },
              { id: "mailboxes", label: "Mailboxes" },
              { id: "settings", label: "School settings" },
            ]}
            active={tab}
            onChange={setTab}
          />
        }
      >

        {tab === "people" ? <PeoplePanel /> : null}
        {tab === "academic" ? <AcademicPanel /> : null}
        {tab === "classes" ? <ClassesPanel /> : null}
        {tab === "levels" ? <LevelsPanel /> : null}
        {tab === "admissions" ? <AdmissionsSettingsPanel /> : null}
        {tab === "students" ? <StudentRegistrationsPanel /> : null}
        {tab === "guardians" ? <GuardiansPanel /> : null}
        {tab === "mailboxes" ? <MailboxesPanel /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
      </Page>
    </div>
  );
};

export default SchoolAdmin;
