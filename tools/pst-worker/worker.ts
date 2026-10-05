// The Web Worker (built to public/workers/pst-worker.js): reads a chosen
// .pst / .ost in the background of the page and hands back mbox parts for
// upload. Messages: in  { type: "start", file } | { type: "ack" } | { type: "stop" }
//                   out { type: "scan", folders, total } | { type: "progress", … }
//                       | { type: "part", bytes, messages } | { type: "done", … } | { type: "error", message }
// The page acknowledges each part once it is uploaded; the worker never runs
// more than two parts ahead, so a huge file never piles up in memory.

import { PSTFile } from "pst-extractor";
import { setFile } from "./shims/fs";
import { extract, scan } from "./core";

declare const self: { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

let waiting = 0;
let release: (() => void) | null = null;
let stopped = false;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: string; file?: File };
  if (m.type === "ack") {
    waiting = Math.max(0, waiting - 1);
    if (release && waiting < 2) {
      const r = release;
      release = null;
      r();
    }
    return;
  }
  if (m.type === "stop") {
    stopped = true;
    release?.();
    return;
  }
  if (m.type !== "start" || !m.file) return;
  try {
    setFile(m.file);
    // pst-extractor opens a "file name"; our fs shim reads the chosen file.
    const pst = new PSTFile("chosen.pst");
    const folders = scan(pst);
    self.postMessage({ type: "scan", folders, total: folders.reduce((n, f) => n + f.count, 0) });
    const result = await extract(
      pst,
      async (part, messages) => {
        waiting += 1;
        self.postMessage({ type: "part", bytes: part.buffer, messages }, [part.buffer]);
        if (waiting >= 2) await new Promise<void>((r) => (release = r));
      },
      (p) => self.postMessage({ type: "progress", ...p }),
      40 * 1024 * 1024,
      () => stopped,
    );
    self.postMessage({ type: "done", ...result, stopped });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    self.postMessage({
      type: "error",
      message: /encrypted/i.test(msg)
        ? "This file is password-protected. Open it in Outlook, remove the password (File → Account Settings → Data Files → Settings → Change Password), and try again."
        : /Invalid file header|Unrecognised PST/i.test(msg)
          ? "This is not an Outlook data file (.pst or .ost)."
          : `Could not read the file: ${msg}`,
    });
  }
};
