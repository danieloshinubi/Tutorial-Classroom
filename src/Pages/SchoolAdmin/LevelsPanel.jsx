import React, { useCallback, useEffect, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchLevelsForSchool,
  createLevel,
  renameLevel,
  deleteLevel,
  countCoursesOnLevel,
} from "../../lib/api";
import { Card, Field, Button, Badge, Notice, Empty } from "../../Components/UI";

// Suggestions only — a school picks whatever it actually calls its classes.
// Two different things a school groups its courses by, and the same table
// holds either: year groups (JSS 1, Year 7) or streams and departments
// (Science, Computer Science). A school picks whichever it actually uses —
// the order number only decides how the list is sorted.
const PRESETS = {
  "Secondary streams": [
    [1, "Science"], [2, "Arts"], [3, "Commercial"],
  ],
  "University departments": [
    [1, "Computer Science"], [2, "Software Engineering"],
    [3, "Accounting"], [4, "Business Administration"],
  ],
  "Nigerian secondary": [
    [1, "JSS 1"], [2, "JSS 2"], [3, "JSS 3"],
    [4, "SS 1"], [5, "SS 2"], [6, "SS 3"],
  ],
  "Primary": [
    [1, "Primary 1"], [2, "Primary 2"], [3, "Primary 3"],
    [4, "Primary 4"], [5, "Primary 5"], [6, "Primary 6"],
  ],
  "British years": [
    [7, "Year 7"], [8, "Year 8"], [9, "Year 9"],
    [10, "Year 10"], [11, "Year 11"],
  ],
  "University levels": [
    [100, "100 Level"], [200, "200 Level"],
    [300, "300 Level"], [400, "400 Level"],
  ],
};

const LevelsPanel = () => {
  const { schoolId } = useSchool();

  const [levels, setLevels] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({ year: "", label: "" });
  const [editing, setEditing] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const rows = await fetchLevelsForSchool(schoolId);
      setLevels(rows);
      const tally = await Promise.all(
        rows.map((row) =>
          countCoursesOnLevel({ schoolId, year: row.year }).then((n) => [row.year, n])
        )
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

    const year = Number(form.year);
    if (!form.label.trim()) return setError("Give it a name.");
    if (!Number.isInteger(year)) return setError("The order must be a whole number.");
    if (levels.some((row) => row.year === year)) {
      return setError(`Order ${year} is already used by "${levels.find((r) => r.year === year).label}".`);
    }

    setBusy(true);
    try {
      await createLevel({ schoolId, year, label: form.label.trim() });
      setForm({ year: "", label: "" });
      setNotice("Added.");
      load();
    } catch (err) {
      setError(err.message || "Could not add that.");
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = async (name) => {
    const preset = PRESETS[name];
    const clashes = preset.filter((row) => levels.some((l) => l.year === row[0]));
    if (clashes.length) {
      setError(`That preset clashes with levels you already have (order ${clashes.map((c) => c[0]).join(", ")}).`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const [year, label] of preset) {
        await createLevel({ schoolId, year, label });
      }
      setNotice(`Added ${preset.length} levels.`);
      load();
    } catch (err) {
      setError(err.message || "Could not add those.");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (row) => {
    if (!draftLabel.trim()) return;
    setBusy(true);
    try {
      await renameLevel({ schoolId, year: row.year, label: draftLabel.trim() });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message || "Could not rename that.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (row) => {
    const used = counts[row.year] || 0;
    const warning = used
      ? `"${row.label}" still has ${used} course${used === 1 ? "" : "s"}. Deleting it deletes ${used === 1 ? "that course" : "those courses"} and everything in ${used === 1 ? "it" : "them"} — materials, assignments, exams and chat. This cannot be undone.`
      : `Delete "${row.label}"?`;
    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      await deleteLevel({ schoolId, year: row.year });
      load();
    } catch (err) {
      setError(err.message || "Could not delete that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      <div className="panel-top">
      <p style={{ color: "var(--ink-2)", maxWidth: "62ch" }}>
        {"How your school groups its courses — year groups like \"JSS 1\", or streams and departments like \"Science\", \"Arts\" or \"Computer Science\". Name them whatever you actually call them. Only administration adds and removes these; teachers pick from the list when they create a course."}
      </p>
      <Card style={{ maxWidth: 620 }}>
        <h3 style={{ marginTop: 0 }}>{"Add a class level"}</h3>
        <form onSubmit={handleAdd}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "110px 1fr" }}>
            <Field label="Order">
              <input
                type="number"
                className="input"
                value={form.year}
                placeholder="1"
                onChange={(e) => setForm((c) => ({ ...c, year: e.target.value }))}
              />
            </Field>
            <Field label="Name">
              <input
                className="input"
                value={form.label}
                placeholder="JSS 1"
                onChange={(e) => setForm((c) => ({ ...c, label: e.target.value }))}
              />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Working..." : "Add level"}
          </Button>
        </form>

        {levels.length === 0 ? (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
            <div className="label" style={{ marginBottom: 10 }}>{"Or start from a preset"}</div>
            <div className="btn-row">
              {Object.keys(PRESETS).map((name) => (
                <Button
                  key={name}
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => applyPreset(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "10px 0 0" }}>
              {"Presets are a starting point — rename or delete any of them afterwards."}
            </p>
          </div>
        ) : null}
      </Card>
      </div>

      {loading ? <Empty>{"Loading..."}</Empty> : null}
      {!loading && levels.length === 0 ? (
        <Empty>{"No class levels yet. Add one above before creating courses."}</Empty>
      ) : null}

      {levels.length > 0 ? (
        <Card className="pad-0" style={{ padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{"Order"}</th>
                  <th>{"Name"}</th>
                  <th>{"Courses"}</th>
                  <th>{""}</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((row) => (
                  <tr key={row.year}>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink-3)" }}>
                      {row.year}
                    </td>
                    <td>
                      {editing === row.year ? (
                        <input
                          className="input"
                          autoFocus
                          value={draftLabel}
                          onChange={(e) => setDraftLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(row);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          style={{ maxWidth: 220 }}
                        />
                      ) : (
                        <strong>{row.label}</strong>
                      )}
                    </td>
                    <td>
                      <Badge tone={counts[row.year] ? "brand" : undefined}>
                        {counts[row.year] ?? 0}
                      </Badge>
                    </td>
                    <td>
                      <span className="btn-row">
                        {editing === row.year ? (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => saveRename(row)}>
                              {"Save"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(null)}
                            >
                              {"Cancel"}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setEditing(row.year);
                                setDraftLabel(row.label);
                              }}
                            >
                              {"Rename"}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => handleDelete(row)}
                            >
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

export default LevelsPanel;
