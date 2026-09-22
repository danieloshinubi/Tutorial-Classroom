import React, { useMemo, useState } from "react";
import { Card, Notice, Button } from "../../Components/UI";
import { useSchool } from "../../context/SchoolContext";
import { MODULES, LOCKED_MODULES, groupModules } from "../../lib/modules";
import { updateSchool } from "../../lib/api";

// Which parts of Schoolivio this school actually runs.
//
// The stored value is the switched-OFF list (schools.disabled_modules), not the
// on list, so a school provisioned today starts with everything live and a
// module added to the product later turns up automatically rather than staying
// hidden until someone opts in. That inversion only lives in the database and
// the API call; everything here is phrased the way an administrator thinks
// about it — a row per module, on or off.
//
// Turning a module off hides it from every member's navigation and closes its
// routes. It does not delete anything: switch it back on and the data is where
// it was. That distinction is worth stating plainly on screen, because "remove
// Bursary" could otherwise reasonably be read as "destroy the fee records".
const ModulesPanel = () => {
  const { school, disabledModules, reload } = useSchool();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // Working copy, so toggling several modules is one save rather than a
  // round trip per switch.
  const [draft, setDraft] = useState(() => new Set(disabledModules || []));

  const groups = useMemo(() => groupModules(MODULES), []);
  const dirty = useMemo(() => {
    const saved = new Set(disabledModules || []);
    if (saved.size !== draft.size) return true;
    for (const id of draft) if (!saved.has(id)) return true;
    return false;
  }, [draft, disabledModules]);

  const toggle = (id) => {
    setNote("");
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setNote("");
    try {
      await updateSchool(school.id, { disabled_modules: [...draft] });
      await reload();
      setNote("Saved. Everyone's navigation updates the next time they load the app.");
    } catch (err) {
      setError(err.message || "Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ maxWidth: 720 }}>
      <p style={{ marginTop: 0, color: "var(--ink-3)", fontSize: 14 }}>
        {
          "Switch off anything this school doesn't run. It disappears from everyone's navigation and its pages stop opening — nothing is deleted, and switching it back on brings it and its records straight back."
        }
      </p>

      <Notice tone="error">{error}</Notice>
      {note ? <Notice tone="success">{note}</Notice> : null}

      {groups.map((group) => (
        <div key={group.name} style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>{group.name}</div>
          {group.modules.map((module) => {
            const locked = LOCKED_MODULES.includes(module.id);
            const on = locked || !draft.has(module.id);
            return (
              <div
                key={module.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--ink)" }}>{module.label}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {locked
                      ? "Always on — this is where these switches live"
                      : on
                      ? "Live for everyone whose role includes it"
                      : "Hidden from everyone"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={on ? "secondary" : "primary"}
                  disabled={locked || saving}
                  onClick={() => toggle(module.id)}
                >
                  {locked ? "Always on" : on ? "Switch off" : "Switch on"}
                </Button>
              </div>
            );
          })}
        </div>
      ))}

      <div className="btn-row" style={{ marginTop: 18 }}>
        <Button disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty || saving}
          onClick={() => { setDraft(new Set(disabledModules || [])); setNote(""); setError(""); }}
        >
          {"Discard"}
        </Button>
      </div>
    </Card>
  );
};

export default ModulesPanel;
