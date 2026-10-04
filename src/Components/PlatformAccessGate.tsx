import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useSchool } from "../context/SchoolContext";
import { resolveSlug } from "../lib/tenant";
import { cancelSchoolAccessRequest, requestSchoolAccess, type PlatformAccess } from "../lib/schoolAccessApi";
import { formatDate } from "./UI";
import { Mark } from "./Logo";

// What a Schoolivio console account sees at a school it has not been let
// into (supabase/224): ask the school for access with a reason, then wait
// for one of its owners or admins to approve it for a set time, or decline.
// Nothing of the school shows until then.
const PlatformAccessGate = ({ access }: { access: PlatformAccess }) => {
  const { reload } = useSchool();
  const { signOut } = useAuth();
  const slug = resolveSlug();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const schoolName = access.school_name || slug;

  // While waiting, check every 20 seconds whether the school has answered.
  useEffect(() => {
    if (access.state !== "pending") return undefined;
    const timer = setInterval(() => reload(), 20000);
    return () => clearInterval(timer);
  }, [access.state, reload]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (reason.trim().length < 3) return setError("Say why you need access, so the school can decide.");
    setBusy(true);
    try {
      await requestSchoolAccess(slug, reason.trim());
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelSchoolAccessRequest(slug);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="pag-page">
      <div className="pag-card">
        <div className="pag-brand">
          <Mark size={22} />
          {"Schoolivio support"}
        </div>

        {access.state === "pending" ? (
          <>
            <h1>{`Waiting for ${schoolName}`}</h1>
            <p className="pag-lede">
              {"Your request went to the school's owners and admins. This page opens by itself as soon as one of them approves it."}
            </p>
            <div className="pag-quote">
              <span>{"You asked"}</span>
              <p>{access.reason}</p>
              {access.requested_at ? <small>{formatDate(access.requested_at)}</small> : null}
            </div>
            {error ? <p className="pag-error" role="alert">{error}</p> : null}
            <div className="pag-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => reload()}>
                {"Check now"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancel}>
                {"Cancel request"}
              </button>
            </div>
          </>
        ) : access.state === "no_school" ? (
          <>
            <h1>{"There's no school at this address"}</h1>
            <p className="pag-lede">{"Check the address and try again."}</p>
          </>
        ) : (
          <>
            <h1>{`Ask ${schoolName} for access`}</h1>
            <p className="pag-lede">
              {"Your Schoolivio account needs this school's approval to come in. Its owners and admins are told who you are and why; one of them lets you in for a set time, after which access ends by itself."}
            </p>
            {access.last_status === "declined" ? (
              <p className="pag-note">
                {`Your last request was declined${access.last_note ? `: “${access.last_note}”` : "."}`}
              </p>
            ) : access.last_status === "ended" ? (
              <p className="pag-note">{"Your last access to this school has ended."}</p>
            ) : null}
            <form onSubmit={send}>
              <label className="field">
                <span className="label">{"Why you need access"}</span>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={500}
                  autoFocus
                  value={reason}
                  placeholder="e.g. The bursar asked us to fix a fee structure that will not save."
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {error ? <p className="pag-error" role="alert">{error}</p> : null}
              <div className="pag-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Sending..." : "Request access"}
                </button>
              </div>
            </form>
          </>
        )}

        <p className="pag-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => signOut()}>
            {"Sign out"}
          </button>
        </p>
      </div>
    </main>
  );
};

// While a console account is inside a school on time-limited access: a
// standing label saying so, and the page closing when the time is up.
export const SupportAccessPill = ({ expiresAt }: { expiresAt: string }) => {
  useEffect(() => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!(ms > 0)) return undefined;
    // setTimeout cannot wait longer than about 24.8 days; access is at most a week.
    const timer = setTimeout(() => window.location.reload(), Math.min(ms + 1500, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return (
    <div className="support-pill" role="status">
      {`Schoolivio support access · ends ${new Date(expiresAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`}
    </div>
  );
};

export default PlatformAccessGate;
