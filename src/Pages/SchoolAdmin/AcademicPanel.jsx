import React, { useCallback, useEffect, useState } from "react";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchSessions,
  createSession,
  deleteSession,
  fetchTerms,
  createTerm,
  deleteTerm,
  setCurrentTerm,
} from "../../lib/api";
import { Card, Field, Button, Badge, Notice, Empty, formatDate } from "../../Components/UI";

// A school runs sessions made of terms. Fees, results and attendance are all
// reported per term, so nothing downstream can be built until this exists.
const AcademicPanel = () => {
  const { schoolId } = useSchool();

  const [sessions, setSessions] = useState([]);
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

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
      setTerm((c) => ({ ...c, name: "", startsOn: "", endsOn: "" }));
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
      await setCurrentTerm(row.id);
      setNotice(`${row.name} is now the current term.`);
      load();
    } catch (err) {
      setError(err.message || "Could not switch the term.");
    } finally {
      setBusy(false);
    }
  };

  const removeTerm = async (row) => {
    if (!window.confirm(`Delete ${row.name}? Anything reported against it goes too.`)) return;
    setBusy(true);
    try {
      await deleteTerm(row.id);
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
      !window.confirm(
        owned
          ? `Delete ${row.name}? Its ${owned} term${owned === 1 ? "" : "s"} go with it.`
          : `Delete ${row.name}?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteSession(row.id);
      load();
    } catch (err) {
      setError(err.message || "Could not delete that session.");
    } finally {
      setBusy(false);
    }
  };

  const current = terms.find((t) => t.is_current);

  return (
    <>
      <p style={{ color: "var(--ink-2)", maxWidth: "64ch" }}>
        {"Your academic calendar. Results, fees and attendance are all reported against a term, so set these up before anything else."}
      </p>

      <Notice tone="error">{error}</Notice>
      <Notice tone="success">{notice}</Notice>

      {current ? (
        <Card style={{ marginBottom: 20, background: "var(--brand-soft)", borderColor: "transparent" }}>
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

      <div className="split" style={{ alignItems: "start" }}>
        <div>
          <h3>{"Sessions"}</h3>
          {loading ? <Empty>{"Loading..."}</Empty> : null}
          {!loading && sessions.length === 0 ? (
            <Empty>{"No sessions yet. Add one to begin."}</Empty>
          ) : null}

          {sessions.map((s) => (
            <Card key={s.id} style={{ marginBottom: 10 }}>
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
                <Button variant="danger" size="sm" disabled={busy} onClick={() => removeSession(s)}>
                  {"Delete"}
                </Button>
              </div>

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
                          variant="ghost"
                          disabled={busy}
                          onClick={() => removeTerm(t)}
                        >
                          {"Delete"}
                        </Button>
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

        {/* The forms stay level with the list they are filling, so adding a
            third term does not mean scrolling back up to find the box. */}
        <div className="panel-aside">
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
                <input
                  type="date"
                  className="input"
                  value={session.startsOn}
                  onChange={(e) => setSession((c) => ({ ...c, startsOn: e.target.value }))}
                />
              </Field>
              <Field label="Ends">
                <input
                  type="date"
                  className="input"
                  value={session.endsOn}
                  onChange={(e) => setSession((c) => ({ ...c, endsOn: e.target.value }))}
                />
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
                  <select
                    className="select"
                    value={term.sessionId}
                    onChange={(e) => setTerm((c) => ({ ...c, sessionId: e.target.value }))}
                  >
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Name" hint="First Term, Second Term, Third Term.">
                  <input
                    className="input"
                    value={term.name}
                    placeholder="First Term"
                    onChange={(e) => setTerm((c) => ({ ...c, name: e.target.value }))}
                  />
                </Field>
                <Field label="Starts">
                  <input
                    type="date"
                    className="input"
                    value={term.startsOn}
                    onChange={(e) => setTerm((c) => ({ ...c, startsOn: e.target.value }))}
                  />
                </Field>
                <Field label="Ends">
                  <input
                    type="date"
                    className="input"
                    value={term.endsOn}
                    onChange={(e) => setTerm((c) => ({ ...c, endsOn: e.target.value }))}
                  />
                </Field>
                <Button type="submit" disabled={busy}>{"Add term"}</Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
};

export default AcademicPanel;
