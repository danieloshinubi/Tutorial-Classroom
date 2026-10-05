import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import {
  deleteContact,
  deleteContactGroup,
  listContactGroups,
  listContacts,
  saveContact,
  saveContactGroup,
  type Address,
  type Contact,
  type ContactGroup,
  type DirectoryEntry,
} from "../../lib/mailApi";
import RecipientField from "./RecipientField";
import { ICON, Initials, Svg, btn, primaryBtn } from "./mailUi";

// The contacts book (supabase/241): each person's own people (parents,
// suppliers, colleagues elsewhere) and their own groups ("SS3 parents",
// "Exam board"). Everyone in it is suggested while typing To / Cc / Bcc; a
// group goes as one name and opens up into its people when the mail is sent.

const input =
  "tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-[14px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const blankContact = (mailboxId: string): Contact => ({ id: "", mailbox_id: mailboxId, name: "", address: "", phone: "", company: "", notes: "" });

const Contacts = ({
  mailboxId,
  people,
  start,
  onWrite,
  onChanged,
}: {
  mailboxId: string;
  people: DirectoryEntry[];
  /** Opened from "Add to contacts": the person to add. */
  start?: Address | null;
  onWrite: (to: Address[]) => void;
  onChanged: () => void;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const [tab, setTab] = useState<"people" | "groups">("people");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [editing, setEditing] = useState<Contact | null>(start ? { ...blankContact(mailboxId), name: start.name, address: start.address } : null);
  const [group, setGroup] = useState<ContactGroup | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([listContacts(mailboxId), listContactGroups(mailboxId)]);
      setContacts(c);
      setGroups(g);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [mailboxId, setError]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (contacts || []).filter((c) => !n || `${c.name} ${c.address} ${c.company}`.toLowerCase().includes(n));
  }, [contacts, search]);

  const saveOne = async () => {
    if (!editing) return;
    if (!EMAIL.test(editing.address.trim())) return setError("Enter a valid email address.");
    try {
      await saveContact({ ...editing, id: editing.id || undefined });
      setNotice(editing.id ? "Contact saved." : `${editing.name || editing.address} added to your contacts.`);
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveGroup = async () => {
    if (!group) return;
    if (!group.name.trim()) return setError("Give the group a name.");
    if (!group.members.length) return setError("Add at least one person to the group.");
    try {
      await saveContactGroup({ id: group.id || undefined, mailbox_id: mailboxId, name: group.name, members: group.members });
      setNotice(`Group "${group.name}" saved.`);
      setGroup(null);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Everyone suggested for a group: staff and your contacts.
  const pickable: DirectoryEntry[] = useMemo(() => [
    ...people.filter((p) => !p.address.startsWith("group:")),
    ...(contacts || []).filter((c) => !people.some((p) => p.address === c.address)).map((c) => ({ address: c.address, name: c.name || c.address, job_title: c.company || "Contact", avatar_url: null })),
  ], [people, contacts]);

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-4 tw-py-2.5">
        <h2 className="tw-m-0 tw-mr-2 tw-text-[17px] tw-font-semibold tw-text-ink">{"Contacts"}</h2>
        {(["people", "groups"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`tw-rounded-full tw-border tw-border-solid tw-px-3 tw-py-1 tw-text-[13px] tw-font-semibold tw-cursor-pointer [font-family:inherit] ${tab === t ? "tw-border-brand tw-bg-brand-soft tw-text-brand" : "tw-border-line tw-bg-surface tw-text-ink-2"}`}
          >
            {t === "people" ? `People (${contacts?.length ?? 0})` : `Groups (${groups.length})`}
          </button>
        ))}
        <span className="tw-flex-1" />
        {tab === "people" ? (
          <button type="button" className={primaryBtn} onClick={() => setEditing(blankContact(mailboxId))}>{"New contact"}</button>
        ) : (
          <button type="button" className={primaryBtn} onClick={() => setGroup({ id: "", mailbox_id: mailboxId, name: "", members: [] })}>{"New group"}</button>
        )}
      </div>

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-bg-bg tw-p-4">
        {editing ? (
          <div className="tw-mb-4 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-4">
            <p className="tw-m-0 tw-mb-3 tw-text-[15px] tw-font-semibold tw-text-ink">{editing.id ? "Edit contact" : "New contact"}</p>
            <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
              {([["name", "Name"], ["address", "Email"], ["phone", "Phone"], ["company", "Organisation"]] as const).map(([k, label]) => (
                <label key={k} className="tw-flex tw-flex-col tw-gap-1">
                  <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{label}</span>
                  <input className={input} value={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} autoComplete="off" />
                </label>
              ))}
            </div>
            <label className="tw-mt-3 tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Notes"}</span>
              <textarea className={`${input} tw-min-h-[64px]`} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </label>
            <div className="tw-mt-3 tw-flex tw-gap-2">
              <button type="button" className={primaryBtn} onClick={saveOne}>{"Save"}</button>
              <button type="button" className={btn} onClick={() => setEditing(null)}>{"Cancel"}</button>
            </div>
          </div>
        ) : null}

        {group ? (
          <div className="tw-mb-4 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-4">
            <p className="tw-m-0 tw-mb-3 tw-text-[15px] tw-font-semibold tw-text-ink">{group.id ? "Edit group" : "New group"}</p>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Group name"}</span>
              <input className={input} value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} placeholder="e.g. SS3 parents" />
            </label>
            <div className="tw-mt-2">
              <RecipientField label="People" value={group.members} onChange={(members) => setGroup({ ...group, members: members.filter((m) => !m.address.startsWith("group:")) })} people={pickable} />
            </div>
            <div className="tw-mt-3 tw-flex tw-gap-2">
              <button type="button" className={primaryBtn} onClick={saveGroup}>{"Save group"}</button>
              <button type="button" className={btn} onClick={() => setGroup(null)}>{"Cancel"}</button>
            </div>
          </div>
        ) : null}

        {tab === "people" ? (
          <>
            <input className={`${input} tw-mb-3`} placeholder="Search contacts" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul className="tw-m-0 tw-list-none tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-0">
              {shown.map((c) => (
                <li key={c.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-4 tw-py-3 last:tw-border-b-0">
                  <Initials name={c.name} address={c.address} size={36} />
                  <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
                    <span className="tw-truncate tw-text-[14px] tw-font-semibold tw-text-ink">{c.name || c.address}</span>
                    <span className="tw-truncate tw-text-[12.5px] tw-text-ink-3">{[c.address, c.company, c.phone].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="tw-flex tw-gap-1">
                    <button type="button" className={btn} onClick={() => onWrite([{ name: c.name, address: c.address }])}>
                      <Svg d={ICON.compose} size={14} />
                      {"Write"}
                    </button>
                    <button type="button" className={btn} onClick={() => setEditing(c)}>{"Edit"}</button>
                    <button
                      type="button"
                      className={`${btn} tw-text-danger`}
                      onClick={async () => {
                        if (!(await confirmDialog(`Delete ${c.name || c.address} from your contacts?`))) return;
                        try {
                          await deleteContact(c.id);
                          await load();
                          onChanged();
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      {"Delete"}
                    </button>
                  </span>
                </li>
              ))}
              {contacts && !shown.length ? <li className="tw-px-4 tw-py-6 tw-text-center tw-text-[13.5px] tw-text-ink-3">{search ? "No contacts match." : "No contacts yet. Add one, or use Add to contacts on any message."}</li> : null}
            </ul>
          </>
        ) : (
          <ul className="tw-m-0 tw-list-none tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-0">
            {groups.map((g) => (
              <li key={g.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-4 tw-py-3 last:tw-border-b-0">
                <span className="tw-inline-flex tw-h-9 tw-w-9 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand tw-text-white"><Svg d={ICON.users} size={16} /></span>
                <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
                  <span className="tw-truncate tw-text-[14px] tw-font-semibold tw-text-ink">{g.name}</span>
                  <span className="tw-truncate tw-text-[12.5px] tw-text-ink-3">{`${g.members.length} ${g.members.length === 1 ? "person" : "people"}: ${g.members.slice(0, 4).map((m) => m.name || m.address).join(", ")}${g.members.length > 4 ? "…" : ""}`}</span>
                </span>
                <span className="tw-flex tw-gap-1">
                  <button type="button" className={btn} onClick={() => onWrite([{ name: g.name, address: `group:mine:${g.id}` }])}>
                    <Svg d={ICON.compose} size={14} />
                    {"Write"}
                  </button>
                  <button type="button" className={btn} onClick={() => setGroup(g)}>{"Edit"}</button>
                  <button
                    type="button"
                    className={`${btn} tw-text-danger`}
                    onClick={async () => {
                      if (!(await confirmDialog(`Delete the group "${g.name}"? The people in it stay in your contacts.`))) return;
                      try {
                        await deleteContactGroup(g.id);
                        await load();
                        onChanged();
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                  >
                    {"Delete"}
                  </button>
                </span>
              </li>
            ))}
            {!groups.length ? <li className="tw-px-4 tw-py-6 tw-text-center tw-text-[13.5px] tw-text-ink-3">{"No groups yet. Everyone can already write to All staff and to each role."}</li> : null}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Contacts;
