import React from "react";
import { Button, formatDate } from "../../Components/UI";

// The merge tags a tenant admin can use in their custom intro/closing text
// (AdmissionsSettingsPanel's "Admission letter" tab) — kept in one place so
// the settings panel's hint text and the actual substitution here can never
// drift apart.
export const LETTER_MERGE_TAGS = [
  ["applicant_name", "The applicant's full name"],
  ["school_name", "The school's name"],
  ["guardian_name", "The guardian's name"],
  ["session_name", "The academic session, if any"],
  ["class_name", "The class/placement, if any"],
  ["reference", "The application reference"],
  ["registration_number", "The registration number, once enrolled"],
];

// {{tag}} → the matching value, or "" if that application has none (e.g.
// {{registration_number}} before enrolment) — never leaves the literal
// {{tag}} in printed output.
export const fillLetterMergeTags = (template, vars) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, tag) => vars[tag] ?? "");

// A custom paragraph can contain blank lines to mean "new paragraph" —
// split so multi-paragraph custom text doesn't print as one run-on block.
const renderParagraphs = (text) =>
  text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((para, i) => <p key={i}>{para}</p>);

// A printable letter the school can hand or email to the family.
//
// Laid out for A4 rather than for the screen: the print stylesheet drops the
// app's chrome and the on-screen controls, so what comes out of the printer is
// the letter and nothing else.
const AdmissionLetter = ({ application: app, className, onClose }) => {
  const school = app.schools || {};
  const fullName = [app.first_name, app.middle_name, app.surname]
    .filter(Boolean)
    .join(" ");
  const placement = className || app.classes?.name;

  const mergeVars = {
    applicant_name: fullName,
    school_name: school.name || "",
    guardian_name: app.guardian_name || "",
    session_name: app.sessions?.name || "",
    class_name: placement || "",
    reference: app.reference || "",
    registration_number: app.registration_number || "",
  };

  // A tenant admin's own wording, merge-tagged — falls back to the default
  // Schoolivio paragraphs below whenever they haven't set one, so a school
  // that customises nothing keeps the exact letter it always had.
  const customIntro =
    app.status === "enrolled"
      ? school.admission_letter_enrolled_intro
      : school.admission_letter_offer_intro;
  const customClosing = school.admission_letter_closing;

  return (
    <div className="letter-page">
      <div className="letter-toolbar">
        <Button variant="secondary" onClick={onClose}>{"Back"}</Button>
        <Button onClick={() => window.print()}>{"Print or save as PDF"}</Button>
      </div>

      <article className="letter">
        <header className="letter-head">
          <div>
            {school.logo_url ? (
              <img src={school.logo_url} alt="" className="letter-logo" />
            ) : null}
            <h1>{school.name}</h1>
            {school.address ? <p>{school.address}</p> : null}
            <p className="letter-contact">
              {[school.phone, school.email].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="letter-ref">
            <span>{"Ref"}</span>
            <strong>{app.reference}</strong>
            <span>{formatDate(new Date().toISOString(), { withTime: false })}</span>
          </div>
        </header>

        <h2 className="letter-title">
          {app.status === "enrolled" ? "Confirmation of Enrolment" : "Offer of Admission"}
        </h2>

        <p>{`Dear ${app.guardian_name},`}</p>

        {customIntro ? (
          renderParagraphs(fillLetterMergeTags(customIntro, mergeVars))
        ) : app.status === "enrolled" ? (
          <p>
            {`We are pleased to confirm that ${fullName} has been enrolled at ${school.name}`}
            {app.sessions ? ` for the ${app.sessions.name} academic session` : ""}
            {placement ? `, in ${placement}` : ""}
            {app.registration_number ? `, under registration number ${app.registration_number}` : ""}
            {"."}
          </p>
        ) : (
          <p>
            {`Following our review of the application submitted on your behalf, we are pleased to offer ${fullName} a place at ${school.name}`}
            {app.sessions ? ` for the ${app.sessions.name} academic session` : ""}
            {placement ? `, in ${placement}` : ""}
            {"."}
          </p>
        )}

        <table className="letter-table">
          <tbody>
            <tr>
              <th>{"Applicant"}</th>
              <td>{fullName}</td>
            </tr>
            {app.date_of_birth ? (
              <tr>
                <th>{"Date of birth"}</th>
                <td>{formatDate(app.date_of_birth, { withTime: false })}</td>
              </tr>
            ) : null}
            {app.sessions ? (
              <tr>
                <th>{"Session"}</th>
                <td>{app.sessions.name}</td>
              </tr>
            ) : null}
            {placement ? (
              <tr>
                <th>{"Class"}</th>
                <td>{placement}</td>
              </tr>
            ) : null}
            <tr>
              <th>{"Reference"}</th>
              <td>{app.reference}</td>
            </tr>
            {app.registration_number ? (
              <tr>
                <th>{"Registration number"}</th>
                <td>{app.registration_number}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {app.status === "offered" && app.offer_expires_at ? (
          <p>
            {`This offer is open until ${formatDate(app.offer_expires_at, {
              withTime: false,
            })}. Please confirm acceptance before that date so the place can be held.`}
          </p>
        ) : null}

        {app.status !== "enrolled" ? (
          <p>
            {"Details of fees and the items required for resumption will follow separately. Please quote the reference above in any correspondence."}
          </p>
        ) : null}

        {customClosing ? (
          renderParagraphs(fillLetterMergeTags(customClosing, mergeVars))
        ) : (
          <p>{"We look forward to welcoming your family to the school."}</p>
        )}

        <div className="letter-sign">
          <p>{"Yours faithfully,"}</p>
          {school.signature_url ? (
            <img src={school.signature_url} alt="" className="letter-signature" />
          ) : (
            <div className="letter-rule" />
          )}
          {school.signatory_name || school.signatory_title ? (
            <>
              {school.signatory_name ? (
                <p className="letter-role">{school.signatory_name}</p>
              ) : null}
              {school.signatory_title ? (
                <p className="letter-role">{school.signatory_title}</p>
              ) : null}
            </>
          ) : (
            <p className="letter-role">{"For the Principal"}</p>
          )}
          <p className="letter-role">{school.name}</p>
        </div>

        <footer className="letter-foot">
          {`Issued through Schoolivio${school.slug ? ` · ${school.slug}.schoolivio.com` : ""}`}
        </footer>
      </article>
    </div>
  );
};

export default AdmissionLetter;
