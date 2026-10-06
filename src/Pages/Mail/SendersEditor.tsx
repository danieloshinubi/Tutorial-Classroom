import React, { useCallback, useEffect, useState } from "react";
import { Button, Select } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { markSender, senderLists, type SenderEntry } from "../../lib/mailApi";
import { ICON, Svg, btn } from "./mailUi";

// Mail → Settings → Junk (supabase/243): senders always let into the Inbox
// (safe, pictures shown) and senders sent straight to Junk (blocked). An
// address, or @domain for everyone at a domain.

const VALID = /^(@|[^@\s]+@)[a-z0-9.-]+\.[a-z]{2,}$/i;

const SendersEditor = ({ mailboxId }: { mailboxId: string }) => {
  const { setError } = useActionFeedback();
  const [list, setList] = useState<SenderEntry[] | null>(null);
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"safe" | "blocked">("blocked");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    senderLists(mailboxId).then(setList).catch((err: Error) => setError(err.message));
  }, [mailboxId, setError]);
  useEffect(load, [load]);

  const add = async () => {
    const v = value.trim().toLowerCase();
    if (!VALID.test(v)) {
      setError("Type an address (name@example.com) or a whole domain (@example.com).");
      return;
    }
    setBusy(true);
    try {
      await markSender(mailboxId, v, kind);
      setValue("");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: string) => {
    try {
      await markSender(mailboxId, v, null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const section = (k: "safe" | "blocked", title: string, hint: string) => {
    const rows = (list || []).filter((e) => e.kind === k);
    return (
      <div>
        <div className="tw-text-[14px] tw-font-semibold tw-text-ink">{title}</div>
        <p className="tw-m-0 tw-mb-2 tw-text-[12.5px] tw-text-ink-3">{hint}</p>
        {list === null ? (
          <div className="tw-text-[13px] tw-text-ink-3">{"Loading…"}</div>
        ) : rows.length ? (
          <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0">
            {rows.map((e) => (
              <li key={e.value} className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded-lg tw-bg-bg tw-px-3 tw-py-1.5">
                <span className="tw-truncate tw-text-[13.5px] tw-text-ink">{e.value}</span>
                <button type="button" className={`${btn} tw-text-[12.5px]`} onClick={() => remove(e.value)} aria-label={`Remove ${e.value}`}>
                  <Svg d={ICON.close} size={13} />
                  {"Remove"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="tw-text-[13px] tw-text-ink-3">{"None yet."}</div>
        )}
      </div>
    );
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-wrap tw-items-end tw-gap-2">
        <label className="tw-flex tw-min-w-[220px] tw-flex-1 tw-flex-col tw-gap-1">
          <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Address or @domain"}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="name@example.com or @example.com"
            className="tw-h-9 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-text-[14px] tw-text-ink tw-outline-none [font-family:inherit]"
          />
        </label>
        <div className="tw-w-[170px]">
          <Select
            value={kind}
            onChange={(v: string) => setKind(v as "safe" | "blocked")}
            options={[
              { value: "blocked", label: "Block (to Junk)" },
              { value: "safe", label: "Safe (Inbox)" },
            ]}
          />
        </div>
        <Button type="button" disabled={busy || !value.trim()} onClick={add}>{"Add"}</Button>
      </div>
      {section("blocked", "Blocked senders", "Their mail goes straight to Junk.")}
      {section("safe", "Safe senders", "Their mail is never put in Junk, and their pictures show straight away.")}
      <p className="tw-m-0 tw-text-[12.5px] tw-text-ink-3">{"Junk is emptied after 30 days (your school can change this)."}</p>
    </div>
  );
};

export default SendersEditor;
