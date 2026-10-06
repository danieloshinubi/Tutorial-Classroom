import React, { useCallback, useEffect, useState } from "react";
import { Select } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import { deleteRule, listRules, saveRule, type MailRule } from "../../lib/mailApi";
import { btn, primaryBtn } from "./mailUi";

// Mail → Settings → Rules (supabase/242): what happens to new mail as it
// arrives. Every filled-in "when" must match; the "then" steps all happen.
// Rules run top to bottom; "stop" ends there. A rule never acts on mail it
// forwarded itself, so rules cannot bounce mail back and forth.

const input =
  "tw-w-full tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-2 tw-text-[14px] tw-text-ink tw-outline-none focus:tw-border-brand [font-family:inherit]";

const FOLDERS = [
  { value: "", label: "Leave it in the Inbox" },
  { value: "archive", label: "Move to Archive" },
  { value: "junk", label: "Move to Junk" },
  { value: "deleted", label: "Move to Deleted" },
];

const blank = (mailboxId: string): MailRule => ({
  id: "", mailbox_id: mailboxId, name: "", position: 0, enabled: true, from_contains: "", subject_contains: "",
  with_attachments: false, move_to: null, mark_read: false, flag: false, forward_to: null, stop: false,
});

const describe = (r: MailRule) => {
  const when = [
    r.from_contains && `from contains "${r.from_contains}"`,
    r.subject_contains && `subject contains "${r.subject_contains}"`,
    r.with_attachments && "has attachments",
  ].filter(Boolean).join(" and ");
  const then = [
    r.move_to && `move to ${r.move_to === "deleted" ? "Deleted" : r.move_to[0].toUpperCase() + r.move_to.slice(1)}`,
    r.mark_read && "mark it read",
    r.flag && "flag it",
    r.forward_to && `forward to ${r.forward_to}`,
    r.stop && "stop there",
  ].filter(Boolean).join(", ");
  return `When ${when || "…"}, ${then || "…"}.`;
};

const RulesEditor = ({ mailboxId }: { mailboxId: string }) => {
  const { setError, setNotice } = useActionFeedback();
  const [rules, setRules] = useState<MailRule[] | null>(null);
  const [editing, setEditing] = useState<MailRule | null>(null);

  const load = useCallback(() => {
    listRules(mailboxId).then(setRules).catch((err: Error) => setError(err.message));
  }, [mailboxId, setError]);
  useEffect(load, [load]);

  const save = async (r: MailRule) => {
    try {
      await saveRule({ ...r, id: r.id || undefined, position: r.id ? r.position : (rules?.length ?? 0) });
      setNotice("Rule saved. It applies to new mail from now on.");
      setEditing(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const set = (patch: Partial<MailRule>) => editing && setEditing({ ...editing, ...patch });

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <p className="tw-m-0 tw-text-[13px] tw-text-ink-3">{"What happens to new mail as it arrives, top to bottom. For example: mail from the exams board goes to Archive and is flagged."}</p>
      {editing ? (
        <div className="tw-rounded-xl tw-bg-bg tw-p-4">
          <label className="tw-flex tw-flex-col tw-gap-1">
            <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Name (optional)"}</span>
            <input className={input} value={editing.name} placeholder="Exam board mail" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <p className="tw-m-0 tw-mb-2 tw-mt-4 tw-text-[13px] tw-font-semibold tw-text-ink">{"When a message arrives and"}</p>
          <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[12.5px] tw-text-ink-2">{"the sender contains"}</span>
              <input className={input} value={editing.from_contains} placeholder="waec.org or a name" onChange={(e) => set({ from_contains: e.target.value })} />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[12.5px] tw-text-ink-2">{"the subject contains"}</span>
              <input className={input} value={editing.subject_contains} placeholder="Invoice" onChange={(e) => set({ subject_contains: e.target.value })} />
            </label>
          </div>
          <label className="tw-mt-2 tw-flex tw-items-center tw-gap-2 tw-text-[13.5px] tw-text-ink">
            <input type="checkbox" checked={editing.with_attachments} onChange={(e) => set({ with_attachments: e.target.checked })} />
            {"it has attachments"}
          </label>
          <p className="tw-m-0 tw-mb-2 tw-mt-4 tw-text-[13px] tw-font-semibold tw-text-ink">{"Then"}</p>
          <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
            <Select value={editing.move_to ?? ""} onChange={(v: string) => set({ move_to: (v || null) as MailRule["move_to"] })} options={FOLDERS} />
            <input className={input} value={editing.forward_to ?? ""} placeholder="Forward to (optional): name@example.com" onChange={(e) => set({ forward_to: e.target.value || null })} />
          </div>
          <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-4">
            <label className="tw-flex tw-items-center tw-gap-2 tw-text-[13.5px] tw-text-ink">
              <input type="checkbox" checked={editing.mark_read} onChange={(e) => set({ mark_read: e.target.checked })} />
              {"mark it read"}
            </label>
            <label className="tw-flex tw-items-center tw-gap-2 tw-text-[13.5px] tw-text-ink">
              <input type="checkbox" checked={editing.flag} onChange={(e) => set({ flag: e.target.checked })} />
              {"flag it"}
            </label>
            <label className="tw-flex tw-items-center tw-gap-2 tw-text-[13.5px] tw-text-ink">
              <input type="checkbox" checked={editing.stop} onChange={(e) => set({ stop: e.target.checked })} />
              {"stop: no later rules"}
            </label>
          </div>
          <p className="tw-m-0 tw-mt-3 tw-text-[12.5px] tw-text-ink-2">{describe(editing)}</p>
          <div className="tw-mt-3 tw-flex tw-gap-2">
            <button type="button" className={primaryBtn} onClick={() => save(editing)}>{"Save rule"}</button>
            <button type="button" className={btn} onClick={() => setEditing(null)}>{"Cancel"}</button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className={primaryBtn} onClick={() => setEditing(blank(mailboxId))}>{"New rule"}</button>
        </div>
      )}
      <ul className="tw-m-0 tw-list-none tw-p-0">
        {(rules || []).map((r) => (
          <li key={r.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3">
            <label className="tw-flex tw-items-center" title={r.enabled ? "On" : "Off"}>
              <input type="checkbox" checked={r.enabled} onChange={(e) => save({ ...r, enabled: e.target.checked })} />
            </label>
            <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
              <span className={`tw-text-[14px] tw-font-semibold ${r.enabled ? "tw-text-ink" : "tw-text-ink-3"}`}>{r.name || "Rule"}</span>
              <span className="tw-text-[12.5px] tw-text-ink-3">{describe(r)}</span>
            </span>
            <button type="button" className={btn} onClick={() => setEditing(r)}>{"Edit"}</button>
            <button type="button" className={`${btn} tw-text-danger`} onClick={async () => {
              if (!(await confirmDialog("Delete this rule?"))) return;
              try {
                await deleteRule(r.id);
                load();
              } catch (err) {
                setError((err as Error).message);
              }
            }}>{"Delete"}</button>
          </li>
        ))}
        {rules && !rules.length && !editing ? <li className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-py-3 tw-text-[13.5px] tw-text-ink-3">{"No rules yet."}</li> : null}
      </ul>
    </div>
  );
};

export default RulesEditor;
