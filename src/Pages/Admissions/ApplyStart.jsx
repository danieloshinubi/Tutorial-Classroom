import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ApplicantShell } from "../../Components/ApplicantShell";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import {
  fetchPublicAdmissionSessions,
  fetchAdmissionProgrammes,
  fetchAdmissionConfig,
  fetchMyApplicantAccount,
  createApplicantAccount,
  startApplication,
} from "../../lib/api";
import { useActionFeedback } from "../../Components/Toast";
import {
  Page,
  Card,
  Field,
  Button,
  Notice,
  Select,
  DatePicker,
} from "../../Components/UI";

// The accounted flow's entry point. Signed-in applicant chooses a session
// and a programme; the server generates the application (and the fee
// invoice if the config asks for it).
//
// Deliberately does not use useSchool()/SchoolContext — that resolves the
// school through classroom.schools' own SELECT policy, which is
// membership-gated, and an applicant is never a school_members row. This
// page resolves the school and its open sessions the same non-member-safe
// way the anonymous /Apply form already does (public_school(),
// public_admission_sessions()), so it works for an applicant with zero
// tenant access, which is the only kind of applicant there is.
const ApplyStart = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const slug = resolveSlug();

  const [school, setSchool] = useState(null);
  const schoolId = school?.id || null;
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
  const { setError } = useActionFeedback();

  useEffect(() => {
    supabase
      .rpc("public_school", { target_slug: slug })
      .then(({ data }) => {
        if (data?.length) setSchool(data[0]);
      })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      try {
        const [open, acct] = await Promise.all([
          fetchPublicAdmissionSessions(schoolId),
          fetchMyApplicantAccount(schoolId).catch(() => null),
        ]);
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
        } else if (profile) {
          // Already gave us their name at signup — no reason to ask twice.
          setForm((current) => ({
            ...current,
            first_name: profile.first_name || "",
            surname: profile.surname || "",
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
    // profile is only read to seed the form once, the first time this
    // effect runs for a given school — re-running it every time the auth
    // context's profile object identity changes would stomp on whatever
    // the applicant has since typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <>
      <ApplicantShell school={school} />
      <Page
        title="Start an application"
        subtitle={school ? school.name : ""}
      >
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
                <Select
                  className="select"
                  value={form.session_id}
                  onChange={(v) => setForm((current) => ({ ...current, session_id: v }))}
                  options={[
                    { value: "", label: "Choose a session" },
                    ...sessions.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </Field>

              {form.session_id && programmes.length > 0 ? (
                <Field label="Programme">
                  <Select
                    className="select"
                    value={form.programme_id}
                    onChange={(v) => setForm((current) => ({ ...current, programme_id: v }))}
                    options={[
                      { value: "", label: "Choose a programme" },
                      ...programmes.map((p) => ({
                        value: p.id,
                        label: `${p.name} ${p.department ? `— ${p.department}` : ""}`,
                      })),
                    ]}
                  />
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
                    <DatePicker value={form.date_of_birth} onChange={(v) => setForm((current) => ({ ...current, date_of_birth: v }))} />
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
    </>
  );
};

export default ApplyStart;
