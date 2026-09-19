// One-off: the Tekktopia logo was supplied as flat BLACK-background artwork
// (no alpha channel, confirmed by direct pixel inspection — (0,0,0) across
// the whole canvas outside the orange/blue T) — chroma-keys near-black
// pixels to transparent so only the T itself remains, on any background.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const file = process.argv[2];
const png = PNG.sync.read(fs.readFileSync(file));

const THRESHOLD = 40; // near-black: all channels below this become transparent

for (let i = 0; i < png.data.length; i += 4) {
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  if (r <= THRESHOLD && g <= THRESHOLD && b <= THRESHOLD) {
    png.data[i + 3] = 0;
  }
}

fs.writeFileSync(file, PNG.sync.write(png));
console.log("done:", path.basename(file));
