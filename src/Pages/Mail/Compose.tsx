import React, { useCallback, useEffect, useRef, useState } from "react";
import { RichTextEditor, type RichTextEditorHandle } from "../../Components/RichTextEditor";
import { DateTimePicker } from "../../Components/UI";
import { confirmDialog } from "../../Components/Confirm";
import { useActionFeedback } from "../../Components/Toast";
import {
  attachmentsFor,
  copyAttachments,
  deleteForever,
  formatBytes,
  isGroup,
  removeAttachment,
  saveDraft,
  scheduleDraft,
  uploadAttachment,
  type SendResult,
  type Address,
  type Attachment,
  type DirectoryEntry,
  type Importance,
  type Mailbox,
  type MailMessage,
} from "../../lib/mailApi";
import RecipientField from "./RecipientField";
import { ICON, Svg, btn, escapeHtml, longWhen, names, primaryBtn } from "./mailUi";
import { MAX_INLINE_TOTAL, inlineBytes, isPicture, pictureForMail } from "./pictures";
import { queueSend } from "./sendQueue";

// Writing a message, the way Outlook does it: From, To, Cc and Bcc with
// suggestions (people, contacts and groups), the subject, the full rich-text
// editor (fonts, sizes, colours, highlight, lists, alignment, tables, links,
// pictures inside the text), attachments by button, drag and drop or paste,
// importance, the signature, and the draft saved as you type. Replying quotes
// the original underneath; forwarding brings its files. Also (supabase/241):
// "Tell me when it's opened", a read receipt, sending later, and a few
// seconds to undo a send.

/** A summary of what sending did, for the notice. */
export const sendSummary = (r: SendResult) => {
  const parts = [r.delivered ? `Sent to ${r.delivered} ${r.delivered === 1 ? "person" : "people"}` : "Sent"];
  if (r.waiting) {
    const who = `${r.waiting} outside address${r.waiting === 1 ? "" : "es"}`;
    parts.push(r.sending_on ? `Going out now to ${who}` : `${who} will get it once your school sets up outside mail (it waits in your Outbox)`);
  }
  if (r.refused) parts.push(`${r.refused} could not receive it (mailbox full)`);
  return `${parts.join(". ")}.`;
};

// The picker works in local time (YYYY-MM-DDTHH:mm).
const localInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const toggle = (on: boolean) =>
  `${btn} ${on ? "tw-bg-brand-soft tw-text-brand" : ""}`;

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface ComposeStart {
  mode: ComposeMode;
  source?: MailMessage;
  /** For a draft opened again. */
  draft?: MailMessage;
  /** A new message already addressed ("Write" in Contacts). */
  to?: Address[];
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const prefix = (subject: string, p: "RE" | "FW") => (new RegExp(`^${p}:`, "i").test(subject.trim()) ? subject : `${p}: ${subject}`);

const quoted = (m: MailMessage) => `
<p></p>
<hr>
<p><b>From:</b> ${escapeHtml(m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address)}<br>
<b>Sent:</b> ${escapeHtml(longWhen(m.sent_at))}<br>
<b>To:</b> ${escapeHtml(names(m.to_list))}${m.cc_list.length ? `<br><b>Cc:</b> ${escapeHtml(names(m.cc_list))}` : ""}<br>
<b>Subject:</b> ${escapeHtml(m.subject)}</p>
<blockquote>${m.body_html}</blockquote>`;

const Compose = ({
  mailbox,
  people,
  start,
  onClose,
  onSaved,
}: {
  mailbox: Mailbox;
  people: DirectoryEntry[];
  start: ComposeStart;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { setError, setNotice } = useActionFeedback();
  const me = mailbox.address;
  const src = start.source;
  const signature = mailbox.signature_html ? `<p></p><p></p>${mailbox.signature_html}` : "";
  const strip = (list: Address[]) => list.filter((a) => a.address !== me);

  const initial = (() => {
    if (start.draft) {
      const d = start.draft;
      return { to: d.to_list, cc: d.cc_list, bcc: d.bcc_list, subject: d.subject, html: d.body_html, importance: d.importance };
    }
    if (src && (start.mode === "reply" || start.mode === "replyAll")) {
      // Replies go where the sender asked (Reply-To), or to the sender.
      const sender = src.reply_to?.length ? src.reply_to : [{ name: src.from_name, address: src.from_address }];
      const to = start.mode === "replyAll" ? strip([...sender, ...src.to_list]) : sender;
      return {
        to: to.length ? to : sender,
        cc: start.mode === "replyAll" ? strip(src.cc_list) : [],
        bcc: [],
        subject: prefix(src.subject, "RE"),
        html: `<p></p>${signature}${quoted(src)}`,
        importance: "normal" as Importance,
      };
    }
    if (src && start.mode === "forward") {
      return { to: [], cc: [], bcc: [], subject: prefix(src.subject, "FW"), html: `<p></p>${signature}${quoted(src)}`, importance: "normal" as Importance };
    }
    return { to: start.to ?? [], cc: [], bcc: [], subject: "", html: `<p></p>${signature}`, importance: "normal" as Importance };
  })();

  const [to, setTo] = useState<Address[]>(initial.to);
  const [cc, setCc] = useState<Address[]>(initial.cc);
  const [bcc, setBcc] = useState<Address[]>(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const [showBcc, setShowBcc] = useState(initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [html, setHtml] = useState(initial.html);
  const [importance, setImportance] = useState<Importance>(initial.importance);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [sending, setSending] = useState(false);
  const [big, setBig] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [trackOpens, setTrackOpens] = useState<boolean>(start.draft ? start.draft.track_opens : mailbox.notify_opens);
  const [readReceipt, setReadReceipt] = useState<boolean>(start.draft?.read_receipt ?? false);
  const [scheduledAt, setScheduledAt] = useState<string | null>(start.draft?.scheduled_at ?? null);
  const [scheduling, setScheduling] = useState(false);
  const [pickTime, setPickTime] = useState("");
  const draft = useRef<{ id?: string; envelope_id?: string }>(start.draft ? { id: start.draft.id, envelope_id: start.draft.envelope_id } : {});
  const dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pictureInput = useRef<HTMLInputElement | null>(null);
  const editor = useRef<RichTextEditorHandle | null>(null);

  // A draft opened again brings its files.
  useEffect(() => {
    if (start.draft) attachmentsFor([start.draft.envelope_id]).then(setAttachments);
  }, [start.draft]);

  const save = useCallback(async () => {
    const result = await saveDraft({
      id: draft.current.id,
      envelopeId: draft.current.envelope_id,
      mailboxId: mailbox.id,
      to,
      cc,
      bcc,
      subject,
      html,
      importance,
      inReplyTo: src && start.mode !== "forward" && start.mode !== "new" ? src.message_id : start.draft?.in_reply_to,
      threadId: src && start.mode !== "forward" ? src.thread_id : undefined,
      trackOpens,
      readReceipt,
    });
    draft.current = result;
    dirty.current = false;
    setSavedAt(new Date());
    onSaved();
    return result;
  }, [mailbox.id, to, cc, bcc, subject, html, importance, src, start.mode, start.draft, onSaved, trackOpens, readReceipt]);

  // Forwarding brings the original's files, once the draft exists to hold them.
  const forwarded = useRef(false);
  useEffect(() => {
    if (start.mode !== "forward" || !src || forwarded.current || !src.has_attachments) return;
    forwarded.current = true;
    (async () => {
      try {
        const files = await attachmentsFor([src.envelope_id]);
        if (!files.length) return;
        const d = draft.current.id ? draft.current : await save();
        setAttachments(await copyAttachments(files, mailbox.id, d.envelope_id as string));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [start.mode, src, mailbox.id, save, setError]);

  // Saved a moment after each change, as Outlook does.
  useEffect(() => {
    if (!dirty.current) return undefined;
    const t = window.setTimeout(() => {
      save().catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [to, cc, bcc, subject, html, importance, trackOpens, readReceipt, save]);
  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    dirty.current = true;
    setter(v);
  };

  const attach = async (files: File[]) => {
    if (!files.length) return;
    try {
      const d = draft.current.id ? draft.current : await save();
      for (const file of files) {
        setUploading((n) => n + 1);
        try {
          const a = await uploadAttachment(mailbox.id, d.envelope_id as string, file);
          setAttachments((list) => [...list, a]);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Pictures go inside the text, made a sensible size first.
  const addPictures = async (files: File[]) => {
    for (const f of files) {
      try {
        const url = await pictureForMail(f);
        if (inlineBytes(html) + url.length * 0.75 > MAX_INLINE_TOTAL) {
          setError("That is more pictures than one message can carry (about 10 MB). Attach the rest as files instead.");
          return;
        }
        editor.current?.insertImage(url, f.name);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  };
  // Pasted or dropped: pictures into the text, other files as attachments.
  const takeFiles = (files: File[]) => {
    const pics = files.filter(isPicture);
    const rest = files.filter((f) => !isPicture(f));
    if (pics.length) addPictures(pics);
    if (rest.length) attach(rest);
  };

  const send = async () => {
    const everyone = [...to, ...cc, ...bcc];
    if (!everyone.length) return setError("Add at least one recipient.");
    const bad = everyone.filter((a) => !isGroup(a.address) && !EMAIL.test(a.address));
    if (bad.length) return setError(`These addresses are not valid: ${bad.map((a) => a.address).join(", ")}`);
    if (!subject.trim() && !(await confirmDialog("Send this message without a subject?"))) return;
    if (uploading) return setError("Wait for the attachments to finish uploading.");
    setSending(true);
    try {
      const d = await save();
      if (scheduledAt) {
        await scheduleDraft(d.id, scheduledAt);
        setNotice(`Scheduled for ${new Date(scheduledAt).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. It waits in Drafts until then.`);
        onSaved();
        onClose();
        return;
      }
      // A few seconds to undo (the person's setting), then it really goes.
      queueSend(d.id, subject || "(no subject)", mailbox.undo_seconds ?? 10, (r) => {
        setNotice(sendSummary(r));
        onSaved();
      }, (err) => setError(`Not sent: ${err.message} It is in your Drafts.`));
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  };

  const setSchedule = async (at: string | null) => {
    if (at && new Date(at).getTime() < Date.now() + 60000) return setError("Pick a time at least a minute from now.");
    setScheduledAt(at);
    setScheduling(false);
    // An already-saved draft remembers it straight away.
    if (draft.current.id) {
      try {
        await scheduleDraft(draft.current.id, at ? new Date(at).toISOString() : null);
      } catch (err) {
        setError((err as Error).message);
      }
    }
  };

  const discard = async () => {
    const hasContent = draft.current.id || to.length || subject.trim() || html.replace(/<[^>]+>/g, "").trim();
    if (hasContent && !(await confirmDialog("Discard this message? The draft is deleted."))) return;
    try {
      for (const a of attachments) await removeAttachment(a);
      if (draft.current.id) await deleteForever([draft.current.id]);
      onSaved();
    } catch {
      // Nothing to undo if it was never saved.
    }
    onClose();
  };

  const total = attachments.reduce((n, a) => n + a.size_bytes, 0);

  return (
    <div
      className={
        big
          ? "tw-fixed tw-inset-0 tw-z-[160] tw-flex tw-items-stretch tw-justify-center tw-bg-[rgb(15_23_42_/_0.4)] tw-p-6 mobile:tw-p-0"
          : "tw-flex tw-h-full tw-min-h-0 tw-flex-col"
      }
    >
      <div
        className={`tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-bg-surface ${big ? "tw-max-w-[1000px] tw-rounded-2xl tw-shadow-3 mobile:tw-rounded-none" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          takeFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {/* Toolbar */}
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-4 tw-py-2.5">
          <button type="button" className={primaryBtn} disabled={sending} onClick={send}>
            <Svg d={ICON.sent} size={15} />
            {sending ? (scheduledAt ? "Scheduling…" : "Sending…") : scheduledAt ? "Schedule" : "Send"}
          </button>
          <div className="tw-relative">
            <button type="button" className={toggle(!!scheduledAt)} title="Send later" onClick={() => {
              setPickTime(scheduledAt ? localInput(scheduledAt) : "");
              setScheduling((v) => !v);
            }}>
              <Svg d={ICON.clock} size={15} />
              {scheduledAt ? new Date(scheduledAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "Later"}
            </button>
            {scheduling ? (
              <div className="tw-absolute tw-left-0 tw-top-full tw-z-[70] tw-mt-1 tw-w-[280px] tw-rounded-xl tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-3 tw-shadow-3">
                <p className="tw-m-0 tw-mb-2 tw-text-[13px] tw-font-semibold tw-text-ink">{"Send it at"}</p>
                <DateTimePicker value={pickTime} onChange={(v: string) => setPickTime(v || "")} />
                <div className="tw-mt-3 tw-flex tw-justify-between tw-gap-2">
                  {scheduledAt ? <button type="button" className={btn} onClick={() => setSchedule(null)}>{"Send now instead"}</button> : <span />}
                  <button type="button" className={primaryBtn} disabled={!pickTime} onClick={() => setSchedule(new Date(pickTime).toISOString())}>{"Set"}</button>
                </div>
              </div>
            ) : null}
          </div>
          <button type="button" className={btn} onClick={() => fileInput.current?.click()}>
            <Svg d={ICON.clip} size={15} />
            {"Attach"}
          </button>
          <button type="button" className={btn} title="Put a picture inside the message" onClick={() => pictureInput.current?.click()}>
            <Svg d={ICON.picture} size={15} />
            {"Picture"}
          </button>
          <button
            type="button"
            className={toggle(trackOpens)}
            aria-pressed={trackOpens}
            title="Get a notification the moment each person opens it"
            onClick={() => touch(setTrackOpens)(!trackOpens)}
          >
            <Svg d={ICON.eye} size={15} />
            {"Tell me when opened"}
          </button>
          <button
            type="button"
            className={toggle(readReceipt)}
            aria-pressed={readReceipt}
            title="Ask for a read receipt"
            onClick={() => touch(setReadReceipt)(!readReceipt)}
          >
            <Svg d={ICON.check} size={15} />
            {"Read receipt"}
          </button>
          <button
            type="button"
            className={`${btn} ${importance === "high" ? "tw-bg-danger-soft tw-text-danger" : ""}`}
            aria-pressed={importance === "high"}
            title="High importance"
            onClick={() => touch(setImportance)(importance === "high" ? "normal" : "high")}
          >
            <span className="tw-text-[15px] tw-font-bold">{"!"}</span>
            {"High importance"}
          </button>
          <button
            type="button"
            className={`${btn} ${importance === "low" ? "tw-bg-bg tw-text-ink" : ""}`}
            aria-pressed={importance === "low"}
            title="Low importance"
            onClick={() => touch(setImportance)(importance === "low" ? "normal" : "low")}
          >
            <span className="tw-text-[15px]">{"↓"}</span>
            {"Low"}
          </button>
          <span className="tw-flex-1" />
          <span className="tw-text-[12px] tw-text-ink-3">{savedAt ? `Draft saved ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
          <button type="button" className={btn} title={big ? "Back to the reading pane" : "Open in a larger window"} onClick={() => setBig((v) => !v)}>
            <Svg d={big ? ICON.shrink : ICON.expand} size={15} />
          </button>
          <button type="button" className={`${btn} tw-text-danger`} onClick={discard}>
            <Svg d={ICON.deleted} size={15} />
            {"Discard"}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              attach(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <input
            ref={pictureInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              addPictures(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>

        {/* Addresses and subject */}
        <div className="tw-px-5">
          <div className="tw-flex tw-items-center tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-py-2.5">
            <span className="tw-w-10 tw-shrink-0 tw-text-[13.5px] tw-text-ink-3">{"From"}</span>
            <span className="tw-truncate tw-text-[14px] tw-text-ink">{`${mailbox.display_name} <${mailbox.address}>`}</span>
          </div>
          <RecipientField
            label="To"
            value={to}
            onChange={touch(setTo)}
            people={people}
            autoFocus={start.mode === "new" || start.mode === "forward"}
            trailing={
              <span className="tw-flex tw-shrink-0 tw-gap-1 tw-pt-1">
                {!showCc ? (
                  <button type="button" className={`${btn} tw-px-1.5 tw-py-0.5 tw-text-[13px]`} onClick={() => setShowCc(true)}>
                    {"Cc"}
                  </button>
                ) : null}
                {!showBcc ? (
                  <button type="button" className={`${btn} tw-px-1.5 tw-py-0.5 tw-text-[13px]`} onClick={() => setShowBcc(true)}>
                    {"Bcc"}
                  </button>
                ) : null}
              </span>
            }
          />
          {showCc ? <RecipientField label="Cc" value={cc} onChange={touch(setCc)} people={people} /> : null}
          {showBcc ? <RecipientField label="Bcc" value={bcc} onChange={touch(setBcc)} people={people} /> : null}
          <input
            value={subject}
            onChange={(e) => touch(setSubject)(e.target.value)}
            placeholder="Add a subject"
            aria-label="Subject"
            className="tw-w-full tw-border-0 tw-border-b tw-border-solid tw-border-line tw-bg-transparent tw-py-3 tw-text-[15px] tw-font-semibold tw-text-ink tw-outline-none [font-family:inherit]"
          />
        </div>

        {/* Attachments */}
        {attachments.length || uploading ? (
          <div className="tw-flex tw-flex-wrap tw-gap-2 tw-px-5 tw-pt-3">
            {attachments.map((a) => (
              <span key={a.id} className="tw-inline-flex tw-max-w-[260px] tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-line tw-bg-bg tw-py-1.5 tw-pl-2.5 tw-pr-1.5 tw-text-[13px]">
                <span className="tw-text-brand">
                  <Svg d={ICON.file} size={15} />
                </span>
                <span className="tw-min-w-0 tw-flex-1 tw-truncate" title={a.file_name}>
                  {a.file_name}
                </span>
                <span className="tw-shrink-0 tw-text-[12px] tw-text-ink-3">{formatBytes(a.size_bytes)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.file_name}`}
                  onClick={async () => {
                    await removeAttachment(a);
                    setAttachments((list) => list.filter((x) => x.id !== a.id));
                  }}
                  className="tw-inline-flex tw-h-6 tw-w-6 tw-items-center tw-justify-center tw-rounded tw-border-0 tw-bg-transparent tw-text-ink-3 tw-cursor-pointer hover:tw-bg-surface hover:tw-text-danger"
                >
                  <Svg d={ICON.close} size={13} />
                </button>
              </span>
            ))}
            {uploading ? <span className="tw-self-center tw-text-[13px] tw-text-ink-3">{`Uploading ${uploading}…`}</span> : null}
            {attachments.length > 1 ? <span className="tw-self-center tw-text-[12px] tw-text-ink-3">{`${attachments.length} files · ${formatBytes(total)}`}</span> : null}
          </div>
        ) : null}

        {/* The message */}
        <div className="mail-compose-editor tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-px-5 tw-py-3">
          <RichTextEditor ref={editor} value={html} onChange={touch(setHtml)} toolbar="full" placeholder="Write your message…" onPasteFiles={takeFiles} />
        </div>

        {dragging ? (
          <div className="tw-pointer-events-none tw-absolute tw-inset-3 tw-flex tw-items-center tw-justify-center tw-rounded-2xl tw-border-2 tw-border-dashed tw-border-brand tw-bg-brand-soft tw-text-[15px] tw-font-semibold tw-text-brand">
            {"Drop files to attach them (pictures go inside the message)"}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Compose;
