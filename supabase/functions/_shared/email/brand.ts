// Server-side twin of src/lib/branding.js's deriveBrandPalette() — same
// math, so an email and the app itself never disagree about what a
// school's colour actually looks like. Kept as a separate copy (Deno edge
// functions bundle independently and can't import from src/), not a
// refactor target: if one changes, check the other.

export type BrandPalette = {
  brand: string;
  brandDark: string;
  brandDarker: string;
  brandSoft: string;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function hexToHsl(hex: string) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number) {
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

const DEFAULT_HEX = "#6d3fc4"; // Schoolivio's own purple — a school with no theme_color set gets this, same as the app itself.

export function deriveBrandPalette(hex?: string | null): BrandPalette {
  const hsl = hexToHsl(hex || "");
  if (!hsl) return deriveBrandPalette(DEFAULT_HEX);
  const { h, s } = hsl;
  const l = Math.min(0.62, Math.max(0.3, hsl.l));
  return {
    brand: hslToHex(h, s, l),
    brandDark: hslToHex(h, s, Math.max(0.18, l - 0.14)),
    brandDarker: hslToHex(h, Math.min(1, s + 0.05), Math.max(0.14, l - 0.24)),
    brandSoft: hslToHex(h, Math.min(1, s + 0.3), 0.95),
  };
}
