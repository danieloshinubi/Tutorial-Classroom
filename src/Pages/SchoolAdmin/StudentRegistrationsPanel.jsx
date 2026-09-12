import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSchool } from "../../context/SchoolContext";
import { fetchStudentRegistrations, updateStudentRegistration } from "../../lib/api";
import { Card, Button, Badge, Notice, Empty, formatDate, displayName } from "../../Components/UI";

const STATUS_LABEL = {
  active: "Active",
  withdrawn: "Withdrawn",
  graduated: "Graduated",
  transferred: "Transferred",
};

const STATUS_TONE = {
  active: "success",
  withdrawn: "danger",
  graduated: "brand",
  transferred: "warn",
};

// The permanent registry Phase 5 creates one row into every time an
// applicant is registered — this is where a matric number is looked up
// again months or years later, and where a standing actually changes
// (withdrawn, graduated, transferred), not just written once and forgotten.
const StudentRegistrationsPanel = () => {
  const { schoolId } = useSchool();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    fetchStudentRegistrations(schoolId)
      .then(setRows)
      .catch((err) => setError(err.message || "Could not load the register."))
      .finally(() => setLoading(false));
  }, [schoolId]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!needle) return true;
      return [displayName(r.student), r.student?.email, r.registration_number]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [rows, query, statusFilter]);

  const counts = useMemo(() => {
    const tally = {};
    rows.forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
    return tally;
  }, [rows]);

  const changeStatus = async (row, status) => {
    let notes = row.notes || "";
    if (status !== "active") {
      const reason = window.prompt(`Reason for marking ${displayName(row.student)} as ${STATUS_LABEL[status].toLowerCase()}? (optional)`, "");
      if (reason === null) return; // cancelled
      notes = reason.trim() || notes;
    }
    setBusyId(row.id);
    setError("");
    try {
      await updateStudentRegistration({ id: row.id, status, notes });
      load();
    } catch (err) {
      setError(err.message || "Could not update that registration.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "68ch" }}>
        {"Every student ever registered at this school, with the permanent registration number issued the moment they were promoted from applicant to student. Standing (active, withdrawn, graduated, transferred) is tracked here, not deleted — the number is kept for life."}
      </p>

      <Notice tone="error">{error}</Notice>

      <div className="btn-row" style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Search name, email or reg. number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select"
          style={{ width: "auto" }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">{`Everyone (${rows.length})`}</option>
          {Object.keys(STATUS_LABEL).map((s) => (
            <option key={s} value={s}>{`${STATUS_LABEL[s]} (${counts[s] || 0})`}</option>
          ))}
        </select>
      </div>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && rows.length === 0 ? (
        <Empty>{"Nobody has been registered yet — that happens from an accepted, cleared application's workspace."}</Empty>
      ) : null}
      {!loading && rows.length > 0 && filtered.length === 0 ? (
        <Empty>{"Nothing matches that search."}</Empty>
      ) : null}

      {filtered.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Reg. number"}</th>
                  <th>{"Student"}</th>
                  <th>{"Session"}</th>
                  <th>{"Class"}</th>
                  <th>{"Status"}</th>
                  <th>{"Registered"}</th>
                  <th>{""}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} style={{ opacity: r.status === "active" ? 1 : 0.7 }}>
                    <td style={{ fontFamily: "monospace", fontSize: 13, whiteSpace: "nowrap" }}>
                      {r.registration_number}
                    </td>
                    <td>
                      <strong>{displayName(r.student)}</strong>
                      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.student?.email}</div>
                    </td>
                    <td>{r.session?.name || "—"}</td>
                    <td>{r.class?.name || "Not placed"}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      {r.notes ? <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>{r.notes}</div> : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--ink-3)" }}>
                      {formatDate(r.registered_at, { withTime: false })}
                    </td>
                    <td>
                      <span className="btn-row" style={{ flexWrap: "wrap" }}>
                        {r.application_id ? (
                          <Link to={`/AdmissionsWorkspace/${r.application_id}`}>
                            <Button size="sm" variant="secondary">{"Application"}</Button>
                          </Link>
                        ) : null}
                        <select
                          className="select"
                          style={{ width: "auto", padding: "6px 8px", fontSize: 13 }}
                          value={r.status}
                          disabled={busyId === r.id}
                          onChange={(e) => changeStatus(r, e.target.value)}
                        >
                          {Object.keys(STATUS_LABEL).map((s) => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
};

export default StudentRegistrationsPanel;
