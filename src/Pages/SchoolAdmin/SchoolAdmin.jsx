import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { edit2 } from "react-icons-kit/feather/edit2";
import { lock } from "react-icons-kit/feather/lock";
import { userX } from "react-icons-kit/feather/userX";
import { userCheck } from "react-icons-kit/feather/userCheck";
import { trash2 } from "react-icons-kit/feather/trash2";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import LevelsPanel from "./LevelsPanel";
import GuardiansPanel from "./GuardiansPanel";
import AcademicPanel from "./AcademicPanel";
import ClassesPanel from "./ClassesPanel";
import AdmissionsSettingsPanel from "./AdmissionsSettingsPanel";
import PaymentGatewaySettingsPanel from "./PaymentGatewaySettingsPanel";
import ModulesPanel from "./ModulesPanel";
import StudentRegistrationsPanel from "./StudentRegistrationsPanel";
import OrganogramPanel from "./OrganogramPanel";
import { STAFF_ROLES } from "../../lib/orgChart";
import { ROLES, ROLE_LABEL, toneFor, roleAccent } from "../../lib/roles";
import {
  fetchSchoolMembers,
  updateMemberRole,
  updateMemberManager,
  setMemberActive,
  removeMember,
  addSchoolUser,
  updateSchool,
  updateProfile,
  resetMemberPassword,
  uploadSchoolLogo,
  removeSchoolLogo,
  uploadSchoolSignature,
  removeSchoolSignature,
  uploadAvatar,
  removeAvatar,
  fetchTicketMailboxes,
  connectTicketMailbox,
  setMailboxActive,
  deleteTicketMailbox,
} from "../../lib/api";
import { ImageUpload } from "../../Components/ImageUpload";
import { ExportButton } from "../../Components/ExportButton";
import { applyTenantBranding } from "../../lib/branding";
import AdmissionLetter, { LETTER_MERGE_TAGS } from "../Admissions/AdmissionLetter";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Empty,
  Tabs,
  Select,
  displayName,
  initials,
  bandClass,
  formatDate,
  SkeletonTable,
  SkeletonText,
  SkeletonList,
} from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

const PEOPLE_EXPORT_COLUMNS = [
  { key: "profiles.first_name", label: "First name" },
  { key: "profiles.surname", label: "Surname" },
  { key: "profiles.email", label: "Email" },
  { key: "profiles.username", label: "Username" },
  { key: "role", label: "Role" },
  { key: "is_active", label: "Active" },
  { key: "created_at", label: "Joined" },
];

/* ------------------------------------------------------------------ people */
const PeoplePanel = () => {
  const { user } = useAuth();
  const { schoolId } = useSchool();

  const [members, setMembers] = useState([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const { setError, setNotice } = useActionFeedback();

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
  }, [schoolId, setError]);

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

  const changeManager = async (row, managerUserId) => {
    setBusyId(row.id);
    setError("");
    try {
      await updateMemberManager({ schoolId, memberId: row.id, managerId: managerUserId || null });
      setNotice(
        managerUserId
          ? `${displayName(row.profiles)} now reports to ${displayName(members.find((m) => m.user_id === managerUserId)?.profiles)}.`
          : `${displayName(row.profiles)} no longer has a manager set.`
      );
      load();
    } catch (err) {
      setError(err.message || "Could not set who that person reports to.");
    } finally {
      setBusyId(null);
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
        <div className="btn-row">
          <ExportButton
            columns={PEOPLE_EXPORT_COLUMNS}
            rows={filtered}
            filename={`people-${new Date().toISOString().slice(0, 10)}.csv`}
          />
          <Button
            variant={showInvite ? "secondary" : "primary"}
            onClick={() => setShowInvite((open) => !open)}
          >
            {showInvite ? "Cancel" : "Add someone"}
          </Button>
        </div>
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

      {loading ? <SkeletonTable rows={6} cols={5} /> : null}
      {!loading && filtered.length === 0 ? <Empty>{"Nobody matches."}</Empty> : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <p className="people-count">
            {`${filtered.length} of ${members.length} ${members.length === 1 ? "person" : "people"}`}
          </p>
          <div className="table-wrap">
            <table className="data people-table">
              <thead>
                <tr>
                  <th>{"Person"}</th>
                  <th>{"Role"}</th>
                  <th>{"Reports to"}</th>
                  <th>{"Added"}</th>
                  <th>{""}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isSelf = row.profiles.id === user?.id;
                  const rowBusy = busyId === row.id;
                  return (
                    <tr key={row.id} className={`people-row${row.is_active ? "" : " suspended"}`}>
                      <td>
                        <span className="people-person">
                          {row.profiles.avatar_url ? (
                            <img
                              src={row.profiles.avatar_url}
                              alt=""
                              className="people-avatar people-avatar-photo"
                            />
                          ) : (
                            <span className={`people-avatar ${bandClass(row.profiles.id || displayName(row.profiles))}`}>
                              {initials(row.profiles)}
                            </span>
                          )}
                          <span className="people-person-text">
                            <span className="people-name">
                              {displayName(row.profiles)}
                              {isSelf ? <Badge tone="success">{"you"}</Badge> : null}
                              {!row.is_active ? <Badge>{"suspended"}</Badge> : null}
                            </span>
                            <span className="people-email">{row.profiles.email || "—"}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        {/* Changing your own role away from admin would lock
                            you out of this page, so it is fixed for yourself. */}
                        {isSelf ? (
                          <Badge tone={toneFor(row.role)}>{ROLE_LABEL[row.role]}</Badge>
                        ) : (
                          <Select
                            className="select"
                            style={{ width: "auto", padding: "6px 8px", borderLeft: `3px solid ${roleAccent(row.role)}` }}
                            value={row.role}
                            disabled={rowBusy}
                            onChange={(v) => changeRole(row, v)}
                            options={ROLES.map(([value, label]) => ({ value, label }))}
                          />
                        )}
                      </td>
                      <td>
                        {/* Reporting lines are a staff concept only — a
                            student or parent has nobody to report to, and
                            can't be picked as someone else's manager
                            either (see STAFF_ROLES, shared with the org
                            chart panel so both agree on who counts). */}
                        {STAFF_ROLES.includes(row.role) ? (
                          <Select
                            className="select"
                            style={{ width: "auto", minWidth: 160, padding: "6px 8px" }}
                            value={row.manager_id || ""}
                            disabled={rowBusy}
                            onChange={(v) => changeManager(row, v)}
                            options={[
                              { value: "", label: "Not set" },
                              ...members
                                .filter((m) => m.user_id !== row.user_id && m.is_active && STAFF_ROLES.includes(m.role))
                                .map((m) => ({ value: m.user_id, label: displayName(m.profiles) })),
                            ]}
                          />
                        ) : (
                          <span style={{ color: "var(--ink-3)" }}>{"—"}</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                        {formatDate(row.created_at, { withTime: false })}
                      </td>
                      <td>
                        <span className="people-actions">
                          <button
                            type="button"
                            className="row-action-btn"
                            title="Edit"
                            aria-label={`Edit ${displayName(row.profiles)}`}
                            disabled={rowBusy}
                            onClick={() => startEdit(row)}
                          >
                            <Icon icon={edit2} size={15} />
                          </button>
                          <button
                            type="button"
                            className="row-action-btn"
                            title="Reset password"
                            aria-label={`Reset ${displayName(row.profiles)}'s password`}
                            disabled={isSelf || rowBusy}
                            onClick={() => handleResetPassword(row)}
                          >
                            <Icon icon={lock} size={15} />
                          </button>
                          <button
                            type="button"
                            className="row-action-btn"
                            title={row.is_active ? "Suspend" : "Restore"}
                            aria-label={`${row.is_active ? "Suspend" : "Restore"} ${displayName(row.profiles)}`}
                            disabled={isSelf || rowBusy}
                            onClick={() => toggleActive(row)}
                          >
                            <Icon icon={row.is_active ? userX : userCheck} size={15} />
                          </button>
                          <button
                            type="button"
                            className="row-action-btn danger"
                            title="Remove"
                            aria-label={`Remove ${displayName(row.profiles)}`}
                            disabled={isSelf || rowBusy}
                            onClick={() => handleRemove(row)}
                          >
                            <Icon icon={trash2} size={15} />
                          </button>
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
const DEFAULT_BRAND_COLOR = "#6d3fc4";
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const SettingsPanel = () => {
  const { school, reload } = useSchool();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    logo_url: "",
    theme_color: "",
    signature_url: "",
    signatory_name: "",
    signatory_title: "",
    admission_letter_offer_intro: "",
    admission_letter_enrolled_intro: "",
    admission_letter_closing: "",
  });
  const [saving, setSaving] = useState(false);
  const [previewStatus, setPreviewStatus] = useState(null);
  const { setError, setNotice } = useActionFeedback();

  useEffect(() => {
    if (!school) return;
    setForm({
      name: school.name || "",
      email: school.email || "",
      phone: school.phone || "",
      address: school.address || "",
      logo_url: school.logo_url || "",
      theme_color: school.theme_color || "",
      signature_url: school.signature_url || "",
      signatory_name: school.signatory_name || "",
      signatory_title: school.signatory_title || "",
      admission_letter_offer_intro: school.admission_letter_offer_intro || "",
      admission_letter_enrolled_intro: school.admission_letter_enrolled_intro || "",
      admission_letter_closing: school.admission_letter_closing || "",
    });
  }, [school]);

  // Live preview: recolour/re-badge this admin's own tab as they pick,
  // before Save persists anything. Reverts to the school's actual saved
  // branding on the way out — leaving the panel shouldn't leave a preview
  // stuck on screen if they never saved it.
  useEffect(() => {
    if (!school) return undefined;
    applyTenantBranding({
      name: school.name,
      logoUrl: form.logo_url,
      themeColor: form.theme_color,
    });
    return () => {
      applyTenantBranding({
        name: school.name,
        logoUrl: school.logo_url,
        themeColor: school.theme_color,
      });
    };
  }, [school, form.logo_url, form.theme_color]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const themeColor = form.theme_color.trim();
    if (themeColor && !HEX_COLOR_RE.test(themeColor)) {
      setError("Theme colour must be a hex code like #2563eb.");
      return;
    }
    setSaving(true);
    try {
      await updateSchool(school.id, {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        logo_url: form.logo_url.trim() || null,
        theme_color: themeColor || null,
        signature_url: form.signature_url.trim() || null,
        signatory_name: form.signatory_name.trim() || null,
        signatory_title: form.signatory_title.trim() || null,
        admission_letter_offer_intro: form.admission_letter_offer_intro.trim() || null,
        admission_letter_enrolled_intro: form.admission_letter_enrolled_intro.trim() || null,
        admission_letter_closing: form.admission_letter_closing.trim() || null,
      });
      await reload();
      setNotice("School details saved.");
    } catch (err) {
      setError(err.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  if (!school) return <SkeletonText lines={8} />;

  if (previewStatus) {
    const enrolled = previewStatus === "enrolled";
    return (
      <AdmissionLetter
        application={{
          reference: "SAMPLE/2026/0001",
          first_name: "Ada",
          middle_name: "",
          surname: "Okafor",
          date_of_birth: "2014-04-15",
          guardian_name: "Mr & Mrs Okafor",
          status: previewStatus,
          offer_expires_at: enrolled ? null : new Date(Date.now() + 14 * 86400000).toISOString(),
          registration_number: enrolled ? "REG-0001" : null,
          sessions: { name: "2026/2027" },
          classes: { name: "JSS 1" },
          schools: { ...school, ...form },
        }}
        onClose={() => setPreviewStatus(null)}
      />
    );
  }

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
        <Field
          label="Logo"
          hint="Replaces the Schoolivio mark everywhere this school's app shows it — the sidebar, the sign-in screen, the applicant portal, and the browser tab icon. Until one is set, Schoolivio's own mark is shown as a placeholder."
        >
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
        <Field
          label="Authorised signature"
          hint="Appears on official documents issued through the portal, starting with the admission letter, under the signatory's name and title below."
        >
          <ImageUpload
            value={form.signature_url}
            shape="square"
            onUpload={async (file) => {
              const url = await uploadSchoolSignature({ schoolId: school.id, file });
              setForm((current) => ({ ...current, signature_url: url }));
            }}
            onRemove={async () => {
              await removeSchoolSignature(form.signature_url);
              setForm((current) => ({ ...current, signature_url: "" }));
            }}
          />
        </Field>
        <Field label="Signatory name" hint="The person whose signature this is, e.g. “Adaeze Okafor”.">
          <input className="input" value={form.signatory_name} onChange={update("signatory_name")} />
        </Field>
        <Field label="Signatory title" hint="Their role, e.g. “Principal” or “Head of Admissions”.">
          <input className="input" value={form.signatory_title} onChange={update("signatory_title")} />
        </Field>

        <div style={{ margin: "18px 0 4px" }}>
          <strong style={{ fontSize: 14 }}>{"Admission letter wording"}</strong>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            {"Leave these blank and the admission letter keeps Schoolivio's own default wording. Write your own and it's used instead — everything else on the letter (the facts table, offer expiry and fee notices, and the signature above) stays the same either way."}
          </p>
          <p style={{ margin: "6px 0 0", color: "var(--ink-3)", fontSize: 12.5 }}>
            {"Available in any of the fields below: "}
            {LETTER_MERGE_TAGS.map(([tag], i) => (
              <React.Fragment key={tag}>
                {i > 0 ? ", " : ""}
                <code>{`{{${tag}}}`}</code>
              </React.Fragment>
            ))}
            {". Leave a blank line to start a new paragraph."}
          </p>
        </div>
        <Field label="Offer letter — opening paragraph" hint="Used when an applicant is offered a place.">
          <textarea
            className="textarea"
            style={{ minHeight: 100 }}
            placeholder={`Following our review of the application submitted on your behalf, we are pleased to offer {{applicant_name}} a place at {{school_name}}.`}
            value={form.admission_letter_offer_intro}
            onChange={update("admission_letter_offer_intro")}
          />
        </Field>
        <Field label="Enrolment letter — opening paragraph" hint="Used once the applicant is enrolled.">
          <textarea
            className="textarea"
            style={{ minHeight: 100 }}
            placeholder={`We are pleased to confirm that {{applicant_name}} has been enrolled at {{school_name}}.`}
            value={form.admission_letter_enrolled_intro}
            onChange={update("admission_letter_enrolled_intro")}
          />
        </Field>
        <Field label="Closing line" hint="Shared by both letters, printed just before the signature.">
          <textarea
            className="textarea"
            style={{ minHeight: 60 }}
            placeholder="We look forward to welcoming your family to the school."
            value={form.admission_letter_closing}
            onChange={update("admission_letter_closing")}
          />
        </Field>
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewStatus("offered")}>
            {"Preview offer letter"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewStatus("enrolled")}>
            {"Preview enrolment letter"}
          </Button>
        </div>

        <Field
          label="Theme colour"
          hint="Recolours buttons, active tabs, badges and highlights across this school's app — sign-in included. Leave it as Schoolivio's own purple until you'd rather match your school's colours."
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="color"
              value={HEX_COLOR_RE.test(form.theme_color) ? form.theme_color : DEFAULT_BRAND_COLOR}
              onChange={(e) => setForm((current) => ({ ...current, theme_color: e.target.value }))}
              style={{ width: 44, height: 36, padding: 2, border: "1px solid var(--line)", borderRadius: 8, background: "none", cursor: "pointer" }}
              aria-label="Theme colour"
            />
            <input
              className="input"
              style={{ maxWidth: 140 }}
              value={form.theme_color}
              onChange={update("theme_color")}
              placeholder={DEFAULT_BRAND_COLOR}
            />
            {form.theme_color ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((current) => ({ ...current, theme_color: "" }))}
              >
                {"Reset to default"}
              </Button>
            ) : null}
          </div>
        </Field>

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
  const { setError } = useActionFeedback();

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
  const { setError } = useActionFeedback();
  const [busyId, setBusyId] = useState(null);
  const [showConnect, setShowConnect] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchTicketMailboxes(schoolId)
      .then(setMailboxes)
      .catch((err) => setError(err.message || "Could not load connected mailboxes."))
      .finally(() => setLoading(false));
  }, [schoolId, setError]);

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

      {loading ? <SkeletonList rows={3} avatar={false} /> : null}
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

const TABS = ["people", "organogram", "academic", "classes", "levels", "admissions", "students", "guardians", "mailboxes", "payments", "modules", "settings"];

const SchoolAdmin = () => {
  const { school } = useSchool();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get("tab");
    return TABS.includes(requested) ? requested : "people";
  });

  // A link elsewhere in the app (e.g. "prepare items from config" finding
  // nothing configured) can point straight at a tab here via ?tab=... —
  // this keeps that landing tab in sync if the query string changes after
  // mount too, not just on the initial load.
  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested && TABS.includes(requested) && requested !== tab) {
      setTab(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const changeTab = (id) => {
    setTab(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", id);
        // A subtab param only means something on the admissions tab — drop
        // it once we're not there, so it doesn't silently reapply to the
        // wrong subtab if the admin comes back to admissions later.
        if (id !== "admissions") next.delete("subtab");
        return next;
      },
      { replace: true }
    );
  };

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
              { id: "organogram", label: "Org chart" },
              { id: "academic", label: "Calendar" },
              { id: "classes", label: "Classes & subjects" },
              { id: "levels", label: "Classes & departments" },
              { id: "admissions", label: "Admissions settings" },
              { id: "students", label: "Students" },
              { id: "guardians", label: "Parents & children" },
              { id: "mailboxes", label: "Mailboxes" },
              { id: "payments", label: "Payments" },
              { id: "modules", label: "Modules" },
              { id: "settings", label: "School settings" },
            ]}
            active={tab}
            onChange={changeTab}
          />
        }
      >

        {tab === "people" ? <PeoplePanel /> : null}
        {tab === "organogram" ? <OrganogramPanel /> : null}
        {tab === "academic" ? <AcademicPanel /> : null}
        {tab === "classes" ? <ClassesPanel /> : null}
        {tab === "levels" ? <LevelsPanel /> : null}
        {tab === "admissions" ? <AdmissionsSettingsPanel /> : null}
        {tab === "students" ? <StudentRegistrationsPanel /> : null}
        {tab === "guardians" ? <GuardiansPanel /> : null}
        {tab === "mailboxes" ? <MailboxesPanel /> : null}
        {tab === "payments" ? <PaymentGatewaySettingsPanel /> : null}
        {tab === "modules" ? <ModulesPanel /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
      </Page>
    </div>
  );
};

export default SchoolAdmin;
