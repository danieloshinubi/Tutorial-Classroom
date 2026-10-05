import { sendDraft, type SendResult } from "../../lib/mailApi";

// Undo send (supabase/241): a message waits a few seconds (the person's
// setting) before it is really sent, with an Undo button. It lives outside
// React so moving to another page of Schoolivio does not cancel it. If the
// browser is closed in those seconds the message is not sent: it stays in
// Drafts, nothing is lost.

export interface PendingSend {
  draftId: string;
  subject: string;
  until: number;
}

let pending: PendingSend[] = [];
const timers = new Map<string, number>();
const listeners = new Set<(p: PendingSend[]) => void>();
const emit = () => listeners.forEach((l) => l(pending));

export function onPendingSends(fn: (p: PendingSend[]) => void) {
  listeners.add(fn);
  fn(pending);
  return () => {
    listeners.delete(fn);
  };
}

export function queueSend(
  draftId: string,
  subject: string,
  seconds: number,
  done: (r: SendResult) => void,
  failed: (err: Error) => void,
) {
  const go = () => {
    timers.delete(draftId);
    pending = pending.filter((p) => p.draftId !== draftId);
    emit();
    sendDraft(draftId).then(done).catch(failed);
  };
  if (seconds <= 0) return go();
  pending = [...pending.filter((p) => p.draftId !== draftId), { draftId, subject, until: Date.now() + seconds * 1000 }];
  timers.set(draftId, window.setTimeout(go, seconds * 1000));
  emit();
}

/** Stops a waiting message; true when it had not gone yet. */
export function undoSend(draftId: string) {
  const t = timers.get(draftId);
  if (t === undefined) return false;
  window.clearTimeout(t);
  timers.delete(draftId);
  pending = pending.filter((p) => p.draftId !== draftId);
  emit();
  return true;
}

/** Sends a waiting message now (the "Send now" on the bar). */
export function sendNow(draftId: string, done: (r: SendResult) => void, failed: (err: Error) => void) {
  if (!undoSend(draftId)) return;
  sendDraft(draftId).then(done).catch(failed);
}

// Leaving with a message still waiting: ask first.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!pending.length) return undefined;
    e.preventDefault();
    e.returnValue = "A message is waiting to be sent. Leave now and it stays in Drafts.";
    return e.returnValue;
  });
}
