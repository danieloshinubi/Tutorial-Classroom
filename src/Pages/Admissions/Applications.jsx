import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApplicantShell } from "../../Components/ApplicantShell";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import { useActionFeedback } from "../../Components/Toast";
import {
  fetchMyApplications,
  fetchMyApplicantAccount,
} from "../../lib/api";
import {
  Page,
  Card,
  Grid,
  Button,
  Badge,
  Empty,
  formatDate,
  SkeletonCards,
} from "../../Components/UI";

// One row per application the signed-in applicant holds against this
// school. The list is deliberately separate from the tenant's normal
// dashboard, because an applicant is not yet a member — and, following that
// through properly, it resolves the school itself the non-member-safe way
// (public_school()) rather than through useSchool(), which depends on
// membership the applicant will never have.
const Applications = () => {
  const [school, setSchool] = useState(null);
  const schoolId = school?.id || null;
  const [account, setAccount] = useState(null);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [acct, apps] = await Promise.all([
        fetchMyApplicantAccount(schoolId),
        fetchMyApplications(schoolId),
      ]);
      setAccount(acct);
      setApplications(apps);
    } catch (err) {
      setError(err.message || "Could not load your applications.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    supabase
      .rpc("public_school", { target_slug: resolveSlug() })
      .then(({ data }) => {
        if (data?.length) setSchool(data[0]);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <ApplicantShell school={school} />
      <Page
        title="My applications"
        subtitle={school ? `Applications to ${school.name}` : "Applications"}
        action={
          <Link to="/Apply/Start">
            <Button>{"Start a new application"}</Button>
          </Link>
        }
      >
        {loading ? <SkeletonCards count={4} lines={2} /> : null}

        {!loading && !account ? (
          <Card style={{ maxWidth: 640 }}>
            <h3 style={{ marginTop: 0 }}>{"Create your applicant account"}</h3>
            <p style={{ marginTop: 0 }}>
              {
                "You are signed in but you don't have an applicant account for this school yet. Start an application below and we will create one at the same time."
              }
            </p>
            <Link to="/Apply/Start">
              <Button>{"Start an application"}</Button>
            </Link>
          </Card>
        ) : null}

        {!loading && applications.length === 0 && account ? (
          <Empty>{"You have not started any applications yet."}</Empty>
        ) : null}

        <Grid>
          {applications.map((app) => (
            <Link
              key={app.id}
              to={`/Applications/${app.id}`}
              className="card-link"
            >
              <Card style={{ height: "100%" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <strong>{app.reference}</strong>
                  <Badge tone={
                    app.status === "offered" ? "success" :
                    app.status === "rejected" || app.status === "declined" ? "danger" :
                    app.form_state === "action_required" ? "warn" : "brand"
                  }>
                    {app.form_state === "action_required" ? "Action required" : app.status}
                  </Badge>
                </div>
                <p style={{ marginTop: 8, marginBottom: 4 }}>
                  {app.programme_id ? "Programme application" : "Applying for admission"}
                </p>
                <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
                  {`Started ${formatDate(app.created_at)}`}
                </div>
              </Card>
            </Link>
          ))}
        </Grid>
      </Page>
    </>
  );
};

export default Applications;
