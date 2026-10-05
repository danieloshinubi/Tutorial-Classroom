import { supabase } from "../../lib/supabaseClient";
import { appendPstPart, finishPstParts, importFound, startPstImport } from "../../lib/mailImportApi";

// Importing an Outlook .pst / .ost (supabase/240). The file is read right
// here in the browser, by a Web Worker (public/workers/pst-worker.js, built
// from tools/pst-worker), which only ever reads the parts it needs, so a
// file of many gigabytes is fine. The mail comes out in parts of about 40 MB
// that are uploaded one at a time and imported by the server as they arrive.
//
// It lives outside React so that closing the import window, or moving to
// another page of Schoolivio, does not stop it. Closing the browser tab
// does: the page asks first, and whatever came across is kept (and skipped
// if the same file is imported again).

export interface PstState {
  running: boolean;
  fileName: string;
  importId: string | null;
  total: number;          // items in the file's mail folders
  read: number;           // messages read so far
  uploaded: number;       // messages uploaded so far
  bytes: number;
  error: string | null;
  finished: boolean;
}

const fresh = (): PstState => ({ running: false, fileName: "", importId: null, total: 0, read: 0, uploaded: 0, bytes: 0, error: null, finished: false });
let state: PstState = fresh();
const listeners = new Set<(s: PstState) => void>();
const emit = (patch: Partial<PstState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
};

export const pstState = () => state;
export function onPst(fn: (s: PstState) => void) {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

let worker: Worker | null = null;

const warnOnLeave = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "Your Outlook file is still being imported. Leaving now stops it.";
  return e.returnValue;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Is the server more than 2,000 messages behind what has been sent up?
async function behind(importId: string) {
  const found = await importFound(importId).catch(() => state.uploaded);
  return state.uploaded - found > 2000;
}

async function upload(mailboxId: string, importId: string, n: number, bytes: ArrayBuffer) {
  const path = `${mailboxId}/${importId}/${String(n).padStart(5, "0")}.mbox`;
  let last: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await supabase.storage.from("mail-imports").upload(path, new Blob([bytes]), { upsert: false, contentType: "application/octet-stream" });
    // A retry after an upload that did land finds it already there: that is fine.
    if (!error || /exists|duplicate/i.test(error.message)) {
      await appendPstPart(importId, path, bytes.byteLength);
      return;
    }
    last = new Error(error.message);
    await sleep(2000 * (attempt + 1));
  }
  throw last ?? new Error("Upload failed.");
}

export async function startPst(mailboxId: string, file: File) {
  if (state.running) throw new Error("An Outlook file is already being imported. Wait for it to finish.");
  const started = await startPstImport(mailboxId, `Outlook data file (${file.name})`);
  const importId = started.id as string;
  emit({ ...fresh(), running: true, fileName: file.name, importId });
  window.addEventListener("beforeunload", warnOnLeave);

  let n = 0;
  let chain = Promise.resolve();
  const stop = async (error: string | null) => {
    worker?.terminate();
    worker = null;
    await chain.catch(() => null);
    await finishPstParts(importId).catch(() => null);
    window.removeEventListener("beforeunload", warnOnLeave);
    emit({ running: false, finished: !error, error });
  };

  worker = new Worker("/workers/pst-worker.js");
  worker.onerror = (e) => {
    stop(`The Outlook file could not be read: ${e.message || "unknown error"}`);
  };
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; total?: number; done?: number; bytes?: ArrayBuffer; messages?: number; message?: string };
    if (m.type === "scan") emit({ total: m.total ?? 0 });
    else if (m.type === "progress") emit({ read: m.done ?? 0 });
    else if (m.type === "part" && m.bytes) {
      const bytes = m.bytes;
      const messages = m.messages ?? 0;
      n += 1;
      const seq = n;
      chain = chain.then(async () => {
        // Never far ahead of the server: wait while it is more than 2,000 messages behind.
        while (await behind(importId)) await sleep(10000);
        await upload(mailboxId, importId, seq, bytes);
        emit({ uploaded: state.uploaded + messages, bytes: state.bytes + bytes.byteLength });
        worker?.postMessage({ type: "ack" });
      }).catch((err: Error) => {
        stop(`Uploading stopped: ${err.message}. What came across is kept; import the file again to bring the rest (nothing is doubled).`);
        throw err;
      });
    } else if (m.type === "done") {
      chain.then(() => stop(null)).catch(() => null);
    } else if (m.type === "error") {
      stop(m.message ?? "The Outlook file could not be read.");
    }
  };
  worker.postMessage({ type: "start", file });
}

export function cancelPst() {
  if (!state.running) return;
  worker?.postMessage({ type: "stop" });
}
