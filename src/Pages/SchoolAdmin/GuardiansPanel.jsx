import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import { useActionFeedback } from "../../Components/Toast";
import {
  fetchSchoolMembers,
  fetchChildren,
  linkGuardian,
  unlinkGuardian,
} from "../../lib/api";
import {
  Card,
  Button,
  Empty,
  Select,
  SkeletonList,
  displayName,
  initials,
} from "../../Components/UI";
import { confirmDialog } from "../../Components/Confirm";

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
  const { setError, setNotice } = useActionFeedback();

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const rows = await fetchSchoolMembers(schoolId);
      setMembers(rows);

      const parents = rows.filter((r) => r.role === "parent");
      const pairs = await Promise.all(
        parents.map((p) =>
          fetchChildren(p.profiles.id, schoolId)
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
  }, [schoolId, setError]);

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
      !await confirmDialog(
        `Stop ${parentName} seeing ${displayName(link.student)}'s reports?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await unlinkGuardian(link.id, schoolId);
      load();
    } catch (err) {
      setError(err.message || "Could not remove that link.");
    } finally {
      setBusy(false);
    }
  };

  // What the list shows: a search across parents and their children, and
  // which parents (all, with children, none yet).
  const [query, setQuery] = useState("");
  const [show, setShow] = useState("all");
  const childSelectRef = useRef(null);

  const counts = useMemo(() => {
    const withKids = parents.filter((p) => (links[p.profiles.id] || []).length > 0).length;
    return { all: parents.length, with: withKids, none: parents.length - withKids };
  }, [parents, links]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return parents.filter((p) => {
      const kids = links[p.profiles.id] || [];
      if (show === "with" && kids.length === 0) return false;
      if (show === "none" && kids.length > 0) return false;
      if (!needle) return true;
      const haystack = [
        displayName(p.profiles), p.profiles.email,
        ...kids.map((k) => `${displayName(k.student)} ${k.student?.email || ""}`),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [parents, links, query, show]);

  // "Link a child" on a row: that parent goes into the form, and the child
  // picker is next.
  const startLinkFor = (parentId) => {
    setSelected(parentId);
    setChildId("");
    requestAnimationFrame(() => {
      childSelectRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      childSelectRef.current?.querySelector("button")?.focus();
    });
  };

  return (
    <>
      {loading ? <SkeletonList rows={4} avatar={true} /> : null}

      {!loading && parents.length === 0 ? (
        <Empty>
          {"No parent accounts yet. Add one under People, with the role Parent."}
        </Empty>
      ) : null}

      {parents.length > 0 ? (
        <>
          {/* Stays pinned while the list scrolls: the form to link, then the
              search and filter for the list below. */}
          <div className="panel-top gd-top">
            <form className="gd-link" onSubmit={handleLink}>
              <span className="gd-link-title">{"Link a child"}</span>
              <div className="gd-link-field gd-link-parent">
                <Select
                  className="select"
                  value={selected}
                  onChange={setSelected}
                  options={[
                    { value: "", label: "Choose a parent" },
                    ...parents.map((p) => ({
                      value: p.profiles.id,
                      label: `${displayName(p.profiles)} — ${p.profiles.email}`,
                    })),
                  ]}
                />
              </div>
              <div className="gd-link-field gd-link-child" ref={childSelectRef}>
                <Select
                  className="select"
                  value={childId}
                  onChange={setChildId}
                  disabled={students.length === 0}
                  placeholder={students.length ? "Choose a child" : "No pupils yet"}
                  options={[
                    { value: "", label: students.length ? "Choose a child" : "No pupils yet — add one under People" },
                    ...students.map((s) => ({
                      value: s.profiles.id,
                      label: `${displayName(s.profiles)} — ${s.profiles.email}`,
                    })),
                  ]}
                />
              </div>
              <div className="gd-link-field gd-link-rel">
                <input
                  className="input"
                  value={relationship}
                  placeholder="Relationship (optional)"
                  aria-label="Relationship, optional: mother, father, guardian"
                  onChange={(e) => setRelationship(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy || !selected || !childId}>
                {busy ? "Linking..." : "Link"}
              </Button>
            </form>

            <div className="gd-filters">
              <input
                className="input gd-search"
                placeholder="Search parents or children"
                aria-label="Search parents or children"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="gd-chips" role="group" aria-label="Show">
                {[
                  ["all", `All ${counts.all}`],
                  ["with", `With children ${counts.with}`],
                  ["none", `No children linked ${counts.none}`],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={show === key}
                    className={`gd-chip${show === key ? " active" : ""}${key === "none" && counts.none ? " warn" : ""}`}
                    onClick={() => setShow(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {shown.length === 0 ? (
            <Empty>{query.trim() ? "No parent or child matches that." : "No parents in this view."}</Empty>
          ) : (
            <Card className="pad-0" style={{ padding: "4px 14px" }}>
              <p className="people-count">
                {`${shown.length} of ${parents.length} ${parents.length === 1 ? "parent" : "parents"}`}
              </p>
              <div className="table-wrap">
                <table className="data gd-table">
                  <thead>
                    <tr>
                      <th>{"Parent"}</th>
                      <th>{"Children they can see"}</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => {
                      const kids = links[p.profiles.id] || [];
                      return (
                        <tr key={p.profiles.id} className={kids.length ? "" : "gd-row-empty"}>
                          <td className="gd-parent">
                            <span className="people-person">
                              <span className="people-avatar gd-avatar">{initials(p.profiles)}</span>
                              <span className="people-person-text">
                                <span className="people-name">{displayName(p.profiles)}</span>
                                <span className="people-email">{p.profiles.email}</span>
                              </span>
                            </span>
                          </td>
                          <td>
                            {kids.length ? (
                              <ul className="gd-kids">
                                {kids.map((k) => (
                                  <li key={k.id} className="gd-kid">
                                    <span className="gd-kid-name">{displayName(k.student)}</span>
                                    {k.relationship ? <span className="gd-kid-rel">{k.relationship}</span> : null}
                                    <button
                                      type="button"
                                      className="gd-kid-x"
                                      aria-label={`Unlink ${displayName(k.student)}`}
                                      title="Unlink"
                                      disabled={busy}
                                      onClick={() => handleUnlink(k, displayName(p.profiles))}
                                    >
                                      {"×"}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="gd-none">{"No children linked — sees nothing"}</span>
                            )}
                          </td>
                          <td className="gd-actions">
                            <Button size="sm" variant="secondary" onClick={() => startLinkFor(p.profiles.id)}>
                              {"Link a child"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : null}
    </>
  );
};

export default GuardiansPanel;
