import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import type { MailPerson, MailSettings } from "../../lib/mailSettingsApi";
import { microsoftConsentLink, microsoftImportEveryone, schoolImports, type MailImport } from "../../lib/mailImportApi";
import { ImportRow } from "./ImportMail";
import { btn, primaryBtn } from "./mailUi";

// School admin → Mail settings → "Bring old mail across" (supabase/240).
// Each person can import their own mail (Mail → Import old mail). For a
// school on Microsoft 365 the admin approves Schoolivio once and brings
// everyone's mail across together, with no passwords. Every import in the
// school is listed here with its progress; on switch day, "Catch up all"
// brings across whatever arrived since.

const OldMailAdmin = ({ schoolId, s, people, onChanged }: { schoolId: string; s: MailSettings; people: MailPerson[]; onChanged: () => void }) => {
  const { setError, setNotice } = useActionFeedback();
  const [list, setList] = useState<MailImport[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    schoolImports(schoolId).then(setList).catch((err: Error) => setError(err.message));
  }, [schoolId, setError]);
  useEffect(load, [load]);
  const running = useMemo(() => (list || []).some((i) => i.status === "queued" || i.status === "running"), [list]);
  useEffect(() => {
    if (!running) return undefined;
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, [running, load]);

  // Back from Microsoft's approval screen.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const result = q.get("microsoft");
    if (!result) return;
    if (result === "ok") setNotice("Microsoft 365 approved. You can now bring everyone's mail across.");
    else setError(`Microsoft 365 was not approved: ${q.get("reason") || "unknown reason"}`);
    q.delete("microsoft");
    q.delete("reason");
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
    onChanged();
  }, [setNotice, setError, onChanged]);

  const names = useMemo(() => new Map(people.filter((p) => p.mailbox_id).map((p) => [p.mailbox_id as string, p.name])), [people]);
  const total = (list || []).reduce((n, i) => n + i.imported, 0);

  const approve = async () => {
    setBusy("approve");
    try {
      const r = await microsoftConsentLink(schoolId, `${window.location.origin}/School?tab=mail`);
      if (r.url) window.location.href = r.url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const everyone = async () => {
    const count = people.filter((p) => p.mailbox_id).length;
    if (!(await confirmDialog(`Bring across the Microsoft 365 mail of all ${count} staff with mailboxes? It runs in the background, one after another; mail already here is skipped.`))) return;
    setBusy("everyone");
    try {
      const r = await microsoftImportEveryone(schoolId);
      setNotice(`${r.started} import${r.started === 1 ? "" : "s"} started.${r.problems?.length ? ` Not started: ${r.problems.join("; ")}` : ""}`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 tw-shadow-1 mobile:tw-p-4">
      <header className="tw-mb-3 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h3 className="tw-m-0 tw-text-[16px] tw-font-semibold tw-text-ink">{"Bring old mail across"}</h3>
        {total ? <span className="tw-text-[12.5px] tw-text-ink-3">{`${total.toLocaleString()} messages brought across so far`}</span> : null}
      </header>
      <p className="tw-m-0 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
        {"When the school leaves its old provider, everyone's mail can come with it, once. Each person can do their own from Mail → Import old mail (Gmail and Google Workspace, Zoho, Yahoo, cPanel or any provider, a Google Takeout file, or .eml files). On switch day, press Catch up on each import to bring across what arrived since."}
      </p>

      <div className="tw-mt-4 tw-rounded-xl tw-bg-bg tw-p-4">
        <p className="tw-m-0 tw-text-[14px] tw-font-semibold tw-text-ink">{"Microsoft 365: everyone at once"}</p>
        {!s.microsoft_ready ? (
          <p className="tw-m-0 tw-mt-1 tw-text-[13px] tw-text-ink-3">{"Not switched on for Schoolivio yet. Please contact Schoolivio support; meanwhile staff can import their own mail."}</p>
        ) : !s.microsoft_consent_at ? (
          <>
            <p className="tw-m-0 tw-mt-1 tw-text-[13px] tw-leading-relaxed tw-text-ink-2">
              {"A Microsoft 365 administrator of the school approves Schoolivio once (read-only access to mail). Then every member of staff's mail comes across without anyone's password, matched by their address."}
            </p>
            <button type="button" className={`${primaryBtn} tw-mt-3`} disabled={busy !== null} onClick={approve}>
              {busy === "approve" ? "Opening Microsoft…" : "Approve with Microsoft 365"}
            </button>
          </>
        ) : (
          <>
            <p className="tw-m-0 tw-mt-1 tw-text-[13px] tw-text-ink-2">
              {`Approved ${new Date(s.microsoft_consent_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}. Each person's Schoolivio address must match their Microsoft 365 address (set them under Staff addresses).`}
            </p>
            <div className="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
              <button type="button" className={primaryBtn} disabled={busy !== null} onClick={everyone}>
                {busy === "everyone" ? "Starting…" : "Bring everyone's mail across"}
              </button>
              <button type="button" className={btn} disabled={busy !== null} onClick={approve}>{"Approve again"}</button>
            </div>
          </>
        )}
      </div>

      <ul className="tw-m-0 tw-mt-3 tw-list-none tw-p-0">
        {(list || []).map((imp) => <ImportRow key={imp.id} imp={imp} onChanged={load} showWho={names.get(imp.mailbox_id) || "Someone"} />)}
        {list && !list.length ? <li className="tw-py-3 tw-text-[13.5px] tw-text-ink-3">{"No imports yet."}</li> : null}
      </ul>
    </section>
  );
};

export default OldMailAdmin;
