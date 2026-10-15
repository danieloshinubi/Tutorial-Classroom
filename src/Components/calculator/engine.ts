import { create, all } from "mathjs";
import { isBox, tok, box, type Seq, type Node, type Box } from "./tree";
import { constantBySym, conversionBySym } from "./tables";

// Works out what the pupil typed, the way an fx-991ES PLUS does: its order
// of operations (2π and 3sin(x) bind tighter than ÷, so 1÷2π is 1/(2π);
// −2² is −4), its angle units, its errors (Math ERROR, Syntax ERROR), and
// answers shown as exact fractions, surds and multiples of π where they are.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M: any = create(all, {});

/* ------------------------------------------------------------------ types */

export type Mode = "COMP" | "CMPLX" | "STAT" | "BASE-N" | "EQN" | "MATRIX" | "TABLE" | "VECTOR";
export type Angle = "deg" | "rad" | "gra";
export type Disp = { k: "norm"; n: 1 | 2 } | { k: "fix"; n: number } | { k: "sci"; n: number };
export type Base = "dec" | "hex" | "bin" | "oct";
export type Settings = {
  mathIO: boolean; // natural display of answers (fractions, surds, π)
  angle: Angle;
  disp: Disp;
  mixed: boolean; // a b/c answers rather than d/c
  polar: boolean; // complex answers as r∠θ
};
export const DEFAULT_SETTINGS: Settings = { mathIO: true, angle: "deg", disp: { k: "norm", n: 1 }, mixed: false, polar: false };

export type StatType = "1-VAR" | "A+BX" | "_+CX²" | "ln X" | "e^X" | "A•B^X" | "A•X^B" | "1/X";
export type StatRow = { x: number; y: number; f: number };
export type StatData = { type: StatType; rows: StatRow[]; freq: boolean };

// A value: a real number, a complex number, a matrix or vector, or the two
// answers Pol( and Rec( give.
export type Pair = { pair: [number, number]; labels: [string, string] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Val = number | any;

export type Ctx = {
  mode: Mode;
  settings: Settings;
  vars: Record<string, Val>; // A–F, X, Y, M, MatA…, VctA…
  ans: Val;
  stat: StatData;
  base: Base;
};

export class CalcError extends Error {
  constructor(public kind: "Syntax" | "Math" | "Dimension" | "Argument" | "Can't Solve" | "Stack" | "Time Out") {
    super(`${kind} ERROR`);
  }
}
const syntax = () => new CalcError("Syntax");
const mathErr = () => new CalcError("Math");

export const isPair = (v: Val): v is Pair => !!v && typeof v === "object" && "pair" in v;
export const isComplex = (v: Val) => M.isComplex(v);
export const isMatrix = (v: Val) => M.isMatrix(v);
const isVector = (v: Val) => isMatrix(v) && v.size().length === 1;

/* -------------------------------------------------------------- numerics */

const LIMIT = 1e100;
const snap = (x: number) => {
  if (!Number.isFinite(x) || Math.abs(x) >= LIMIT) throw mathErr();
  if (Math.abs(x) < 1e-99) return 0;
  return Number(x.toPrecision(15));
};

// Real or complex: a complex number with no imaginary part is a real one.
const tidy = (v: Val): Val => {
  if (typeof v === "number") return snap(v);
  if (isComplex(v)) {
    const re = snap(v.re);
    const im = snap(v.im);
    const scale = Math.max(Math.abs(re), Math.abs(im));
    const re2 = Math.abs(re) < scale * 1e-14 ? 0 : re;
    const im2 = Math.abs(im) < scale * 1e-14 ? 0 : im;
    return im2 === 0 ? re2 : M.complex(re2, im2);
  }
  if (isMatrix(v)) return M.map(v, (x: Val) => tidy(x));
  return v;
};

const real = (v: Val): number => {
  if (typeof v === "number") return v;
  throw isMatrix(v) ? new CalcError("Dimension") : mathErr();
};

const toRad = (x: number, a: Angle) => (a === "deg" ? (x * Math.PI) / 180 : a === "gra" ? (x * Math.PI) / 200 : x);
const fromRad = (x: number, a: Angle) => (a === "deg" ? (x * 180) / Math.PI : a === "gra" ? (x * 200) / Math.PI : x);
const unitToCurrent = (x: number, from: Angle, to: Angle) => fromRad(toRad(x, from), to);

const factorial = (x: number) => {
  if (!Number.isInteger(x) || x < 0 || x > 69) throw mathErr();
  let r = 1;
  for (let k = 2; k <= x; k += 1) r *= k;
  return r;
};

// The fraction p/q closest to x with a small denominator, if x really is one.
export const toFraction = (x: number, maxDen = 1e6): [number, number] | null => {
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  let v = Math.abs(x);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  for (let i = 0; i < 40; i += 1) {
    const a = Math.floor(v);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxDen) return null;
    if (Math.abs(h1 / k1 - Math.abs(x)) <= 5e-14 * Math.max(1, Math.abs(x))) return [sign * h1, k1];
    const frac = v - a;
    if (frac < 1e-15) break;
    v = 1 / frac;
  }
  return Math.abs(h1 / k1 - Math.abs(x)) <= 5e-14 * Math.max(1, Math.abs(x)) ? [sign * h1, k1] : null;
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

/* ---------------------------------------------------------------- parser */

type Items = Node[];

class Parser {
  i = 0;
  constructor(private items: Items, private ctx: Ctx, private scope: Record<string, Val> = {}) {}

  peek(): Node | undefined {
    return this.items[this.i];
  }
  isTok(v: string) {
    const n = this.peek();
    return !!n && !isBox(n) && n.v === v;
  }
  take(v: string) {
    if (this.isTok(v)) {
      this.i += 1;
      return true;
    }
    return false;
  }
  done() {
    return this.i >= this.items.length;
  }

  run(): Val {
    if (this.done()) throw syntax();
    const v = this.expr();
    if (!this.done()) throw syntax();
    return v;
  }

  expr(): Val {
    return this.add();
  }

  add(): Val {
    let v = this.mul();
    for (;;) {
      if (this.take("+")) v = op.add(v, this.mul());
      else if (this.take("-")) v = op.sub(v, this.mul());
      else return v;
    }
  }

  mul(): Val {
    let v = this.implicit();
    for (;;) {
      if (this.take("×")) v = op.mul(v, this.implicit(), this.ctx);
      else if (this.take("÷")) v = op.div(v, this.implicit());
      else return v;
    }
  }

  // 2π, 3sin(30), 2(1+1), AB: multiplication nobody types, and on the
  // calculator it binds tighter than × and ÷.
  startsOperand(): boolean {
    const n = this.peek();
    if (!n) return false;
    if (isBox(n)) return n.t !== "pow" && n.t !== "e10";
    const v = n.v;
    if (/^[0-9.]$/.test(v)) return true;
    if (v === "(" || v.endsWith("(")) return true;
    return ATOMS.has(v) || v.startsWith("const:") || v.startsWith("stat:") || /^(Mat|Vct)/.test(v);
  }

  implicit(): Val {
    let v = this.perm();
    while (this.startsOperand()) v = op.mul(v, this.perm(), this.ctx);
    return v;
  }

  perm(): Val {
    let v = this.neg();
    for (;;) {
      if (this.take("nPr")) {
        const r = real(this.neg());
        const n = real(v);
        if (!Number.isInteger(n) || !Number.isInteger(r) || r < 0 || n < r) throw mathErr();
        // Stops as soon as it passes the calculator's range, so a huge n
        // is a Math ERROR at once rather than a frozen screen.
        let out = 1;
        for (let k = n - r + 1; k <= n; k += 1) {
          out *= k;
          if (out >= LIMIT) throw mathErr();
        }
        v = out;
      } else if (this.take("nCr")) {
        const r = real(this.neg());
        const n = real(v);
        if (!Number.isInteger(n) || !Number.isInteger(r) || r < 0 || n < r) throw mathErr();
        const k = Math.min(r, n - r);
        let out = 1;
        for (let j = 1; j <= k; j += 1) {
          out = (out * (n - k + j)) / j;
          if (out >= LIMIT) throw mathErr();
        }
        v = Math.round(out);
      } else if (this.take("∠")) {
        const th = toRad(real(this.neg()), this.ctx.settings.angle);
        const r = real(v);
        v = M.complex(r * Math.cos(th), r * Math.sin(th));
      } else return v;
    }
  }

  neg(): Val {
    if (this.take("neg") || this.take("-")) return op.neg(this.neg());
    if (this.take("+")) return this.neg();
    return this.postfix(this.primary());
  }

  postfix(v: Val): Val {
    for (;;) {
      const n = this.peek();
      if (!n) return v;
      if (isBox(n) && n.t === "pow") {
        this.i += 1;
        v = op.pow(v, this.sub(n.s[0]), this.ctx);
        continue;
      }
      if (isBox(n) && n.t === "e10") {
        this.i += 1;
        v = op.mul(v, op.pow(10, this.sub(n.s[0]), this.ctx), this.ctx);
        continue;
      }
      if (isBox(n)) return v;
      const t = n.v;
      if (t === "!") v = factorial(real(v));
      else if (t === "%") v = op.div(v, 100);
      else if (t === "°" || t === "ʳ" || t === "ᵍ") {
        const from: Angle = t === "°" ? "deg" : t === "ʳ" ? "rad" : "gra";
        v = unitToCurrent(real(v), from, this.ctx.settings.angle);
      } else if (t === "dms") {
        // 2°30°15° is 2 degrees, 30 minutes, 15 seconds.
        this.i += 1;
        let total = real(v);
        let weight = 1 / 60;
        for (let part = 0; part < 2; part += 1) {
          const save = this.i;
          if (!this.startsNumber()) break;
          const p = this.number();
          if (!this.isTok("dms")) {
            this.i = save;
            break;
          }
          this.i += 1;
          total += (total < 0 ? -1 : 1) * p * weight;
          weight /= 60;
        }
        v = total;
        continue;
      } else if (t === "x̂" || t === "x̂₁" || t === "x̂₂" || t === "ŷ") {
        v = estimate(this.ctx.stat, t, real(v));
      } else if (t.startsWith("conv:")) {
        const c = conversionBySym.get(t);
        if (!c) throw syntax();
        v = c.apply(real(v));
      } else if (t === "▸r∠θ" || t === "▸a+bi") {
        this.ctx.settings = { ...this.ctx.settings, polar: t === "▸r∠θ" };
      } else return v;
      this.i += 1;
    }
  }

  sub(s: Seq, scope?: Record<string, Val>): Val {
    return new Parser(s, this.ctx, { ...this.scope, ...(scope || {}) }).run();
  }

  startsNumber() {
    const n = this.peek();
    return !!n && !isBox(n) && /^[0-9.]$/.test(n.v);
  }

  number(): number {
    let s = "";
    while (this.startsNumber()) s += (this.items[this.i++] as { v: string }).v;
    if ((s.match(/\./g) || []).length > 1 || s === ".") throw syntax();
    return Number(s);
  }

  args(): Val[] {
    const out: Val[] = [];
    if (this.take(")")) return out;
    for (;;) {
      out.push(this.expr());
      if (this.take(",")) continue;
      if (!this.take(")") && !this.done()) throw syntax();
      return out;
    }
  }

  variable(name: string): Val {
    if (name in this.scope) return this.scope[name];
    const v = this.ctx.vars[name];
    if (v === undefined) {
      if (/^(Mat|Vct)/.test(name)) throw new CalcError("Dimension");
      return 0;
    }
    return v;
  }

  primary(): Val {
    const n = this.peek();
    if (!n) throw syntax();
    if (isBox(n)) {
      this.i += 1;
      return this.template(n);
    }
    if (this.startsNumber()) return this.number();
    const t = n.v;
    this.i += 1;
    if (t === "(") {
      const v = this.expr();
      if (!this.take(")") && !this.done()) throw syntax();
      return v;
    }
    if (t === "π") return Math.PI;
    if (t === "e") return Math.E;
    if (t === "i") {
      if (this.ctx.mode !== "CMPLX") throw syntax();
      return M.complex(0, 1);
    }
    if (t === "Ans") return this.ctx.ans ?? 0;
    if (t === "Ran#") return Math.floor(Math.random() * 1000) / 1000;
    if (/^[A-FXYM]$/.test(t) || /^(Mat|Vct)(A|B|C|Ans)$/.test(t)) return this.variable(t);
    if (t.startsWith("const:")) {
      const c = constantBySym.get(t);
      if (!c) throw syntax();
      return c.value;
    }
    if (t.startsWith("stat:")) return statValue(this.ctx.stat, t.slice(5));
    if (t.endsWith("(")) return this.call(t.slice(0, -1), this.args());
    throw syntax();
  }

  call(fn: string, a: Val[]): Val {
    const ang = this.ctx.settings.angle;
    const one = () => {
      if (a.length !== 1) throw syntax();
      return a[0];
    };
    const trig = (f: (x: number) => number, x: Val) => {
      if (typeof x !== "number") throw mathErr();
      if ((fn === "tan") && ang === "deg" && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-12) throw mathErr();
      const r = f(toRad(x, ang));
      if (fn === "tan" && Math.abs(r) > 1e15) throw mathErr();
      return Math.abs(r) < 1e-13 ? 0 : Number(r.toPrecision(14));
    };
    const inv = (f: (x: number) => number, x: Val, lo = -1, hi = 1) => {
      const v = real(x);
      if (v < lo - 1e-15 || v > hi + 1e-15) throw mathErr();
      return fromRad(f(Math.max(lo, Math.min(hi, v))), ang);
    };
    switch (fn) {
      case "sin":
        return trig(Math.sin, one());
      case "cos":
        return trig(Math.cos, one());
      case "tan":
        return trig(Math.tan, one());
      case "sin⁻¹":
        return inv(Math.asin, one());
      case "cos⁻¹":
        return inv(Math.acos, one());
      case "tan⁻¹":
        return fromRad(Math.atan(real(one())), ang);
      case "sinh":
        return Math.sinh(real(one()));
      case "cosh":
        return Math.cosh(real(one()));
      case "tanh":
        return Math.tanh(real(one()));
      case "sinh⁻¹":
        return Math.asinh(real(one()));
      case "cosh⁻¹": {
        const x = real(one());
        if (x < 1) throw mathErr();
        return Math.acosh(x);
      }
      case "tanh⁻¹": {
        const x = real(one());
        if (x <= -1 || x >= 1) throw mathErr();
        return Math.atanh(x);
      }
      case "log": {
        if (a.length === 2) return logBase(real(a[0]), real(a[1]));
        const x = one();
        if (typeof x === "number" && x <= 0 && this.ctx.mode !== "CMPLX") throw mathErr();
        if (x === 0) throw mathErr();
        return typeof x === "number" && x > 0 ? Math.log10(x) : M.log10(x);
      }
      case "ln": {
        const x = one();
        if (typeof x === "number" && x <= 0 && this.ctx.mode !== "CMPLX") throw mathErr();
        if (x === 0) throw mathErr();
        return typeof x === "number" && x > 0 ? Math.log(x) : M.log(x);
      }
      case "Abs":
        return op.abs(one());
      case "Pol": {
        if (a.length !== 2) throw syntax();
        const x = real(a[0]);
        const y = real(a[1]);
        const r = Math.hypot(x, y);
        const th = x === 0 && y === 0 ? 0 : fromRad(Math.atan2(y, x), ang);
        this.ctx.vars.X = snap(r);
        this.ctx.vars.Y = snap(th);
        return { pair: [snap(r), snap(th)], labels: ["r", "θ"] } as Pair;
      }
      case "Rec": {
        if (a.length !== 2) throw syntax();
        const r = real(a[0]);
        const th = toRad(real(a[1]), ang);
        const x = Math.abs(r * Math.cos(th)) < 1e-13 * Math.abs(r) ? 0 : r * Math.cos(th);
        const y = Math.abs(r * Math.sin(th)) < 1e-13 * Math.abs(r) ? 0 : r * Math.sin(th);
        this.ctx.vars.X = snap(x);
        this.ctx.vars.Y = snap(y);
        return { pair: [snap(x), snap(y)], labels: ["X", "Y"] } as Pair;
      }
      case "Rnd":
        return roundToDisplay(real(one()), this.ctx.settings.disp);
      case "RanInt#": {
        if (a.length !== 2) throw syntax();
        const lo = real(a[0]);
        const hi = real(a[1]);
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) throw mathErr();
        return lo + Math.floor(Math.random() * (hi - lo + 1));
      }
      case "arg": {
        const z = one();
        const c = typeof z === "number" ? M.complex(z, 0) : z;
        return fromRad(Math.atan2(c.im, c.re), ang);
      }
      case "Conjg": {
        const z = one();
        return typeof z === "number" ? z : M.conj(z);
      }
      case "det": {
        const m = one();
        if (!isMatrix(m) || m.size().length !== 2 || m.size()[0] !== m.size()[1]) throw new CalcError("Dimension");
        return M.det(m);
      }
      case "Trn": {
        const m = one();
        if (!isMatrix(m) || m.size().length !== 2) throw new CalcError("Dimension");
        return M.transpose(m);
      }
      case "Dot": {
        if (a.length !== 2 || !isVector(a[0]) || !isVector(a[1]) || a[0].size()[0] !== a[1].size()[0]) throw new CalcError("Dimension");
        return M.dot(a[0], a[1]);
      }
      case "Angle": {
        if (a.length !== 2 || !isVector(a[0]) || !isVector(a[1]) || a[0].size()[0] !== a[1].size()[0]) throw new CalcError("Dimension");
        const c = M.dot(a[0], a[1]) / (M.norm(a[0]) * M.norm(a[1]));
        return fromRad(Math.acos(Math.max(-1, Math.min(1, c))), ang);
      }
      case "UnitV": {
        const v = one();
        if (!isVector(v)) throw new CalcError("Dimension");
        const len = M.norm(v);
        if (!len) throw mathErr();
        return M.divide(v, len);
      }
      default:
        throw syntax();
    }
  }

  template(n: Box): Val {
    const [s0, s1, s2] = n.s;
    switch (n.t) {
      case "frac":
        return op.div(this.sub(s0), this.sub(s1));
      case "mixed": {
        const w = real(this.sub(s0));
        const f = real(op.div(this.sub(s1), this.sub(s2)));
        return w < 0 ? w - f : w + f;
      }
      case "sqrt":
        return op.sqrt(this.sub(s0), this.ctx);
      case "root": {
        const k = real(this.sub(s0));
        const x = real(this.sub(s1));
        if (k === 0) throw mathErr();
        if (x < 0) {
          if (Number.isInteger(k) && Math.abs(k) % 2 === 1) return -Math.pow(-x, 1 / k);
          throw mathErr();
        }
        return Math.pow(x, 1 / k);
      }
      case "pow":
      case "e10":
        throw syntax(); // only ever after something
      case "logb":
        return logBase(real(this.sub(s0)), real(this.sub(s1)));
      case "abs":
        return op.abs(this.sub(s0));
      case "int": {
        const lo = real(this.sub(s1));
        const hi = real(this.sub(s2));
        const f = (x: number) => real(this.sub(s0, { X: x }));
        return integrate(f, lo, hi);
      }
      case "ddx": {
        const at = real(this.sub(s1));
        const f = (x: number) => real(this.sub(s0, { X: x }));
        return differentiate(f, at);
      }
      case "sum": {
        const lo = real(this.sub(s1));
        const hi = real(this.sub(s2));
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw mathErr();
        if (hi - lo > 1e6) throw new CalcError("Time Out");
        let total: Val = 0;
        for (let x = lo; x <= hi; x += 1) total = op.add(total, this.sub(s0, { X: x }));
        return total;
      }
      default:
        throw syntax();
    }
  }
}

const ATOMS = new Set(["π", "e", "i", "Ans", "Ran#", "A", "B", "C", "D", "E", "F", "X", "Y", "M"]);

const logBase = (b: number, x: number) => {
  if (b <= 0 || b === 1 || x <= 0) throw mathErr();
  return Math.log(x) / Math.log(b);
};

const roundToDisplay = (x: number, d: Disp) => {
  if (d.k === "fix") return Number(x.toFixed(d.n));
  if (d.k === "sci") return Number(x.toPrecision(d.n || 10));
  return Number(x.toPrecision(10));
};

/* ------------------------------------------------------------ arithmetic */

const dims = (a: Val, b: Val) => {
  const sa = a.size();
  const sb = b.size();
  if (sa.length !== sb.length || sa.some((d: number, k: number) => d !== sb[k])) throw new CalcError("Dimension");
};

const op = {
  add(a: Val, b: Val): Val {
    if (typeof a === "number" && typeof b === "number") return a + b;
    if (isMatrix(a) !== isMatrix(b)) throw new CalcError("Dimension");
    if (isMatrix(a)) dims(a, b);
    if (isPair(a) || isPair(b)) throw syntax();
    return M.add(a, b);
  },
  sub(a: Val, b: Val): Val {
    return op.add(a, op.neg(b));
  },
  neg(a: Val): Val {
    if (typeof a === "number") return -a;
    if (isPair(a)) throw syntax();
    return M.unaryMinus(a);
  },
  mul(a: Val, b: Val, ctx: Ctx): Val {
    if (typeof a === "number" && typeof b === "number") return a * b;
    if (isPair(a) || isPair(b)) throw syntax();
    if (isVector(a) && isVector(b)) {
      // Vector × vector is the cross product, as on the calculator.
      if (a.size()[0] !== 3 || b.size()[0] !== 3) throw new CalcError("Dimension");
      return M.cross(a, b);
    }
    if (isMatrix(a) && isMatrix(b)) {
      const sa = a.size();
      const sb = b.size();
      if (sa[sa.length - 1] !== sb[0]) throw new CalcError("Dimension");
    }
    void ctx;
    return M.multiply(a, b);
  },
  div(a: Val, b: Val): Val {
    if (isMatrix(b)) throw new CalcError("Dimension");
    if (b === 0 || (isComplex(b) && b.re === 0 && b.im === 0)) throw mathErr();
    if (typeof a === "number" && typeof b === "number") return a / b;
    return M.divide(a, b);
  },
  abs(a: Val): Val {
    if (typeof a === "number") return Math.abs(a);
    if (isVector(a)) return M.norm(a);
    return M.abs(a);
  },
  sqrt(a: Val, ctx: Ctx): Val {
    if (typeof a === "number") {
      if (a >= 0) return Math.sqrt(a);
      if (ctx.mode !== "CMPLX") throw mathErr();
      return M.complex(0, Math.sqrt(-a));
    }
    if (isMatrix(a)) throw new CalcError("Dimension");
    return M.sqrt(a);
  },
  pow(a: Val, b: Val, ctx: Ctx): Val {
    if (isMatrix(a)) {
      const e = real(b);
      const s = a.size();
      if (s.length !== 2 || s[0] !== s[1]) throw new CalcError("Dimension");
      if (e === -1) {
        if (Math.abs(M.det(a)) < 1e-14) throw mathErr();
        return M.inv(a);
      }
      if (!Number.isInteger(e) || e < 0) throw mathErr();
      return M.pow(a, e);
    }
    if (typeof a === "number" && typeof b === "number") {
      if (a === 0 && b <= 0) throw mathErr();
      if (a < 0 && !Number.isInteger(b)) {
        // (−8)^(1/3) is −2: a real odd root, as the calculator gives.
        const f = toFraction(b, 1000);
        if (f && Math.abs(f[1]) % 2 === 1) {
          const r = Math.pow(-a, Math.abs(b));
          const signed = Math.abs(f[0]) % 2 === 1 ? -r : r;
          return b < 0 ? 1 / signed : signed;
        }
        if (ctx.mode !== "CMPLX") throw mathErr();
        return M.pow(M.complex(a, 0), b);
      }
      return Math.pow(a, b);
    }
    if (isComplex(a) || isComplex(b)) {
      if (ctx.mode !== "CMPLX") throw mathErr();
      return M.pow(a, b);
    }
    throw syntax();
  },
};

/* ------------------------------------------------------------- calculus */

// Adaptive Gauss–Kronrod (7–15), the method the calculator itself uses.
const GK = {
  x: [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.586087235467691, 0.405845151377397, 0.207784955007898, 0],
  wk: [0.022935322010529, 0.063092092629979, 0.104790010322250, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728],
  wg: [0, 0.129484966168870, 0, 0.279705391489277, 0, 0.381830050505119, 0, 0.417959183673469],
};

const gk = (f: (x: number) => number, a: number, b: number) => {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  let k = 0;
  let g = 0;
  for (let j = 0; j < 8; j += 1) {
    const dx = h * GK.x[j];
    const fs = j === 7 ? [f(c)] : [f(c - dx), f(c + dx)];
    const sum = fs.reduce((s, v) => s + v, 0);
    k += GK.wk[j] * sum;
    g += GK.wg[j] * sum;
  }
  return { value: k * h, err: Math.abs((k - g) * h) };
};

export const integrate = (f: (x: number) => number, a: number, b: number): number => {
  if (a === b) return 0;
  let calls = 0;
  const go = (lo: number, hi: number, depth: number): number => {
    calls += 1;
    if (calls > 4000) throw new CalcError("Time Out");
    const { value, err } = gk(f, lo, hi);
    if (!Number.isFinite(value)) throw mathErr();
    if (err < 1e-11 * Math.max(1, Math.abs(value)) || depth > 30) return value;
    const mid = (lo + hi) / 2;
    return go(lo, mid, depth + 1) + go(mid, hi, depth + 1);
  };
  return go(a, b, 0);
};

// Central differences refined by Richardson extrapolation.
export const differentiate = (f: (x: number) => number, x: number): number => {
  let h = 0.1 * Math.max(1, Math.abs(x));
  const table: number[][] = [];
  for (let i = 0; i < 8; i += 1) {
    table[i] = [(f(x + h) - f(x - h)) / (2 * h)];
    for (let j = 1; j <= i; j += 1) table[i][j] = table[i][j - 1] + (table[i][j - 1] - table[i - 1][j - 1]) / (Math.pow(4, j) - 1);
    h /= 2;
  }
  const d = table[7][7];
  if (!Number.isFinite(d)) throw mathErr();
  return Math.abs(d) < 1e-11 ? 0 : Number(d.toPrecision(11));
};

/* ----------------------------------------------------------------- stats */

const weighted = (rows: StatRow[], freq: boolean) => rows.filter((r) => Number.isFinite(r.x)).map((r) => ({ ...r, f: freq ? r.f : 1 }));

const quantiles = (rows: { x: number; f: number }[]) => {
  const xs: number[] = [];
  rows.forEach((r) => {
    if (!Number.isInteger(r.f) || r.f < 0) throw mathErr();
    for (let k = 0; k < r.f; k += 1) xs.push(r.x);
  });
  xs.sort((p, q) => p - q);
  const med = (a: number[]) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  const n = xs.length;
  if (!n) throw mathErr();
  const lower = xs.slice(0, Math.floor(n / 2));
  const upper = xs.slice(Math.ceil(n / 2));
  return { Q1: n > 1 ? med(lower) : xs[0], med: med(xs), Q3: n > 1 ? med(upper) : xs[0] };
};

type Reg = { A: number; B: number; C: number; r: number };

const transform = (type: StatType) => {
  switch (type) {
    case "ln X":
      return { tx: Math.log, ty: (y: number) => y };
    case "e^X":
      return { tx: (x: number) => x, ty: Math.log };
    case "A•B^X":
      return { tx: (x: number) => x, ty: Math.log };
    case "A•X^B":
      return { tx: Math.log, ty: Math.log };
    case "1/X":
      return { tx: (x: number) => 1 / x, ty: (y: number) => y };
    default:
      return { tx: (x: number) => x, ty: (y: number) => y };
  }
};

export const regression = (s: StatData): Reg => {
  const rows = weighted(s.rows, s.freq);
  if (s.type === "1-VAR" || rows.length < 2) throw mathErr();
  if (s.type === "_+CX²") {
    // Least squares for y = A + Bx + Cx².
    const S = (p: number, q: number) => rows.reduce((t, r) => t + r.f * Math.pow(r.x, p) * Math.pow(r.y, q), 0);
    const A = [
      [S(0, 0), S(1, 0), S(2, 0)],
      [S(1, 0), S(2, 0), S(3, 0)],
      [S(2, 0), S(3, 0), S(4, 0)],
    ];
    const b = [S(0, 1), S(1, 1), S(2, 1)];
    if (Math.abs(M.det(A)) < 1e-12) throw mathErr();
    const sol = M.lusolve(A, b).map((r: number[]) => r[0]);
    return { A: sol[0], B: sol[1], C: sol[2], r: NaN };
  }
  const { tx, ty } = transform(s.type);
  const pts = rows.map((r) => ({ x: tx(r.x), y: ty(r.y), f: r.f }));
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw mathErr();
  const n = pts.reduce((t, p) => t + p.f, 0);
  const sx = pts.reduce((t, p) => t + p.f * p.x, 0);
  const sy = pts.reduce((t, p) => t + p.f * p.y, 0);
  // Deviations from the mean (two passes), not Σx² − (Σx)²/n, which loses
  // every digit for large, close values.
  const mx = sx / n;
  const my = sy / n;
  const sxx = pts.reduce((t, p) => t + p.f * (p.x - mx) ** 2, 0);
  const syy = pts.reduce((t, p) => t + p.f * (p.y - my) ** 2, 0);
  const sxy = pts.reduce((t, p) => t + p.f * (p.x - mx) * (p.y - my), 0);
  if (sxx === 0) throw mathErr();
  const b = sxy / sxx;
  const a = (sy - b * sx) / n;
  const r = syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
  switch (s.type) {
    case "e^X":
      return { A: Math.exp(a), B: b, C: 0, r };
    case "A•B^X":
      return { A: Math.exp(a), B: Math.exp(b), C: 0, r };
    case "A•X^B":
      return { A: Math.exp(a), B: b, C: 0, r };
    default:
      return { A: a, B: b, C: 0, r };
  }
};

const estimate = (s: StatData, which: string, v: number): number => {
  const { A, B, C } = regression(s);
  if (which === "ŷ") {
    switch (s.type) {
      case "A+BX":
        return A + B * v;
      case "_+CX²":
        return A + B * v + C * v * v;
      case "ln X":
        return A + B * Math.log(v);
      case "e^X":
        return A * Math.exp(B * v);
      case "A•B^X":
        return A * Math.pow(B, v);
      case "A•X^B":
        return A * Math.pow(v, B);
      case "1/X":
        return A + B / v;
      default:
        throw mathErr();
    }
  }
  switch (s.type) {
    case "A+BX":
      return (v - A) / B;
    case "_+CX²": {
      const disc = B * B - 4 * C * (A - v);
      if (disc < 0 || C === 0) throw mathErr();
      const r1 = (-B + Math.sqrt(disc)) / (2 * C);
      const r2 = (-B - Math.sqrt(disc)) / (2 * C);
      return which === "x̂₂" ? r2 : r1;
    }
    case "ln X":
      return Math.exp((v - A) / B);
    case "e^X":
      return Math.log(v / A) / B;
    case "A•B^X":
      return Math.log(v / A) / Math.log(B);
    case "A•X^B":
      return Math.pow(v / A, 1 / B);
    case "1/X":
      return B / (v - A);
    default:
      throw mathErr();
  }
};

export const statValue = (s: StatData, name: string): number => {
  const rows = weighted(s.rows, s.freq);
  if (!rows.length) throw mathErr();
  const n = rows.reduce((t, r) => t + r.f, 0);
  const sum = (g: (r: StatRow) => number) => rows.reduce((t, r) => t + r.f * g(r), 0);
  const mean = (g: (r: StatRow) => number) => sum(g) / n;
  // Two passes (mean first), so 1000000001, 1000000002, 1000000003 gives
  // σx = 0.8164965809, not 0.
  const pop = (g: (r: StatRow) => number) => {
    const m = mean(g);
    return Math.sqrt(sum((r) => (g(r) - m) ** 2) / n);
  };
  const smp = (g: (r: StatRow) => number) => {
    if (n < 2) throw mathErr();
    return pop(g) * Math.sqrt(n / (n - 1));
  };
  const X = (r: StatRow) => r.x;
  const Y = (r: StatRow) => r.y;
  switch (name) {
    case "n":
      return n;
    case "Σx":
      return sum(X);
    case "Σx²":
      return sum((r) => r.x * r.x);
    case "Σy":
      return sum(Y);
    case "Σy²":
      return sum((r) => r.y * r.y);
    case "Σxy":
      return sum((r) => r.x * r.y);
    case "Σx³":
      return sum((r) => r.x ** 3);
    case "Σx²y":
      return sum((r) => r.x * r.x * r.y);
    case "Σx⁴":
      return sum((r) => r.x ** 4);
    case "x̄":
      return mean(X);
    case "σx":
      return pop(X);
    case "sx":
      return smp(X);
    case "ȳ":
      return mean(Y);
    case "σy":
      return pop(Y);
    case "sy":
      return smp(Y);
    case "minX":
      return Math.min(...rows.map(X));
    case "maxX":
      return Math.max(...rows.map(X));
    case "minY":
      return Math.min(...rows.map(Y));
    case "maxY":
      return Math.max(...rows.map(Y));
    case "Q1":
    case "med":
    case "Q3":
      return quantiles(rows)[name];
    case "A":
    case "B":
    case "C":
    case "r": {
      const v = regression(s)[name];
      if (Number.isNaN(v)) throw mathErr();
      return v;
    }
    default:
      throw syntax();
  }
};

/* ----------------------------------------------------------- evaluation */

// Splits a row at ":" (several statements, the last one's answer shown) and
// at "=" (an equation, for SOLVE).
export const splitAt = (s: Seq, sep: string): Seq[] => {
  const parts: Seq[] = [[]];
  s.forEach((n) => {
    if (!isBox(n) && n.v === sep) parts.push([]);
    else parts[parts.length - 1].push(n);
  });
  return parts;
};

export const evaluate = (s: Seq, ctx: Ctx, scope?: Record<string, Val>): Val => {
  if (ctx.mode === "BASE-N") return evaluateBase(s, ctx);
  let last: Val = 0;
  for (const stmt of splitAt(s, ":")) {
    const eq = splitAt(stmt, "=");
    if (eq.length > 2) throw syntax();
    if (eq.length === 2) {
      // Y=X+1 under CALC assigns Y.
      const lhs = eq[0];
      if (lhs.length !== 1 || isBox(lhs[0]) || !/^[A-FXYM]$/.test(lhs[0].v)) throw syntax();
      last = tidy(new Parser(eq[1], ctx, scope).run());
      ctx.vars[lhs[0].v] = last;
    } else {
      last = tidy(new Parser(stmt, ctx, scope).run());
    }
    if (isComplex(last) && ctx.mode !== "CMPLX") throw mathErr();
  }
  return last;
};

// SOLVE: finds X making left = right (or the expression 0), starting from X.
export const solve = (s: Seq, ctx: Ctx, start: number): { x: number; residual: number } => {
  const eq = splitAt(s, "=");
  if (eq.length > 2) throw syntax();
  const f = (x: number) => {
    const l = real(new Parser(eq[0], ctx, { X: x }).run());
    const r = eq.length === 2 ? real(new Parser(eq[1], ctx, { X: x }).run()) : 0;
    return l - r;
  };
  const tryFrom = (x0: number) => {
    let x = x0;
    for (let k = 0; k < 150; k += 1) {
      let fx: number;
      try {
        fx = f(x);
      } catch {
        return null;
      }
      if (Math.abs(fx) < 1e-14) return x;
      const h = 1e-7 * Math.max(1, Math.abs(x));
      let d: number;
      try {
        d = (f(x + h) - f(x - h)) / (2 * h);
      } catch {
        return null;
      }
      if (!Number.isFinite(d) || d === 0) return null;
      const next = x - fx / d;
      if (!Number.isFinite(next)) return null;
      if (Math.abs(next - x) < 1e-13 * Math.max(1, Math.abs(x))) return next;
      x = next;
    }
    return Math.abs(f(x)) < 1e-9 ? x : null;
  };
  const guesses = [start, 0, 1, -1, 10, -10, 100, -100, 0.5, -0.5, 1000, -1000];
  for (const g of guesses) {
    const x = tryFrom(g);
    if (x !== null && Number.isFinite(x)) {
      const xs = Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(12));
      // L−R at the root itself; what is left is rounding, which the
      // calculator shows as 0.
      const res = f(x);
      return { x: xs, residual: Math.abs(res) < 1e-9 ? 0 : Number(res.toPrecision(10)) };
    }
  }
  throw new CalcError("Can't Solve");
};

// EQN mode. Simultaneous equations (2 or 3 unknowns) and polynomials
// (degree 2 or 3); answers can be complex.
export const solveEquations = (kind: 1 | 2 | 3 | 4, c: number[][]): { label: string; value: Val }[] | "Infinite Sol" | "No Solution" => {
  if (kind === 1 || kind === 2) {
    const n = kind === 1 ? 2 : 3;
    const A = c.map((row) => row.slice(0, n));
    const b = c.map((row) => row[n]);
    if (Math.abs(M.det(A)) < 1e-13) {
      const rank = (m: number[][]) => {
        const r = M.matrix(m);
        // Rank by row reduction.
        const a = r.toArray().map((row: number[]) => [...row]);
        let rk = 0;
        for (let col = 0; col < a[0].length && rk < a.length; col += 1) {
          let piv = rk;
          while (piv < a.length && Math.abs(a[piv][col]) < 1e-12) piv += 1;
          if (piv === a.length) continue;
          [a[rk], a[piv]] = [a[piv], a[rk]];
          for (let k = 0; k < a.length; k += 1) {
            if (k === rk) continue;
            const f = a[k][col] / a[rk][col];
            for (let j = col; j < a[0].length; j += 1) a[k][j] -= f * a[rk][j];
          }
          rk += 1;
        }
        return rk;
      };
      return rank(A) === rank(c) ? "Infinite Sol" : "No Solution";
    }
    const x = M.lusolve(A, b).map((r: number[]) => r[0]);
    return x.map((v: number, k: number) => ({ label: ["X", "Y", "Z"][k], value: tidy(v) }));
  }
  const [a, b, cc, d] = c[0];
  if (a === 0) throw mathErr();
  const roots: Val[] = kind === 3 ? M.polynomialRoot(cc, b, a) : M.polynomialRoot(d, cc, b, a);
  // Real roots first, largest first, as the calculator lists them.
  const sorted = roots.map(tidy).sort((p: Val, q: Val) => {
    const pr = typeof p === "number";
    const qr = typeof q === "number";
    if (pr && qr) return q - p;
    if (pr !== qr) return pr ? -1 : 1;
    return q.im - p.im;
  });
  return sorted.map((v: Val, k: number) => ({ label: `X${"₁₂₃"[k]}`, value: v }));
};

/* ---------------------------------------------------------------- BASE-N */

const BASE_RADIX: Record<Base, number> = { dec: 10, hex: 16, bin: 2, oct: 8 };
const BASE_BITS: Record<Base, number> = { dec: 32, hex: 32, bin: 16, oct: 32 };

const wrapBits = (v: number, base: Base) => {
  if (!Number.isFinite(v)) throw mathErr();
  const bits = BASE_BITS[base];
  if (base === "dec") {
    if (v < -2147483648 || v > 2147483647) throw mathErr();
    return Math.trunc(v);
  }
  const span = 2 ** bits;
  if (v < -(span / 2) || v >= span) throw mathErr();
  const u = ((Math.trunc(v) % span) + span) % span;
  return u >= span / 2 ? u - span : u;
};

const evaluateBase = (s: Seq, ctx: Ctx): number => {
  const items = s;
  let i = 0;
  const peek = () => items[i] as Node | undefined;
  const is = (v: string) => {
    const n = peek();
    return !!n && !isBox(n) && n.v === v;
  };
  const take = (v: string) => (is(v) ? (i += 1, true) : false);
  const base = ctx.base;
  const digitsOf = (radix: number) => {
    let str = "";
    for (;;) {
      const n = peek();
      if (!n || isBox(n)) break;
      const d = n.v;
      if (!/^[0-9A-F]$/.test(d) || parseInt(d, 16) >= radix) break;
      str += d;
      i += 1;
    }
    if (!str) throw syntax();
    const v = parseInt(str, radix);
    // A literal with its top bit set is negative (two's complement).
    return radix === 10 ? v : wrapBits(v, base === "dec" ? (radix === 2 ? "bin" : radix === 8 ? "oct" : "hex") : base);
  };
  const lit = (): number => {
    const n = peek();
    if (!n || isBox(n)) throw syntax();
    const prefix: Record<string, number> = { d: 10, h: 16, b: 2, o: 8 };
    if (n.v in prefix) {
      i += 1;
      return digitsOf(prefix[n.v]);
    }
    return digitsOf(BASE_RADIX[base]);
  };
  const unary = (): number => {
    if (take("neg") || take("-")) return wrapBits(-unary(), base);
    if (take("(")) {
      const v = or();
      if (!take(")") && i < items.length) throw syntax();
      return v;
    }
    if (take("Not(") || take("Neg(")) {
      const isNot = (items[i - 1] as { v: string }).v === "Not(";
      const v = or();
      if (!take(")") && i < items.length) throw syntax();
      return wrapBits(isNot ? ~v : -v, base);
    }
    if (take("Ans")) return ctx.ans ?? 0;
    return lit();
  };
  const mul = (): number => {
    let v = unary();
    for (;;) {
      if (take("×")) v = wrapBits(v * unary(), base);
      else if (take("÷")) {
        const d = unary();
        if (d === 0) throw mathErr();
        v = wrapBits(Math.trunc(v / d), base);
      } else return v;
    }
  };
  const add = (): number => {
    let v = mul();
    for (;;) {
      if (take("+")) v = wrapBits(v + mul(), base);
      else if (take("-")) v = wrapBits(v - mul(), base);
      else return v;
    }
  };
  const and = (): number => {
    let v = add();
    while (take("and")) v = wrapBits(v & add(), base);
    return v;
  };
  const or = (): number => {
    let v = and();
    for (;;) {
      if (take("or")) v = wrapBits(v | and(), base);
      else if (take("xor")) v = wrapBits(v ^ and(), base);
      else if (take("xnor")) v = wrapBits(~(v ^ and()), base);
      else return v;
    }
  };
  if (!items.length) throw syntax();
  const v = or();
  if (i < items.length) throw syntax();
  return v;
};

export const formatBase = (v: number, base: Base): string => {
  if (base === "dec") return String(v);
  const bits = BASE_BITS[base];
  const u = v < 0 ? v + 2 ** bits : v;
  const width = base === "bin" ? 16 : base === "hex" ? 8 : 11;
  return u.toString(BASE_RADIX[base]).toUpperCase().padStart(width, "0");
};

/* ------------------------------------------------------------ formatting */

const digitsSeq = (s: string): Seq => [...s].map((ch) => tok(ch === "-" ? "-" : ch));

const sup = (n: number): Box => box("pow", digitsSeq(String(n)));

// A decimal, the way the calculator's display shows it: 10 digits, and
// ×10ⁿ outside the Norm range (or always, under Sci and ENG).
export const formatDecimal = (x: number, disp: Disp, eng: number | null = null): Seq => {
  if (x === 0 && eng === null) return disp.k === "fix" ? digitsSeq((0).toFixed(disp.n)) : disp.k === "sci" ? [...digitsSeq(trimMant((0).toFixed(Math.max(0, (disp.n || 10) - 1)), false)), tok("×10"), sup(0)] : [tok("0")];
  const abs = Math.abs(x);
  const sci = (sig: number, strip: boolean, expStep = 1, shift = 0) => {
    let e = abs === 0 ? 0 : Math.floor(Math.log10(abs));
    let m = abs / Math.pow(10, e);
    let ms = m.toFixed(sig - 1);
    if (Number(ms) >= 10) {
      e += 1;
      m = abs / Math.pow(10, e);
      ms = m.toFixed(sig - 1);
    }
    if (expStep === 3) {
      const e3 = Math.floor(e / 3) * 3 - 3 * shift;
      const mm = abs / Math.pow(10, e3);
      const intDigits = Math.max(1, Math.floor(Math.log10(mm || 1)) + 1);
      ms = mm.toFixed(Math.max(0, Math.min(9, sig - intDigits)));
      e = e3;
    }
    return [...digitsSeq((x < 0 ? "-" : "") + trimMant(ms, strip)), tok("×10"), sup(e)];
  };
  if (eng !== null) return sci(10, true, 3, eng);
  if (disp.k === "sci") return sci(disp.n || 10, false);
  if (abs >= 1e10) return sci(10, true);
  if (disp.k === "fix") {
    return digitsSeq(x.toFixed(disp.n));
  }
  const lowest = disp.n === 1 ? 1e-2 : 1e-9;
  if (abs < lowest) return sci(10, true);
  const intDigits = Math.max(1, Math.floor(Math.log10(abs)) + 1);
  const s = x.toFixed(Math.max(0, Math.min(20, 10 - intDigits)));
  return digitsSeq(trimMant(s, true));
};

const trimMant = (s: string, strip: boolean) => (strip && s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

const squarefree = (n: number): [number, number] => {
  // √n = k√m with m squarefree.
  let k = 1;
  let m = n;
  for (let f = 2; f * f <= m; f += 1) {
    while (m % (f * f) === 0) {
      m /= f * f;
      k *= f;
    }
  }
  return [k, m];
};

const ndigits = (n: number) => String(Math.abs(n)).length;

const fracSeq = (p: number, q: number, mixed: boolean, top: Seq = digitsSeq(String(Math.abs(p)))): Seq => {
  const neg = p < 0 ? [tok("-")] : [];
  if (q === 1) return [...neg, ...top];
  if (mixed && Math.abs(p) > q && top.every((n) => !isBox(n))) {
    const w = Math.floor(Math.abs(p) / q);
    return [...neg, box("mixed", digitsSeq(String(w)), digitsSeq(String(Math.abs(p) - w * q)), digitsSeq(String(q)))];
  }
  return [...neg, box("frac", top, digitsSeq(String(q)))];
};

// The exact form the calculator would show, or null for a plain decimal.
// A candidate exact form is only used if it really equals x to 12 digits.
const same = (a: number, x: number) => Math.abs(a - x) <= 1e-12 * Math.max(1, Math.abs(x));

export const exactForm = (x: number, mixed: boolean): Seq | null => {
  if (!Number.isFinite(x) || Number.isInteger(x)) return null;
  const f = toFraction(x, 1e6);
  if (f && ndigits(f[0]) + ndigits(f[1]) <= 10) return fracSeq(f[0], f[1], mixed);
  // Very large or tiny values are decimals, never surds.
  if (Math.abs(x) >= 1e6 || Math.abs(x) < 1e-6) return null;
  // p π / q (before the surds, so 5π/4 is never mistaken for one)
  const pf = toFraction(x / Math.PI, 1000);
  if (pf && Math.abs(pf[0]) < 1e4 && same((pf[0] * Math.PI) / pf[1], x)) {
    const top: Seq = [...(Math.abs(pf[0]) === 1 ? [] : digitsSeq(String(Math.abs(pf[0])))), tok("π")];
    return fracSeq(pf[0] < 0 ? -1 : 1, pf[1], false, top);
  }
  // k√m / q
  const sq = toFraction(x * x, 1e4);
  if (sq && sq[0] > 0 && sq[0] * sq[1] < 1e8) {
    const [k0, m] = squarefree(sq[0] * sq[1]);
    if (m > 1) {
      const g = gcd(k0, sq[1]);
      const k = k0 / g;
      const q = sq[1] / g;
      if (same(((x < 0 ? -1 : 1) * k * Math.sqrt(m)) / q, x)) {
        const top: Seq = [...(k === 1 ? [] : digitsSeq(String(k))), box("sqrt", digitsSeq(String(m)))];
        return fracSeq(x < 0 ? -1 : 1, q, false, top);
      }
    }
  }
  // (p + r√m) / q, small numbers only, and checked back exactly.
  for (let m = 2; m <= 99; m += 1) {
    if (squarefree(m)[0] !== 1) continue;
    const root = Math.sqrt(m);
    for (let q = 1; q <= 24; q += 1) {
      for (let r = -24; r <= 24; r += 1) {
        if (!r) continue;
        const pr = Math.round(x * q - r * root);
        if (!pr || Math.abs(pr) > 999) continue;
        const g = gcd(gcd(pr, r), q);
        const [P, R, Q] = [pr / g, r / g, q / g];
        if (!same((P + R * root) / Q, x)) continue;
        const rpart: Seq = [...(Math.abs(R) === 1 ? [] : digitsSeq(String(Math.abs(R)))), box("sqrt", digitsSeq(String(m)))];
        const top: Seq = [...digitsSeq(String(P)), tok(R < 0 ? "-" : "+"), ...rpart];
        return Q === 1 ? top : [box("frac", top, digitsSeq(String(Q)))];
      }
    }
  }
  return null;
};

export type Shown =
  | { kind: "seq"; seq: Seq; exact: boolean }
  | { kind: "matrix"; cells: Seq[][]; label: string }
  | { kind: "lines"; lines: { label: string; seq: Seq }[] };

const realSeq = (x: number, s: Settings, decimal: boolean, eng: number | null): { seq: Seq; exact: boolean } => {
  if (!decimal && s.mathIO && eng === null && s.disp.k === "norm") {
    const e = exactForm(x, s.mixed);
    if (e) return { seq: e, exact: true };
  }
  return { seq: formatDecimal(x, s.disp, eng), exact: false };
};

const complexSeq = (z: Val, s: Settings, decimal: boolean, eng: number | null): Seq => {
  if (s.polar) {
    const r = Math.hypot(z.re, z.im);
    const th = fromRad(Math.atan2(z.im, z.re), s.angle);
    return [...realSeq(snap(r), s, decimal, eng).seq, tok("∠"), ...realSeq(snap(th), s, decimal, eng).seq];
  }
  const re = z.re ? realSeq(z.re, s, decimal, eng).seq : [];
  const imAbs = Math.abs(z.im);
  const im = imAbs === 1 ? [] : realSeq(imAbs, s, decimal, eng).seq;
  const sign = z.im < 0 ? [tok("-")] : re.length ? [tok("+")] : [];
  return [...re, ...sign, ...im, tok("i")];
};

// The answer, ready to draw.
export const show = (v: Val, ctx: Ctx, opts: { decimal?: boolean; eng?: number | null; dms?: boolean } = {}): Shown => {
  const s = ctx.settings;
  const decimal = !!opts.decimal;
  const eng = opts.eng ?? null;
  if (ctx.mode === "BASE-N") return { kind: "seq", seq: digitsSeq(formatBase(v, ctx.base)), exact: false };
  if (isPair(v)) {
    return { kind: "lines", lines: v.pair.map((x: number, k: number) => ({ label: v.labels[k], seq: realSeq(x, s, decimal, eng).seq })) };
  }
  if (isMatrix(v)) {
    const arr = v.toArray();
    const rows: Val[][] = v.size().length === 1 ? [arr] : arr;
    return {
      kind: "matrix",
      label: v.size().length === 1 ? "VctAns" : "MatAns",
      cells: rows.map((row) => row.map((x: Val) => (typeof x === "number" ? realSeq(x, s, decimal, eng).seq : complexSeq(x, s, decimal, eng)))),
    };
  }
  if (isComplex(v)) return { kind: "seq", seq: complexSeq(v, s, decimal, eng), exact: false };
  if (opts.dms) {
    const neg = v < 0;
    let a = Math.abs(v);
    let d = Math.floor(a);
    a = (a - d) * 60;
    let m = Math.floor(a + 1e-9);
    let sec = Number(((a - m) * 60).toFixed(2));
    if (sec >= 60) {
      sec -= 60;
      m += 1;
    }
    if (m >= 60) {
      m -= 60;
      d += 1;
    }
    return { kind: "seq", seq: digitsSeq(`${neg ? "-" : ""}${d}°${m}′${sec}″`), exact: false };
  }
  return { kind: "seq", ...realSeq(v, s, decimal, eng) };
};

// Plain text of an answer, for copying into an answer box.
export const seqText = (s: Seq): string =>
  s
    .map((n) => {
      if (!isBox(n)) return n.v === "-" ? "-" : n.v === "×10" ? "×10^" : n.v;
      const [a, b, c] = n.s.map(seqText);
      switch (n.t) {
        case "frac":
          return `(${a})/(${b})`;
        case "mixed":
          return `${a} ${b}/${c}`;
        case "sqrt":
          return `√(${a})`;
        case "pow":
          return `^(${a})`;
        default:
          return a;
      }
    })
    .join("");

// Matrices and vectors as the calculator's editors hold them (rows of numbers).
export const toMatrix = (rows: number[][], vector: boolean): Val => (vector ? M.matrix(rows[0]) : M.matrix(rows));
