import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchSchoolMembers,
  fetchChildren,
  linkGuardian,
  unlinkGuardian,
} from "../../lib/api";
import {
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  displayName,
  initials,
} from "../../Components/UI";

// Links a parent account to the children it may see. Without a link a parent
// sees nothing, which is the safe default — a guardian's access to a child's
// marks and attendance is granted deliberately, never inferred from a surname.
const GuardiansPanel = () => {
  const { schoolId } = useSchool();

  const [members, setMembers] = useState([]);
  const [links, setLinks] = useState({});
  const [selected, setSelected] = useState("");
  const [childId, setChildId] = useState("");
  const [relationship, setRelationship] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const rows = await fetchSchoolMembers(schoolId);
      setMembers(rows);

      const parents = rows.filter((r) => r.role === "parent");
      const pairs = await Promise.all(
        parents.map((p) =>
          fetchChildren(p.profiles.id)
            .then((kids) => [p.profiles.id, kids])
            .catch(() => [p.profiles.id, []])
        )
      );
      setLinks(Object.fromEntries(pairs));
    } catch (err) {
      setError(err.message || "Could not load parents.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const parents = useMemo(() => members.filter((r) => r.role === "parent"), [members]);
  const students = useMemo(() => members.filter((r) => r.role === "student"), [members]);

  const handleLink = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!selected || !childId) {
      setError("Choose both a parent and a child.");
      return;
    }
    if (links[selected]?.some((k) => k.student.id === childId)) {
      setError("That child is already linked to this parent.");
      return;
    }

    setBusy(true);
    try {
      await linkGuardian({
        schoolId,
        guardianId: selected,
        studentId: childId,
        relationship: relationship.trim(),
      });
      setNotice("Linked. The parent can now see that child's report.");
      setChildId("");
      setRelationship("");
      load();
    } catch (err) {
      setError(err.message || "Could not link them.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async (link, parentName) => {
    if (
      !window.confirm(
        `Stop ${parentName} seeing ${displayName(link.student)}'s reports?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await unlinkGuardian(link.id);
      load();
    } catch (err) {
      setError(err.message || "Could not remove that link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "64ch" }}>
        {"Choose which children each parent account can see. A parent with no children linked sees nothing at all."}
      </p>

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      {loading ? <Empty>{"Loading..."}</Empty> : null}

      {!loading && parents.length === 0 ? (
        <Empty>
          {"No parent accounts yet. Add one under People, with the role Parent."}
        </Empty>
      ) : null}

      {parents.length > 0 ? (
        <div className="panel-top">
        <Card style={{ maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>{"Link a child to a parent"}</h3>
          <form onSubmit={handleLink}>
            <Field label="Parent">
              <select
                className="select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">{"Choose a parent"}</option>
                {parents.map((p) => (
                  <option key={p.profiles.id} value={p.profiles.id}>
                    {`${displayName(p.profiles)} — ${p.profiles.email}`}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Child"
              hint={
                students.length
                  ? "Only student accounts appear here."
                  : "No student accounts yet — add one under People first."
              }
            >
              <select
                className="select"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                disabled={students.length === 0}
              >
                <option value="">{"Choose a child"}</option>
                {students.map((s) => (
                  <option key={s.profiles.id} value={s.profiles.id}>
                    {`${displayName(s.profiles)} — ${s.profiles.email}`}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Relationship" hint="Optional — mother, father, guardian.">
              <input
                className="input"
                value={relationship}
                placeholder="Mother"
                onChange={(e) => setRelationship(e.target.value)}
              />
            </Field>

            <Button type="submit" disabled={busy}>
              {busy ? "Linking..." : "Link"}
            </Button>
          </form>
        </Card>
        </div>
      ) : null}

      {parents.map((p) => {
        const kids = links[p.profiles.id] || [];
        return (
          <Card key={p.profiles.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span
                className="brand-mark"
                style={{ width: 36, height: 36, borderRadius: "50%", fontSize: 13 }}
              >
                {initials(p.profiles)}
              </span>
              <div style={{ flex: 1, minWidth: 160 }}>
                <strong>{displayName(p.profiles)}</strong>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {p.profiles.email}
                </div>
              </div>
              <Badge tone={kids.length ? "brand" : "warn"}>
                {kids.length
                  ? `${kids.length} child${kids.length === 1 ? "" : "ren"}`
                  : "no children linked"}
              </Badge>
            </div>

            {kids.length ? (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {kids.map((k) => (
                  <div
                    key={k.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      padding: "8px 12px",
                      background: "var(--bg)",
                      borderRadius: "var(--r-sm)",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 140 }}>
                      {displayName(k.student)}
                      {k.relationship ? (
                        <span style={{ color: "var(--ink-3)" }}>{` · ${k.relationship}`}</span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => handleUnlink(k, displayName(p.profiles))}
                    >
                      {"Unlink"}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        );
      })}
    </>
  );
};

export default GuardiansPanel;
