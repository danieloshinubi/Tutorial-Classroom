import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../Components/Navbar/Navbar";
import { useAuth } from "../../context/AuthContext";
import { useSchool } from "../../context/SchoolContext";
import {
  fetchApplication,
  fetchApplicationEvents,
  fetchApplicationDocuments,
  uploadApplicationDocument,
  deleteApplicationDocument,
  signedMaterialUrl,
  decideApplication,
  enrolApplicant,
  addSchoolUser,
  fetchClasses,
  fetchSchoolMembers,
  NEXT_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
} from "../../lib/api";
import {
  Page,
  Card,
  Field,
  Button,
  Badge,
  Notice,
  Empty,
  displayName,
  formatDate,
} from "../../Components/UI";
import AdmissionLetter from "./AdmissionLetter";

const DOC_KINDS = [
  ["birth_certificate", "Birth certificate"],
  ["previous_results", "Previous results"],
  ["passport", "Passport photograph"],
  ["transfer_certificate", "Transfer certificate"],
  ["other", "Other"],
];

const Fact = ({ label, children }) =>
  children ? (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  ) : null;

const ApplicationDetail = () => {
  const { applicationId } = useParams();
  const { user } = useAuth();
  const { schoolId, labelFor } = useSchool();

  const [app, setApp] = useState(null);
  const [events, setEvents] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [note, setNote] = useState("");
  const [offerExpires, setOfferExpires] = useState("");
  const [docKind, setDocKind] = useState("birth_certificate");
  const [showLetter, setShowLetter] = useState(false);
  const fileInput = useRef(null);

  // Enrolment needs a student account. Either reuse one, or make one here.
  const [enrolMode, setEnrolMode] = useState("create");
  const [existingStudent, setExistingStudent] = useState("");
  const [classId, setClassId] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [issued, setIssued] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await fetchApplication(applicationId);
      if (!row) {
        setError("That application no longer exists.");
        return;
      }
      setApp(row);
      setStudentEmail((current) => current || row.guardian_email);
      setClassId((current) => current || row.class_id || "");

      const [ev, docs, cls, members] = await Promise.all([
        fetchApplicationEvents(applicationId).catch(() => []),
        fetchApplicationDocuments(applicationId).catch(() => []),
        schoolId ? fetchClasses(schoolId).catch(() => []) : [],
        schoolId ? fetchSchoolMembers(schoolId).catch(() => []) : [],
      ]);
      setEvents(ev);
      setDocuments(docs);
      setClasses(cls);
      setStudents(members.filter((m) => m.role === "student"));
    } catch (err) {
      setError(err.message || "Could not load that application.");
    } finally {
      setLoading(false);
    }
  }, [applicationId, schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (status) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await decideApplication({
        id: applicationId,
        status,
        note: note.trim(),
        offerExpires: status === "offered" && offerExpires
          ? new Date(offerExpires).toISOString()
          : null,
      });
      setNote("");
      setOfferExpires("");
      setNotice(`Moved to ${STATUS_LABEL[status].toLowerCase()}.`);
      load();
    } catch (err) {
      setError(err.message || "Could not update that application.");
    } finally {
      setBusy(false);
    }
  };

  const handleEnrol = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let studentId = existingStudent;

      // Creating the account here rather than sending the officer to another
      // screen: enrolling and having a login are the same moment.
      if (enrolMode === "create") {
        if (!studentEmail.trim()) {
          setError("An email address is needed for the pupil's account.");
          setBusy(false);
          return;
        }
        const created = await addSchoolUser({
          schoolId,
          email: studentEmail,
          firstName: app.first_name,
          surname: app.surname,
          role: "student",
        });
        studentId = created.user_id;
        if (created.password) {
          setIssued({ email: created.email, password: created.password });
        }
      }

      if (!studentId) {
        setError("Choose an existing pupil, or create a new account.");
        setBusy(false);
        return;
      }

      await enrolApplicant({ id: applicationId, studentId, classId });
      setNotice("Enrolled.");
      load();
    } catch (err) {
      setError(err.message || "Could not enrol that applicant.");
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("That file is over 20 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await uploadApplicationDocument({
        schoolId: app.school_id,
        applicationId,
        file,
        kind: docKind,
        userId: user.id,
      });
      load();
    } catch (err) {
      setError(
        /bucket|not found/i.test(err.message || "")
          ? 'File storage is not set up — create the "course-materials" bucket in Supabase. Document links on the application still work.'
          : err.message || "Could not upload that document."
      );
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (doc) => {
    setError("");
    try {
      window.open(await signedMaterialUrl(doc.file_path), "_blank", "noopener");
    } catch (err) {
      setError(err.message || "Could not open that document.");
    }
  };

  if (loading) {
    return (
      <div className="shell">
        <Navbar />
        <Page><Empty>{"Loading application..."}</Empty></Page>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="shell">
        <Navbar />
        <Page title="Application">
          <Notice tone="error">{error}</Notice>
          <Link to="/Admissions">
            <Button variant="secondary">{"Back to admissions"}</Button>
          </Link>
        </Page>
      </div>
    );
  }

  if (showLetter) {
    return (
      <AdmissionLetter
        application={app}
        className={classes.find((c) => c.id === classId)?.name}
        onClose={() => setShowLetter(false)}
      />
    );
  }

  const next = NEXT_STATUSES[app.status] || [];
  const fullName = [app.first_name, app.middle_name, app.surname]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="shell">
      <Navbar />
      <Page
        title={fullName}
        subtitle={`${app.reference}${app.sessions ? ` · ${app.sessions.name}` : ""}`}
        action={
          <div className="btn-row">
            {["offered", "accepted", "enrolled"].includes(app.status) ? (
              <Button variant="secondary" onClick={() => setShowLetter(true)}>
                {"Admission letter"}
              </Button>
            ) : null}
            <Link to="/Admissions">
              <Button variant="secondary">{"All applications"}</Button>
            </Link>
          </div>
        }
      >
        <div className="btn-row" style={{ marginBottom: 18 }}>
          <Badge tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Badge>
          {app.status === "offered" && app.offer_expires_at ? (
            <Badge tone={new Date(app.offer_expires_at) < new Date() ? "danger" : undefined}>
              {new Date(app.offer_expires_at) < new Date()
                ? `Offer expired ${formatDate(app.offer_expires_at, { withTime: false })}`
                : `Offer expires ${formatDate(app.offer_expires_at, { withTime: false })}`}
            </Badge>
          ) : null}
          {app.classes ? <Badge tone="success">{app.classes.name}</Badge> : null}
        </div>

        <Notice tone="error">{error}</Notice>
        <Notice tone="success">{notice}</Notice>

        {issued ? (
          <Card
            style={{
              marginBottom: 18,
              maxWidth: 560,
              background: "var(--success-soft)",
              borderColor: "transparent",
            }}
          >
            <strong>{"The pupil's sign-in details"}</strong>
            <p style={{ fontSize: 14, margin: "6px 0 12px" }}>
              {"Shown once. They will be asked to choose their own password."}
            </p>
            <div style={{ fontFamily: "monospace", fontSize: 15 }}>
              <div>{issued.email}</div>
              <div>{issued.password}</div>
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(`${issued.email}  ${issued.password}`)
                    .catch(() => {})
                }
              >
                {"Copy"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                {"Done"}
              </Button>
            </div>
          </Card>
        ) : null}

        <div className="split">
          <div>
            <Card style={{ marginBottom: 18 }}>
              <h3 style={{ marginTop: 0 }}>{"The applicant"}</h3>
              <dl className="apply-facts">
                <Fact label="Full name">{fullName}</Fact>
                <Fact label="Date of birth">
                  {app.date_of_birth ? formatDate(app.date_of_birth, { withTime: false }) : null}
                </Fact>
                <Fact label="Gender">{app.gender}</Fact>
                <Fact label="Applying for">
                  {app.applying_for_level == null ? null : labelFor(app.applying_for_level)}
                </Fact>
                <Fact label="Previous school">{app.previous_school}</Fact>
              </dl>
            </Card>

            <Card style={{ marginBottom: 18 }}>
              <h3 style={{ marginTop: 0 }}>{"Parent or guardian"}</h3>
              <dl className="apply-facts">
                <Fact label="Name">{app.guardian_name}</Fact>
                <Fact label="Relationship">{app.guardian_relation}</Fact>
                <Fact label="Email">
                  <a href={`mailto:${app.guardian_email}`}>{app.guardian_email}</a>
                </Fact>
                <Fact label="Phone">
                  {app.guardian_phone ? (
                    <a href={`tel:${app.guardian_phone}`}>{app.guardian_phone}</a>
                  ) : null}
                </Fact>
                <Fact label="Address">{app.address}</Fact>
              </dl>
            </Card>

            {app.notes || app.document_links ? (
              <Card style={{ marginBottom: 18 }}>
                <h3 style={{ marginTop: 0 }}>{"From the family"}</h3>
                {app.notes ? (
                  <p style={{ whiteSpace: "pre-wrap" }}>{app.notes}</p>
                ) : null}
                {app.document_links ? (
                  <>
                    <span className="label">{"Document links they gave"}</span>
                    <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "6px 0 0" }}>
                      {app.document_links}
                    </p>
                  </>
                ) : null}
              </Card>
            ) : null}

            <Card style={{ marginBottom: 18 }}>
              <h3 style={{ marginTop: 0 }}>{`Documents (${documents.length})`}</h3>
              {documents.length === 0 ? (
                <p style={{ color: "var(--ink-3)", fontSize: 14 }}>
                  {"Nothing attached yet."}
                </p>
              ) : (
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {documents.map((doc) => (
                    <div className="file-chip" key={doc.id}>
                      <span style={{ flex: 1 }}>
                        {doc.file_name || "Document"}
                        <span className="file-meta">
                          {` · ${DOC_KINDS.find(([k]) => k === doc.kind)?.[1] || doc.kind}`}
                        </span>
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => openDocument(doc)}>
                        {"Open"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`Remove ${doc.file_name || "this document"}?`)) return;
                          await deleteApplicationDocument({ id: doc.id, filePath: doc.file_path });
                          load();
                        }}
                      >
                        {"Remove"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="btn-row">
                <select
                  className="select"
                  style={{ width: "auto" }}
                  value={docKind}
                  onChange={(e) => setDocKind(e.target.value)}
                >
                  {DOC_KINDS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {"Attach a file"}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  onChange={(e) => handleUpload(e.target.files?.[0])}
                />
              </div>
            </Card>

            {/* The audit trail. There is no update or delete policy on this
                table for anybody, so what is here is what happened. */}
            <Card>
              <h3 style={{ marginTop: 0 }}>{"History"}</h3>
              {events.length === 0 ? (
                <Empty>{"Nothing recorded."}</Empty>
              ) : (
                <ol className="timeline">
                  {events.map((ev) => (
                    <li key={ev.id}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>
                          {ev.status_from
                            ? `${STATUS_LABEL[ev.status_from]} → ${STATUS_LABEL[ev.status_to]}`
                            : STATUS_LABEL[ev.status_to] || "Updated"}
                        </strong>
                        <div className="timeline-meta">
                          {`${ev.actor_label || "Someone"} · ${formatDate(ev.created_at)}`}
                        </div>
                        {ev.note ? <p className="timeline-note">{ev.note}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <div>
            <Card style={{ marginBottom: 18 }}>
              <h3 style={{ marginTop: 0 }}>{"Decision"}</h3>

              {next.length === 0 ? (
                <p style={{ color: "var(--ink-3)", fontSize: 14, margin: 0 }}>
                  {app.status === "enrolled"
                    ? "Enrolled. Nothing further to decide."
                    : "No further moves from here."}
                </p>
              ) : (
                <>
                  <Field label="Note" hint="Recorded in the history. Optional.">
                    <textarea
                      className="textarea"
                      style={{ minHeight: 70 }}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Reason, or anything worth remembering"
                    />
                  </Field>

                  {next.includes("offered") ? (
                    <Field label="Offer expires" hint="Defaults to 14 days from now.">
                      <input
                        type="datetime-local"
                        className="input"
                        value={offerExpires}
                        onChange={(e) => setOfferExpires(e.target.value)}
                      />
                    </Field>
                  ) : null}

                  <div className="btn-row">
                    {next.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={
                          s === "rejected" || s === "withdrawn"
                            ? "danger"
                            : s === "offered" || s === "accepted"
                            ? "primary"
                            : "secondary"
                        }
                        disabled={busy}
                        onClick={() => move(s)}
                      >
                        {STATUS_LABEL[s]}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {app.status === "accepted" ? (
              <Card>
                <h3 style={{ marginTop: 0 }}>{"Enrol"}</h3>
                <p style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 0 }}>
                  {"This creates the pupil's place: a school account and, if you pick one, a class."}
                </p>

                <Field label="Account">
                  <select
                    className="select"
                    value={enrolMode}
                    onChange={(e) => setEnrolMode(e.target.value)}
                  >
                    <option value="create">{"Create a new pupil account"}</option>
                    <option value="existing">{"Use an existing pupil account"}</option>
                  </select>
                </Field>

                {enrolMode === "create" ? (
                  <Field
                    label="Email for the pupil"
                    hint="Defaults to the guardian's address. Change it if the pupil has their own."
                  >
                    <input
                      type="email"
                      className="input"
                      value={studentEmail}
                      onChange={(e) => setStudentEmail(e.target.value)}
                    />
                  </Field>
                ) : (
                  <Field label="Pupil">
                    <select
                      className="select"
                      value={existingStudent}
                      onChange={(e) => setExistingStudent(e.target.value)}
                    >
                      <option value="">{"Choose"}</option>
                      {students.map((m) => (
                        <option key={m.profiles.id} value={m.profiles.id}>
                          {`${displayName(m.profiles)} — ${m.profiles.email}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field
                  label="Class"
                  hint={classes.length ? "Optional — you can place them later." : "No classes yet."}
                >
                  <select
                    className="select"
                    value={classId}
                    onChange={(e) => setClassId(e.target.value)}
                  >
                    <option value="">{"Decide later"}</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`${c.name} — ${labelFor(c.level_year)}`}
                      </option>
                    ))}
                  </select>
                </Field>

                <Button disabled={busy} onClick={handleEnrol}>
                  {busy ? "Enrolling..." : "Enrol this pupil"}
                </Button>
              </Card>
            ) : null}
          </div>
        </div>
      </Page>
    </div>
  );
};

export default ApplicationDetail;
