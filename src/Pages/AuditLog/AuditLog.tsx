import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../../Components/Navbar/Navbar";
import { useSchool } from "../../context/SchoolContext";
import { fetchAuditLog, fetchAuditLogTables, fetchSchoolMembers } from "../../lib/api";
import { useActionFeedback } from "../../Components/Toast";
import ExportButton from "../../Components/ExportButton";
import { Page, Card, Field, Button, Badge, Empty, formatDate, Select, DateTimePicker, SkeletonList, displayName } from "../../Components/UI";
import { actorName, actorRole, explain, headline, nounFor, type AuditRow, type People } from "../../lib/auditExplain";

// Every recorded action at the school, in plain words (lib/auditExplain.ts):
// who did it, what they did to which record, and when, as a sentence; the
// record's details as labelled values, with people's names in place of ids.
// The raw record is still there under "Technical detail" for anyone who
// needs it.

const ACTION_WORD: Record<string, string> = { INSERT: "Created", UPDATE: "Changed", DELETE: "Deleted" };
const ACTION_TONE: Record<string, string> = { INSERT: "success", UPDATE: "brand", DELETE: "danger" };

const Row = ({ row, people }: { row: AuditRow; people: People }) => {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const detail = open ? explain(row, people) : null;

  return (
    <Card className="audit-row">
      <div className="audit-row-head">
        <div className="audit-row-main">
          <div className="audit-row-title">
            <Badge tone={ACTION_TONE[row.action]}>{ACTION_WORD[row.action] || row.action}</Badge>
            <strong>{headline(row, people)}</strong>
          </div>
          <div className="audit-row-meta">
            <span>{actorName(row)}</span>
            {actorRole(row) ? <span className="audit-muted">{` · ${actorRole(row)}`}</span> : null}
            <span className="audit-muted">{` · ${formatDate(row.created_at, { withTime: true })}`}</span>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide detail" : "See detail"}
        </Button>
      </div>

      {detail ? (
        <div className="audit-detail">
          <dl className="audit-facts-top">
            <div>
              <dt>{"When"}</dt>
              <dd>{detail.when}</dd>
            </div>
            <div>
              <dt>{"Who"}</dt>
              <dd>{detail.who}</dd>
            </div>
            <div>
              <dt>{"What happened"}</dt>
              <dd>{detail.what}</dd>
            </div>
            {detail.where ? (
              <div>
                <dt>{"Where from"}</dt>
                <dd>{detail.where}</dd>
              </div>
            ) : null}
          </dl>

          {detail.changes.length ? (
            <div className="table-wrap">
              <table className="data audit-changes">
                <thead>
                  <tr>
                    <th>{"What changed"}</th>
                    <th>{"Before"}</th>
                    <th>{"After"}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.changes.map((c) => (
                    <tr key={c.field}>
                      <td>{c.field}</td>
                      <td className="audit-before">{c.before}</td>
                      <td className="audit-after">{c.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {detail.facts.length ? (
            <div className="audit-record">
              <div className="audit-record-title">{row.action === "DELETE" ? "What was deleted" : `The new ${nounFor(row.table_name)}`}</div>
              <dl>
                {detail.facts.map((f) => (
                  <div key={f.field}>
                    <dt>{f.field}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <button type="button" className="audit-raw-toggle" onClick={() => setRaw((v) => !v)}>
            {raw ? "Hide technical detail" : "Technical detail"}
          </button>
          {raw ? (
            <div className="audit-raw">
              <div>{`Table: ${row.table_name} · Record: ${row.record_id || "—"}`}</div>
              <pre className="code-block">{JSON.stringify(row.action === "UPDATE" ? { before: row.old_data, after: row.new_data } : row.new_data || row.old_data, null, 2)}</pre>
              {row.user_agent ? <div className="audit-muted">{row.user_agent}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

const AuditLog = () => {
  const { schoolId } = useSchool();
  const { setError } = useActionFeedback();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [count, setCount] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<People>(new Map());

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
      setRows(result.rows as AuditRow[]);
      setCount(result.count);
      setPageSize(result.pageSize);
    } catch (err) {
      setError((err as Error).message || "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, tableFilter, actionFilter, actorSearch, from, to, page, setError]);

  useEffect(() => {
    load();
  }, [load]);

  // Tables to filter by, and the school's people, so ids read as names.
  useEffect(() => {
    if (!schoolId) return;
    fetchAuditLogTables(schoolId).then(setTables).catch(() => {});
    fetchSchoolMembers(schoolId)
      .then((rows) => {
        const members = rows as unknown as { user_id: string; profiles: Parameters<typeof displayName>[0] }[];
        setPeople(new Map(members.map((m) => [m.user_id, displayName(m.profiles)])));
      })
      .catch(() => {});
  }, [schoolId]);

  const applyFilter = (setter: (v: string) => void) => (value: string) => {
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
  const hasFilters = Boolean(tableFilter || actionFilter || actorSearch || from || to);

  // The export reads the same as the screen.
  const exportColumns = useMemo(
    () => [
      { key: "created_at", label: "When", type: "datetime" },
      { key: (r: AuditRow) => headline(r, people), label: "What happened" },
      { key: (r: AuditRow) => actorName(r), label: "Who" },
      { key: (r: AuditRow) => actorRole(r), label: "Role" },
      {
        key: (r: AuditRow) =>
          explain(r, people)
            .changes.map((c) => `${c.field}: ${c.before} → ${c.after}`)
            .join("; "),
        label: "Changes",
      },
      { key: (r: AuditRow) => r.ip_address || "", label: "IP address" },
      { key: (r: AuditRow) => r.country || "", label: "Country" },
    ],
    [people]
  );

  const tableOptions = [...tables]
    .map((t) => ({ value: t, label: nounFor(t).charAt(0).toUpperCase() + nounFor(t).slice(1) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="shell">
      <Navbar />
      <Page title="Audit Log" subtitle="Every recorded action at your school: who did what, to which record, and when.">
        <Card style={{ marginBottom: 16 }}>
          <div className="split" style={{ marginBottom: 0 }}>
            <Field label="Kind of record">
              <Select
                className="select"
                value={tableFilter}
                onChange={applyFilter(setTableFilter)}
                options={[{ value: "", label: "Everything" }, ...tableOptions]}
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
                  { value: "UPDATE", label: "Changed" },
                  { value: "DELETE", label: "Deleted" },
                ]}
              />
            </Field>
          </div>
          <div className="split" style={{ marginTop: 12 }}>
            <Field label="Person" hint="Matches the name recorded at the time.">
              <input className="input" placeholder="Search by name..." value={actorSearch} onChange={(e) => applyFilter(setActorSearch)(e.target.value)} />
            </Field>
            <Field label="From">
              <DateTimePicker value={from} onChange={applyFilter(setFrom)} />
            </Field>
            <Field label="To">
              <DateTimePicker value={to} onChange={applyFilter(setTo)} />
            </Field>
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {"Clear filters"}
              </Button>
            ) : null}
            <ExportButton filename="audit-log" sheetName="Audit log" rows={rows} columns={exportColumns} />
          </div>
        </Card>

        <p className="audit-count">{count > 0 ? `${count.toLocaleString()} recorded action${count === 1 ? "" : "s"}` : ""}</p>

        {loading ? <SkeletonList rows={6} avatar={false} /> : null}
        {!loading && rows.length === 0 ? <Empty>{hasFilters ? "Nothing matches those filters." : "Nothing recorded yet."}</Empty> : null}

        {rows.map((row) => (
          <Row key={row.id} row={row} people={people} />
        ))}

        {count > pageSize ? (
          <div className="btn-row" style={{ justifyContent: "center", marginTop: 12 }}>
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              {"Previous"}
            </Button>
            <span className="audit-muted">{`Page ${page + 1} of ${totalPages}`}</span>
            <Button variant="secondary" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {"Next"}
            </Button>
          </div>
        ) : null}
      </Page>
    </div>
  );
};

export default AuditLog;
