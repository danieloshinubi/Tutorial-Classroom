import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker, Select } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { formatBytes } from "../../lib/mailApi";
import { controlImport, importsFor, startImapImport, uploadAndImport, type MailImport } from "../../lib/mailImportApi";
import { btn, primaryBtn } from "./mailUi";
import { cancelPst, onPst, pstState, startPst, type PstState } from "./pstImport";

// "Import old mail" (supabase/240): a person brings their mail across from
// the provider the school is leaving, once. From an email account (any
// provider, by IMAP), a Google Takeout .mbox, or .eml files. It runs in the
// background; this shows each import's progress live, and lets an account
// import catch up on switch day with whatever arrived since.

const input =
  "tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-[14px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]";

const PROVIDERS: Record<string, { label: string; host: string; port: number; security: string; note: string }> = {
  google: { label: "Gmail / Google Workspace", host: "imap.gmail.com", port: 993, security: "ssl", note: "Use an app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password. IMAP must be allowed in Gmail settings." },
  zoho: { label: "Zoho Mail", host: "imap.zoho.com", port: 993, security: "ssl", note: "Turn on IMAP access in Zoho Mail settings first. With two-factor sign-in, use an app-specific password." },
  yahoo: { label: "Yahoo Mail", host: "imap.mail.yahoo.com", port: 993, security: "ssl", note: "Use an app password from Yahoo Account Security." },
  icloud: { label: "iCloud Mail", host: "imap.mail.me.com", port: 993, security: "ssl", note: "Use an app-specific password from appleid.apple.com." },
  cpanel: { label: "cPanel / hosting company", host: "", port: 993, security: "ssl", note: "The server is usually mail.yourdomain.com; your hosting company's email settings page shows it." },
  other: { label: "Other provider", host: "", port: 993, security: "ssl", note: "Your provider's IMAP settings: server, port and security." },
};

const STATUS: Record<MailImport["status"], { label: string; cls: string }> = {
  queued: { label: "Waiting to start", cls: "tw-bg-bg tw-text-ink-3" },
  running: { label: "Importing", cls: "tw-bg-brand-soft tw-text-brand" },
  done: { label: "Done", cls: "tw-bg-success-soft tw-text-success" },
  failed: { label: "Stopped", cls: "tw-bg-danger-soft tw-text-danger" },
  cancelled: { label: "Cancelled", cls: "tw-bg-bg tw-text-ink-3" },
};

export const ImportRow = ({ imp, onChanged, showWho }: { imp: MailImport; onChanged: () => void; showWho?: string }) => {
  const { setError, setNotice } = useActionFeedback();
  const s = STATUS[imp.status];
  const act = async (action: "cancel" | "catch_up") => {
    try {
      await controlImport(imp.id, action);
      setNotice(action === "cancel" ? "Import stopped." : "Catching up: only mail that arrived since is brought across.");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <li className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-3 tw-gap-y-1 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3">
      <span className={`tw-inline-flex tw-shrink-0 tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[12px] tw-font-semibold ${s.cls}`}>{s.label}</span>
      <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
        <span className="tw-truncate tw-text-[14px] tw-font-semibold tw-text-ink">{showWho ? `${showWho} · ${imp.label}` : imp.label}</span>
        <span className="tw-text-[12.5px] tw-text-ink-3">
          {`${imp.imported.toLocaleString()} brought across${imp.skipped ? ` · ${imp.skipped.toLocaleString()} already here` : ""}${imp.failed ? ` · ${imp.failed.toLocaleString()} could not be read` : ""}${imp.bytes ? ` · ${formatBytes(imp.bytes)}` : ""}`}
        </span>
        {imp.last_error && imp.status !== "done" ? <span className="tw-text-[12.5px] tw-text-danger">{imp.last_error}</span> : null}
      </span>
      <span className="tw-flex tw-gap-1">
        {imp.status === "queued" || imp.status === "running" ? (
          <button type="button" className={btn} onClick={() => act("cancel")}>{"Stop"}</button>
        ) : (imp.source === "imap" || imp.source === "microsoft") ? (
          <button type="button" className={btn} onClick={() => act("catch_up")} title="Bring across only what arrived since">{"Catch up"}</button>
        ) : null}
      </span>
    </li>
  );
};

const ImportMail = ({ mailboxId, liveTick = 0 }: { mailboxId: string; liveTick?: number }) => {
  const { setError, setNotice } = useActionFeedback();
  const [tab, setTab] = useState<"account" | "pst" | "mbox" | "eml">("account");
  const [pst, setPst] = useState<PstState>(pstState());
  useEffect(() => onPst(setPst), []);
  // The list follows the .pst as its parts arrive.
  useEffect(() => {
    if (pst.uploaded || pst.finished) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pst.uploaded, pst.finished]);
  const [list, setList] = useState<MailImport[] | null>(null);
  const [provider, setProvider] = useState("google");
  const [host, setHost] = useState(PROVIDERS.google.host);
  const [port, setPort] = useState(String(PROVIDERS.google.port));
  const [security, setSecurity] = useState(PROVIDERS.google.security);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [since, setSince] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState<"inbox" | "sent" | "archive">("inbox");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const load = useCallback(() => {
    importsFor(mailboxId).then(setList).catch((err: Error) => setError(err.message));
  }, [mailboxId, setError]);
  useEffect(load, [load, liveTick]);
  // While something is running, look again every few seconds too.
  const running = useMemo(() => (list || []).some((i) => i.status === "queued" || i.status === "running"), [list]);
  useEffect(() => {
    if (!running) return undefined;
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [running, load]);

  const pick = (key: string) => {
    setProvider(key);
    setHost(PROVIDERS[key].host);
    setPort(String(PROVIDERS[key].port));
    setSecurity(PROVIDERS[key].security);
  };

  const startAccount = async () => {
    setBusy(true);
    try {
      await startImapImport({
        mailboxId, host: host.trim(), port: Number(port) || 993, security, username: username.trim(), password,
        since: since || null, label: `${PROVIDERS[provider].label} (${username.trim()})`,
      });
      setPassword("");
      setNotice("Signed in. Your old mail is coming across in the background; you can close this and carry on.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startFiles = async () => {
    setBusy(true);
    setProgress(0);
    try {
      await uploadAndImport({ mailboxId, kind: tab === "mbox" ? "mbox" : "eml", files, folder, onProgress: setProgress });
      setFiles([]);
      setNotice("Uploaded. Your old mail is coming across in the background; you can close this and carry on.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setTab(id);
        setFiles([]);
      }}
      className={`tw-rounded-full tw-border tw-border-solid tw-px-3 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-cursor-pointer [font-family:inherit] ${
        tab === id ? "tw-border-brand tw-bg-brand-soft tw-text-brand" : "tw-border-line tw-bg-surface tw-text-ink-2 hover:tw-border-brand"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        {tabBtn("account", "From an email account")}
        {tabBtn("mbox", "Google Takeout (.mbox)")}
        {tabBtn("pst", "Outlook (.pst)")}
        {tabBtn("eml", ".eml files")}
      </div>

      {tab === "pst" ? (
        <div className="tw-flex tw-flex-col tw-gap-3">
          <p className="tw-m-0 tw-text-[13px] tw-leading-relaxed tw-text-ink-2">
            {"In Outlook: File → Open & Export → Import/Export → Export to a file → Outlook Data File (.pst), choose the mailbox, and save it. Or use the .pst you already have (an .ost works too). Any size is fine: it is read here on your computer and only the mail itself is sent up, a part at a time. Folders come across as they were; calendars and contacts are left out."}
          </p>
          {pst.running || pst.finished || pst.error ? (
            <div className="tw-rounded-xl tw-bg-bg tw-p-4">
              <p className="tw-m-0 tw-text-[14px] tw-font-semibold tw-text-ink">
                {pst.running ? `Reading ${pst.fileName}` : pst.error ? `Stopped: ${pst.fileName}` : `Finished reading ${pst.fileName}`}
              </p>
              <div className="tw-mt-2 tw-h-2 tw-overflow-hidden tw-rounded-full tw-bg-line">
                <div className="tw-h-full tw-rounded-full tw-bg-brand tw-transition-all" style={{ width: `${pst.total ? Math.min(100, Math.round((pst.read / pst.total) * 100)) : pst.finished ? 100 : 3}%` }} />
              </div>
              <p className="tw-m-0 tw-mt-1.5 tw-text-[12.5px] tw-text-ink-3">
                {`${pst.read.toLocaleString()} of about ${pst.total.toLocaleString()} read · ${pst.uploaded.toLocaleString()} sent up (${formatBytes(pst.bytes)})`}
              </p>
              {pst.running ? (
                <p className="tw-m-0 tw-mt-1.5 tw-text-[12.5px] tw-text-warn-ink">{"Keep this browser tab open until reading finishes. You can close this window and keep working in Schoolivio."}</p>
              ) : null}
              {pst.error ? <p className="tw-m-0 tw-mt-1.5 tw-text-[12.5px] tw-text-danger">{pst.error}</p> : null}
              {pst.running ? (
                <button type="button" className={`${btn} tw-mt-2`} onClick={cancelPst}>{"Stop reading"}</button>
              ) : null}
            </div>
          ) : null}
          {!pst.running ? (
            <>
              <input
                type="file"
                accept=".pst,.ost"
                onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 1))}
                className="tw-text-[13px] tw-text-ink [font-family:inherit]"
              />
              {files[0] ? <p className="tw-m-0 tw-text-[12.5px] tw-text-ink-3">{`${files[0].name}, ${formatBytes(files[0].size)}`}</p> : null}
              <div>
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={busy || !files[0] || !/\.(pst|ost)$/i.test(files[0]?.name || "")}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await startPst(mailboxId, files[0]);
                      setFiles([]);
                      setNotice("Reading your Outlook file. Keep this browser tab open until it finishes.");
                      load();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Starting…" : "Read and import"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : tab === "account" ? (
        <div className="tw-flex tw-flex-col tw-gap-3">
          <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Provider"}</span>
              <Select value={provider} onChange={(v: string) => pick(v)} options={Object.entries(PROVIDERS).map(([value, p]) => ({ value, label: p.label }))} />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Email address"}</span>
              <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@yourschool.org" autoComplete="off" />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{provider === "google" ? "App password" : "Password"}</span>
              <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Only mail since (optional)"}</span>
              <DatePicker value={since} onChange={(v: string) => setSince(v || "")} placeholder="All of it" />
            </label>
            {provider === "cpanel" || provider === "other" ? (
              <>
                <label className="tw-flex tw-flex-col tw-gap-1">
                  <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"IMAP server"}</span>
                  <input className={input} value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.yourschool.org" autoComplete="off" />
                </label>
                <div className="tw-grid tw-grid-cols-2 tw-gap-3">
                  <label className="tw-flex tw-flex-col tw-gap-1">
                    <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Port"}</span>
                    <input className={input} inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <label className="tw-flex tw-flex-col tw-gap-1">
                    <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Security"}</span>
                    <Select value={security} onChange={(v: string) => setSecurity(v)} options={[{ value: "ssl", label: "SSL/TLS" }, { value: "starttls", label: "STARTTLS" }, { value: "none", label: "None" }]} />
                  </label>
                </div>
              </>
            ) : null}
          </div>
          <p className="tw-m-0 tw-rounded-lg tw-bg-bg tw-px-3 tw-py-2 tw-text-[12.5px] tw-leading-relaxed tw-text-ink-2">
            {PROVIDERS[provider].note}
            {" Every folder comes across: Inbox, Sent, Drafts, Junk and Deleted to the same folders here, everything else to Archive. The password is kept encrypted only so you can catch up on switch day, and deleted 30 days after."}
          </p>
          <p className="tw-m-0 tw-text-[12.5px] tw-text-ink-3">{"On Microsoft 365? Your school admin can bring everyone's mail across at once from Mail settings, with no passwords."}</p>
          <div>
            <button type="button" className={primaryBtn} disabled={busy || !username.trim() || !password || !host.trim()} onClick={startAccount}>
              {busy ? "Signing in…" : "Start importing"}
            </button>
          </div>
        </div>
      ) : (
        <div className="tw-flex tw-flex-col tw-gap-3">
          <p className="tw-m-0 tw-text-[13px] tw-leading-relaxed tw-text-ink-2">
            {tab === "mbox"
              ? "Download your mail from Google Takeout (takeout.google.com → Mail), unzip it, and choose the .mbox file. Large files are fine: they are sent in parts. Gmail's labels decide the folder (Inbox, Sent, Spam, Trash; the rest to Archive)."
              : "Choose .eml files (from Outlook, Thunderbird or Apple Mail: drag messages to a folder to save them as files). They go into the folder you pick."}
          </p>
          <input
            type="file"
            multiple={tab === "eml"}
            accept={tab === "mbox" ? ".mbox,application/mbox" : ".eml,message/rfc822"}
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="tw-text-[13px] tw-text-ink [font-family:inherit]"
          />
          {files.length ? <p className="tw-m-0 tw-text-[12.5px] tw-text-ink-3">{`${files.length} file${files.length === 1 ? "" : "s"}, ${formatBytes(files.reduce((n, f) => n + f.size, 0))}`}</p> : null}
          {tab === "eml" ? (
            <label className="tw-flex tw-max-w-[260px] tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Put them in"}</span>
              <Select value={folder} onChange={(v: string) => setFolder(v as typeof folder)} options={[{ value: "inbox", label: "Inbox" }, { value: "sent", label: "Sent" }, { value: "archive", label: "Archive" }]} />
            </label>
          ) : null}
          {progress !== null ? (
            <div className="tw-h-2 tw-overflow-hidden tw-rounded-full tw-bg-line">
              <div className="tw-h-full tw-rounded-full tw-bg-brand tw-transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          ) : null}
          <div>
            <button type="button" className={primaryBtn} disabled={busy || !files.length} onClick={startFiles}>
              {busy ? (progress !== null ? `Uploading ${Math.round((progress || 0) * 100)}%…` : "Starting…") : "Upload and import"}
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="tw-m-0 tw-text-[13px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{"Your imports"}</p>
        <ul className="tw-m-0 tw-list-none tw-p-0">
          {(list || []).map((imp) => <ImportRow key={imp.id} imp={imp} onChanged={load} />)}
          {list && !list.length ? <li className="tw-py-3 tw-text-[13.5px] tw-text-ink-3">{"Nothing imported yet."}</li> : null}
        </ul>
      </div>
    </div>
  );
};

export default ImportMail;
