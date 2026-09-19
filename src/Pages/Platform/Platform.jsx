import React, { useCallback, useEffect, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import {
  fetchPlatformSchools,
  createSchool,
  setSchoolActive,
} from "../../lib/api";
import { schoolUrl } from "../../lib/tenant";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Empty,
  formatDate,
} from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

// The vendor's view across every tenant. Deliberately counts only: how big a
// school is, never what is inside it. Nobody at Schoolivio needs to read a
// pupil's marks to run the business.
const Platform = () => {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", ownerEmail: "" });
  const [slugTouched, setSlugTouched] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchPlatformSchools()
      .then(setSchools)
      .catch((err) => setError(err.message || "Could not load schools."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const setName = (value) =>
    setForm((c) => ({
      ...c,
      name: value,
      slug: slugTouched ? c.slug : slugify(value),
    }));

  const handleCreate = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const slug = slugify(form.slug || form.name);
    if (!form.name.trim()) return setError("The school needs a name.");
    if (slug.length < 2) return setError("The address needs at least two characters.");
    if (schools.some((s) => s.slug === slug)) {
      return setError(`${slug}.schoolivio.com is already taken.`);
    }

    setBusy(true);
    try {
      await createSchool({
        name: form.name.trim(),
        slug,
        ownerEmail: form.ownerEmail.trim(),
      });
      setNotice(`${form.name.trim()} created at ${slug}.schoolivio.com.`);
      setForm({ name: "", slug: "", ownerEmail: "" });
      setSlugTouched(false);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message || "Could not create that school.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (school) => {
    const stopping = school.is_active;
    if (
      stopping &&
      !window.confirm(
        `Suspend ${school.name}? Everyone there loses access until it is restored. Nothing is deleted.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await setSchoolActive({ id: school.id, isActive: !school.is_active });
      load();
    } catch (err) {
      setError(err.message || "Could not update that school.");
    } finally {
      setBusy(false);
    }
  };

  const totals = schools.reduce(
    (acc, s) => ({
      schools: acc.schools + 1,
      active: acc.active + (s.is_active ? 1 : 0),
      members: acc.members + s.members,
      students: acc.students + s.students,
    }),
    { schools: 0, active: 0, members: 0, students: 0 }
  );

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Platform"
        subtitle="Every school on Schoolivio"
        action={
          <Button
            variant={showForm ? "secondary" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "New school"}
          </Button>
        }
      >
        <div className="stat-row">
          <div className="stat">
            <div className="stat-value">{totals.schools}</div>
            <div className="stat-label">{"Schools"}</div>
            <div className="stat-note">{`${totals.active} active`}</div>
          </div>
          <div className="stat">
            <div className="stat-value">{totals.members}</div>
            <div className="stat-label">{"People"}</div>
          </div>
          <div className="stat">
            <div className="stat-value">{totals.students}</div>
            <div className="stat-label">{"Students"}</div>
          </div>
        </div>

        {showForm ? (
          <Card style={{ maxWidth: 620, marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>{"Create a school"}</h3>
            <form onSubmit={handleCreate}>
              <Field label="School name">
                <input
                  className="input"
                  value={form.name}
                  placeholder="Greenfield Academy"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field
                label="Address"
                hint={`They will sign in at ${slugify(form.slug || form.name) || "your-school"}.schoolivio.com`}
              >
                <input
                  className="input"
                  value={form.slug}
                  placeholder="greenfield"
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((c) => ({ ...c, slug: e.target.value }));
                  }}
                />
              </Field>
              <Field
                label="Proprietor's email"
                hint="If that account exists it becomes the owner. Otherwise you own it and can hand it over later."
              >
                <input
                  type="email"
                  className="input"
                  value={form.ownerEmail}
                  placeholder="head@greenfield.com"
                  onChange={(e) => setForm((c) => ({ ...c, ownerEmail: e.target.value }))}
                />
              </Field>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating..." : "Create school"}
              </Button>
            </form>
          </Card>
        ) : null}

        {loading ? <Empty>{"Loading..."}</Empty> : null}
        {!loading && schools.length === 0 ? (
          <Empty>{"No schools yet."}</Empty>
        ) : null}

        {schools.length > 0 ? (
          <Card className="pad-0" style={{ padding: "4px 14px" }}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{"School"}</th>
                    <th>{"Address"}</th>
                    <th>{"People"}</th>
                    <th>{"Students"}</th>
                    <th>{"Teachers"}</th>
                    <th>{"Courses"}</th>
                    <th>{"Created"}</th>
                    <th>{""}</th>
                  </tr>
                </thead>
                <tbody>
                  {schools.map((s) => (
                    <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.55 }}>
                      <td>
                        <strong>{s.name}</strong>
                        {!s.is_active ? (
                          <span style={{ marginLeft: 8 }}>
                            <Badge tone="danger">{"suspended"}</Badge>
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <a href={schoolUrl(s.slug)} target="_blank" rel="noreferrer noopener">
                          {s.slug}
                        </a>
                      </td>
                      <td>{s.members}</td>
                      <td>{s.students}</td>
                      <td>{s.teachers}</td>
                      <td>{s.courses}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                        {formatDate(s.created_at, { withTime: false })}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant={s.is_active ? "secondary" : "primary"}
                          disabled={busy}
                          onClick={() => toggleActive(s)}
                        >
                          {s.is_active ? "Suspend" : "Restore"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </Page>
    </div>
  );
};

export default Platform;
