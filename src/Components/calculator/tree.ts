// The natural-display editor's model (2026-10-15). What the pupil types is a
// tree, exactly as a Casio fx-991ES PLUS holds it: a row of tokens, where a
// fraction, root, power, integral and the rest are boxes holding rows of
// their own. The cursor is a row plus a position in it, and moves through the
// boxes in the same order the real calculator's ◀ ▶ keys do.

export type Seq = Node[];

export type Kind =
  | "frac" // a/b
  | "mixed" // whole a/b
  | "sqrt"
  | "root" // ⁿ√a  (slots: n, a)
  | "pow" // superscript on what comes before it
  | "e10" // ×10^n, part of the number before it
  | "logb" // log_b(a)  (slots: b, a)
  | "abs"
  | "int" // ∫ f dx from lo to hi  (slots: f, lo, hi)
  | "ddx" // d/dx(f) at x  (slots: f, x)
  | "sum"; // Σ f for X = lo..hi  (slots: f, lo, hi)

export type Tok = { t: "c"; v: string };
export type Box = { t: Kind; s: Seq[] };
export type Node = Tok | Box;

export type Cursor = { seq: Seq; i: number };

export const tok = (v: string): Tok => ({ t: "c", v });
export const isBox = (n: Node | undefined): n is Box => !!n && n.t !== "c";
export const box = (t: Kind, ...s: Seq[]): Box => ({ t, s });

// A fresh, empty template of each kind, and the slot the cursor lands in.
export const template = (t: Kind): { node: Box; slot: number } => {
  switch (t) {
    case "frac":
      return { node: box("frac", [], []), slot: 0 };
    case "mixed":
      return { node: box("mixed", [], [], []), slot: 0 };
    case "root":
      return { node: box("root", [], []), slot: 0 };
    case "logb":
      return { node: box("logb", [], []), slot: 0 };
    case "int":
      return { node: box("int", [], [], []), slot: 0 };
    case "ddx":
      return { node: box("ddx", [], []), slot: 0 };
    case "sum":
      return { node: box("sum", [], [], []), slot: 0 };
    default:
      return { node: box(t, []), slot: 0 };
  }
};

type Where = { parent: Seq; index: number; node: Box; slot: number };

// Where a row sits: the box that holds it, and that box's place in its own row.
export const locate = (root: Seq, target: Seq): Where | null => {
  for (let index = 0; index < root.length; index += 1) {
    const node = root[index];
    if (!isBox(node)) continue;
    for (let slot = 0; slot < node.s.length; slot += 1) {
      if (node.s[slot] === target) return { parent: root, index, node, slot };
      const deeper = locate(node.s[slot], target);
      if (deeper) return deeper;
    }
  }
  return null;
};

export const moveRight = (root: Seq, c: Cursor): Cursor => {
  if (c.i < c.seq.length) {
    const n = c.seq[c.i];
    if (isBox(n) && n.s.length) return { seq: n.s[0], i: 0 };
    return { seq: c.seq, i: c.i + 1 };
  }
  const w = locate(root, c.seq);
  if (!w) return { seq: root, i: 0 }; // wraps round, as the calculator does
  if (w.slot + 1 < w.node.s.length) return { seq: w.node.s[w.slot + 1], i: 0 };
  return { seq: w.parent, i: w.index + 1 };
};

export const moveLeft = (root: Seq, c: Cursor): Cursor => {
  if (c.i > 0) {
    const n = c.seq[c.i - 1];
    if (isBox(n) && n.s.length) {
      const last = n.s[n.s.length - 1];
      return { seq: last, i: last.length };
    }
    return { seq: c.seq, i: c.i - 1 };
  }
  const w = locate(root, c.seq);
  if (!w) return { seq: root, i: root.length };
  if (w.slot > 0) {
    const prev = w.node.s[w.slot - 1];
    return { seq: prev, i: prev.length };
  }
  return { seq: w.parent, i: w.index };
};

// ▲ ▼ inside a fraction (or a power, a root's index, a limit) move between
// its top and bottom. Returns null when there is nowhere to go, so the caller
// can use the key for the history instead.
export const moveVertical = (root: Seq, c: Cursor, dir: "up" | "down"): Cursor | null => {
  let seq = c.seq;
  for (;;) {
    const w = locate(root, seq);
    if (!w) return null;
    const { node, slot } = w;
    let to = -1;
    if (node.t === "frac" || node.t === "mixed") {
      const top = node.t === "mixed" ? 1 : 0;
      if (dir === "down" && slot === top) to = top + 1;
      if (dir === "up" && slot === top + 1) to = top;
    } else if (node.t === "int" || node.t === "sum") {
      if (dir === "down" && slot === 2) to = 1;
      if (dir === "up" && slot === 1) to = 2;
    }
    if (to >= 0) {
      const target = node.s[to];
      return { seq: target, i: Math.min(c.i, target.length) };
    }
    seq = w.parent;
  }
};

// Puts a token or template at the cursor; returns where the cursor goes.
export const insertNode = (c: Cursor, node: Node, enterSlot = -1): Cursor => {
  c.seq.splice(c.i, 0, node);
  if (isBox(node) && enterSlot >= 0) return { seq: node.s[enterSlot], i: node.s[enterSlot].length };
  return { seq: c.seq, i: c.i + 1 };
};

const emptyBox = (n: Box) => n.s.every((s) => s.length === 0);

// DEL: removes what is just left of the cursor. A box with something in it is
// stepped into instead (so its contents go one at a time); at the start of a
// box's row, the box itself goes and its contents stay where it was.
export const deleteBack = (root: Seq, c: Cursor): Cursor => {
  if (c.i > 0) {
    const n = c.seq[c.i - 1];
    if (isBox(n) && !emptyBox(n) && !(n.t === "pow" && n.s[0].length <= 2)) return moveLeft(root, c);
    c.seq.splice(c.i - 1, 1);
    return { seq: c.seq, i: c.i - 1 };
  }
  const w = locate(root, c.seq);
  if (!w) return c;
  const spill = w.node.s.flat();
  w.parent.splice(w.index, 1, ...spill);
  const before = w.node.s.slice(0, w.slot).reduce((a, s) => a + s.length, 0);
  return { seq: w.parent, i: w.index + before };
};

export const clone = (s: Seq): Seq => s.map((n) => (isBox(n) ? { t: n.t, s: n.s.map(clone) } : { ...n }));

export const isEmpty = (s: Seq) => s.length === 0;

// Every token in a row and the rows inside it, for "which letters does this
// use" (CALC asks for each).
export const tokensIn = (s: Seq): string[] => s.flatMap((n) => (isBox(n) ? n.s.flatMap(tokensIn) : [n.v]));
