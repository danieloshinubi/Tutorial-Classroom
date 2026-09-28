import React, { useCallback, useEffect, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchSessions,
  createSession,
  updateSession,
  deleteSession,
  fetchTerms,
  createTerm,
  updateTerm,
  deleteTerm,
  setCurrentTerm,
} from "../../lib/api";
import { Card, Field, Button, Badge, Notice, Empty, formatDate, Select, DatePicker, SkeletonCards } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";

// Shared by the two inline edit forms below. Name on its own row, the two
// dates side by side under it, so the form sits inside a session card or a
// term row without forcing either one wider.
const TERM_NAMES = [
  "First Term",
  "Second Term",
  "Third Term",
  "Summer Coaching",
  "Holiday Coaching",
];
const OTHER = "__other";
const termOptions = [
  ...TERM_NAMES.map((n) => ({ value: n, label: n })),
  { value: OTHER, label: "Other (type a name)" },
];

const editForm = { display: "grid", gap: 10 };
const editDates = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
};

// A school runs sessions made of terms. Fees, results and attendance are all
// reported per term, so nothing downstream can be built until this exists.
const AcademicPanel = () => {
  const { schoolId } = useSchool();

  const [sessions, setSessions] = useState([]);
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { setError, setNotice } = useActionFeedback();

  const [session, setSession] = useState({ name: "", startsOn: "", endsOn: "" });
  const [term, setTerm] = useState({ sessionId: "", name: "", startsOn: "", endsOn: "" });

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [s, t] = await Promise.all([fetchSessions(schoolId), fetchTerms(schoolId)]);
      setSessions(s);
      setTerms(t);
      setTerm((c) => (c.sessionId || !s.length ? c : { ...c, sessionId: s[0].id }));
    } catch (err) {
      setError(err.message || "Could not load the calendar.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  // Which row is being edited, and the values being typed into it. Null when
  // nothing is. Editing happens in place rather than in the "Add" form on the
  // right, so it is always obvious which session or term is being changed.
  const [editSession, setEditSession] = useState(null);
  const [editTerm, setEditTerm] = useState(null);

  const saveSession = async (event) => {
    event?.preventDefault();
    if (!editSession?.name.trim()) return setError("A session needs a name.");
    setBusy(true);
    setError("");
    try {
      await updateSession({
        id: editSession.id,
        schoolId,
        name: editSession.name.trim(),
        startsOn: editSession.startsOn,
        endsOn: editSession.endsOn,
      });
      setEditSession(null);
      setNotice("Session updated.");
      load();
    } catch (err) {
      setError(
        err.code === "23505"
          ? `There is already a session called ${editSession.name.trim()}.`
          : err.message || "Could not save that."
      );
    } finally {
      setBusy(false);
    }
  };

  const saveTerm = async (event) => {
    event?.preventDefault();
    if (!editTerm?.name.trim()) return setError("A term needs a name.");
    setBusy(true);
    setError("");
    try {
      await updateTerm({
        id: editTerm.id,
        schoolId,
        name: editTerm.name.trim(),
        startsOn: editTerm.startsOn,
        endsOn: editTerm.endsOn,
      });
      setEditTerm(null);
      setNotice("Term updated.");
      load();
    } catch (err) {
      setError(err.message || "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  const addSession = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!session.name.trim()) return setError("Give the session a name, such as 2025/2026.");

    setBusy(true);
    try {
      await createSession({ schoolId, ...session, name: session.name.trim() });
      setSession({ name: "", startsOn: "", endsOn: "" });
      setNotice("Session added.");
      load();
    } catch (err) {
      setError(
        err.code === "23505"
          ? `There is already a session called ${session.name.trim()}.`
          : err.message || "Could not add that session."
      );
    } finally {
      setBusy(false);
    }
  };

  const addTerm = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!term.sessionId) return setError("Choose the session this term belongs to.");
    if (!term.name.trim()) return setError("Give the term a name, such as First Term.");

    const position = terms.filter((t) => t.session_id === term.sessionId).length + 1;

    setBusy(true);
    try {
      await createTerm({ schoolId, ...term, name: term.name.trim(), position });
      setTerm((c) => ({ ...c, name: "", custom: false, startsOn: "", endsOn: "" }));
      setNotice("Term added.");
      load();
    } catch (err) {
      setError(
        err.code === "23505"
          ? "That session already has a term with that name."
          : err.message || "Could not add that term."
      );
    } finally {
      setBusy(false);
    }
  };

  const makeCurrent = async (row) => {
    setBusy(true);
    setError("");
    try {
      await setCurrentTerm(row.id, schoolId);
      setNotice(`${row.name} is now the current term.`);
      load();
    } catch (err) {
      setError(err.message || "Could not switch the term.");
    } finally {
      setBusy(false);
    }
  };

  const removeTerm = async (row) => {
    if (!await confirmDialog(`Delete ${row.name}? Anything reported against it goes too.`)) return;
    setBusy(true);
    try {
      await deleteTerm(schoolId, row.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that term.");
    } finally {
      setBusy(false);
    }
  };

  const removeSession = async (row) => {
    const owned = terms.filter((t) => t.session_id === row.id).length;
    if (
      !await confirmDialog(
        owned
          ? `Delete ${row.name}? Its ${owned} term${owned === 1 ? "" : "s"} go with it.`
          : `Delete ${row.name}?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteSession(row.id, schoolId);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that session.");
    } finally {
      setBusy(false);
    }
  };

  const current = terms.find((t) => t.is_current);

  return (
    <div className="panel-panes">
      <div className="panel-top">
        <p style={{ color: "var(--ink-2)", maxWidth: "64ch" }}>
          {"Your academic calendar. Results, fees and attendance are all reported against a term, so set these up before anything else."}
        </p>

        {current ? (
          <Card style={{ marginBottom: 0, background: "var(--brand-soft)", borderColor: "transparent" }}>
            <strong>{`Current term: ${current.name}`}</strong>
            <span style={{ color: "var(--ink-2)" }}>
              {current.sessions ? ` · ${current.sessions.name}` : ""}
            </span>
          </Card>
        ) : sessions.length ? (
          <Notice tone="error">
            {"No current term is set. Choose one below — reports and fees need to know which term they belong to."}
          </Notice>
        ) : null}
      </div>

      <div className="split">
        <div className="pane">
          <h3>{"Sessions"}</h3>
          <div className="pane-scroll">
            {loading ? <SkeletonCards count={3} lines={3} /> : null}
            {!loading && sessions.length === 0 ? (
              <Empty>{"No sessions yet. Add one to begin."}</Empty>
            ) : null}

            {sessions.map((s) => (
              <Card key={s.id} style={{ marginBottom: 10 }}>
                {editSession?.id === s.id ? (
                  <form onSubmit={saveSession} style={editForm}>
                    <Field label="Name">
                      <input
                        className="input"
                        value={editSession.name}
                        onChange={(e) => setEditSession((c) => ({ ...c, name: e.target.value }))}
                      />
                    </Field>
                    <div style={editDates}>
                      <Field label="Starts">
                        <DatePicker
                          value={editSession.startsOn}
                          onChange={(v) => setEditSession((c) => ({ ...c, startsOn: v }))}
                        />
                      </Field>
                      <Field label="Ends">
                        <DatePicker
                          value={editSession.endsOn}
                          onChange={(v) => setEditSession((c) => ({ ...c, endsOn: v }))}
                        />
                      </Field>
                    </div>
                    <div className="btn-row">
                      <Button type="submit" size="sm" disabled={busy}>
                        {busy ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setEditSession(null)}
                      >
                        {"Cancel"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="page-head" style={{ marginBottom: 0 }}>
                    <div>
                      <strong>{s.name}</strong>
                      {s.is_current ? (
                        <span style={{ marginLeft: 8 }}>
                          <Badge tone="success">{"current"}</Badge>
                        </span>
                      ) : null}
                      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>
                        {s.starts_on
                          ? `${formatDate(s.starts_on, { withTime: false })} — ${
                              s.ends_on ? formatDate(s.ends_on, { withTime: false }) : "open"
                            }`
                          : "No dates set"}
                      </div>
                    </div>
                    <div className="btn-row">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditTerm(null);
                          setEditSession({
                            id: s.id,
                            name: s.name,
                            startsOn: s.starts_on || "",
                            endsOn: s.ends_on || "",
                          });
                        }}
                      >
                        {"Edit"}
                      </Button>
                      <Button variant="danger" size="sm" disabled={busy} onClick={() => removeSession(s)}>
                        {"Delete"}
                      </Button>
                    </div>
                  </div>
                )}

                {terms.filter((t) => t.session_id === s.id).length ? (
                  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    {terms
                      .filter((t) => t.session_id === s.id)
                      .map((t) => (
                        <div
                          key={t.id}
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
                          {editTerm?.id === t.id ? (
                            <form onSubmit={saveTerm} style={{ ...editForm, flex: 1 }}>
                              <Field label="Name">
                                <Select
                                  value={editTerm.custom ? OTHER : editTerm.name}
                                  placeholder="Choose a term"
                                  options={termOptions}
                                  onChange={(v) =>
                                    setEditTerm((c) =>
                                      v === OTHER
                                        ? { ...c, custom: true, name: "" }
                                        : { ...c, custom: false, name: v }
                                    )
                                  }
                                />
                              </Field>
                              {editTerm.custom ? (
                                <Field label="Term name">
                                  <input
                                    className="input"
                                    value={editTerm.name}
                                    onChange={(e) =>
                                      setEditTerm((c) => ({ ...c, name: e.target.value }))
                                    }
                                  />
                                </Field>
                              ) : null}
                              <div style={editDates}>
                                <Field label="Starts">
                                  <DatePicker
                                    value={editTerm.startsOn}
                                    onChange={(v) => setEditTerm((c) => ({ ...c, startsOn: v }))}
                                  />
                                </Field>
                                <Field label="Ends">
                                  <DatePicker
                                    value={editTerm.endsOn}
                                    onChange={(v) => setEditTerm((c) => ({ ...c, endsOn: v }))}
                                  />
                                </Field>
                              </div>
                              <div className="btn-row">
                                <Button type="submit" size="sm" disabled={busy}>
                                  {busy ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => setEditTerm(null)}
                                >
                                  {"Cancel"}
                                </Button>
                              </div>
                            </form>
                          ) : (
                            <>
                            <span style={{ flex: 1, minWidth: 120 }}>
                              {t.name}
                              {t.is_current ? (
                                <span style={{ marginLeft: 8 }}>
                                  <Badge tone="success">{"current"}</Badge>
                                </span>
                              ) : null}
                            </span>
                            {!t.is_current ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => makeCurrent(t)}
                              >
                                {"Make current"}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                setEditSession(null);
                                setEditTerm({
                                  id: t.id,
                                  name: t.name,
                                  custom: !TERM_NAMES.includes(t.name),
                                  startsOn: t.starts_on || "",
                                  endsOn: t.ends_on || "",
                                });
                              }}
                            >
                              {"Edit"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => removeTerm(t)}
                            >
                              {"Delete"}
                            </Button>
                            </>
                          )}
                        </div>
                      ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--ink-3)", fontSize: 13.5, margin: "10px 0 0" }}>
                    {"No terms in this session yet."}
                  </p>
                )}
              </Card>
            ))}
          </div>
        </div>

        {/* Its own scroller, not a sticky aside: the forms stay put however
            far the session list beside them is scrolled. */}
        <div className="pane-scroll">
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{"Add a session"}</h3>
            <form onSubmit={addSession}>
              <Field label="Name" hint="For example 2025/2026.">
                <input
                  className="input"
                  value={session.name}
                  placeholder="2025/2026"
                  onChange={(e) => setSession((c) => ({ ...c, name: e.target.value }))}
                />
              </Field>
              <Field label="Starts">
                <DatePicker value={session.startsOn} onChange={(v) => setSession((c) => ({ ...c, startsOn: v }))} />
              </Field>
              <Field label="Ends">
                <DatePicker value={session.endsOn} onChange={(v) => setSession((c) => ({ ...c, endsOn: v }))} />
              </Field>
              <Button type="submit" disabled={busy}>{"Add session"}</Button>
            </form>
          </Card>

          <Card>
            <h3 style={{ marginTop: 0 }}>{"Add a term"}</h3>
            {sessions.length === 0 ? (
              <p style={{ color: "var(--ink-3)", fontSize: 14, margin: 0 }}>
                {"Add a session first — a term belongs to one."}
              </p>
            ) : (
              <form onSubmit={addTerm}>
                <Field label="Session">
                  <Select
                    className="select"
                    value={term.sessionId}
                    onChange={(v) => setTerm((c) => ({ ...c, sessionId: v }))}
                    options={sessions.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </Field>
                <Field label="Name">
                  <Select
                    value={term.custom ? OTHER : term.name}
                    placeholder="Choose a term"
                    options={termOptions}
                    onChange={(v) =>
                      setTerm((c) =>
                        v === OTHER
                          ? { ...c, custom: true, name: "" }
                          : { ...c, custom: false, name: v }
                      )
                    }
                  />
                </Field>
                {term.custom ? (
                  <Field label="Term name" hint="What this school calls it.">
                    <input
                      className="input"
                      value={term.name}
                      placeholder="For example Revision Week"
                      onChange={(e) => setTerm((c) => ({ ...c, name: e.target.value }))}
                    />
                  </Field>
                ) : null}
                <Field label="Starts">
                  <DatePicker value={term.startsOn} onChange={(v) => setTerm((c) => ({ ...c, startsOn: v }))} />
                </Field>
                <Field label="Ends">
                  <DatePicker value={term.endsOn} onChange={(v) => setTerm((c) => ({ ...c, endsOn: v }))} />
                </Field>
                <Button type="submit" disabled={busy}>{"Add term"}</Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AcademicPanel;
