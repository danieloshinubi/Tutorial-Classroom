import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "../Components/UI";
import { useActionFeedback } from "../Components/Toast";
import { formatBytes } from "../lib/mailApi";
import { addSchoolDns, mailOverview, microsoftApp, saveMicrosoftApp, saveVercelToken, type MailOverview, type SchoolMail } from "../lib/platformMailApi";

// Console → Mail (supabase/239). Every school's Schoolivio Mail at a glance:
// its domain (its own, its schoolivio.com one, or none yet), whether outside
// sending and receiving are on, mailboxes and storage, and the past week's
// sent, received and failed mail. Schools on <slug>.schoolivio.com need their
// records in schoolivio.com's DNS (Vercel): "Add DNS records" does it in one
// click with the token saved here, keeping the school's website where it is.

// A record's full name. Resend gives names relative to the registrable
// domain, so for a subdomain (slug.schoolivio.com) a name may already end in
// "slug" ("send.slug"); adding the domain again would double it.
const fullName = (name: string, domain: string) => {
  if (!name || name === "@") return domain;
  const labels = domain.split(".");
  for (let k = labels.length - 1; k >= 1; k -= 1) {
    const lead = labels.slice(0, k).join(".");
    if (name === lead) return domain;
    if (name.endsWith(`.${lead}`)) return `${name.slice(0, -lead.length - 1)}.${domain}`;
  }
  return `${name}.${domain}`;
};

const input =
  "tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-[14px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]";
const btn =
  "tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-text-ink tw-cursor-pointer hover:tw-border-brand disabled:tw-cursor-not-allowed disabled:tw-opacity-50 [font-family:inherit]";
const primary =
  "tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-lg tw-border-0 tw-bg-brand tw-px-3.5 tw-py-2 tw-text-[13px] tw-font-semibold tw-text-white tw-cursor-pointer hover:tw-opacity-90 disabled:tw-cursor-not-allowed disabled:tw-opacity-50 [font-family:inherit]";

const Pill = ({ tone, children }: { tone: "ok" | "warn" | "bad" | "off"; children: React.ReactNode }) => {
  const cls = { ok: "tw-bg-success-soft tw-text-success", warn: "tw-bg-warn-soft tw-text-warn-ink", bad: "tw-bg-danger-soft tw-text-danger", off: "tw-bg-bg tw-text-ink-3" }[tone];
  return <span className={`tw-inline-flex tw-items-center tw-whitespace-nowrap tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[12px] tw-font-semibold ${cls}`}>{children}</span>;
};

const sending = (s: SchoolMail) =>
  s.sending_enabled ? <Pill tone="ok">{"On"}</Pill>
    : !s.domain ? <Pill tone="off">{"Not set up"}</Pill>
      : !s.has_key ? <Pill tone="warn">{"No Resend key"}</Pill>
        : s.domain_status === "failed" ? <Pill tone="bad">{"Records not found"}</Pill>
          : <Pill tone="warn">{"Waiting for DNS"}</Pill>;

const receiving = (s: SchoolMail) =>
  !s.receiving_enabled ? <Pill tone="off">{"Off"}</Pill>
    : s.receiving_status === "verified" ? <Pill tone="ok">{"On"}</Pill>
      : s.receiving_status === "failed" ? <Pill tone="bad">{"MX not found"}</Pill>
        : <Pill tone="warn">{"Waiting for MX"}</Pill>;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

const SchoolRow = ({ s, canDns, busy, onDns }: { s: SchoolMail; canDns: boolean; busy: boolean; onDns: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <li className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3">
      <div className="tw-grid tw-grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto_auto_minmax(0,1fr)_minmax(0,1.1fr)_auto] tw-items-center tw-gap-3 mobile:tw-grid-cols-2">
        <span className="tw-flex tw-min-w-0 tw-flex-col">
          <span className="tw-truncate tw-text-[14px] tw-font-semibold tw-text-ink">{s.name}</span>
          <span className="tw-truncate tw-text-[12px] tw-text-ink-3">{s.slug}</span>
        </span>
        <span className="tw-flex tw-min-w-0 tw-flex-col">
          <span className="tw-truncate tw-text-[13.5px] tw-text-ink">{s.domain || "—"}</span>
          <span className="tw-text-[12px] tw-text-ink-3">
            {s.kind === "own" ? "Own domain" : s.kind === "schoolivio" ? "schoolivio.com" : "No domain yet"}
            {s.reports_on ? "" : s.has_key ? " · reports off" : ""}
          </span>
        </span>
        <span className="tw-flex tw-flex-col tw-gap-0.5"><span className="tw-text-[11px] tw-uppercase tw-tracking-wide tw-text-ink-3">{"Send"}</span>{sending(s)}</span>
        <span className="tw-flex tw-flex-col tw-gap-0.5"><span className="tw-text-[11px] tw-uppercase tw-tracking-wide tw-text-ink-3">{"Receive"}</span>{receiving(s)}</span>
        <span className="tw-flex tw-flex-col tw-text-[12.5px] tw-text-ink-2">
          <span>{`${s.mailboxes} mailbox${s.mailboxes === 1 ? "" : "es"}`}</span>
          <span className="tw-text-ink-3">{formatBytes(Number(s.used_bytes) || 0)}</span>
        </span>
        <span className="tw-flex tw-flex-col tw-text-[12.5px] tw-text-ink-2">
          <span>{`${s.sent_week} sent · ${s.received_week} in`}</span>
          <span className={s.failed_week || s.waiting ? "tw-text-danger" : "tw-text-ink-3"}>
            {`${s.failed_week} failed${s.waiting ? ` · ${s.waiting} waiting` : ""}`}
          </span>
        </span>
        <span className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2 mobile:tw-col-span-2 mobile:tw-justify-start">
          {s.kind === "schoolivio" && s.dns_records.length ? (
            <button type="button" className={btn} onClick={() => setOpen((o) => !o)}>{open ? "Hide records" : "Records"}</button>
          ) : null}
          {s.kind === "schoolivio" && s.has_key ? (
            <button
              type="button"
              className={s.needs_dns ? primary : btn}
              disabled={!canDns || busy}
              title={canDns ? "" : "Save the Vercel token first"}
              onClick={onDns}
            >
              {busy ? "Adding…" : s.needs_dns ? "Add DNS records" : "Add again"}
            </button>
          ) : null}
        </span>
      </div>
      {s.last_error ? <p className="tw-m-0 tw-mt-1.5 tw-text-[12.5px] tw-text-danger">{s.last_error}</p> : null}
      {open ? (
        <div className="tw-mt-2 tw-overflow-x-auto tw-rounded-lg tw-bg-bg tw-p-3">
          <p className="tw-m-0 tw-mb-2 tw-text-[12px] tw-text-ink-3">
            {s.platform_dns_at ? `Added by Schoolivio ${when(s.platform_dns_at)}.` : "Not added yet."}
            {` Names are under ${s.slug} in schoolivio.com.`}
          </p>
          <table className="tw-w-full tw-border-collapse tw-text-[12px]">
            <tbody>
              {s.dns_records.map((r, i) => (
                <tr key={i} className="tw-align-top">
                  <td className="tw-py-1 tw-pr-3 tw-font-semibold tw-text-ink">{r.type}</td>
                  <td className="tw-py-1 tw-pr-3 tw-text-ink">{fullName(r.name, `${s.slug}.schoolivio.com`).replace(/\.schoolivio\.com$/, "")}</td>
                  <td className="tw-break-all tw-py-1 tw-pr-3 tw-text-ink-2">{r.value}</td>
                  <td className="tw-py-1"><Pill tone={r.status === "verified" ? "ok" : r.status === "failed" ? "bad" : "warn"}>{r.status === "verified" ? "Found" : r.status === "failed" ? "Not found" : "Pending"}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
};

// Tekktopia's Microsoft app (supabase/240): schools on Microsoft 365 approve
// it once, and every member of staff's mail comes across without passwords.
const REDIRECT = `${process.env.REACT_APP_SUPABASE_URL || ""}/functions/v1/mail-import`;
const MicrosoftCard = () => {
  const { setError, setNotice } = useActionFeedback();
  const [app, setApp] = useState<{ client_id: string | null; ready: boolean } | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    microsoftApp().then((a) => {
      setApp(a);
      setClientId((c) => c || a.client_id || "");
    }).catch((err: Error) => setError(err.message));
  }, [setError]);
  useEffect(load, [load]);
  if (!app) return null;
  return (
    <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 mobile:tw-p-4">
      <div className="tw-mb-2 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h3 className="tw-m-0 tw-text-[16px] tw-font-semibold tw-text-ink">{"Microsoft 365 imports"}</h3>
        <Pill tone={app.ready ? "ok" : "warn"}>{app.ready ? "Ready" : "Not set up"}</Pill>
      </div>
      <p className="tw-m-0 tw-mb-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
        {"Lets a school on Microsoft 365 bring all its staff's old mail across after one approval by its own administrator. Register an app in Microsoft Entra (Azure) → App registrations: accounts in any organisational directory; redirect URI (Web) "}
        <code className="tw-break-all">{REDIRECT}</code>
        {"; API permissions, Microsoft Graph, Application: Mail.Read and User.Read.All; then a client secret under Certificates & secrets."}
      </p>
      <div className="tw-flex tw-flex-wrap tw-items-end tw-gap-3">
        <label className="tw-flex tw-min-w-[260px] tw-flex-1 tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Application (client) ID"}</span>
          <input className={input} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
        </label>
        <label className="tw-flex tw-min-w-[220px] tw-flex-1 tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Client secret"}</span>
          <input className={input} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={app.ready ? "Saved. Paste a new one only to replace it." : ""} autoComplete="new-password" />
        </label>
        <button
          type="button"
          className={primary}
          disabled={busy || !clientId.trim() || (!app.ready && !secret.trim())}
          onClick={async () => {
            setBusy(true);
            try {
              await saveMicrosoftApp(clientId.trim(), secret.trim());
              setSecret("");
              setNotice("Microsoft app saved. Schools can now approve Microsoft 365 imports.");
              load();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
};

const PlatformMail = () => {
  const { setError, setNotice } = useActionFeedback();
  const [data, setData] = useState<MailOverview | null>(null);
  const [token, setToken] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "dns" | "on" | "problems">("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await mailOverview();
      setData(d);
      setTeam((t) => t || d.vercel_team_id || "");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.schools || []).filter((s) => {
      if (needle && !`${s.name} ${s.slug} ${s.domain || ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "dns") return s.needs_dns;
      if (filter === "on") return s.sending_enabled;
      if (filter === "problems") return s.failed_week > 0 || s.waiting > 0 || !!s.last_error || s.domain_status === "failed";
      return true;
    });
  }, [data, filter, search]);

  if (!data) return <Page title="Mail"><p className="tw-text-[14px] tw-text-ink-3">{"Loading…"}</p></Page>;

  const schools = data.schools;
  const counts = {
    on: schools.filter((s) => s.sending_enabled).length,
    receiving: schools.filter((s) => s.receiving_enabled && s.receiving_status === "verified").length,
    dns: schools.filter((s) => s.needs_dns).length,
    problems: schools.filter((s) => s.failed_week > 0 || s.waiting > 0 || !!s.last_error || s.domain_status === "failed").length,
  };
  const storage = schools.reduce((n, s) => n + (Number(s.used_bytes) || 0), 0);
  const boxes = schools.reduce((n, s) => n + (Number(s.mailboxes) || 0), 0);

  const dns = async (s: SchoolMail) => {
    setBusy(s.school_id);
    try {
      const r = await addSchoolDns(s.school_id);
      setNotice(`${s.name}: ${r.added || 0} record${r.added === 1 ? "" : "s"} added${r.pinned ? `, website address kept (${r.pinned})` : ""}. ${r.status === "verified" ? "Resend found them: outside mail is on." : "Resend is checking them now."}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Mail" subtitle="Every school's Schoolivio Mail: outside sending and receiving, storage, and schoolivio.com addresses">
      <div className="tw-flex tw-flex-col tw-gap-4">
        <div className="tw-grid tw-grid-cols-4 tw-gap-3 mobile:tw-grid-cols-2">
          {[
            { label: "Sending outside", value: `${counts.on} of ${schools.length}` },
            { label: "Receiving outside", value: String(counts.receiving) },
            { label: "Need DNS records", value: String(counts.dns), tone: counts.dns ? "tw-text-warn-ink" : "" },
            { label: "Mailboxes · storage", value: `${boxes} · ${formatBytes(storage)}` },
          ].map((k) => (
            <div key={k.label} className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-4">
              <p className="tw-m-0 tw-text-[12px] tw-uppercase tw-tracking-wide tw-text-ink-3">{k.label}</p>
              <p className={`tw-m-0 tw-mt-1 tw-text-[20px] tw-font-semibold tw-text-ink ${k.tone || ""}`}>{k.value}</p>
            </div>
          ))}
        </div>

        <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 mobile:tw-p-4">
          <div className="tw-mb-2 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
            <h3 className="tw-m-0 tw-text-[16px] tw-font-semibold tw-text-ink">{"schoolivio.com DNS (Vercel)"}</h3>
            <Pill tone={data.vercel_connected ? "ok" : "warn"}>{data.vercel_connected ? "Connected" : "Not set up"}</Pill>
          </div>
          <p className="tw-m-0 tw-mb-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
            {"Schools without a domain of their own send from <slug>.schoolivio.com. Their records go in schoolivio.com's DNS, which Vercel hosts. A token lets the button below add them for you. In Vercel: Account Settings → Tokens → Create, scoped to the team that owns schoolivio.com."}
          </p>
          <div className="tw-flex tw-flex-wrap tw-items-end tw-gap-3">
            <label className="tw-flex tw-min-w-[240px] tw-flex-[2] tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Vercel token"}</span>
              <input className={input} type="password" autoComplete="new-password" value={token} placeholder={data.vercel_connected ? "Saved. Paste a new one only to replace it." : ""} onChange={(e) => setToken(e.target.value)} />
            </label>
            <label className="tw-flex tw-min-w-[180px] tw-flex-1 tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Team ID (if schoolivio.com is in a team)"}</span>
              <input className={input} value={team} placeholder="team_…" onChange={(e) => setTeam(e.target.value)} autoComplete="off" />
            </label>
            <button
              type="button"
              className={primary}
              disabled={!token.trim() || busy !== null}
              onClick={async () => {
                setBusy("vercel");
                try {
                  await saveVercelToken(token.trim(), team.trim());
                  setToken("");
                  setNotice("Vercel token saved. schoolivio.com's DNS can now be updated from here.");
                  await load();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "vercel" ? "Checking…" : data.vercel_connected ? "Replace" : "Save"}
            </button>
          </div>
        </section>

        <MicrosoftCard />

        <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 mobile:tw-p-4">
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            {([
              ["all", `All (${schools.length})`],
              ["dns", `Need DNS (${counts.dns})`],
              ["on", `Sending (${counts.on})`],
              ["problems", `Problems (${counts.problems})`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`tw-rounded-full tw-border tw-border-solid tw-px-3 tw-py-1 tw-text-[12.5px] tw-font-semibold tw-cursor-pointer [font-family:inherit] ${
                  filter === id ? "tw-border-brand tw-bg-brand-soft tw-text-brand" : "tw-border-line tw-bg-surface tw-text-ink-2 hover:tw-border-brand"
                }`}
              >
                {label}
              </button>
            ))}
            <input className={`${input} tw-ml-auto tw-max-w-[260px] mobile:tw-ml-0 mobile:tw-max-w-none`} placeholder="Search schools or domains" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="tw-m-0 tw-mt-3 tw-list-none tw-p-0">
            {list.map((s) => (
              <SchoolRow key={s.school_id} s={s} canDns={data.vercel_connected} busy={busy === s.school_id} onDns={() => dns(s)} />
            ))}
            {!list.length ? <li className="tw-py-6 tw-text-center tw-text-[13.5px] tw-text-ink-3">{"No schools match."}</li> : null}
          </ul>
        </section>
      </div>
    </Page>
  );
};

export default PlatformMail;
