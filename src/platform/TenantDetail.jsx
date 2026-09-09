import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchTenant,
  fetchTenantAdmins,
  setTenantActive,
  setTenantPlan,
  PLANS,
} from "../lib/platformApi";
import {
  Page,
  Card,
  Button,
  Badge,
  Notice,
  Empty,
  formatDate,
} from "../Components/UI";
import { StatRow } from "../Components/Charts";

const Fact = ({ label, children }) =>
  children ? (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  ) : null;

// One school, in the detail a support call needs: who runs it, how much of it
// is in use, what plan it is on. Not its coursework — that belongs to the
// school, and this console has no business reading it.
const TenantDetail = () => {
  const { schoolId } = useParams();
  const [tenant, setTenant] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    Promise.all([fetchTenant(schoolId), fetchTenantAdmins(schoolId).catch(() => [])])
      .then(([t, a]) => {
        setTenant(t);
        setAdmins(a);
      })
      .catch((err) => setError(err.message || "Could not load that school."))
      .finally(() => setLoading(false));
  }, [schoolId]);

  useEffect(load, [load]);

  const changePlan = async (plan) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const updated = await setTenantPlan({ id: schoolId, plan });
      setTenant((current) => ({ ...current, plan: updated.plan }));
      setNotice(`${tenant.name} is now on the ${plan} plan.`);
    } catch (err) {
      setError(err.message || "Could not change the plan.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (
      tenant.is_active &&
      !window.confirm(
        `Suspend ${tenant.name}? Everyone at that school loses access until it is reactivated.`
      )
    ) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      await setTenantActive({ id: schoolId, isActive: !tenant.is_active });
      setTenant((current) => ({ ...current, is_active: !current.is_active }));
    } catch (err) {
      setError(err.message || "Could not change that school.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Page>
        <Empty>{"Loading school..."}</Empty>
      </Page>
    );
  }

  if (!tenant) {
    return (
      <Page title="School">
        <Notice tone="error">{error || "No such school."}</Notice>
        <Link to="/Tenants">
          <Button variant="secondary">{"All schools"}</Button>
        </Link>
      </Page>
    );
  }

  return (
    <Page
      title={tenant.name}
      subtitle={`${tenant.slug}.schoolivio.com`}
      action={
        <div className="btn-row">
          <Button
            variant={tenant.is_active ? "secondary" : "primary"}
            disabled={busy}
            onClick={toggle}
          >
            {tenant.is_active ? "Suspend" : "Reactivate"}
          </Button>
          <Link to="/Tenants">
            <Button variant="secondary">{"All schools"}</Button>
          </Link>
        </div>
      }
    >
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <Badge tone={tenant.is_active ? "success" : "danger"}>
          {tenant.is_active ? "active" : "suspended"}
        </Badge>
        <Badge>{tenant.plan || "trial"}</Badge>
        <Badge>{`since ${formatDate(tenant.created_at, { withTime: false })}`}</Badge>
      </div>

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      <StatRow
        stats={[
          { label: "Students", value: tenant.students, note: "active members" },
          { label: "Staff", value: tenant.staff, note: "teaching and admin" },
          { label: "Parents", value: tenant.parents, note: "guardian accounts" },
          { label: "Courses", value: tenant.courses, note: "not archived" },
        ]}
      />

      <div className="split" style={{ marginTop: 26 }}>
        <Card>
          <h3>{"The school"}</h3>
          <dl className="facts">
            <Fact label="Name">{tenant.name}</Fact>
            <Fact label="Address">{`${tenant.slug}.schoolivio.com`}</Fact>
            <Fact label="Email">{tenant.email}</Fact>
            <Fact label="Phone">{tenant.phone}</Fact>
            <Fact label="Currency">{tenant.currency}</Fact>
            <Fact label="Timezone">{tenant.timezone}</Fact>
            <Fact label="Applications">
              {tenant.applications === 0 ? "none yet" : String(tenant.applications)}
            </Fact>
            <Fact label="Result sheets">
              {tenant.result_sheets === 0 ? "none yet" : String(tenant.result_sheets)}
            </Fact>
            <Fact label="Last activity">
              {tenant.last_activity
                ? formatDate(tenant.last_activity)
                : "nothing recorded"}
            </Fact>
          </dl>
        </Card>

        <Card>
          <h3>{"Plan"}</h3>
          <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
            {"A plan is a platform decision. A school cannot change its own."}
          </p>
          <div className="btn-row" style={{ flexWrap: "wrap" }}>
            {PLANS.map((plan) => (
              <Button
                key={plan}
                size="sm"
                variant={tenant.plan === plan ? "primary" : "secondary"}
                disabled={busy || tenant.plan === plan}
                onClick={() => changePlan(plan)}
              >
                {plan}
              </Button>
            ))}
          </div>
        </Card>
      </div>

      <section className="section">
        <h2>{"Who runs it"}</h2>
        {admins.length === 0 ? (
          <Empty>
            {"Nobody administers this school yet — it cannot be set up until somebody does."}
          </Empty>
        ) : (
          <Card className="pad-0" style={{ padding: "4px 14px" }}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{"Name"}</th>
                    <th>{"Email"}</th>
                    <th>{"Role"}</th>
                    <th>{"Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((a) => (
                    <tr key={a.user_id}>
                      <td>
                        <strong>{a.name}</strong>
                      </td>
                      <td>
                        <a href={`mailto:${a.email}`}>{a.email}</a>
                      </td>
                      <td>{a.role}</td>
                      <td>
                        <Badge tone={a.is_active ? "success" : "danger"}>
                          {a.is_active ? "active" : "deactivated"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 24 }}>
        {"To work inside this school, sign in at "}
        <code>{`${tenant.slug}.schoolivio.com`}</code>
        {" with an account that belongs to it. This console deliberately cannot read a tenant's coursework, marks or fees."}
      </p>
    </Page>
  );
};

export default TenantDetail;
