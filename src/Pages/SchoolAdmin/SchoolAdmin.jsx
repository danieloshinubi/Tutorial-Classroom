import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import LevelsPanel from "./LevelsPanel";
import GuardiansPanel from "./GuardiansPanel";
import {
  fetchSchoolMembers,
  updateMemberRole,
  setMemberActive,
  removeMember,
  inviteSchoolUser,
  updateSchool,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  Tabs,
  displayName,
  initials,
  formatDate,
} from "../../Components/UI";

const ROLES = [
  ["owner", "Proprietor"],
  ["admin", "Administrator"],
  ["bursar", "Bursar"],
  ["admissions", "Admissions"],
  ["teacher", "Teacher"],
  ["student", "Student"],
  ["parent", "Parent"],
];

const ROLE_LABEL = Object.fromEntries(ROLES);

const toneFor = (role) => {
  if (role === "owner" || role === "admin") return "danger";
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
      const result = await inviteSchoolUser({ schoolId, ...invite });
      // Say what actually happened, including when the email did not go out —
      // otherwise an administrator waits for a message that never arrives.
      const who = `${invite.email} was added as ${ROLE_LABEL[invite.role]}.`;
      setNotice(
        result?.emailed === false
          ? `${who} The email could not be sent, so ask them to use "Forgot password" to set one.`
          : `${who} They have been emailed a link to set their password.`
      );
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
      await updateMemberRole({ memberId: row.id, role });
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
      await setMemberActive({ memberId: row.id, isActive: !row.is_active });
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
      await removeMember(row.id);
      load();
    } catch (err) {
      setError(err.message || "Could not remove that person.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div className="btn-row">
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="select"
            style={{ width: "auto" }}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">{`All roles (${members.length})`}</option>
            {ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {`${label} (${counts[value] || 0})`}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant={showInvite ? "secondary" : "primary"}
          onClick={() => setShowInvite((open) => !open)}
        >
          {showInvite ? "Cancel" : "Add someone"}
        </Button>
      </div>

      {showInvite ? (
        <Card style={{ marginBottom: 18, maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>{"Add someone to this school"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 0 }}>
            {"They receive an invitation and choose their own password. You never see it."}
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
              <select
                className="select"
                value={invite.role}
                onChange={(e) => setInvite((c) => ({ ...c, role: e.target.value }))}
              >
                {ROLES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Button type="submit" disabled={inviting}>
              {inviting ? "Adding..." : "Send invitation"}
            </Button>
          </form>
        </Card>
      ) : null}

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

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
                          <select
                            className="select"
                            style={{ width: "auto", padding: "6px 8px" }}
                            value={row.role}
                            disabled={busyId === row.id}
                            onChange={(e) => changeRole(row, e.target.value)}
                          >
                            {ROLES.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                        {formatDate(row.created_at, { withTime: false })}
                      </td>
                      <td>
                        <span className="btn-row">
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
        <Field label="Logo URL" hint="Shown in the navigation bar and on report cards.">
          <input className="input" value={form.logo_url} onChange={update("logo_url")} placeholder="https://..." />
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

const SchoolAdmin = () => {
  const { school } = useSchool();
  const [tab, setTab] = useState("people");

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="School administration"
        subtitle={school ? `${school.name} · ${school.slug}.schoolivio.com` : ""}
      >
        <Tabs
          tabs={[
            { id: "people", label: "People" },
            { id: "levels", label: "Class levels" },
            { id: "guardians", label: "Parents & children" },
            { id: "settings", label: "School settings" },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab === "people" ? <PeoplePanel /> : null}
        {tab === "levels" ? <LevelsPanel /> : null}
        {tab === "guardians" ? <GuardiansPanel /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
      </Page>
    </div>
  );
};

export default SchoolAdmin;
