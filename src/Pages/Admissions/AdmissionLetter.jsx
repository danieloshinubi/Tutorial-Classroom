import React from "react";
import { Button, formatDate } from "../../Components/UI";

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

        {app.status === "enrolled" ? (
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

        <p>{"We look forward to welcoming your family to the school."}</p>

        <div className="letter-sign">
          <p>{"Yours faithfully,"}</p>
          <div className="letter-rule" />
          <p className="letter-role">{"For the Principal"}</p>
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
