import React, { useEffect, useState } from "react";
import { Button, Field } from "../../Components/UI";
import { createFamilyAccounts, fetchFamilyRequest, suggestUsername, type FamilyRequest, type FamilyResult } from "../../lib/familyAccountsApi";

// On a "New pupil account" ticket, for IT (the school's admins): make the
// pupil's and parent's accounts in one go, link them, and email the family
// their sign-in details (supabase/229). Shown only on such a ticket, to
// someone allowed to do it.

const FamilyAccountsCard = ({ ticketId, onDone }: { ticketId: string; onDone: () => void }) => {
  const [req, setReq] = useState<FamilyRequest | null>(null);
  const [username, setUsername] = useState("");
  const [pupilEmail, setPupilEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FamilyResult | null>(null);

  useEffect(() => {
    let live = true;
    fetchFamilyRequest(ticketId).then((r) => {
      if (!live) return;
      setReq(r);
      if (r) setUsername(suggestUsername(r.first_name, r.surname));
    });
    return () => {
      live = false;
    };
  }, [ticketId]);

  if (!req) return null;
  const pupil = [req.first_name, req.middle_name, req.surname].filter(Boolean).join(" ");

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await createFamilyAccounts({ ticketId, username: username.trim().toLowerCase(), pupilEmail: pupilEmail.trim() });
      setResult(r);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tk-card fam-card">
      <div className="tk-card-title">{"Pupil & parent accounts"}</div>

      {result ? (
        <div className="fam-done" role="status">
          <p>
            <strong>{"Done."}</strong>
            {` ${pupil} signs in with username `}
            <code>{result.username}</code>
            {`. The parent (${result.parentEmail}) ${result.parentNew ? "has a new account" : "already had one, now a parent here"}, linked to the pupil.`}
          </p>
          {result.emailedTo ? (
            <p>{`The sign-in details and portal address were emailed to ${result.emailedTo}.`}</p>
          ) : result.credentials ? (
            <div className="fam-creds">
              <p>{"No email could be sent, so pass these on to the family. They are shown only now."}</p>
              <div>{`Pupil: ${result.username} · ${result.credentials.pupilPassword}`}</div>
              {result.credentials.parentPassword ? <div>{`Parent: ${result.parentEmail} · ${result.credentials.parentPassword}`}</div> : null}
              <div>{`Portal: https://${req.slug}.schoolivio.com`}</div>
            </div>
          ) : null}
        </div>
      ) : req.student_account_id ? (
        <p className="fam-hint">
          {"Accounts already created. Pupil username: "}
          <code>{req.student_username || "—"}</code>
          {req.parent_linked ? " · parent linked." : "."}
        </p>
      ) : (
        <>
          <p className="fam-hint">
            {`Creates ${req.first_name}'s school account and the parent's (${req.guardian_email || "no email on file"}), links them, and emails both sign-ins and the portal address to ${req.applied_with || req.guardian_email || "the family"}.`}
          </p>
          <Field label="Pupil's username" hint="They sign in with this. Letters, numbers and dots.">
            <input className="input" value={username} maxLength={40} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Pupil's own email" hint="Optional. Leave empty if the pupil has none; the username is enough.">
            <input className="input" type="email" value={pupilEmail} placeholder={req.pupil_email || ""} onChange={(e) => setPupilEmail(e.target.value)} />
          </Field>
          {error ? (
            <p className="fam-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="button" disabled={busy || !username.trim() || !req.guardian_email} onClick={create}>
            {busy ? "Creating..." : "Create pupil & parent accounts"}
          </Button>
        </>
      )}
    </section>
  );
};

export default FamilyAccountsCard;
