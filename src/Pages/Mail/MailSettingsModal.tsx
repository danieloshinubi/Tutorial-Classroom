import React, { useState } from "react";
import { Button, DateTimePicker, Modal, Select } from "../../Components/UI";
import { RichTextEditor } from "../../Components/RichTextEditor";
import { useActionFeedback } from "../../Components/Toast";
import { saveMailboxSettings, saveSignature, type Mailbox } from "../../lib/mailApi";

// Mail → Settings (supabase/241): the signature, automatic replies (out of
// office) and how sending behaves (seconds to undo a send, and whether new
// messages tell you when they are opened).

const localInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const MailSettingsModal = ({ mailbox, onClose, onSaved }: { mailbox: Mailbox; onClose: () => void; onSaved: (m: Mailbox) => void }) => {
  const { setError, setNotice } = useActionFeedback();
  const [tab, setTab] = useState<"signature" | "away" | "sending">("signature");
  const [signature, setSignature] = useState(mailbox.signature_html);
  const [away, setAway] = useState({
    on: mailbox.autoreply_enabled,
    start: localInput(mailbox.autoreply_start),
    end: localInput(mailbox.autoreply_end),
    html: mailbox.autoreply_html || "<p>Thank you for your message. I am away and will reply when I am back.</p>",
    outside: mailbox.autoreply_outside,
  });
  const [undo, setUndo] = useState(String(mailbox.undo_seconds ?? 10));
  const [notify, setNotify] = useState(mailbox.notify_opens);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (away.start && away.end && new Date(away.end) <= new Date(away.start)) throw new Error("The automatic replies end before they start.");
      await saveSignature(mailbox.id, signature);
      const patch = {
        autoreply_enabled: away.on,
        autoreply_start: away.start ? new Date(away.start).toISOString() : null,
        autoreply_end: away.end ? new Date(away.end).toISOString() : null,
        autoreply_html: away.html,
        autoreply_outside: away.outside,
        undo_seconds: Number(undo),
        notify_opens: notify,
      };
      await saveMailboxSettings(mailbox.id, patch);
      onSaved({ ...mailbox, ...patch, signature_html: signature });
      setNotice(away.on ? "Settings saved. Automatic replies are on." : "Settings saved.");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`tw-rounded-full tw-border tw-border-solid tw-px-3 tw-py-1.5 tw-text-[13px] tw-font-semibold tw-cursor-pointer [font-family:inherit] ${tab === id ? "tw-border-brand tw-bg-brand-soft tw-text-brand" : "tw-border-line tw-bg-surface tw-text-ink-2"}`}
    >
      {label}
    </button>
  );

  return (
    <Modal
      title="Mail settings"
      wide
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{"Cancel"}</Button>
          <Button type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="tw-mb-4 tw-flex tw-flex-wrap tw-gap-2">
        {tabBtn("signature", "Signature")}
        {tabBtn("away", away.on ? "Automatic replies (on)" : "Automatic replies")}
        {tabBtn("sending", "Sending")}
      </div>

      {tab === "signature" ? (
        <>
          <p className="tw-m-0 tw-mb-2 tw-text-[13px] tw-text-ink-3">{"Added to the end of every message you write or reply to."}</p>
          <div className="tw-rounded-xl tw-border tw-border-solid tw-border-line tw-p-3">
            <RichTextEditor value={signature} onChange={setSignature} toolbar="full" placeholder="e.g. your name, job title, the school and its phone number" />
          </div>
        </>
      ) : tab === "away" ? (
        <div className="tw-flex tw-flex-col tw-gap-3">
          <label className="tw-flex tw-items-center tw-gap-2 tw-text-[14px] tw-font-semibold tw-text-ink">
            <input type="checkbox" checked={away.on} onChange={(e) => setAway({ ...away, on: e.target.checked })} />
            {"Send automatic replies"}
          </label>
          <div className="tw-grid tw-grid-cols-2 tw-gap-3 mobile:tw-grid-cols-1">
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"From (optional)"}</span>
              <DateTimePicker value={away.start} onChange={(v: string) => setAway({ ...away, start: v || "" })} placeholder="Straight away" />
            </label>
            <label className="tw-flex tw-flex-col tw-gap-1">
              <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Until (optional)"}</span>
              <DateTimePicker value={away.end} onChange={(v: string) => setAway({ ...away, end: v || "" })} placeholder="Until I turn them off" />
            </label>
          </div>
          <div className="tw-rounded-xl tw-border tw-border-solid tw-border-line tw-p-3">
            <RichTextEditor value={away.html} onChange={(v: string) => setAway({ ...away, html: v })} toolbar="full" placeholder="Your automatic reply" />
          </div>
          <label className="tw-flex tw-items-center tw-gap-2 tw-text-[13.5px] tw-text-ink">
            <input type="checkbox" checked={away.outside} onChange={(e) => setAway({ ...away, outside: e.target.checked })} />
            {"Also reply to people outside the school"}
          </label>
          <p className="tw-m-0 tw-text-[12.5px] tw-text-ink-3">{"Each person gets it once every 4 days at most. Automatic mail (no-reply addresses, newsletters) never gets one."}</p>
        </div>
      ) : (
        <div className="tw-flex tw-flex-col tw-gap-4">
          <label className="tw-flex tw-max-w-[320px] tw-flex-col tw-gap-1">
            <span className="tw-text-[13px] tw-font-semibold tw-text-ink-2">{"Undo send"}</span>
            <Select
              value={undo}
              onChange={(v: string) => setUndo(v)}
              options={[
                { value: "0", label: "Off: send straight away" },
                { value: "5", label: "5 seconds" },
                { value: "10", label: "10 seconds" },
                { value: "20", label: "20 seconds" },
                { value: "30", label: "30 seconds" },
              ]}
            />
            <span className="tw-text-[12.5px] tw-text-ink-3">{"How long you have to take a message back after pressing Send."}</span>
          </label>
          <label className="tw-flex tw-items-start tw-gap-2 tw-text-[13.5px] tw-text-ink">
            <input type="checkbox" className="tw-mt-1" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>
              <strong>{"Tell me when my mail is opened"}</strong>
              <br />
              <span className="tw-text-[12.5px] tw-text-ink-3">
                {"New messages start with this on (you can switch it off on any message). You get a notification the moment each person opens it, on screen and on your phone. Inside Schoolivio it is exact; outside, it works when the recipient's mail app shows pictures (Apple Mail may report an open early)."}
              </span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
};

export default MailSettingsModal;
