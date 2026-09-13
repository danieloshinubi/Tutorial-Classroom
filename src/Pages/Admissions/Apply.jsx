import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import {
  submitApplication,
  uploadPublicApplicationDocument,
  removePublicApplicationDocument,
} from "../../lib/api";
import { Field, Button, Notice } from "../../Components/UI";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
const GUARDIAN_RELATIONS = [
  "Mother", "Father", "Guardian", "Grandma", "Grandpa", "Son", "Daughter", "Other",
];

const DOC_KINDS = [
  ["other", "Document"],
  ["birth_certificate", "Birth certificate"],
  ["previous_results", "Previous results"],
  ["passport", "Passport photograph"],
  ["transfer_certificate", "Transfer certificate"],
];

const formatBytes = (n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

// A small red asterisk appended to a Field's label — Field just renders
// whatever `label` is given, so a fragment works as well as a string.
const Req = () => <span className="apply-req-mark">{"*"}</span>;

const SECTIONS = [
  { num: 1, label: "The applicant" },
  { num: 2, label: "Parent or guardian" },
  { num: 3, label: "Anything else" },
];

const NEXT_STEPS = [
  "The school reviews what you've sent — no need to call and check.",
  "They may ask for documents, or invite an interview, by email.",
  "You'll hear the decision by email, at the address you gave.",
];

// The public application form. No account, no login — a parent finds the
// school's address, fills this in, and gets a reference they can quote.
const Apply = () => {
  const slug = resolveSlug();

  const [school, setSchool] = useState(null);
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    surname: "",
    dateOfBirth: "",
    gender: "",
    applyingForLevel: "",
    previousSchool: "",
    guardianName: "",
    guardianRelation: "",
    guardianEmail: "",
    guardianPhone: "",
    address: "",
    notes: "",
    documentLinks: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  // Each entry: { key, name, size, status: 'uploading'|'done'|'error', kind, path?, error? }
  const [attachments, setAttachments] = useState([]);
  const fileInput = useRef(null);

  // "Other" in the relationship dropdown needs its own text field — tracked
  // separately so switching back to a listed option doesn't lose what was
  // typed, and so the dropdown can tell "Guardian" apart from a blank "Other".
  const [relationIsOther, setRelationIsOther] = useState(false);

  useEffect(() => {
    supabase
      .rpc("public_school", { target_slug: slug })
      .then(({ data }) => {
        if (data?.length) setSchool(data[0]);
      })
      .catch(() => {});
  }, [slug]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  // Uploaded one at a time as soon as they're chosen — a family sees which
  // ones landed (or didn't) well before they get to Submit, rather than
  // discovering a failed upload only after everything else went through.
  const attachFiles = async (fileList) => {
    if (!school?.id) {
      setError("Hold on — still loading the school. Try attaching again in a moment.");
      return;
    }
    const files = Array.from(fileList || []);
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setAttachments((c) => [...c, { key, name: file.name, size: file.size, status: "error", error: "That file type isn't supported — PDF, JPEG, PNG, WEBP or HEIC only." }]);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setAttachments((c) => [...c, { key, name: file.name, size: file.size, status: "error", error: "That file is over 15 MB." }]);
        continue;
      }
      setAttachments((c) => [...c, { key, name: file.name, size: file.size, status: "uploading", kind: "other" }]);
      try {
        const uploaded = await uploadPublicApplicationDocument({ schoolId: school.id, file, kind: "other" });
        setAttachments((c) => c.map((a) => (a.key === key ? { ...a, ...uploaded, status: "done" } : a)));
      } catch (err) {
        setAttachments((c) => c.map((a) => (a.key === key ? { ...a, status: "error", error: err.message || "Could not upload that file." } : a)));
      }
    }
  };

  const removeAttachment = async (key) => {
    const attachment = attachments.find((a) => a.key === key);
    setAttachments((c) => c.filter((a) => a.key !== key));
    if (attachment?.path) {
      await removePublicApplicationDocument(attachment.path).catch(() => {});
    }
  };

  const setAttachmentKind = (key, kind) =>
    setAttachments((c) => c.map((a) => (a.key === key ? { ...a, kind } : a)));

  const uploadingCount = attachments.filter((a) => a.status === "uploading").length;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!form.firstName.trim() || !form.surname.trim()) {
      setError("The applicant's first name and surname are both required.");
      return;
    }
    if (!form.guardianName.trim() || !form.guardianEmail.trim()) {
      setError("We need a parent or guardian's name and email address.");
      return;
    }
    if (uploadingCount > 0) {
      setError("Hold on — one or more files are still uploading.");
      return;
    }

    setSubmitting(true);
    try {
      const documentUploads = attachments
        .filter((a) => a.status === "done")
        .map((a) => ({ path: a.path, name: a.name, size: a.size, mime_type: a.mime_type, kind: a.kind }));
      const result = await submitApplication({ slug, ...form, documentUploads });
      setDone(result);
    } catch (err) {
      // The commonest refusal by far, and it needs a plain explanation.
      setError(
        /not accepting/i.test(err.message || "")
          ? `${school?.name || "This school"} is not accepting applications at the moment. Contact the school directly.`
          : err.message || "Could not submit the application."
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------------------------------------ submitted */
  if (done) {
    return (
      <div className="apply">
        <div className="apply-inner apply-done">
          <span className="apply-tick" aria-hidden="true">{"✓"}</span>
          <h1>{"Application received"}</h1>
          <p className="apply-lede">
            {`${done.school_name} has your application for ${form.firstName} ${form.surname}.`}
          </p>

          <div className="apply-reference">
            <span className="label">{"Your reference"}</span>
            <strong>{done.reference}</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard?.writeText(done.reference).catch(() => {})}
            >
              {"Copy"}
            </button>
          </div>

          <p className="apply-note">
            {"Keep this reference. With the email address you gave, it is how you check progress — the school does not need to send you a login."}
          </p>

          <div className="apply-next">
            <div className="apply-next-title">{"What happens next"}</div>
            <ol>
              {NEXT_STEPS.map((step, i) => (
                <li key={step}>
                  <span className="apply-next-step-num" aria-hidden="true">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="btn-row" style={{ justifyContent: "center" }}>
            <Link to="/Apply/Status" className="btn btn-primary">
              {"Check the status"}
            </Link>
            <Link to="/Login" className="btn btn-secondary">
              {"Go to sign in"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- form */
  return (
    <div className="apply">
      <header className="apply-head">
        <div className="apply-inner">
          <div className="apply-brand">
            {school?.logo_url ? (
              <img src={school.logo_url} alt="" />
            ) : (
              <span>{(school?.name || "S").charAt(0).toUpperCase()}</span>
            )}
            <span>{school?.name || "Schoolivio"}</span>
          </div>
          <h1>{"Apply for admission"}</h1>
          <p className="apply-lede">
            {school
              ? `Complete this form to apply to ${school.name}. You do not need an account — you will be given a reference to track it with.`
              : "Complete this form to apply. You do not need an account."}
          </p>
          <p className="apply-lede" style={{ marginTop: -14, fontSize: 14 }}>
            {"Prefer to pay fees online and get updates without checking back? "}
            <Link to="/Apply/Account">{"Create an account instead"}</Link>
          </p>
          <ul className="apply-outline">
            {SECTIONS.map((s) => (
              <li key={s.num}>
                <span className="apply-outline-num">{s.num}</span>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main className="apply-inner">
        <form onSubmit={handleSubmit} className="apply-form">
          <p className="apply-required-key">{"Fields marked "}<Req />{" are required."}</p>

          <section>
            <h2><span className="apply-h2-num">{"1"}</span>{"The applicant"}</h2>
            <div className="apply-grid">
              <Field label={<>{"First name"}<Req /></>}>
                <input required className="input" value={form.firstName} onChange={update("firstName")} />
              </Field>
              <Field label="Middle name">
                <input className="input" value={form.middleName} onChange={update("middleName")} />
              </Field>
              <Field label={<>{"Surname"}<Req /></>}>
                <input required className="input" value={form.surname} onChange={update("surname")} />
              </Field>
              <Field label="Date of birth">
                <input type="date" className="input" value={form.dateOfBirth} onChange={update("dateOfBirth")} />
              </Field>
              <Field label="Gender">
                <select className="select" value={form.gender} onChange={update("gender")}>
                  <option value="">{"Prefer not to say"}</option>
                  <option value="Female">{"Female"}</option>
                  <option value="Male">{"Male"}</option>
                </select>
              </Field>
              <Field label="Applying for class" hint="The class level, if you know it.">
                <input
                  type="number"
                  className="input"
                  value={form.applyingForLevel}
                  onChange={update("applyingForLevel")}
                  placeholder="1"
                />
              </Field>
            </div>
            <Field label="Previous school" hint="Leave blank if this is their first school.">
              <input className="input" value={form.previousSchool} onChange={update("previousSchool")} />
            </Field>
          </section>

          <section>
            <h2><span className="apply-h2-num">{"2"}</span>{"Parent or guardian"}</h2>
            <p className="apply-hint">
              {"This is who the school will contact, and the email address you will use to check progress."}
            </p>
            <div className="apply-grid">
              <Field label={<>{"Full name"}<Req /></>}>
                <input required className="input" value={form.guardianName} onChange={update("guardianName")} />
              </Field>
              <Field label="Relationship">
                <select
                  className="select"
                  value={relationIsOther ? "Other" : form.guardianRelation}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "Other") {
                      setRelationIsOther(true);
                      setForm((c) => ({ ...c, guardianRelation: "" }));
                    } else {
                      setRelationIsOther(false);
                      setForm((c) => ({ ...c, guardianRelation: v }));
                    }
                  }}
                >
                  <option value="">{"Choose"}</option>
                  {GUARDIAN_RELATIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {relationIsOther ? (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    placeholder="Describe the relationship"
                    value={form.guardianRelation}
                    onChange={update("guardianRelation")}
                  />
                ) : null}
              </Field>
              <Field label={<>{"Email"}<Req /></>}>
                <input required type="email" className="input" value={form.guardianEmail} onChange={update("guardianEmail")} />
              </Field>
              <Field label="Phone">
                <input className="input" placeholder="0801 234 5678" value={form.guardianPhone} onChange={update("guardianPhone")} />
              </Field>
            </div>
            <Field label="Home address">
              <textarea className="textarea" style={{ minHeight: 80 }} value={form.address} onChange={update("address")} />
            </Field>
          </section>

          <section>
            <h2><span className="apply-h2-num">{"3"}</span>{"Anything else"}</h2>

            <Field
              label="Documents"
              hint="Birth certificate, previous results, a passport photograph — whatever you have. PDF or image, up to 15 MB each. The school can also collect these later if you'd rather not now."
            >
              <div className="apply-attach">
                {attachments.map((a) => (
                  <div key={a.key} className="apply-attach-row">
                    <div className="apply-attach-info">
                      <span className="apply-attach-name">{a.name}</span>
                      <span className="apply-attach-size">{formatBytes(a.size)}</span>
                    </div>
                    {a.status === "uploading" ? (
                      <span className="apply-attach-status">{"Uploading..."}</span>
                    ) : a.status === "error" ? (
                      <span className="apply-attach-status error">{a.error}</span>
                    ) : (
                      <select
                        className="select apply-attach-kind"
                        value={a.kind}
                        onChange={(e) => setAttachmentKind(a.key, e.target.value)}
                      >
                        {DOC_KINDS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      className="apply-attach-remove"
                      onClick={() => removeAttachment(a.key)}
                      aria-label={`Remove ${a.name}`}
                    >
                      {"Remove"}
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                >
                  {"Attach a file"}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={ACCEPTED_TYPES.join(",")}
                  hidden
                  onChange={(e) => {
                    attachFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            </Field>

            <Field
              label="Or paste document links instead"
              hint="Useful for a shared Google Drive folder rather than individual files."
            >
              <textarea
                className="textarea"
                style={{ minHeight: 60 }}
                value={form.documentLinks}
                onChange={update("documentLinks")}
                placeholder="https://drive.google.com/..."
              />
            </Field>
            <Field label="Notes for the school">
              <textarea className="textarea" style={{ minHeight: 90 }} value={form.notes} onChange={update("notes")} />
            </Field>
          </section>

          <Notice tone="error">{error}</Notice>

          <div className="apply-actions">
            <Button type="submit" disabled={submitting || uploadingCount > 0}>
              {submitting ? "Submitting..." : uploadingCount > 0 ? "Uploading..." : "Submit application"}
            </Button>
            <Link to="/Apply/Status" style={{ fontSize: 14 }}>
              {"Already applied? Check the status"}
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
};

export default Apply;
