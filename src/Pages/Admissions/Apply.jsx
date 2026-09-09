import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { resolveSlug } from "../../lib/tenant";
import { submitApplication } from "../../lib/api";
import { Field, Button, Notice } from "../../Components/UI";

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

    setSubmitting(true);
    try {
      const result = await submitApplication({ slug, ...form });
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
        </div>
      </header>

      <main className="apply-inner">
        <form onSubmit={handleSubmit} className="apply-form">
          <section>
            <h2>{"The applicant"}</h2>
            <div className="apply-grid">
              <Field label="First name">
                <input required className="input" value={form.firstName} onChange={update("firstName")} />
              </Field>
              <Field label="Middle name">
                <input className="input" value={form.middleName} onChange={update("middleName")} />
              </Field>
              <Field label="Surname">
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
            <h2>{"Parent or guardian"}</h2>
            <p className="apply-hint">
              {"This is who the school will contact, and the email address you will use to check progress."}
            </p>
            <div className="apply-grid">
              <Field label="Full name">
                <input required className="input" value={form.guardianName} onChange={update("guardianName")} />
              </Field>
              <Field label="Relationship">
                <input className="input" placeholder="Mother" value={form.guardianRelation} onChange={update("guardianRelation")} />
              </Field>
              <Field label="Email">
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
            <h2>{"Anything else"}</h2>
            <Field
              label="Documents"
              hint="Paste links to a birth certificate, previous results or a passport photograph. The school can also collect these later."
            >
              <textarea
                className="textarea"
                style={{ minHeight: 80 }}
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
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit application"}
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
