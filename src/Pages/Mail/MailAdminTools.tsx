import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import {
  convertToShared,
  deleteGroupAddress,
  deleteMailbox,
  groupAddresses,
  mailSafety,
  saveGroupAddress,
  saveSharedMailbox,
  setMailAliases,
  setMailboxActive,
  setMailQuota,
  sharedMailboxes,
  type GroupAddress,
  type MailSafety,
  type MailSafetyPatch,
  type MailPerson,
  type SharedAccess,
  type SharedMailbox,
} from "../../lib/mailSettingsApi";
import { formatBytes } from "../../lib/mailApi";
import { ICON, Svg, btn, primaryBtn } from "./mailUi";

// School admin → Mail settings, the admin's tools (supabase/242):
// shared mailboxes (admissions@, bursar@) and who can open them; group
// addresses (ss3teachers@) and their members; and per person: storage,
// other addresses, suspend / resume, turn into a shared mailbox, delete;
// and safety (supabase/243).

const input =
  "tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-[14px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]";

const ACCESS: { value: SharedAccess; label: string }[] = [
  { value: "full", label: "Full access (sends as it)" },
  { value: "on_behalf", label: "Sends on behalf of it" },
  { value: "read", label: "Read only" },
];

const Section = ({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) => (
  <section className="tw-rounded-2xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5 tw-shadow-1 mobile:tw-p-4">
    <header className="tw-mb-3 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
      <h3 className="tw-m-0 tw-text-[16px] tw-font-semibold tw-text-ink">{title}</h3>
      {aside}
    </header>
    {children}
  </section>
);

// An address: the part before the @, and which of the school's domains.
const AddressInput = ({ value, onChange, domains }: { value: string; onChange: (v: string) => void; domains: string[] }) => {
  const [local, dom] = value.includes("@") ? value.split("@") : [value, domains[0]];
  return (
    <span className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
      <input className={`${input} tw-w-auto tw-min-w-[150px] tw-flex-1`} value={local} placeholder="admissions"
        onChange={(e) => onChange(`${e.target.value.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase()}@${dom || domains[0]}`)} />
      <span className="tw-text-[14px] tw-text-ink-3">{"@"}</span>
      {domains.length > 1 ? (
        <div className="tw-min-w-[200px]">
          <Select value={dom || domains[0]} onChange={(v: string) => onChange(`${local}@${v}`)} options={domains.map((d) => ({ value: d, label: d }))} />
        </div>
      ) : (
        <span className="tw-text-[14px] tw-text-ink">{domains[0]}</span>
      )}
    </span>
  );
};

// Ticking people, with a search once the list is long.
function usePicker<T extends { key: string; label: string; sub?: string }>(items: T[]) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return items.filter((i) => !n || `${i.label} ${i.sub || ""}`.toLowerCase().includes(n));
  }, [items, q]);
  const search = items.length > 8 ? <input className={`${input} tw-mb-2`} placeholder="Search staff" value={q} onChange={(e) => setQ(e.target.value)} /> : null;
  return { shown, search };
}

/* ---------------------------------------------------------------- shared */

const SharedEditor = ({ schoolId, start, people, domains, onDone }: {
  schoolId: string; start: SharedMailbox | null; people: MailPerson[]; domains: string[]; onDone: (saved: boolean) => void;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const [name, setName] = useState(start?.name ?? "");
  const [address, setAddress] = useState(start?.address ?? `@${domains[0]}`);
  // Only current staff: someone who has left cannot be shown, so could not be
  // unticked, and saving would then always fail.
  const [members, setMembers] = useState<Record<string, SharedAccess>>(() =>
    Object.fromEntries((start?.members ?? []).filter((m) => people.some((p) => p.user_id === m.user_id)).map((m) => [m.user_id, m.access])));
  const [busy, setBusy] = useState(false);
  const staff = useMemo(() => people.map((p) => ({ key: p.user_id, label: p.name, sub: p.job_title || p.role })), [people]);
  const { shown, search } = usePicker(staff);
  const save = async () => {
    setBusy(true);
    try {
      await saveSharedMailbox({ schoolId, id: start?.id, name, address, members: Object.entries(members).map(([user_id, access]) => ({ user_id, access })) });
      setNotice(`${name} saved.`);
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tw-mb-3 tw-rounded-xl tw-bg-bg tw-p-4">
      <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Name people see"}</span>
          <input className={input} value={name} placeholder="Admissions" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Address"}</span>
          <AddressInput value={address} onChange={setAddress} domains={domains} />
        </label>
      </div>
      <p className="tw-m-0 tw-mb-2 tw-mt-4 tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Who can open it"}</p>
      {search}
      <ul className="tw-m-0 tw-max-h-[280px] tw-list-none tw-overflow-y-auto tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-0">
        {shown.map((s) => (
          <li key={s.key} className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2 last:tw-border-b-0">
            <label className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2 tw-text-[14px] tw-text-ink">
              <input type="checkbox" checked={!!members[s.key]} onChange={(e) => setMembers((m) => {
                const next = { ...m };
                if (e.target.checked) next[s.key] = "full";
                else delete next[s.key];
                return next;
              })} />
              <span className="tw-truncate">{s.label}</span>
              <span className="tw-truncate tw-text-[12px] tw-text-ink-3">{s.sub}</span>
            </label>
            {members[s.key] ? (
              <div className="tw-w-[230px]">
                <Select value={members[s.key]} onChange={(v: string) => setMembers((m) => ({ ...m, [s.key]: v as SharedAccess }))} options={ACCESS} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="tw-mt-3 tw-flex tw-gap-2">
        <button type="button" className={primaryBtn} disabled={busy || !name.trim() || !address.split("@")[0]} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className={btn} onClick={() => onDone(false)}>{"Cancel"}</button>
      </div>
    </div>
  );
};

export const SharedMailboxesCard = ({ schoolId, people, domains, onChanged, version = 0 }: { schoolId: string; people: MailPerson[]; domains: string[]; onChanged: () => void; version?: number }) => {
  const { setError } = useActionFeedback();
  const [list, setList] = useState<SharedMailbox[] | null>(null);
  const [editing, setEditing] = useState<SharedMailbox | "new" | null>(null);
  const load = useCallback(() => {
    sharedMailboxes(schoolId).then(setList).catch((err: Error) => setError(err.message));
    // version: the page reloaded (a person turned into a shared mailbox).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, setError, version]);
  useEffect(load, [load]);
  return (
    <Section title="Shared mailboxes" aside={<button type="button" className={btn} onClick={() => setEditing("new")}><Svg d={ICON.inbox} size={14} />{"New shared mailbox"}</button>}>
      <p className="tw-m-0 tw-mb-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
        {"One mailbox several people work from, like admissions@ or bursar@. Members see it under their own mailbox in Mail; replies go out from the shared address."}
      </p>
      {editing ? (
        <SharedEditor schoolId={schoolId} start={editing === "new" ? null : editing} people={people} domains={domains}
          onDone={(saved) => {
            setEditing(null);
            if (saved) {
              load();
              onChanged();
            }
          }} />
      ) : null}
      <ul className="tw-m-0 tw-list-none tw-p-0">
        {(list || []).map((s) => (
          <li key={s.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-1 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3">
            <span className="tw-flex tw-min-w-[200px] tw-flex-1 tw-flex-col">
              <span className="tw-text-[14px] tw-font-semibold tw-text-ink">{s.name}{!s.is_active ? <span className="tw-ml-2 tw-text-[12px] tw-text-danger">{"Suspended"}</span> : null}</span>
              <span className="tw-text-[12.5px] tw-text-ink-3">{`${s.address} · ${formatBytes(Number(s.used_bytes))} used`}</span>
            </span>
            <span className="tw-flex-[2] tw-text-[12.5px] tw-text-ink-2">
              {s.members.length ? s.members.map((m) => `${m.name}${m.access === "read" ? " (read)" : m.access === "on_behalf" ? " (on behalf)" : ""}`).join(", ") : "Nobody can open it yet"}
            </span>
            <button type="button" className={btn} onClick={() => setEditing(s)}>{"Edit"}</button>
          </li>
        ))}
        {list && !list.length && !editing ? <li className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3 tw-text-[13.5px] tw-text-ink-3">{"No shared mailboxes yet."}</li> : null}
      </ul>
    </Section>
  );
};

/* ---------------------------------------------------------------- groups */

const GroupEditor = ({ schoolId, start, people, shared, domains, onDone }: {
  schoolId: string; start: GroupAddress | null; people: MailPerson[]; shared: SharedMailbox[]; domains: string[]; onDone: (saved: boolean) => void;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const [name, setName] = useState(start?.name ?? "");
  const [address, setAddress] = useState(start?.address ?? `@${domains[0]}`);
  const [outside, setOutside] = useState(start?.allow_outside ?? false);
  const [members, setMembers] = useState<Set<string>>(new Set((start?.members ?? []).map((m) => m.mailbox_id)));
  const [busy, setBusy] = useState(false);
  const boxes = useMemo(() => [
    ...people.filter((p) => p.mailbox_id).map((p) => ({ key: p.mailbox_id as string, label: p.name, sub: p.address || "" })),
    ...shared.map((s) => ({ key: s.id, label: s.name, sub: `${s.address} · shared` })),
  ], [people, shared]);
  const { shown, search } = usePicker(boxes);
  const save = async () => {
    setBusy(true);
    try {
      await saveGroupAddress({ schoolId, id: start?.id, name, address, allowOutside: outside, members: Array.from(members) });
      setNotice(`${name} saved. Mail to ${address} now reaches ${members.size} ${members.size === 1 ? "mailbox" : "mailboxes"}.`);
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tw-mb-3 tw-rounded-xl tw-bg-bg tw-p-4">
      <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Group name"}</span>
          <input className={input} value={name} placeholder="SS3 teachers" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Address"}</span>
          <AddressInput value={address} onChange={setAddress} domains={domains} />
        </label>
      </div>
      <label className="tw-mt-3 tw-flex tw-items-center tw-gap-2 tw-text-[13.5px] tw-text-ink">
        <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
        {"Accept mail from outside the school (parents, other schools)"}
      </label>
      <p className="tw-m-0 tw-mb-2 tw-mt-4 tw-text-[13px] tw-font-semibold tw-text-ink-2">{`Members (${members.size})`}</p>
      {search}
      <ul className="tw-m-0 tw-max-h-[280px] tw-list-none tw-overflow-y-auto tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-0">
        {shown.map((b) => (
          <li key={b.key} className="tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2 last:tw-border-b-0">
            <label className="tw-flex tw-items-center tw-gap-2 tw-text-[14px] tw-text-ink">
              <input type="checkbox" checked={members.has(b.key)} onChange={(e) => setMembers((m) => {
                const next = new Set(m);
                if (e.target.checked) next.add(b.key);
                else next.delete(b.key);
                return next;
              })} />
              <span className="tw-truncate">{b.label}</span>
              <span className="tw-truncate tw-text-[12px] tw-text-ink-3">{b.sub}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="tw-m-0 tw-mt-2 tw-text-[12.5px] tw-text-ink-3">{"Only staff with a mailbox are listed. Make mailboxes for everyone under Staff addresses first."}</p>
      <div className="tw-mt-3 tw-flex tw-gap-2">
        <button type="button" className={primaryBtn} disabled={busy || !name.trim() || !address.split("@")[0] || !members.size} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className={btn} onClick={() => onDone(false)}>{"Cancel"}</button>
        {start ? (
          <button type="button" className={`${btn} tw-ml-auto tw-text-danger`} onClick={async () => {
            if (!(await confirmDialog(`Delete the group address ${start.address}? Mail to it will no longer arrive anywhere.`))) return;
            try {
              await deleteGroupAddress(start.id);
              setNotice("Group address deleted.");
              onDone(true);
            } catch (err) {
              setError((err as Error).message);
            }
          }}>{"Delete group"}</button>
        ) : null}
      </div>
    </div>
  );
};

export const GroupAddressesCard = ({ schoolId, people, domains, version = 0 }: { schoolId: string; people: MailPerson[]; domains: string[]; version?: number }) => {
  const { setError } = useActionFeedback();
  const [list, setList] = useState<GroupAddress[] | null>(null);
  const [shared, setShared] = useState<SharedMailbox[]>([]);
  const [editing, setEditing] = useState<GroupAddress | "new" | null>(null);
  const load = useCallback(() => {
    Promise.all([groupAddresses(schoolId), sharedMailboxes(schoolId)])
      .then(([g, s]) => {
        setList(g);
        setShared(s);
      })
      .catch((err: Error) => setError(err.message));
    // version: the page reloaded (a shared mailbox may be new).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, setError, version]);
  useEffect(load, [load]);
  return (
    <Section title="Group addresses" aside={<button type="button" className={btn} onClick={() => setEditing("new")}><Svg d={ICON.users} size={14} />{"New group address"}</button>}>
      <p className="tw-m-0 tw-mb-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
        {"An address that hands each message to its members' own Inboxes, like ss3teachers@ or exams@. Everyone can write to it; outside senders only if you allow it."}
      </p>
      {editing ? (
        <GroupEditor schoolId={schoolId} start={editing === "new" ? null : editing} people={people} shared={shared} domains={domains}
          onDone={(saved) => {
            setEditing(null);
            if (saved) load();
          }} />
      ) : null}
      <ul className="tw-m-0 tw-list-none tw-p-0">
        {(list || []).map((g) => (
          <li key={g.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-1 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3">
            <span className="tw-flex tw-min-w-[200px] tw-flex-1 tw-flex-col">
              <span className="tw-text-[14px] tw-font-semibold tw-text-ink">{g.name}</span>
              <span className="tw-text-[12.5px] tw-text-ink-3">{`${g.address}${g.allow_outside ? " · takes outside mail" : " · inside the school only"}`}</span>
            </span>
            <span className="tw-flex-[2] tw-truncate tw-text-[12.5px] tw-text-ink-2">{`${g.members.length} ${g.members.length === 1 ? "member" : "members"}: ${g.members.slice(0, 5).map((m) => m.name).join(", ")}${g.members.length > 5 ? "…" : ""}`}</span>
            <button type="button" className={btn} onClick={() => setEditing(g)}>{"Edit"}</button>
          </li>
        ))}
        {list && !list.length && !editing ? <li className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3 tw-text-[13.5px] tw-text-ink-3">{"No group addresses yet."}</li> : null}
      </ul>
    </Section>
  );
};

/* ---------------------------------------------------------------- one person */

export const PersonManage = ({ p, schoolId, people, domains, onChanged }: { p: MailPerson; schoolId: string; people: MailPerson[]; domains: string[]; onChanged: () => void }) => {
  const { setError, setNotice } = useActionFeedback();
  const [aliases, setAliases] = useState((p.aliases || []).join(", "));
  // A rename or a move to the domain adds the old address here: show it, or
  // the next save would drop it.
  const saved = (p.aliases || []).join(", ");
  useEffect(() => setAliases(saved), [saved]);
  const [quota, setQuota] = useState(String(Math.round(Number(p.quota_bytes || 5368709120) / 1073741824)));
  const [convertTo, setConvertTo] = useState<string[]>([]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const id = p.mailbox_id as string;
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      setNotice(done);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tw-mt-2 tw-flex tw-w-full tw-flex-col tw-gap-4 tw-rounded-xl tw-bg-bg tw-p-4">
      <div className="tw-grid tw-grid-cols-[160px_1fr_auto] tw-items-end tw-gap-3 mobile:tw-grid-cols-1">
        <label className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Storage"}</span>
          <Select value={quota} onChange={(v: string) => setQuota(v)} options={["1", "2", "5", "10", "25", "50"].map((g) => ({ value: g, label: `${g} GB` }))} />
        </label>
        <span className="tw-text-[12.5px] tw-text-ink-3">{`${formatBytes(Number(p.used_bytes || 0))} used now`}</span>
        <button type="button" className={btn} disabled={busy} onClick={() => run(() => setMailQuota(id, Number(quota)), `Storage set to ${quota} GB.`)}>{"Save storage"}</button>
      </div>
      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Other addresses that reach this person"}</span>
        <div className="tw-flex tw-flex-wrap tw-gap-2">
          <input className={`${input} tw-flex-1`} value={aliases} placeholder={`e.g. head@${domains[0]}, principal@${domains[0]}`} onChange={(e) => setAliases(e.target.value)} />
          <button type="button" className={btn} disabled={busy} onClick={() => run(() => setMailAliases(id, aliases.split(/[,\s;]+/).filter(Boolean)), "Other addresses saved.")}>{"Save addresses"}</button>
        </div>
        <span className="tw-text-[12px] tw-text-ink-3">{"Separate several with commas. Earlier addresses are kept here too, so old mail still arrives."}</span>
      </div>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-pt-3">
        {p.is_active !== false ? (
          <button type="button" className={btn} disabled={busy} onClick={async () => {
            if (await confirmDialog(`Suspend ${p.name}'s mailbox? Nothing can be sent or received, and mail to it is refused, until you resume it.`)) {
              run(() => setMailboxActive(id, false), "Mailbox suspended.");
            }
          }}>{"Suspend"}</button>
        ) : (
          <button type="button" className={btn} disabled={busy} onClick={() => run(() => setMailboxActive(id, true), "Mailbox resumed.")}>{"Resume"}</button>
        )}
        <span className="tw-text-[12.5px] tw-text-ink-3">{"When someone leaves: turn their mailbox into a shared one, or delete it."}</span>
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Turn into a shared mailbox, opened by"}</span>
        <div className="tw-flex tw-flex-wrap tw-gap-1.5">
          {people.filter((x) => x.user_id !== p.user_id).map((x) => (
            <label key={x.user_id} className={`tw-inline-flex tw-cursor-pointer tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-px-2.5 tw-py-1 tw-text-[12.5px] ${convertTo.includes(x.user_id) ? "tw-border-brand tw-bg-brand-soft tw-text-brand" : "tw-border-line tw-bg-surface tw-text-ink-2"}`}>
              <input type="checkbox" className="tw-hidden" checked={convertTo.includes(x.user_id)} onChange={(e) => setConvertTo((c) => (e.target.checked ? [...c, x.user_id] : c.filter((u) => u !== x.user_id)))} />
              {x.name}
            </label>
          ))}
        </div>
        <div>
          <button type="button" className={btn} disabled={busy || !convertTo.length} onClick={async () => {
            if (await confirmDialog(`Turn ${p.address} into a shared mailbox? ${p.name} will no longer have it; the people you chose can open it with all its mail.`)) {
              run(() => convertToShared(id, convertTo.map((user_id) => ({ user_id, access: "full" as SharedAccess }))), "Now a shared mailbox. Find it under Shared mailboxes.");
            }
          }}>{"Turn into shared mailbox"}</button>
        </div>
      </div>
      {p.is_active === false ? (
        <div className="tw-flex tw-flex-col tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-danger tw-bg-danger-soft tw-p-3">
          <span className="tw-text-[13px] tw-font-semibold tw-text-danger">{"Delete this mailbox and all its mail, for good"}</span>
          <span className="tw-text-[12.5px] tw-text-ink-2">{`Type ${p.address} to confirm. Mail other people received from them stays with those people.`}</span>
          <div className="tw-flex tw-flex-wrap tw-gap-2">
            <input className={`${input} tw-flex-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={p.address || ""} />
            <button type="button" className={`${btn} tw-text-danger`} disabled={busy || confirm.trim().toLowerCase() !== p.address}
              onClick={() => run(() => deleteMailbox(schoolId, id, confirm), "Mailbox deleted.")}>{"Delete for good"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// Safety (supabase/243): limits that stop a hacked account spamming the
// world, how long Deleted and Junk keep mail, senders blocked for everyone,
// and what staff have reported as phishing.
const DAYS = [7, 14, 30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `${d} days` }));
const PER_HOUR = [50, 100, 200, 500, 1000].map((n) => ({ value: String(n), label: `${n} an hour` }));
const PER_DAY = [200, 500, 1000, 2000, 5000].map((n) => ({ value: String(n), label: `${n} a day` }));
const withCurrent = (opts: { value: string; label: string }[], v: number, label: (n: number) => string) =>
  opts.some((o) => o.value === String(v)) ? opts : [...opts, { value: String(v), label: label(v) }].sort((a, b) => Number(a.value) - Number(b.value));

export const SafetyCard = ({ schoolId }: { schoolId: string }) => {
  const { setError, setNotice } = useActionFeedback();
  const [s, setS] = useState<MailSafety | null>(null);
  const [blockInput, setBlockInput] = useState("");
  const load = useCallback(() => {
    mailSafety(schoolId).then(setS).catch((err: Error) => setError(err.message));
  }, [schoolId, setError]);
  useEffect(load, [load]);

  const save = async (patch: MailSafetyPatch, done = "Saved.") => {
    try {
      setS(await mailSafety(schoolId, patch));
      setNotice(done);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const block = () => {
    const v = blockInput.trim().toLowerCase();
    if (!/^(@|[^@\s]+@)[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return setError("Type an address (name@example.com) or a whole domain (@example.com).");
    setBlockInput("");
    save({ blocked_senders: [...(s?.blocked_senders || []), v] }, `${v} is blocked for everyone.`);
  };

  if (!s) return <Section title="Safety"><div className="tw-text-[13.5px] tw-text-ink-3">{"Loading…"}</div></Section>;
  const field = (label: string, hint: string, el: React.ReactNode) => (
    <label className="tw-flex tw-flex-col tw-gap-1">
      <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{label}</span>
      {el}
      <span className="tw-text-[12px] tw-text-ink-3">{hint}</span>
    </label>
  );
  return (
    <Section title="Safety">
      <p className="tw-m-0 tw-mb-3 tw-text-[13.5px] tw-leading-relaxed tw-text-ink-2">
        {"Suspicious mail goes to Junk automatically (failed sender checks, someone pretending to be a member of staff, phishing wording). Pictures from outside senders stay hidden until the reader allows them, and risky links ask before opening."}
      </p>
      <div className="tw-grid tw-grid-cols-2 tw-gap-4 mobile:tw-grid-cols-1">
        {field("Outside recipients per person, per hour", "Stops a hacked account sending spam. You are told when someone reaches it.",
          <Select value={String(s.max_outside_hour)} onChange={(v: string) => save({ max_outside_hour: Number(v) })} options={withCurrent(PER_HOUR, s.max_outside_hour, (n) => `${n} an hour`)} />)}
        {field("Outside recipients per person, per day", "Mail inside the school is never limited.",
          <Select value={String(s.max_outside_day)} onChange={(v: string) => save({ max_outside_day: Number(v) })} options={withCurrent(PER_DAY, s.max_outside_day, (n) => `${n} a day`)} />)}
        {field("Empty Deleted after", "Messages in Deleted are removed for good after this.",
          <Select value={String(s.deleted_days)} onChange={(v: string) => save({ deleted_days: Number(v) })} options={withCurrent(DAYS, s.deleted_days, (n) => `${n} days`)} />)}
        {field("Empty Junk after", "Messages in Junk are removed for good after this.",
          <Select value={String(s.junk_days)} onChange={(v: string) => save({ junk_days: Number(v) })} options={withCurrent(DAYS, s.junk_days, (n) => `${n} days`)} />)}
      </div>

      <div className="tw-mt-5">
        <div className="tw-text-[14px] tw-font-semibold tw-text-ink">{"Blocked for the whole school"}</div>
        <p className="tw-m-0 tw-mb-2 tw-text-[12.5px] tw-text-ink-3">{"Mail from these goes to everyone's Junk. (Someone reporting phishing blocks that sender for themselves; add it here to block it for everyone.)"}</p>
        <div className="tw-flex tw-gap-2">
          <input className={input} value={blockInput} onChange={(e) => setBlockInput(e.target.value)} placeholder="name@example.com or @example.com"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                block();
              }
            }} />
          <button type="button" className={primaryBtn} disabled={!blockInput.trim()} onClick={block}>{"Block"}</button>
        </div>
        <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-1.5">
          {s.blocked_senders.map((b) => (
            <span key={b} className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-bg-bg tw-py-1 tw-pl-3 tw-pr-1 tw-text-[12.5px] tw-text-ink">
              {b}
              <button type="button" className={`${btn} tw-px-1 tw-py-0.5`} aria-label={`Unblock ${b}`}
                onClick={() => save({ blocked_senders: s.blocked_senders.filter((x) => x !== b) }, `${b} is no longer blocked.`)}>
                <Svg d={ICON.close} size={12} />
              </button>
            </span>
          ))}
          {!s.blocked_senders.length ? <span className="tw-text-[13px] tw-text-ink-3">{"None."}</span> : null}
        </div>
      </div>

      <div className="tw-mt-5">
        <div className="tw-text-[14px] tw-font-semibold tw-text-ink">{"Phishing reports"}</div>
        <ul className="tw-m-0 tw-mt-1 tw-list-none tw-p-0">
          {s.reports.map((r) => (
            <li key={r.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-0.5 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-2.5 tw-text-[13px]">
              <span className="tw-min-w-[180px] tw-flex-1 tw-font-semibold tw-text-ink">{r.sender}</span>
              <span className="tw-flex-[2] tw-truncate tw-text-ink-2">{r.subject || "(no subject)"}</span>
              <span className="tw-text-ink-3">
                {`${r.reported_by || "Someone"} · ${new Date(r.created_at).toLocaleDateString([], { day: "numeric", month: "short" })} · ${r.copies_moved} ${r.copies_moved === 1 ? "copy" : "copies"} moved to Junk`}
              </span>
            </li>
          ))}
          {!s.reports.length ? <li className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-2.5 tw-text-[13px] tw-text-ink-3">{"Nothing reported."}</li> : null}
        </ul>
      </div>
    </Section>
  );
};
