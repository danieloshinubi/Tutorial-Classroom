// Runs the same conversion the browser worker does, in Node, on a .pst/.ost:
//   node test.mjs <file.pst> [out.mbox]
// Prints the folders found, how many messages became email, and writes the
// mbox parts joined into one file for the importer's own test.
import { build } from "esbuild";
import { writeFileSync, appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [, , input, out = path.join(tmpdir(), "pst-test.mbox")] = process.argv;
if (!input) {
  console.error("usage: node test.mjs <file.pst> [out.mbox]");
  process.exit(1);
}
const bundle = path.join(mkdtempSync(path.join(tmpdir(), "pstw-")), "core.mjs");
await build({ entryPoints: [path.join(here, "core.ts")], outfile: bundle, bundle: true, format: "esm", platform: "node", logLevel: "error",
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
const { PSTFile } = await import(pathToFileURL(path.join(here, "node_modules", "pst-extractor", "dist", "index.js")).href).then((m) => m.default ?? m);
const core = await import(pathToFileURL(bundle).href);

const pst = new PSTFile(path.resolve(input));
const folders = core.scan(pst);
console.log("folders", JSON.stringify(folders));
writeFileSync(out, "");
let parts = 0;
const started = Date.now();
const result = await core.extract(pst, async (part, n) => {
  parts += 1;
  appendFileSync(out, part);
  console.log(`part ${parts}: ${n} messages, ${(part.length / 1048576).toFixed(1)} MB`);
}, () => {}, 4 * 1024 * 1024);
console.log("result", JSON.stringify(result), `${((Date.now() - started) / 1000).toFixed(1)}s`, "->", out);
