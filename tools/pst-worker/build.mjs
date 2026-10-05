// Builds the Outlook .pst reader for the browser into
// public/workers/pst-worker.js (one self-contained file, loaded as a Web
// Worker by src/Pages/Mail/pstImport.ts). Kept apart from the app's own
// build so the app needs no Node polyfills. Rebuild after changing anything
// here:   cd tools/pst-worker && npm install && npm run build
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = (f) => path.join(here, "shims", f);

await build({
  entryPoints: [path.join(here, "worker.ts")],
  outfile: path.join(here, "..", "..", "public", "workers", "pst-worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2019",
  minify: true,
  legalComments: "eof",
  alias: { fs: shim("fs.ts"), zlib: shim("zlib.ts"), stream: shim("empty.ts"), string_decoder: shim("empty.ts") },
  inject: [shim("globals.ts")],
  define: { global: "self" },
  banner: { js: "/* Schoolivio Mail: Outlook .pst reader (tools/pst-worker). Includes pst-extractor (MIT), buffer (MIT), long (Apache-2.0), iconv-lite (MIT), fflate (MIT). */" },
  logLevel: "info",
});
