import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { fetchAdmissionsQueues } from "../../lib/api";
import {
  Page,
  Card,
  Grid,
  Notice,
  Empty,
  Badge,
} from "../../Components/UI";

// The staff dashboard. Every queue the admissions team acts on — payment,
// documents, screening, action-required, review, interview, decision —
// comes back from admissions_queues() in one call, so the page shows work
// in the order the operations team wants to see it.
const LABELS = {
  payment:   "Payment verification",
  documents: "Documents to verify",
  screening: "Screening",
  action:    "Awaiting applicant action",
  review:    "Reviews in progress",
  interview: "Interviews scheduled",
  decision:  "Decision queue",
};

const AdmissionsQueues = () => {
  const { schoolId, school } = useSchool();
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      setGroups(await fetchAdmissionsQueues(schoolId));
    } catch (err) {
      setError(err.message || "Could not load the queues.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalOpen = Object.values(groups).reduce(
    (n, rows) => n + (rows?.length || 0),
    0
  );

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Admissions workspace"
        subtitle={school ? `Operations at ${school.name}` : "Operations"}
      >
        <Notice tone="error">{error}</Notice>

        {loading ? <Empty>{"Loading..."}</Empty> : null}

        {!loading && totalOpen === 0 ? (
          <Empty>{"Queues are empty. Nothing needs action right now."}</Empty>
        ) : null}

        {Object.keys(LABELS).map((bucket) =>
          groups[bucket]?.length ? (
            <section key={bucket} className="section">
              <div className="page-head" style={{ marginBottom: 10 }}>
                <h2>{LABELS[bucket]}</h2>
                <Badge>{`${groups[bucket].length} waiting`}</Badge>
              </div>
              <Grid>
                {groups[bucket].map((row) => (
                  <Link
                    key={`${bucket}-${row.application_id}`}
                    to={`/AdmissionsWorkspace/${row.application_id}`}
                    className="card-link"
                  >
                    <Card style={{ height: "100%" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{row.reference}</strong>
                        <Badge tone="brand">{row.status}</Badge>
                      </div>
                      <p style={{ margin: "6px 0 0" }}>{row.applicant}</p>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
                        {[
                          row.form_state !== "submitted" && row.form_state,
                          row.payment_state !== "not_required" && `pay ${row.payment_state}`,
                          row.documents_state !== "pending" && `docs ${row.documents_state}`,
                          row.screening_state !== "not_started" && `screening ${row.screening_state}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </Card>
                  </Link>
                ))}
              </Grid>
            </section>
          ) : null
        )}
      </Page>
    </div>
  );
};

export default AdmissionsQueues;
