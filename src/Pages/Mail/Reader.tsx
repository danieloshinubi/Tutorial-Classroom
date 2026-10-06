import React, { useEffect, useMemo, useRef, useState } from "react";
import EmailFrame from "../../Components/EmailFrame";
import { Select } from "../../Components/UI";
import { useActionFeedback } from "../../Components/Toast";
import { confirmDialog } from "../../Components/Confirm";
import {
  FOLDERS,
  attachmentsFor,
  deleteForever,
  deliveriesFor,
  messageStatus,
  recallMessage,
  fromOutside,
  markSender,
  reportPhishing,
  senderLists,
  type Address,
  type MessageStatus,
  formatBytes,
  loadThread,
  moveTo,
  openAttachment,
  setFlags,
  type Attachment,
  type Delivery,
  type Folder,
  type MailMessage,
} from "../../lib/mailApi";
import type { ComposeMode } from "./Compose";
import { ICON, Initials, Svg, btn, longWhen, names } from "./mailUi";

// One conversation in the reading pane: the newest message open, earlier
// ones folded (click to open), each with who it is from and to, when, its
// files and the message itself shown safely in its own frame. The actions
// along the top are Outlook's: Reply, Reply all, Forward, Archive, Delete,
// Move, Mark unread, Flag, Junk; in Deleted, Restore and Delete forever.
// On the sender's own copy, how mail to each outside address went
// (supabase/236): sent, delivered, delayed, bounced, marked as spam.

const DELIVERY: Record<Delivery["status"], { label: string; cls: string }> = {
  pending: { label: "Waiting", cls: "tw-bg-bg tw-text-ink-3" },
  sending: { label: "Sending", cls: "tw-bg-brand-soft tw-text-brand" },
  sent: { label: "Sent", cls: "tw-bg-brand-soft tw-text-brand" },
  delayed: { label: "Delayed", cls: "tw-bg-warn-soft tw-text-warn-ink" },
  delivered: { label: "Delivered", cls: "tw-bg-success-soft tw-text-success" },
  bounced: { label: "Bounced", cls: "tw-bg-danger-soft tw-text-danger" },
  complained: { label: "Marked as spam", cls: "tw-bg-danger-soft tw-text-danger" },
  failed: { label: "Not delivered", cls: "tw-bg-danger-soft tw-text-danger" },
};

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// On my own sent copy (supabase/241): who has it inside Schoolivio and
// whether they have read it, and every open, with when.
const Receipts = ({ s }: { s: MessageStatus }) => {
  const opened = new Map(s.opens.map((o) => [o.recipient, o]));
  if (!s.inside.length && !s.opens.length && !s.recalled_at) return null;
  return (
    <div className="tw-mb-3 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-bg tw-px-3 tw-py-2">
      <p className="tw-m-0 tw-mb-1 tw-flex tw-items-center tw-gap-2 tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">
        {"Receipts"}
        {s.track_opens ? <span className="tw-normal-case tw-tracking-normal tw-text-brand">{"· you are told when it is opened"}</span> : null}
      </p>
      {s.recalled_at ? <p className="tw-m-0 tw-mb-1 tw-text-[12.5px] tw-text-warn-ink">{`Recalled ${when(s.recalled_at)}. The report is in your Inbox.`}</p> : null}
      <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0">
        {s.inside.map((r) => {
          const o = opened.get(r.name) || opened.get(r.address);
          return (
            <li key={r.address} className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-2 tw-text-[13px]">
              <span className={`tw-inline-flex tw-shrink-0 tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[11.5px] tw-font-semibold ${o || r.read ? "tw-bg-success-soft tw-text-success" : "tw-bg-brand-soft tw-text-brand"}`}>
                {o ? "Opened" : r.read ? "Read" : "Delivered"}
              </span>
              <span className="tw-min-w-0 tw-truncate tw-text-ink">{r.name || r.address}</span>
              <span className="tw-text-[12px] tw-text-ink-3">{o ? `${when(o.first_at)}${o.times > 1 ? ` · ${o.times} times` : ""}` : when(r.delivered_at)}</span>
            </li>
          );
        })}
        {s.opens.filter((o) => o.via === "picture").map((o) => (
          <li key={o.recipient} className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-2 tw-text-[13px]">
            <span className="tw-inline-flex tw-shrink-0 tw-rounded-full tw-bg-success-soft tw-px-2 tw-py-0.5 tw-text-[11.5px] tw-font-semibold tw-text-success">{"Opened"}</span>
            <span className="tw-min-w-0 tw-truncate tw-text-ink">{o.recipient}</span>
            <span className="tw-text-[12px] tw-text-ink-3">{`${when(o.first_at)}${o.times > 1 ? ` · ${o.times} times` : ""}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Deliveries = ({ list }: { list: Delivery[] }) => (
  <div className="tw-mb-3 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-bg tw-px-3 tw-py-2">
    <p className="tw-m-0 tw-mb-1 tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wide tw-text-ink-3">{"Outside delivery"}</p>
    <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0">
      {list.map((d) => {
        const s = DELIVERY[d.status] || DELIVERY.pending;
        const retry = d.status === "pending" && d.attempts > 0 && !!d.detail;
        return (
          <li key={d.id} className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-0.5 tw-text-[13px]">
            <span className={`tw-inline-flex tw-shrink-0 tw-rounded-full tw-px-2 tw-py-0.5 tw-text-[11.5px] tw-font-semibold ${s.cls}`}>{s.label}</span>
            <span className="tw-min-w-0 tw-truncate tw-text-ink">{d.recipient}</span>
            {d.kind !== "to" ? <span className="tw-text-[12px] tw-text-ink-3">{d.kind === "cc" ? "Cc" : "Bcc"}</span> : null}
            {retry ? <span className="tw-w-full tw-text-[12px] tw-text-ink-3">{`Trying again shortly: ${d.detail}`}</span> : null}
            {!retry && d.detail && ["bounced", "failed", "complained", "delayed"].includes(d.status) ? (
              <span className="tw-w-full tw-text-[12px] tw-text-ink-3">{d.detail}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  </div>
);

const Reader = ({
  mailboxId,
  myAddress,
  folder,
  threadId,
  onCompose,
  onChanged,
  onClosed,
  liveTick = 0,
  onAddContact,
  readOnly = false,
  canTrust = true,
}: {
  mailboxId: string;
  myAddress: string;
  folder: Folder;
  threadId: string;
  onCompose: (mode: ComposeMode, source: MailMessage) => void;
  onChanged: () => void;
  onClosed: () => void;
  /** Goes up whenever the mailbox changes live, so delivery reports refresh. */
  liveTick?: number;
  /** "Add to contacts" for the sender (supabase/241). */
  onAddContact?: (a: Address) => void;
  /** A shared mailbox I may only read (supabase/242): no reply, forward or recall. */
  readOnly?: boolean;
  /** May mark senders safe or blocked: my own mailbox, or full access to a shared one. */
  canTrust?: boolean;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [statuses, setStatuses] = useState<Record<string, MessageStatus>>({});
  // Outside pictures (supabase/243): held back unless the sender is trusted
  // or the reader asks to see them.
  const [safe, setSafe] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<Record<string, number>>({});
  useEffect(() => {
    senderLists(mailboxId)
      .then((list) => setSafe(new Set(list.filter((x) => x.kind === "safe").map((x) => x.value))))
      .catch(() => null);
  }, [mailboxId]);
  const isSafe = (address: string) => {
    const a = address.toLowerCase();
    return safe.has(a) || safe.has(`@${a.split("@")[1]}`);
  };

  useEffect(() => {
    let live = true;
    setMessages(null);
    loadThread(mailboxId, threadId, folder === "deleted")
      .then(async (list) => {
        if (!live) return;
        const shown = list.length ? list : [];
        setMessages(shown);
        setOpen(new Set(shown.length ? [shown[shown.length - 1].id] : []));
        setFiles(await attachmentsFor(Array.from(new Set(shown.filter((m) => m.has_attachments).map((m) => m.envelope_id)))));
        // Opening it reads it.
        const unread = shown.filter((m) => !m.is_read).map((m) => m.id);
        if (unread.length) {
          await setFlags(unread, { is_read: true });
          onChanged();
        }
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailboxId, threadId, folder]);

  // Delivery reports for my own sent copies, kept up to date live.
  useEffect(() => {
    const mine = (messages || []).filter((m) => m.folder === "outbox" || (m.from_address === myAddress && m.sent_at)).map((m) => m.id);
    if (!mine.length) return;
    deliveriesFor(mine).then(setDeliveries).catch(() => null);
    // Who has it inside Schoolivio, who read it, who opened it (supabase/241).
    Promise.all(mine.map((id) => messageStatus(id).then((s) => [id, s] as const).catch(() => null)))
      .then((rows) => setStatuses(Object.fromEntries(rows.filter((r): r is readonly [string, MessageStatus] => !!r))));
  }, [messages, myAddress, liveTick]);

  const mineSent = useMemo(() => (messages || []).filter((m) => m.from_address === myAddress && m.sent_at && (m.folder === "sent" || m.folder === "outbox")), [messages, myAddress]);
  const recallable = mineSent.length ? mineSent[mineSent.length - 1] : null;
  const recall = async () => {
    if (!recallable) return;
    if (!(await confirmDialog("Recall this message? Copies not yet read inside Schoolivio are removed, and outside copies not yet sent are stopped. Mail already delivered outside Schoolivio cannot be recalled."))) return;
    try {
      const r = await recallMessage(recallable.id);
      const parts = [];
      if (r.removed.length) parts.push(`Removed from ${r.removed.length}`);
      if (r.stopped.length) parts.push(`stopped for ${r.stopped.length} outside`);
      if (r.already_read.length) parts.push(`${r.already_read.length} had already read it`);
      if (r.outside.length) parts.push(`${r.outside.length} outside already had it (cannot be recalled)`);
      setNotice(`${parts.join(", ") || "Recalled"}. The full report is in your Inbox.`);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const latest = messages && messages.length ? messages[messages.length - 1] : null;
  // The message an action applies to: the newest one that is not my own.
  const answerable = useMemo(() => (messages ? [...messages].reverse().find((m) => m.from_address !== myAddress) || latest : null), [messages, myAddress, latest]);
  const inFolder = useMemo(() => (messages || []).filter((m) => m.folder === folder), [messages, folder]);
  const targets = inFolder.length ? inFolder : latest ? [latest] : [];

  // Keyboard shortcuts (supabase/243): the Mail page hands over the ones that
  // act on the open conversation.
  const shortcut = useRef<(action: string) => void>(() => undefined);
  shortcut.current = (action: string) => {
    if (!latest || folder === "deleted") return;
    if (!readOnly && action === "reply" && answerable) onCompose("reply", answerable);
    else if (!readOnly && action === "replyAll" && answerable) onCompose("replyAll", answerable);
    else if (!readOnly && action === "forward") onCompose("forward", latest);
    else if (action === "archive" && folder !== "archive") act(() => moveTo(targets, "archive"), "Archived.");
    else if (action === "delete") act(() => moveTo(targets, "deleted"), "Moved to Deleted.");
    else if (action === "unread") act(() => setFlags(targets.map((m) => m.id), { is_read: false }), "Marked as unread.");
  };
  useEffect(() => {
    const on = (e: Event) => shortcut.current((e as CustomEvent<string>).detail);
    window.addEventListener("mail:shortcut", on);
    return () => window.removeEventListener("mail:shortcut", on);
  }, []);

  const act = async (work: () => Promise<unknown>, done?: string, close = true) => {
    try {
      await work();
      if (done) setNotice(done);
      onChanged();
      if (close) onClosed();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (messages === null) return <div className="tw-p-8 tw-text-[14px] tw-text-ink-3">{"Opening…"}</div>;
  if (!latest) return <div className="tw-p-8 tw-text-[14px] tw-text-ink-3">{"This conversation is empty."}</div>;

  const flagged = targets.some((m) => m.is_flagged);
  const moveOptions = FOLDERS.filter((f) => !["drafts", "sent", "outbox", folder].includes(f.id)).map((f) => ({ value: f.id, label: f.label }));

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col">
      {/* Actions */}
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2">
        {folder !== "deleted" ? (
          <>
            {!readOnly ? (
              <>
            <button type="button" className={btn} onClick={() => answerable && onCompose("reply", answerable)}>
              <Svg d={ICON.reply} size={15} />
              {"Reply"}
            </button>
            <button type="button" className={btn} onClick={() => answerable && onCompose("replyAll", answerable)}>
              <Svg d={ICON.replyAll} size={15} />
              {"Reply all"}
            </button>
            <button type="button" className={btn} onClick={() => onCompose("forward", latest)}>
              <Svg d={ICON.forward} size={15} />
              {"Forward"}
            </button>
            {recallable && !recallable.recalled_at ? (
              <button type="button" className={btn} onClick={recall} title="Take back copies not yet read">
                <Svg d={ICON.recall} size={15} />
                {"Recall"}
              </button>
            ) : null}
            {answerable && answerable.from_address !== myAddress && onAddContact ? (
              <button type="button" className={btn} onClick={() => onAddContact({ name: answerable.from_name, address: answerable.from_address })} title="Add the sender to your contacts">
                <Svg d={ICON.users} size={15} />
                {"Add to contacts"}
              </button>
            ) : null}
            <span className="tw-mx-1 tw-h-5 tw-w-px tw-bg-line" />
              </>
            ) : null}
            {folder !== "archive" ? (
              <button type="button" className={btn} onClick={() => act(() => moveTo(targets, "archive"), "Archived.")}>
                <Svg d={ICON.archive} size={15} />
                {"Archive"}
              </button>
            ) : null}
            <button type="button" className={btn} onClick={() => act(() => moveTo(targets, "deleted"), "Moved to Deleted.")}>
              <Svg d={ICON.deleted} size={15} />
              {"Delete"}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() =>
                act(async () => {
                  // "Not junk" also trusts the sender from now on (Outlook does the same).
                  if (canTrust && folder === "junk" && answerable && answerable.from_address !== myAddress) await markSender(mailboxId, answerable.from_address, "safe").catch(() => null);
                  await moveTo(targets, folder === "junk" ? "inbox" : "junk");
                }, folder === "junk" ? (canTrust ? "Moved to Inbox, and the sender is now trusted." : "Moved to Inbox.") : "Moved to Junk.")
              }
            >
              <Svg d={ICON.junk} size={15} />
              {folder === "junk" ? "Not junk" : "Junk"}
            </button>
            {canTrust && answerable && answerable.from_address !== myAddress ? (
              <>
                <button
                  type="button"
                  className={btn}
                  title="Their mail goes to Junk from now on"
                  onClick={async () => {
                    if (await confirmDialog(`Block ${answerable.from_address}? Their mail goes straight to Junk from now on.`)) {
                      act(async () => {
                        await markSender(mailboxId, answerable.from_address, "blocked");
                        await moveTo(targets, "junk");
                      }, "Sender blocked.");
                    }
                  }}
                >
                  <Svg d={ICON.block} size={15} />
                  {"Block sender"}
                </button>
                <button
                  type="button"
                  className={`${btn} tw-text-danger`}
                  title="A scam or a fake message"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: "Report phishing?", body: "The sender is blocked and the message goes to Junk. Unopened copies in your colleagues' mailboxes go to Junk too, and the school admins are told.", confirmLabel: "Report", tone: "danger" }))) return;
                    act(async () => {
                      const r = await reportPhishing(answerable.id);
                      setNotice(`Reported. Thank you.${r.copies_moved ? ` ${r.copies_moved} colleague${r.copies_moved === 1 ? "'s copy was" : "s' copies were"} moved to Junk too.` : ""}`);
                    });
                  }}
                >
                  <Svg d={ICON.shield} size={15} />
                  {"Report phishing"}
                </button>
              </>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              className={btn}
              onClick={() =>
                act(async () => {
                  for (const m of targets) await moveTo([{ id: m.id, folder: m.folder }], ((m.previous_folder as Folder) || "inbox") as Folder);
                }, "Restored.")
              }
            >
              <Svg d={ICON.restore} size={15} />
              {"Restore"}
            </button>
            {!readOnly ? (
            <button
              type="button"
              className={`${btn} tw-text-danger`}
              onClick={async () => {
                if (await confirmDialog("Delete this conversation forever? It cannot be recovered.")) act(() => deleteForever(targets.map((m) => m.id)), "Deleted forever.");
              }}
            >
              <Svg d={ICON.deleted} size={15} />
              {"Delete forever"}
            </button>
            ) : null}
          </>
        )}
        <span className="tw-mx-1 tw-h-5 tw-w-px tw-bg-line" />
        <button type="button" className={btn} onClick={() => act(() => setFlags(targets.map((m) => m.id), { is_read: false }), "Marked as unread.")}>
          <Svg d={ICON.envelope} size={15} />
          {"Mark unread"}
        </button>
        <button
          type="button"
          className={`${btn} ${flagged ? "tw-text-danger" : ""}`}
          onClick={() => act(() => setFlags(targets.map((m) => m.id), { is_flagged: !flagged }), flagged ? "Flag cleared." : "Flagged.", false)}
        >
          <Svg d={ICON.flag} size={15} fill={flagged} />
          {flagged ? "Unflag" : "Flag"}
        </button>
        {moveOptions.length ? (
          <div className="tw-w-[150px]">
            <Select
              value=""
              placeholder="Move to…"
              options={moveOptions}
              onChange={(v) => act(() => moveTo(targets, v as Folder), `Moved to ${FOLDERS.find((f) => f.id === v)?.label}.`)}
            />
          </div>
        ) : null}
      </div>

      {/* The conversation */}
      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-bg-bg tw-px-5 tw-py-5 mobile:tw-px-3">
        <h2 className="tw-m-0 tw-mb-4 tw-flex tw-items-center tw-gap-2 tw-text-[19px] tw-font-semibold tw-leading-snug tw-text-ink">
          {latest.importance === "high" ? <span className="tw-text-danger" title="High importance">{"!"}</span> : null}
          {latest.subject || "(no subject)"}
        </h2>
        <div className="tw-flex tw-flex-col tw-gap-3">
          {messages.map((m) => {
            const isOpen = open.has(m.id);
            const mine = files.filter((f) => f.envelope_id === m.envelope_id);
            return (
              <article key={m.id} className="tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-shadow-1">
                <button
                  type="button"
                  onClick={() => setOpen((s) => new Set(s.has(m.id) ? Array.from(s).filter((x) => x !== m.id) : [...Array.from(s), m.id]))}
                  className="tw-flex tw-w-full tw-items-start tw-gap-3 tw-rounded-xl tw-border-0 tw-bg-transparent tw-p-4 tw-text-left tw-cursor-pointer [font-family:inherit]"
                >
                  <Initials name={m.from_name} address={m.from_address} size={40} />
                  <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-0.5">
                    <span className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-2">
                      <strong className="tw-text-[14.5px] tw-text-ink">{m.from_name || m.from_address}</strong>
                      <span className="tw-text-[12.5px] tw-text-ink-3">{`<${m.from_address}>`}</span>
                    </span>
                    {isOpen ? (
                      <>
                        <span className="tw-text-[13px] tw-text-ink-2">{`To: ${names(m.to_list) || "—"}`}</span>
                        {m.cc_list.length ? <span className="tw-text-[13px] tw-text-ink-2">{`Cc: ${names(m.cc_list)}`}</span> : null}
                        {m.bcc_list?.length ? <span className="tw-text-[13px] tw-text-ink-2">{`Bcc: ${names(m.bcc_list)}`}</span> : null}
                      </>
                    ) : (
                      <span className="tw-truncate tw-text-[13px] tw-text-ink-3">{m.snippet}</span>
                    )}
                  </span>
                  <span className="tw-flex tw-shrink-0 tw-flex-col tw-items-end tw-gap-1">
                    <span className="tw-text-[12.5px] tw-text-ink-3">{longWhen(m.sent_at)}</span>
                    {m.is_flagged ? <span className="tw-text-danger"><Svg d={ICON.flag} size={14} fill /></span> : null}
                  </span>
                </button>
                {isOpen ? (
                  <div className="tw-border-0 tw-border-t tw-border-solid tw-border-line tw-px-4 tw-pb-4 tw-pt-3">
                    {m.folder === "outbox" ? (
                      <p className="tw-m-0 tw-mb-3 tw-rounded-lg tw-bg-warn-soft tw-px-3 tw-py-2 tw-text-[13px] tw-text-warn-ink">
                        {`Still going to ${m.external_pending} outside address${m.external_pending === 1 ? "" : "es"}; everyone inside the school already has it. If it stays here, your school has not set up outside mail yet (School admin → Mail settings).`}
                      </p>
                    ) : null}
                    {statuses[m.id] ? <Receipts s={statuses[m.id]} /> : null}
                    {deliveries.some((d) => d.message_id === m.id) ? <Deliveries list={deliveries.filter((d) => d.message_id === m.id)} /> : null}
                    {mine.length ? (
                      <div className="tw-mb-3 tw-flex tw-flex-wrap tw-gap-2">
                        {mine.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => openAttachment(f).catch((err: Error) => setError(err.message))}
                            className="tw-inline-flex tw-max-w-[280px] tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-bg tw-px-3 tw-py-2 tw-text-left tw-text-[13px] tw-text-ink tw-cursor-pointer hover:tw-border-brand [font-family:inherit]"
                            title={`Open ${f.file_name}`}
                          >
                            <span className="tw-text-brand"><Svg d={ICON.file} size={16} /></span>
                            <span className="tw-min-w-0 tw-flex-1 tw-truncate">{f.file_name}</span>
                            <span className="tw-shrink-0 tw-text-[12px] tw-text-ink-3">{formatBytes(f.size_bytes)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {m.warning ? (
                      <div className="tw-mb-3 tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-danger tw-bg-danger-soft tw-px-3 tw-py-2 tw-text-[13px] tw-text-danger">
                        <Svg d={ICON.shield} size={16} />
                        <span className="tw-flex tw-flex-col tw-gap-0.5">
                          <strong>{"Be careful with this message"}</strong>
                          <span className="tw-text-ink-2">{m.warning}</span>
                        </span>
                      </div>
                    ) : null}
                    {blocked[m.id] && !shown.has(m.id) ? (
                      <div className="tw-mb-3 tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-rounded-lg tw-bg-bg tw-px-3 tw-py-2 tw-text-[13px] tw-text-ink-2">
                        <Svg d={ICON.picture} size={15} />
                        <span className="tw-flex-1">{"Pictures from outside are hidden, so the sender cannot tell you opened this."}</span>
                        <button type="button" className={`${btn} tw-py-1 tw-text-[12.5px]`} onClick={() => setShown((s) => new Set(s).add(m.id))}>{"Show pictures"}</button>
                        {canTrust ? (
                        <button
                          type="button"
                          className={`${btn} tw-py-1 tw-text-[12.5px]`}
                          onClick={async () => {
                            try {
                              await markSender(mailboxId, m.from_address, "safe");
                              setSafe((s) => new Set(s).add(m.from_address.toLowerCase()));
                              setNotice(`Pictures from ${m.from_address} will always show.`);
                            } catch (err) {
                              setError((err as Error).message);
                            }
                          }}
                        >
                          {"Always show from this sender"}
                        </button>
                        ) : null}
                      </div>
                    ) : null}
                    <EmailFrame
                      html={m.body_html}
                      title={m.subject}
                      blockRemote={fromOutside(m) && !shown.has(m.id) && !isSafe(m.from_address)}
                      onBlocked={(n) => setBlocked((b) => (b[m.id] === n ? b : { ...b, [m.id]: n }))}
                      warnLinks={fromOutside(m) || folder === "junk"}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Reader;
