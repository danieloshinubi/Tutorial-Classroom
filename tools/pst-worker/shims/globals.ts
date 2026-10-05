// Node globals the bundled libraries expect, provided in the worker.
import { Buffer } from "buffer";

export { Buffer };
export const process = { env: {}, versions: {}, platform: "browser", nextTick: (fn: () => void) => Promise.resolve().then(fn) };
