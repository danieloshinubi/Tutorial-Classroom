import React, { useCallback, useEffect, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { fetchAuditLog, fetchAuditLogTables } from "../../lib/api";
import { useActionFeedback } from "../../Components/Toast";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Empty,
  formatDate,
  Select,
  DateTimePicker,
  SkeletonList,
} from "../../Components/UI";

const ACTION_VERB = { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" };
const ACTION_TONE = { INSERT: "success", UPDATE: "brand", DELETE: "danger" };

// A raw table name means nothing to a proprietor reading their own audit
// trail — this is the whole reason the log has to say "Updated a payment"
// rather than "payments UPDATE". Anything not listed falls back to a
// prettified version of the table name rather than showing nothing.
const TABLE_LABELS = {
  account_security: "an account security action",
  applications: "an application",
  admission_offers: "an admission offer",
  student_registrations: "a student registration",
  clearance_departments: "a clearance department",
  clearance_checklists: "a clearance checklist item",
  original_verifications: "an original-document sighting",
  application_events: "an application timeline event",
  application_reviews: "an application review",
  application_interviews: "an application interview",
  application_screening_items: "a screening item",
  applicant_documents: "an applicant document",
  application_documents: "an application document",
  admission_config: "the admission configuration",
  admission_programmes: "an admission programme",
  applicant_accounts: "an applicant account",
  document_requirements: "a document requirement",
  screening_requirements: "a screening requirement",
  payments: "a payment",
  invoices: "an invoice",
  invoice_items: "an invoice line item",
  fee_structures: "a fee structure",
  fee_items: "a fee item",
  courses: "a course",
  assignments: "an assignment",
  submissions: "an assignment submission",
  materials: "a course material",
  exams: "an exam",
  exam_questions: "an exam question",
  exam_options: "an exam option",
  exam_attempts: "an exam attempt",
  exam_answers: "an exam answer",
  exam_events: "an exam proctoring event",
  messages: "a class message",
  message_comments: "a message comment",
  message_reactions: "a message reaction",
  notices: "a notice",
  notice_replies: "a notice reply",
  notice_reactions: "a notice reaction",
  notifications: "a notification",
  school_members: "a school membership",
  schools: "the school",
  sessions: "an academic session",
  terms: "a term",
  classes: "a class",
  class_students: "a class roster entry",
  class_subjects: "a class subject assignment",
  subjects: "a subject",
  levels: "a class level",
  enrollments: "a course enrolment",
  guardian_students: "a guardian link",
  result_sheets: "a result sheet",
  result_entries: "a result entry",
  result_events: "a result sheet event",
};

const describe = (row) => {
  const verb = ACTION_VERB[row.action] || row.action;
  const noun = TABLE_LABELS[row.table_name] || `a ${row.table_name.replace(/_/g, " ")} record`;
  return `${verb} ${noun}`;
};

// Bare column names ("first_name", "screening_state") read fine here — this
// is the one place in the app where the audience is explicitly "someone
// technical enough to be running the school", not a parent or student.
const fieldList = (fields) => (fields && fields.length ? fields.join(", ") : null);

const AuditRow = ({ row }) => {
  const [open, setOpen] = useState(false);

  return (
    <Card style={{ marginBottom: 10 }}>
      <div className="page-head" style={{ marginBottom: open ? 10 : 0 }}>
        <div>
          <div className="btn-row" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <Badge tone={ACTION_TONE[row.action]}>{row.action}</Badge>
            <strong>{describe(row)}</strong>  
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {row.actor_label}
            {row.actor_role ? <span style={{ color: "var(--ink-3)" }}>{` · ${row.actor_role}`}</span> : null}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {formatDate(row.created_at, { withTime: true })}
            {row.ip_address ? ` · ${row.ip_address}` : ""}
            {row.country ? ` (${row.country})` : ""}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide detail" : "See detail"}
        </Button>
      </div>

      {open ? (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, fontSize: 13 }}>
          <div style={{ color: "var(--ink-3)", marginBottom: 8 }}>
            {`Table: ${row.table_name} · Record: ${row.record_id || "—"}`}
          </div>
          {row.action === "UPDATE" && fieldList(row.changed_fields) ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{"Fields changed"}</div>
              <div style={{ color: "var(--ink-2)" }}>{fieldList(row.changed_fields)}</div>
            </div>
          ) : null}
          {row.action === "UPDATE" && row.changed_fields?.length ? (
            <div className="table-wrap" style={{ marginBottom: 10 }}>
              <table className="data">
                <thead>
                  <tr><th>{"Field"}</th><th>{"Before"}</th><th>{"After"}</th></tr>
                </thead>
                <tbody>
                  {row.changed_fields.map((f) => (
                    <tr key={f}>
                      <td>{f}</td>
                      <td style={{ color: "var(--danger)", wordBreak: "break-all" }}>
                        {JSON.stringify(row.old_data?.[f]) ?? "—"}
                      </td>
                      <td style={{ color: "var(--success)", wordBreak: "break-all" }}>
                        {JSON.stringify(row.new_data?.[f]) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {row.action !== "UPDATE" ? (
            <pre className="code-block" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12 }}>
              {JSON.stringify(row.new_data || row.old_data, null, 2)}
            </pre>
          ) : null}
          {row.user_agent ? (
            <div style={{ color: "var(--ink-3)", fontSize: 11.5, marginTop: 8, wordBreak: "break-all" }}>
              {row.user_agent}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

const AuditLog = () => {
  const { schoolId } = useSchool();

  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setError } = useActionFeedback();

  const [tableFilter, setTableFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorSearch, setActorSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    try {
      const filters = {
        tableName: tableFilter || undefined,
        action: actionFilter || undefined,
        actorSearch: actorSearch.trim() || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      };
      const result = await fetchAuditLog({ schoolId, filters, page });
      setRows(result.rows);
      setCount(result.count);
      setPageSize(result.pageSize);
    } catch (err) {
      setError(err.message || "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, tableFilter, actionFilter, actorSearch, from, to, page, setError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!schoolId) return;
    fetchAuditLogTables(schoolId).then(setTables).catch(() => {});
  }, [schoolId]);

  // Any filter change starts back at page 0 — otherwise "page 4" of an
  // unfiltered list could silently become an out-of-range, empty "page 4"
  // of a much shorter filtered one.
  const applyFilter = (setter) => (value) => {
    setter(value);
    setPage(0);
  };

  const clearFilters = () => {
    setTableFilter("");
    setActionFilter("");
    setActorSearch("");
    setFrom("");
    setTo("");
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const hasFilters = tableFilter || actionFilter || actorSearch || from || to;

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Audit Log"
        subtitle="Every recorded action at your school — who, what, when, and from where."
      >
        <Card style={{ marginBottom: 16 }}>
          <div className="split" style={{ marginBottom: 0 }}>
            <Field label="Table">
              <Select
                className="select"
                value={tableFilter}
                onChange={applyFilter(setTableFilter)}
                options={[
                  { value: "", label: "All tables" },
                  ...tables.map((t) => ({ value: t, label: TABLE_LABELS[t] || t })),
                ]}
              />
            </Field>
            <Field label="Action">
              <Select
                className="select"
                value={actionFilter}
                onChange={applyFilter(setActionFilter)}
                options={[
                  { value: "", label: "All actions" },
                  { value: "INSERT", label: "Created" },
                  { value: "UPDATE", label: "Updated" },
                  { value: "DELETE", label: "Deleted" },
                ]}
              />
            </Field>
          </div>
          <div className="split" style={{ marginTop: 12 }}>
            <Field label="Person" hint="Matches the name recorded at the time.">
              <input
                className="input"
                placeholder="Search by name..."
                value={actorSearch}
                onChange={(e) => applyFilter(setActorSearch)(e.target.value)}
              />
            </Field>
            <Field label="From">
              <DateTimePicker value={from} onChange={applyFilter(setFrom)} />
            </Field>
            <Field label="To">
              <DateTimePicker value={to} onChange={applyFilter(setTo)} />
            </Field>
          </div>
          {hasFilters ? (
            <div style={{ marginTop: 10 }}>
              <Button variant="ghost" size="sm" onClick={clearFilters}>{"Clear filters"}</Button>
            </div>
          ) : null}
        </Card>


        <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 0 }}>
          {count > 0 ? `${count.toLocaleString()} recorded action${count === 1 ? "" : "s"}` : ""}
        </p>

        {loading ? <SkeletonList rows={6} avatar={false} /> : null}
        {!loading && rows.length === 0 ? (
          <Empty>{hasFilters ? "Nothing matches those filters." : "Nothing recorded yet."}</Empty>
        ) : null}

        {rows.map((row) => (
          <AuditRow key={row.id} row={row} />
        ))}

        {count > pageSize ? (
          <div className="btn-row" style={{ justifyContent: "center", marginTop: 12 }}>
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {"Previous"}
            </Button>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
              {`Page ${page + 1} of ${totalPages}`}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {"Next"}
            </Button>
          </div>
        ) : null}
      </Page>
    </div>
  );
};

export default AuditLog;
