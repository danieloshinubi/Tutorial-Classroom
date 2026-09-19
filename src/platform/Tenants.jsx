import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchTenants,
  createTenant,
  setTenantActive,
} from "../lib/platformApi";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Empty,
  formatDate,
} from "../Components/UI";
import { downloadCsv } from "../lib/csv";
import { useActionFeedback } from "../Components/Toast";

// A slug becomes a hostname, so it has to be safe to put in one.
const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const Tenants = () => {
  const [tenants, setTenants] = useState([]);
  const [query, setQuery] = useState("");
  const { setError, setNotice } = useActionFeedback();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchTenants()
      .then(setTenants)
      .catch((err) => setError(err.message || "Could not load the schools."))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tenants;
    return tenants.filter((t) =>
      [t.name, t.slug].filter(Boolean).some((v) => v.toLowerCase().includes(needle))
    );
  }, [tenants, query]);

  const add = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const finalSlug = slugTouched ? slugify(slug) : slugify(name);
    if (!name.trim() || !finalSlug) {
      setError("A school needs a name, and a slug that can live in a hostname.");
      return;
    }

    setBusy(true);
    try {
      const created = await createTenant({
        name: name.trim(),
        slug: finalSlug,
        ownerEmail: ownerEmail.trim(),
      });
      setNotice(
        `${created?.name || name} is live at ${finalSlug}.schoolivio.com.` +
          (ownerEmail.trim()
            ? ` ${ownerEmail.trim()} is its owner.`
            : " Nobody owns it yet — add an owner from the school's page.")
      );
      setName("");
      setSlug("");
      setSlugTouched(false);
      setOwnerEmail("");
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message || "Could not create that school.");
    } finally {
      setBusy(false);
    }
  };

  // Suspending a tenant locks every one of its users out, so it asks first.
  const toggle = async (tenant) => {
    const suspending = tenant.is_active;
    if (
      suspending &&
      !window.confirm(
        `Suspend ${tenant.name}? Everyone at that school loses access until it is reactivated.`
      )
    ) {
      return;
    }

    setError("");
    try {
      await setTenantActive({ id: tenant.id, isActive: !tenant.is_active });
      setTenants((current) =>
        current.map((t) =>
          t.id === tenant.id ? { ...t, is_active: !t.is_active } : t
        )
      );
    } catch (err) {
      setError(err.message || "Could not change that school.");
    }
  };

  const preview = slugTouched ? slugify(slug) : slugify(name);

  const exportCsv = () => {
    downloadCsv("schools", filtered, [
      { key: "name", label: "School" },
      { key: (t) => `${t.slug}.schoolivio.com`, label: "Address" },
      { key: (t) => t.plan || "trial", label: "Plan" },
      { key: "students", label: "Students" },
      { key: "teachers", label: "Staff" },
      { key: "courses", label: "Courses" },
      { key: (t) => formatDate(t.created_at, { withTime: false }), label: "Added" },
      { key: (t) => (t.is_active ? "active" : "suspended"), label: "Status" },
    ]);
  };

  return (
    <Page
      title="Schools"
      subtitle={`${tenants.length} tenant${tenants.length === 1 ? "" : "s"} on the platform`}
      action={
        <div className="btn-row">
          <Button variant="secondary" disabled={!filtered.length} onClick={exportCsv}>
            {"Export CSV"}
          </Button>
          <Button onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add a school"}
          </Button>
        </div>
      }
    >
      {adding ? (
        <Card style={{ marginBottom: 22 }}>
          <h3>{"A new school"}</h3>
          <form onSubmit={add}>
            <div className="split">
              <Field label="Name">
                <input
                  className="input"
                  autoFocus
                  value={name}
                  placeholder="Jane-Nath College"
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field
                label="Address"
                hint={
                  preview
                    ? `Will live at ${preview}.schoolivio.com`
                    : "Taken from the name unless you change it"
                }
              >
                <input
                  className="input"
                  value={slugTouched ? slug : preview}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value);
                  }}
                />
              </Field>
            </div>

            <Field
              label="Owner's email"
              hint="Optional. If they already have an account, this makes them the school's owner."
            >
              <input
                className="input"
                type="email"
                value={ownerEmail}
                placeholder="principal@school.com"
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
            </Field>

            <Button type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create school"}
            </Button>
          </form>
        </Card>
      ) : null}

      <div className="page-head" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search schools"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && filtered.length === 0 ? (
        <Empty>{tenants.length ? "No school matches." : "No schools yet."}</Empty>
      ) : null}

      {filtered.length ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"School"}</th>
                  <th>{"Address"}</th>
                  <th>{"Plan"}</th>
                  <th>{"People"}</th>
                  <th>{"Courses"}</th>
                  <th>{"Added"}</th>
                  <th>{"Status"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/Tenants/${t.id}`}>
                        <strong>{t.name}</strong>
                      </Link>
                    </td>
                    <td style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                      {`${t.slug}.schoolivio.com`}
                    </td>
                    <td>{t.plan || "trial"}</td>
                    <td>{`${t.students} / ${t.teachers}`}</td>
                    <td>{t.courses}</td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                      {formatDate(t.created_at, { withTime: false })}
                    </td>
                    <td>
                      <Badge tone={t.is_active ? "success" : "danger"}>
                        {t.is_active ? "active" : "suspended"}
                      </Badge>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Button
                        size="sm"
                        variant={t.is_active ? "secondary" : "primary"}
                        onClick={() => toggle(t)}
                      >
                        {t.is_active ? "Suspend" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 18 }}>
        {"People / staff counts. A school's own administrators manage their users — this console does not reach inside a tenant's day-to-day."}
      </p>
    </Page>
  );
};

export default Tenants;
