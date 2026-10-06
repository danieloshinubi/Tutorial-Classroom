import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import { useSchool } from "../../context/SchoolContext";
import { CopyButton } from "../SchoolAdmin/people/ui";
import {
  connectMail,
  createAllMailboxes,
  disconnectMail,
  getMailSettings,
  mailPeople,
  moveAllToDomain,
  refreshMailDomain,
  setMailAddress,
  setReceiving,
  verifyMailDomain,
  type DnsRecord,
  type MailPerson,
  type MailSettings,
} from "../../lib/mailSettingsApi";
import { formatBytes } from "../../lib/mailApi";
import { ICON, Svg, btn, primaryBtn } from "./mailUi";
import OldMailAdmin from "./OldMailAdmin";
import { GroupAddressesCard, PersonManage, SafetyCard, SharedMailboxesCard } from "./MailAdminTools";

// School admin → Mail settings (supabase/236). Mail between staff works
// from day one. For mail to outside addresses the school connects its own
// free Resend account and its own domain: paste the key, add the DNS records
// shown here at the domain's DNS host, press Verify, and outside mail goes
// out from everyone's address on that domain. Addresses are managed here too.
// The account is the school's own, so its sending limits and standing are
// between the school and Resend.

const REGIONS = [
  { value: "us-east-1", label: "United States (default)" },
  { value: "eu-west-1", label: "Europe (Ireland)" },
  { value: "sa-east-1", label: "South America (São Paulo)" },
  { value: "ap-northeast-1", label: "Asia (Tokyo)" },
];

const input =
  "tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-[14px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]";

const STATUS: Record<string, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "tw-bg-success-soft tw-text-success" },
  pending: { label: "Checking", cls: "tw-bg-warn-soft tw-text-warn-ink" },
  not_started: { label: "Not added yet", cls: "tw-bg-bg tw-text-ink-3" },
  failed: { label: "Not found", cls: "tw-bg-danger-soft tw-text-danger" },
  temporary_failure: { label: "Not found yet", cls: "tw-bg-warn-soft tw-text-warn-ink" },
};
const Pill = ({ status }: { status: string }) => {
  const s = STATUS[status] || { label: status.replace(/_/g, " "), cls: "tw-bg-bg tw-text-ink-3" };
  return <span className={`tw-inline-flex tw-shrink-0 tw-items-center tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[12px] tw-font-semibold ${s.cls}`}>{s.label}</span>;
};

const Card = ({ step, title, children, aside }: { step?: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) => (
  <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 tw-shadow-1 mobile:tw-p-4">
    <header className="tw-mb-4 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
      <h3 className="tw-m-0 tw-flex tw-items-center tw-gap-2.5 tw-text-[16px] tw-font-semibold tw-text-ink">
        {step ? (
          <span className="tw-inline-flex tw-h-6 tw-w-6 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-soft tw-text-[12.5px] tw-font-bold tw-text-brand">{step}</span>
        ) : null}
        {title}
      </h3>
      {aside}
    </header>
    {children}
  </section>
);

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

// One DNS record: what to type into the domain's DNS host.
// The receiving MX record: the one MX not on the "send" return-path name
// (the same rule mail-settings uses). It belongs to receiving, not sending.
const isReceivingRecord = (r: DnsRecord) =>
  r.record.toLowerCase().includes("receiv") || (r.type === "MX" && !/^send(\.|$)/i.test(r.name));

const RecordRow = ({ r, domain, recommended }: { r: DnsRecord; domain: string; recommended?: boolean }) => (
  <li className="tw-grid tw-grid-cols-[72px_minmax(0,1fr)_minmax(0,2fr)_auto] tw-items-start tw-gap-3 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3 mobile:tw-grid-cols-1 mobile:tw-gap-1.5">
    <span className="tw-text-[13px] tw-font-bold tw-text-ink">
      {r.type}
      {r.priority != null ? <span className="tw-ml-1 tw-font-normal tw-text-ink-3">{`· ${r.priority}`}</span> : null}
    </span>
    <span className="tw-flex tw-min-w-0 tw-flex-col">
      <span className="tw-flex tw-items-center tw-gap-1">
        <code className="tw-truncate tw-text-[13px] tw-text-ink">{r.name || "@"}</code>
        <CopyButton value={r.name || "@"} label="Copy name" />
      </span>
      <span className="tw-truncate tw-text-[11.5px] tw-text-ink-3">{fullName(r.name, domain)}</span>
    </span>
    <span className="tw-flex tw-min-w-0 tw-items-start tw-gap-1">
      <code className="tw-min-w-0 tw-flex-1 tw-break-all tw-rounded-md tw-bg-bg tw-px-2 tw-py-1 tw-text-[12px] tw-leading-snug tw-text-ink">{r.value}</code>
      <CopyButton value={r.value} label="Copy value" />
    </span>
    {recommended ? (
      <span className="tw-inline-flex tw-shrink-0 tw-items-center tw-rounded-full tw-bg-bg tw-px-2 tw-py-0.5 tw-text-[12px] tw-font-semibold tw-text-ink-3">{"Recommended"}</span>
    ) : (
      <Pill status={r.status} />
    )}
  </li>
);

const PersonRow = ({
  p,
  domains,
  onSave,
  manage,
}: {
  p: MailPerson;
  domains: string[];
  onSave: (mailboxId: string, address: string) => Promise<boolean>;
  /** The admin's tools for this person (supabase/242), shown on Manage. */
  manage?: React.ReactNode;
}) => {
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [local, setLocal] = useState("");
  const [domain, setDomain] = useState(domains[0]);
  const [busy, setBusy] = useState(false);

  const start = () => {
    const [l, d] = (p.address || "").split("@");
    setLocal(l || "");
    setDomain(domains.includes(d) ? d : domains[0]);
    setEditing(true);
  };
  const save = async () => {
    if (!p.mailbox_id) return;
    setBusy(true);
    const ok = await onSave(p.mailbox_id, `${local.trim().toLowerCase()}@${domain}`);
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <li className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-2 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3">
      <span className="tw-flex tw-min-w-[180px] tw-flex-1 tw-flex-col">
        <span className="tw-text-[14px] tw-font-semibold tw-text-ink">
          {p.name}
          {p.is_active === false ? <span className="tw-ml-2 tw-rounded-full tw-bg-danger-soft tw-px-2 tw-py-0.5 tw-text-[11.5px] tw-font-semibold tw-text-danger">{"Suspended"}</span> : null}
        </span>
        <span className="tw-text-[12.5px] tw-text-ink-3">{p.job_title || p.role.replace(/_/g, " ")}{p.aliases?.length ? ` · also ${p.aliases.join(", ")}` : ""}</span>
      </span>
      {editing ? (
        <span className="tw-flex tw-min-w-0 tw-flex-[2] tw-flex-wrap tw-items-center tw-gap-2">
          <input
            className={`${input} tw-w-auto tw-min-w-[140px] tw-flex-1`}
            value={local}
            autoFocus
            aria-label="Part before the @"
            onChange={(e) => setLocal(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <span className="tw-text-[14px] tw-text-ink-3">{"@"}</span>
          {domains.length > 1 ? (
            <div className="tw-min-w-[200px]">
              <Select value={domain} onChange={(v: string) => setDomain(v)} options={domains.map((d) => ({ value: d, label: d }))} />
            </div>
          ) : (
            <span className="tw-text-[14px] tw-text-ink">{domain}</span>
          )}
          <button type="button" className={primaryBtn} disabled={busy || !local.trim()} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className={btn} onClick={() => setEditing(false)}>
            {"Cancel"}
          </button>
        </span>
      ) : (
        <span className="tw-flex tw-min-w-0 tw-flex-[2] tw-items-center tw-justify-between tw-gap-2">
          {p.address ? (
            <span className="tw-flex tw-min-w-0 tw-flex-col">
              <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                <span className="tw-truncate tw-text-[14px] tw-text-ink">{p.address}</span>
                <CopyButton value={p.address} />
              </span>
              <span className="tw-text-[12px] tw-text-ink-3">{`${formatBytes(Number(p.used_bytes || 0))} of ${formatBytes(Number(p.quota_bytes || 0))} used`}</span>
            </span>
          ) : (
            <span className="tw-text-[13.5px] tw-text-ink-3">{"No mailbox yet. One is made the first time they open Mail."}</span>
          )}
          {p.mailbox_id ? (
            <span className="tw-flex tw-shrink-0 tw-gap-1">
              <button type="button" className={btn} onClick={start}>
                <Svg d={ICON.compose} size={14} />
                {"Change"}
              </button>
              {manage ? (
                <button type="button" className={`${btn} ${managing ? "tw-bg-brand-soft tw-text-brand" : ""}`} onClick={() => setManaging((v) => !v)}>
                  <Svg d={ICON.settings} size={14} />
                  {"Manage"}
                </button>
              ) : null}
            </span>
          ) : null}
        </span>
      )}
      {managing && manage ? manage : null}
    </li>
  );
};

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

const MailSettingsPanel = () => {
  const { schoolId } = useSchool() as { schoolId: string };
  const { setError, setNotice } = useActionFeedback();
  const [s, setS] = useState<MailSettings | null>(null);
  const [people, setPeople] = useState<MailPerson[] | null>(null);
  const [domain, setDomain] = useState("");
  // Bumped on every reload, so the shared mailbox and group cards reload too.
  const [version, setVersion] = useState(0);
  // The form is filled from what is saved once per school, not on every
  // reload (those run every minute while Resend checks, and after each action).
  const seeded = useRef<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [settings, list] = await Promise.all([getMailSettings(schoolId), mailPeople(schoolId)]);
      setS(settings);
      setPeople(list);
      if (seeded.current !== schoolId) {
        seeded.current = schoolId;
        setDomain(settings.domain || "");
        setRegion(settings.region || "us-east-1");
      }
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [schoolId, setError]);

  useEffect(() => {
    load();
  }, [load]);

  // While Resend is still checking the records, look again every minute.
  const checking = !!s?.has_key && !!s.domain && (s.domain_status !== "verified" || (s.receiving_enabled && s.receiving_status !== "verified"));
  useEffect(() => {
    if (!checking || !schoolId) return undefined;
    const look = () => {
      if (document.visibilityState === "visible") refreshMailDomain(schoolId).then(load).catch(() => null);
    };
    const first = window.setTimeout(look, 1500);
    const t = window.setInterval(look, 60000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [checking, schoolId, load]);

  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await work();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    const next = domain.trim().toLowerCase();
    if (s?.domain && next !== s.domain && !(await confirmDialog(`Change the domain from ${s.domain} to ${next}? Outside mail will go out from ${next} once its DNS records are verified; addresses still on @${s.domain} stop sending outside until they are moved.`))) return;
    return run("connect", async () => {
      const r = await connectMail({ schoolId, domain: domain.trim(), apiKey: apiKey.trim() || undefined, region });
      setApiKey("");
      if (r.warning) setError(r.warning);
      setNotice(r.status === "verified" ? "Connected. Outside mail is on." : "Connected. Now add the DNS records below, then press Verify.");
    });
  };

  const domains = useMemo(() => (s ? [s.domain, s.fallback_domain].filter((d): d is string => !!d) : []), [s]);
  const missing = (people || []).filter((p) => !p.mailbox_id).length;
  const offDomain = s?.domain ? (people || []).filter((p) => p.address && !p.address.endsWith(`@${s.domain}`)).length : 0;
  const hasDmarc = (s?.dns_records || []).some((r) => r.name.startsWith("_dmarc"));
  const receivingRecord = (s?.dns_records || []).find(isReceivingRecord) || null;
  // A school with no domain of its own, on <slug>.schoolivio.com (supabase/239).
  const onSchoolivio = !!s?.domain && s.domain === s.fallback_domain;

  if (!s) return <div className="tw-p-6 tw-text-[14px] tw-text-ink-3">{"Loading mail settings…"}</div>;

  const banner = s.sending_enabled
    ? { cls: "tw-border-transparent tw-bg-success-soft", icon: ICON.sent, title: "Outside mail is on", text: `Mail to outside addresses goes out from @${s.domain} through the school's Resend account.` }
    : s.has_key && s.domain
      ? { cls: "tw-border-transparent tw-bg-warn-soft", icon: ICON.outbox, title: "Waiting for the DNS records", text: `Add the records in step 2 where ${s.domain}'s DNS is managed, then press Verify. It can take from a few minutes to a few hours to be seen.` }
      : { cls: "tw-border-line tw-bg-bg", icon: ICON.envelope, title: "Mail between staff already works", text: "To send to outside addresses (parents' Gmail, other schools, suppliers), connect the school's own Resend account and domain below." };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className={`tw-flex tw-items-start tw-gap-3 tw-rounded-2xl tw-border tw-border-solid tw-p-4 ${banner.cls}`}>
        <span className="tw-mt-0.5 tw-text-ink"><Svg d={banner.icon} size={20} /></span>
        <span className="tw-flex tw-flex-col tw-gap-0.5">
          <strong className="tw-text-[15px] tw-text-ink">{banner.title}</strong>
          <span className="tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">{banner.text}</span>
          {s.waiting ? (
            <span className="tw-text-[13.5px] tw-font-semibold tw-text-ink">
              {`${s.waiting} outside recipient${s.waiting === 1 ? " is" : "s are"} waiting in Outboxes${s.sending_enabled ? ", going out now." : ". They go as soon as outside mail is on."}`}
            </span>
          ) : null}
        </span>
      </div>

      <Card step="1" title="Connect the school's Resend account" aside={s.has_key ? <span className="tw-text-[12.5px] tw-text-ink-3">{`Connected ${when(s.connected_at)}`}</span> : null}>
        <ol className="tw-m-0 tw-mb-4 tw-flex tw-flex-col tw-gap-1 tw-pl-5 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
          <li>
            {"Create a free account at "}
            <a href="https://resend.com/signup" target="_blank" rel="noreferrer" className="tw-font-semibold tw-text-brand">{"resend.com"}</a>
            {" with the school's email (free: 3,000 emails a month, 100 a day)."}
          </li>
          <li>{"In Resend, open API Keys → Create API key, choose Full access, and copy the key."}</li>
          <li>{"Paste it below with the school's domain, and press Connect."}</li>
        </ol>
        <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"School's domain"}</span>
            <input className={input} value={domain} placeholder="charismartinschools.org" onChange={(e) => setDomain(e.target.value)} autoComplete="off" />
            {domain.trim().toLowerCase() !== s.fallback_domain ? (
              <button
                type="button"
                onClick={() => setDomain(s.fallback_domain)}
                className="tw-self-start tw-border-0 tw-bg-transparent tw-p-0 tw-text-[12.5px] tw-font-semibold tw-text-brand tw-cursor-pointer hover:tw-underline [font-family:inherit]"
              >
                {`No domain? Use ${s.fallback_domain}`}
              </button>
            ) : (
              <span className="tw-text-[12.5px] tw-text-ink-3">{"Schoolivio adds this domain's DNS records for you."}</span>
            )}
          </label>
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Resend API key"}</span>
            <input
              className={input}
              type="password"
              value={apiKey}
              placeholder={s.has_key ? `Saved (ends ${s.key_hint}). Leave blank to keep it.` : "re_…"}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Where Resend sends from"}</span>
            <Select value={region} onChange={(v: string) => setRegion(v)} options={REGIONS} />
          </label>
          <div className="tw-flex tw-items-end">
            <button type="button" className={primaryBtn} disabled={busy !== null || !domain.trim() || (!s.has_key && !apiKey.trim())} onClick={connect}>
              {busy === "connect" ? "Connecting…" : s.has_key ? "Save changes" : "Connect"}
            </button>
          </div>
        </div>
        <p className="tw-m-0 tw-mt-3 tw-text-[12.5px] tw-text-ink-3">{"The key is stored encrypted and is never shown again, to anyone."}</p>
      </Card>

      {s.domain && s.dns_records.length ? (
        <Card
          step="2"
          title={onSchoolivio ? `DNS records for ${s.domain}` : `Add these DNS records for ${s.domain}`}
          aside={
            <span className="tw-flex tw-items-center tw-gap-2">
              {s.checked_at ? <span className="tw-text-[12.5px] tw-text-ink-3">{`Checked ${when(s.checked_at)}`}</span> : null}
              <Pill status={s.domain_status} />
            </span>
          }
        >
          {onSchoolivio ? (
            <p className="tw-m-0 tw-mb-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
              {s.platform_dns_at
                ? `Schoolivio added these records ${when(s.platform_dns_at)}. Resend usually finds them within minutes; this page keeps looking while it is open.`
                : "Nothing to do here: Schoolivio adds these records to schoolivio.com for you, usually within a working day. This page shows them turning green."}
            </p>
          ) : (
            <p className="tw-m-0 tw-mb-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
              {"Add them where the domain's DNS is managed (Cloudflare, GoDaddy, Namecheap, Whogohost, Google…). They sit on "}
              <code>{"send"}</code>
              {" and "}
              <code>{"resend._domainkey"}</code>
              {", so the school's current email, Google Workspace or Microsoft 365 included, keeps working as it is."}
            </p>
          )}
          <ul className="tw-m-0 tw-list-none tw-p-0">
            {s.dns_records.filter((r) => !isReceivingRecord(r)).map((r, i) => (
              <RecordRow key={`${r.type}-${r.name}-${i}`} r={r} domain={s.domain as string} />
            ))}
            {!hasDmarc && !onSchoolivio ? (
              <RecordRow
                r={{ record: "DMARC", type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;", priority: null, status: "", ttl: "Auto" }}
                domain={s.domain}
                recommended
              />
            ) : null}
          </ul>
          {!hasDmarc && !onSchoolivio ? (
            <p className="tw-m-0 tw-mt-2 tw-text-[12.5px] tw-text-ink-3">{"Skip the DMARC record if the domain already has one. Gmail and Yahoo trust mail more with it."}</p>
          ) : null}
          <div className="tw-mt-4 tw-flex tw-flex-wrap tw-items-center tw-gap-3">
            <button type="button" className={primaryBtn} disabled={busy !== null} onClick={() => run("verify", () => verifyMailDomain(schoolId), "Asked Resend to check the records. This page keeps looking every minute while it is open.")}>
              {busy === "verify" ? "Checking…" : s.domain_status === "verified" ? "Check again" : "Verify"}
            </button>
            {s.domain_status !== "verified" ? (
              <span className="tw-text-[13px] tw-text-ink-3">{"New records can take a few minutes, sometimes a few hours, to be seen."}</span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {s.has_key && s.domain ? (
        <Card
          step="3"
          title="Receive outside mail"
          aside={s.receiving_enabled ? <Pill status={s.receiving_status === "off" ? "not_started" : s.receiving_status} /> : null}
        >
          {!s.receiving_enabled ? (
            <>
              <p className="tw-m-0 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
                {onSchoolivio
                  ? `Mail sent to the school's addresses from outside lands in each person's Schoolivio Inbox, with its attachments. Addresses at ${s.domain} that do not exist get a polite "not delivered" reply. Schoolivio adds the record it needs for you.`
                  : `Mail sent to the school's addresses from outside lands in each person's Schoolivio Inbox, with its attachments. Addresses at ${s.domain} that do not exist get a polite "not delivered" reply. Turning this on changes nothing yet: mail keeps going to the school's current provider until the record below is added.`}
              </p>
              <div className="tw-mt-4">
                <button type="button" className={primaryBtn} disabled={busy !== null} onClick={() => run("receiving", () => setReceiving(schoolId, true), "Receiving is on in Resend. Add the MX record when you are ready to switch.")}>
                  {busy === "receiving" ? "Turning on…" : "Turn on receiving"}
                </button>
              </div>
            </>
          ) : (
            <>
              {receivingRecord && onSchoolivio ? (
                <p className="tw-m-0 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
                  {receivingRecord.status === "verified"
                    ? `Mail to ${s.domain} addresses now arrives here.`
                    : "Schoolivio adds the receiving record to schoolivio.com for you. Mail starts arriving once it shows as verified."}
                </p>
              ) : receivingRecord ? (
                <>
                  <p className="tw-m-0 tw-mb-2 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
                    <strong className="tw-text-ink">{"Switch day: "}</strong>
                    {`add this record at ${s.domain}'s DNS host and remove the old MX records (Google, Microsoft…). From then on the school's mail arrives here instead. Do it once everyone is ready; keep the old provider for a month in case anything was missed.`}
                  </p>
                  <ul className="tw-m-0 tw-list-none tw-p-0">
                    <RecordRow r={receivingRecord} domain={s.domain} />
                  </ul>
                </>
              ) : (
                <p className="tw-m-0 tw-text-[13.5px] tw-text-ink-3">{"Resend is preparing the MX record. Press Check again in a moment."}</p>
              )}
              {!onSchoolivio ? (
                <div className="tw-mt-4 tw-rounded-xl tw-bg-bg tw-p-4">
                  <p className="tw-m-0 tw-text-[13.5px] tw-font-semibold tw-text-ink">{"Try it before switching"}</p>
                  <p className="tw-m-0 tw-mt-1 tw-text-[13px] tw-leading-relaxed tw-text-ink-2">
                    {"In Resend, open Receiving: the school's account has a test address ending in .resend.app. Mail sent to a person's name at it (the part before the @ in their address, e.g. "}
                    <code>{`${(people || []).find((p) => p.address)?.address?.split("@")[0] || "ada.obi"}@…resend.app`}</code>
                    {") lands in their Schoolivio Inbox. To try it with real mail, have the current provider forward a copy there."}
                  </p>
                </div>
              ) : null}
              <div className="tw-mt-4 tw-flex tw-flex-wrap tw-items-center tw-gap-3">
                <button type="button" className={btn} disabled={busy !== null} onClick={() => run("verify", () => verifyMailDomain(schoolId), "Checked the records again.")}>
                  {busy === "verify" ? "Checking…" : "Check again"}
                </button>
                {s.received_week ? (
                  <span className="tw-text-[13px] tw-text-ink-3">{`${s.received_week} message${s.received_week === 1 ? "" : "s"} received in the past week.`}</span>
                ) : null}
                <button
                  type="button"
                  className={`${btn} tw-ml-auto tw-text-danger`}
                  disabled={busy !== null}
                  onClick={async () => {
                    if (await confirmDialog("Turn off receiving? Mail sent to the school from outside will be dropped by Resend while the MX record still points there. Put the old provider's MX records back first if you have switched.")) {
                      run("receiving", () => setReceiving(schoolId, false), "Receiving is off.");
                    }
                  }}
                >
                  {"Turn off receiving"}
                </button>
              </div>
            </>
          )}
        </Card>
      ) : null}

      <Card
        step={s.domain ? (s.has_key ? "4" : "3") : "2"}
        title="Staff addresses"
        aside={
          <span className="tw-flex tw-flex-wrap tw-gap-2">
            {missing ? (
              <button type="button" className={btn} disabled={busy !== null} onClick={() => run("create", async () => setNotice(`Made ${await createAllMailboxes(schoolId)} mailboxes.`))}>
                {busy === "create" ? "Making…" : `Make mailboxes for everyone (${missing})`}
              </button>
            ) : null}
            {offDomain ? (
              <button
                type="button"
                className={btn}
                disabled={busy !== null}
                onClick={async () => {
                  if (await confirmDialog(`Move ${offDomain} address${offDomain === 1 ? "" : "es"} to @${s.domain}? The part before the @ stays the same, and mail to the old addresses still arrives.`)) {
                    run("move", async () => setNotice(`Moved ${await moveAllToDomain(schoolId)} addresses to @${s.domain}.`));
                  }
                }}
              >
                {busy === "move" ? "Moving…" : `Move everyone to @${s.domain}`}
              </button>
            ) : null}
          </span>
        }
      >
        <p className="tw-m-0 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
          {s.domain
            ? `Use each person's existing address on ${s.domain} where they have one, so outside replies reach them. Outside mail only goes from addresses on ${s.domain}.`
            : `Everyone has an address on ${s.fallback_domain} for mail inside the school. Add the school's domain above to give them addresses on it.`}
        </p>
        <ul className="tw-m-0 tw-mt-2 tw-list-none tw-p-0">
          {(people || []).map((p) => (
            <PersonRow
              key={p.user_id}
              p={p}
              domains={domains}
              manage={p.mailbox_id ? <PersonManage p={p} schoolId={schoolId} people={people || []} domains={domains} onChanged={load} /> : undefined}
              onSave={async (mailboxId, address) => {
                try {
                  await setMailAddress(mailboxId, address);
                  setNotice(`Address changed to ${address}. Mail to the old one still arrives.`);
                  await load();
                  return true;
                } catch (err) {
                  setError((err as Error).message);
                  return false;
                }
              }}
            />
          ))}
          {people && !people.length ? <li className="tw-py-3 tw-text-[13.5px] tw-text-ink-3">{"No staff yet."}</li> : null}
        </ul>
      </Card>

      <SharedMailboxesCard schoolId={schoolId} people={people || []} domains={domains} onChanged={load} version={version} />
      <GroupAddressesCard schoolId={schoolId} people={people || []} domains={domains} version={version} />
      <SafetyCard schoolId={schoolId} />

      <OldMailAdmin schoolId={schoolId} s={s} people={people || []} onChanged={load} />

      {s.has_key ? (
        <Card title="Delivery reports">
          <p className="tw-m-0 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
            {s.reports_on
              ? "On. Each sender sees, on their sent message, whether outside mail was delivered, delayed, bounced or marked as spam, and gets a note in their Inbox if it could not be delivered."
              : "Off. Mail still goes out, but senders will not see whether it was delivered. Press Save changes in step 1 to try switching them on again."}
          </p>
          {s.last_error ? <p className="tw-m-0 tw-mt-2 tw-text-[13px] tw-text-danger">{s.last_error}</p> : null}
          <div className="tw-mt-4 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-pt-4">
            <button
              type="button"
              className={`${btn} tw-text-danger`}
              disabled={busy !== null}
              onClick={async () => {
                if (await confirmDialog(`Disconnect the school's Resend account? Outside mail stops until it is connected again; mail between staff carries on.${s.receiving_enabled ? " Receiving is on: while the MX record still points at Resend, mail sent to the school from outside will be lost. Put the old provider's MX records back first." : ""}`)) {
                  run("disconnect", () => disconnectMail(schoolId), "Disconnected. Outside mail has stopped.");
                }
              }}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect Resend"}
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
};

export default MailSettingsPanel;
