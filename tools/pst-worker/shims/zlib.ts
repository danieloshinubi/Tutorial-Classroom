// Node's zlib.unzipSync, which pst-extractor uses for newer (compressed)
// .ost / .pst blocks, done in the browser with fflate.
import { Buffer } from "buffer";
import { decompressSync } from "fflate";

export function unzipSync(data: Uint8Array) {
  return Buffer.from(decompressSync(new Uint8Array(data)));
}

export default { unzipSync };
