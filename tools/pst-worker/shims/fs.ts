// The one piece of Node's "fs" pst-extractor needs, for a browser Web
// Worker: reading any part of the chosen file, synchronously, without ever
// loading the whole file (FileReaderSync on slices). Recently read 1 MB
// blocks are kept, since the library reads in many small pieces.

let file: Blob | null = null;
const BLOCK = 1024 * 1024;
const KEEP = 96;
const cache = new Map<number, Uint8Array>();

export function setFile(f: Blob) {
  file = f;
  cache.clear();
}

declare const FileReaderSync: { new (): { readAsArrayBuffer(b: Blob): ArrayBuffer } };

function block(n: number): Uint8Array {
  const hit = cache.get(n);
  if (hit) {
    cache.delete(n);
    cache.set(n, hit);
    return hit;
  }
  if (!file) throw new Error("No file chosen.");
  const data = new Uint8Array(new FileReaderSync().readAsArrayBuffer(file.slice(n * BLOCK, (n + 1) * BLOCK)));
  cache.set(n, data);
  if (cache.size > KEEP) cache.delete(cache.keys().next().value as number);
  return data;
}

export function openSync() {
  return 3;
}
export function closeSync() {}

export function readSync(_fd: number, buffer: Uint8Array, offset: number, length: number, position: number) {
  let done = 0;
  while (done < length) {
    const pos = position + done;
    const n = Math.floor(pos / BLOCK);
    const b = block(n);
    const from = pos - n * BLOCK;
    if (from >= b.length) break;              // end of file
    const take = Math.min(length - done, b.length - from);
    buffer.set(b.subarray(from, from + take), offset + done);
    done += take;
  }
  return done;
}

export default { openSync, closeSync, readSync };
