import React, { useCallback, useEffect, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchClearanceDepartments,
  createClearanceDepartment,
  renameClearanceDepartment,
  setClearanceDepartmentActive,
  deleteClearanceDepartment,
  countClearanceChecklistItems,
} from "../../lib/api";
import { Card, Field, Button, Badge, Notice, Empty } from "../../Components/UI";

// Who has to sign off before an accepted applicant clears — Bursary, the
// Library, Hostel, whatever this school actually runs people through before
// registration. Without at least one active department here, clearance has
// nothing to check and every accepted applicant passes it automatically
// (see recompute_clearance_state in 064) — that is by design, not a bug: a
// school that hasn't set this up yet should not have applicants stuck.
const ClearanceDepartmentsPanel = () => {
  const { schoolId } = useSchool();

  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [draftName, setDraftName] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const list = await fetchClearanceDepartments(schoolId);
      setRows(list);
      const tally = await Promise.all(
        list.map((row) => countClearanceChecklistItems(row.id).then((n) => [row.id, n]))
      );
      setCounts(Object.fromEntries(tally));
    } catch (err) {
      setError(err.message || "Could not load these.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!name.trim()) return setError("Give the department a name.");

    setBusy(true);
    try {
      const nextPosition = rows.length
        ? Math.max(...rows.map((r) => r.position)) + 1
        : 1;
      await createClearanceDepartment({ schoolId, name: name.trim(), position: nextPosition });
      setName("");
      setNotice("Added.");
      load();
    } catch (err) {
      setError(err.message || "Could not add that.");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (row) => {
    if (!draftName.trim()) return;
    setBusy(true);
    try {
      await renameClearanceDepartment({ id: row.id, name: draftName.trim() });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message || "Could not rename that.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    setBusy(true);
    try {
      await setClearanceDepartmentActive({ id: row.id, isActive: !row.is_active });
      load();
    } catch (err) {
      setError(err.message || "Could not update that.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (row) => {
    const used = counts[row.id] || 0;
    const warning = used
      ? `"${row.name}" is already on ${used} application${used === 1 ? "" : "s"}' clearance checklists. Deleting it removes those checklist entries too. This cannot be undone.`
      : `Delete "${row.name}"?`;
    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      await deleteClearanceDepartment(row.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "62ch" }}>
        {"Who an accepted applicant must clear with before they register — Bursary, the Library, Hostel, whatever your school actually runs people through. Deactivate a department to stop applying it to new applications without losing its history on existing ones. If nothing is listed here, clearance passes automatically for every accepted applicant."}
      </p>

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      {/* This panel only ever renders nested inside AdmissionsSettingsPanel's
          own sticky .panel-top (the session picker) — giving this card a
          second .panel-top would stick both at the same offset and collide. */}
      <Card style={{ maxWidth: 480, marginBottom: 22 }}>
        <h3 style={{ marginTop: 0 }}>{"Add a clearance department"}</h3>
        <form onSubmit={handleAdd}>
          <Field label="Name">
            <input
              className="input"
              value={name}
              placeholder="Bursary"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Working..." : "Add department"}
          </Button>
        </form>
      </Card>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && rows.length === 0 ? (
        <Empty>{"No clearance departments yet — every accepted applicant will pass clearance automatically until you add one."}</Empty>
      ) : null}

      {rows.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Department"}</th>
                  <th>{"Status"}</th>
                  <th>{"On applications"}</th>
                  <th>{""}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.55 }}>
                    <td>
                      {editing === row.id ? (
                        <input
                          className="input"
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(row);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          style={{ maxWidth: 220 }}
                        />
                      ) : (
                        <strong>{row.name}</strong>
                      )}
                    </td>
                    <td>
                      <Badge tone={row.is_active ? "success" : undefined}>
                        {row.is_active ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={counts[row.id] ? "brand" : undefined}>
                        {counts[row.id] ?? 0}
                      </Badge>
                    </td>
                    <td>
                      <span className="btn-row">
                        {editing === row.id ? (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => saveRename(row)}>
                              {"Save"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              {"Cancel"}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setEditing(row.id);
                                setDraftName(row.name);
                              }}
                            >
                              {"Rename"}
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => toggleActive(row)}>
                              {row.is_active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button size="sm" variant="danger" disabled={busy} onClick={() => handleDelete(row)}>
                              {"Delete"}
                            </Button>
                          </>
                        )}
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

export default ClearanceDepartmentsPanel;
