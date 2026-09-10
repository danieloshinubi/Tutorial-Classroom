import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchSessions,
  fetchAdmissionProgrammes,
  fetchAdmissionConfig,
  fetchMyApplicantAccount,
  createApplicantAccount,
  startApplication,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Notice,
} from "../../Components/UI";

// The accounted flow's entry point. Signed-in applicant chooses a session
// and a programme; the server generates the application (and the fee
// invoice if the config asks for it).
const ApplyStart = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { school, schoolId } = useSchool();

  const [sessions, setSessions] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [account, setAccount] = useState(null);
  const [config, setConfig] = useState(null);

  const [form, setForm] = useState({
    session_id: "",
    programme_id: "",
    first_name: "",
    middle_name: "",
    surname: "",
    phone: "",
    date_of_birth: "",
    nationality: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      try {
        const [sess, acct] = await Promise.all([
          fetchSessions(schoolId),
          fetchMyApplicantAccount(schoolId).catch(() => null),
        ]);
        const open = sess.filter((s) => s.applications_open);
        setSessions(open);
        setAccount(acct);
        if (acct) {
          setForm((current) => ({
            ...current,
            first_name: acct.first_name || "",
            middle_name: acct.middle_name || "",
            surname: acct.surname || "",
            phone: acct.phone || "",
            date_of_birth: acct.date_of_birth || "",
            nationality: acct.nationality || "",
          }));
        }
        if (open.length === 1) {
          setForm((c) => ({ ...c, session_id: open[0].id }));
        }
      } catch (err) {
        setError(err.message || "Could not load sessions.");
      } finally {
        setLoading(false);
      }
    })();
  }, [schoolId]);

  const loadForSession = useCallback(async (sessionId) => {
    if (!schoolId || !sessionId) return;
    try {
      const [progs, cfg] = await Promise.all([
        fetchAdmissionProgrammes({ schoolId, sessionId }),
        fetchAdmissionConfig({ schoolId, sessionId }),
      ]);
      setProgrammes(progs);
      setConfig(cfg);
    } catch {
      /* If a session has no programmes, users can still start an application
         with no programme — the college case. */
      setProgrammes([]);
    }
  }, [schoolId]);

  useEffect(() => {
    if (form.session_id) loadForSession(form.session_id);
  }, [form.session_id, loadForSession]);

  const update = (name) => (event) =>
    setForm((current) => ({ ...current, [name]: event.target.value }));

  const start = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      // Create the account first if it doesn't exist. The server is
      // idempotent — a second call returns the existing row.
      if (!account) {
        if (!form.first_name.trim() || !form.surname.trim()) {
          setError("Fill in your name so we can create your applicant account.");
          setSaving(false);
          return;
        }
        await createApplicantAccount({
          schoolId,
          firstName: form.first_name.trim(),
          surname: form.surname.trim(),
          email: user?.email,
          phone: form.phone,
          middleName: form.middle_name,
          dateOfBirth: form.date_of_birth || null,
          nationality: form.nationality || null,
        });
      }

      const app = await startApplication({
        sessionId: form.session_id,
        programmeId: form.programme_id || null,
      });
      navigate(`/Applications/${app.id}`);
    } catch (err) {
      setError(err.message || "Could not start the application.");
    } finally {
      setSaving(false);
    }
  };

  const noSessionsOpen = !loading && sessions.length === 0;

  return (
    <div className="shell">
      <Navbar />
      <Page
        title="Start an application"
        subtitle={school ? school.name : ""}
      >
        <Notice tone="error">{error}</Notice>

        {noSessionsOpen ? (
          <Card style={{ maxWidth: 620 }}>
            <p>{"There are no admission sessions open at the moment."}</p>
            <Link to="/Applications">
              <Button variant="secondary">{"Back to applications"}</Button>
            </Link>
          </Card>
        ) : null}

        {sessions.length > 0 ? (
          <Card style={{ maxWidth: 640 }}>
            <form onSubmit={start}>
              <Field label="Admission session">
                <select
                  className="select"
                  value={form.session_id}
                  onChange={update("session_id")}
                >
                  <option value="">{"Choose a session"}</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              {form.session_id && programmes.length > 0 ? (
                <Field label="Programme">
                  <select
                    className="select"
                    value={form.programme_id}
                    onChange={update("programme_id")}
                  >
                    <option value="">{"Choose a programme"}</option>
                    {programmes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.department ? `— ${p.department}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              {config?.application_fee_enabled ? (
                <Notice tone="brand">
                  {`This session charges a ${config.currency || "NGN"} ${
                    Number(config.application_fee_amount || 0).toLocaleString()
                  } application fee. You will pay it after starting.`}
                </Notice>
              ) : null}

              {/* Only if the applicant does not already have an account. */}
              {!account ? (
                <>
                  <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--line)" }} />
                  <h3 style={{ marginTop: 0 }}>{"Your details"}</h3>
                  <Field label="First name">
                    <input className="input" value={form.first_name} onChange={update("first_name")} />
                  </Field>
                  <Field label="Middle name">
                    <input className="input" value={form.middle_name} onChange={update("middle_name")} />
                  </Field>
                  <Field label="Surname">
                    <input className="input" value={form.surname} onChange={update("surname")} />
                  </Field>
                  <Field label="Phone">
                    <input className="input" type="tel" value={form.phone} onChange={update("phone")} />
                  </Field>
                  <Field label="Date of birth">
                    <input className="input" type="date" value={form.date_of_birth} onChange={update("date_of_birth")} />
                  </Field>
                </>
              ) : null}

              <div style={{ marginTop: 16 }}>
                <Button type="submit" disabled={saving || !form.session_id}>
                  {saving ? "Starting..." : "Start application"}
                </Button>
              </div>
            </form>
          </Card>
        ) : null}
      </Page>
    </div>
  );
};

export default ApplyStart;
