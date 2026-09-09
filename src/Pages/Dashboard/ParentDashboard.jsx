import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchChildren,
  fetchMyInvoices,
  fetchNotices,
} from "../../lib/api";
import {
  Page,
  Card,
  Grid,
  Badge,
  Button,
  Notice,
  Empty,
  displayName,
  initials,
  formatDate,
} from "../../Components/UI";

// What a parent actually came for.
//
// The generic dashboard offers courses, which a parent has no business
// joining — they are not a student and "you have not joined any courses yet"
// is a confusing thing to read about your own child. This one answers the
// three questions a parent has: how are my children doing, what do I owe, and
// what has the school said.
const ParentDashboard = () => {
  const { user, profile } = useAuth();
  const { school, schoolId } = useSchool();

  const [children, setChildren] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !schoolId) return;
    setLoading(true);
    try {
      const [kids, bills, news] = await Promise.all([
        fetchChildren(user.id).catch(() => []),
        fetchMyInvoices().catch(() => []),
        fetchNotices(schoolId).catch(() => []),
      ]);
      setChildren(kids);
      setInvoices(bills.filter((b) => b.status === "issued"));
      setNotices(news.filter((n) => n.published_at).slice(0, 3));
    } catch (err) {
      setError(err.message || "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [user, schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const owing = invoices.reduce((sum, i) => sum + Number(i.balance || 0), 0);
  const currency = school?.currency || "NGN";
  const money = (value) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      Number(value || 0)
    );

  return (
    <Page
      title={`Welcome back, ${profile ? displayName(profile) : ""}`}
      subtitle={school ? school.name : undefined}
    >
      <Notice tone="error">{error}</Notice>
      {loading ? <Empty>{"Loading..."}</Empty> : null}

      <section>
        <h2 style={{ fontSize: 19, marginTop: 8 }}>
          {children.length === 1 ? "Your child" : "Your children"}
        </h2>

        {!loading && children.length === 0 ? (
          <Empty>
            {"No children are linked to your account yet. Ask the school office to link them — they need to do it from their side."}
          </Empty>
        ) : null}

        <Grid>
          {children.map((row) => (
            <Link
              key={row.id}
              to={`/Reports/${row.student.id}`}
              className="card-link"
            >
              <Card style={{ height: "100%" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {row.student.avatar_url ? (
                    <img
                      src={row.student.avatar_url}
                      alt=""
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: "50%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <span
                      className="brand-mark"
                      style={{ width: 42, height: 42, borderRadius: "50%", fontSize: 14 }}
                    >
                      {initials(row.student)}
                    </span>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{displayName(row.student)}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {row.relationship || "Your child"}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--brand)" }}>
                  {"See their report →"}
                </div>
              </Card>
            </Link>
          ))}
        </Grid>
      </section>

      <section className="section">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 19 }}>{"Fees"}</h2>
          <Link to="/Fees">
            <Button variant="secondary" size="sm">
              {"All invoices"}
            </Button>
          </Link>
        </div>

        {!loading && invoices.length === 0 ? (
          <Empty>{"Nothing has been billed yet."}</Empty>
        ) : (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {"Outstanding"}
                </div>
                <div style={{ fontSize: 26, fontWeight: 650 }}>{money(owing)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Badge tone={owing > 0 ? "warn" : "success"}>
                  {owing > 0
                    ? `${invoices.filter((i) => Number(i.balance) > 0).length} unpaid`
                    : "all settled"}
                </Badge>
              </div>
            </div>
          </Card>
        )}
      </section>

      <section className="section">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 19 }}>{"From the school"}</h2>
          <Link to="/News">
            <Button variant="secondary" size="sm">
              {"All news"}
            </Button>
          </Link>
        </div>

        {!loading && notices.length === 0 ? (
          <Empty>{"Nothing from the school yet."}</Empty>
        ) : null}

        {notices.map((n) => (
          <Card key={n.id} style={{ marginBottom: 12 }}>
            <div className="btn-row" style={{ marginBottom: 6 }}>
              {n.is_event ? <Badge tone="success">{"event"}</Badge> : null}
              {n.pinned ? <Badge tone="brand">{"pinned"}</Badge> : null}
            </div>
            <strong>{n.title}</strong>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 6 }}>
              {formatDate(n.published_at)}
            </div>
            <p className="chat-body" style={{ margin: 0 }}>
              {n.body.length > 220 ? `${n.body.slice(0, 220)}...` : n.body}
            </p>
          </Card>
        ))}
      </section>
    </Page>
  );
};

export default ParentDashboard;
