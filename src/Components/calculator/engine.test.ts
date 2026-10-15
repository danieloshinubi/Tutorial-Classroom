import { evaluate, show, solve, solveEquations, seqText, DEFAULT_SETTINGS, type Ctx, type Mode } from "./engine";
import { tok, box, type Seq } from "./tree";

// Builds a row from a compact string: each space-separated piece is a token.
const t = (s: string): Seq => s.split(" ").filter(Boolean).flatMap((p) => (/^[0-9.]+$/.test(p) ? [...p] : [p])).map(tok);
const ctx = (mode: Mode = "COMP", over: Partial<Ctx> = {}): Ctx => ({
  mode,
  settings: { ...DEFAULT_SETTINGS },
  vars: {},
  ans: 0,
  stat: { type: "1-VAR", rows: [], freq: false },
  base: "dec",
  ...over,
});
const ev = (s: Seq, c = ctx()) => evaluate(s, c);
const shown = (s: Seq, c = ctx()) => {
  const out = show(evaluate(s, c), c);
  return out.kind === "seq" ? seqText(out.seq) : JSON.stringify(out);
};

test("order of operations, as the calculator does it", () => {
  expect(ev(t("1 + 2 × 3"))).toBe(7);
  expect(ev(t("1 ÷ 2 π"))).toBeCloseTo(1 / (2 * Math.PI), 12); // implicit × first
  expect(ev([tok("neg"), tok("2"), box("pow", t("2"))])).toBe(-4); // −2² = −4
  expect(ev(t("2 ( 3 + 4 )"))).toBe(14);
  expect(ev(t("5 nCr 2"))).toBe(10);
  expect(ev(t("5 nPr 2"))).toBe(20);
  expect(ev(t("5 !"))).toBe(120);
});

test("trig in degrees is exact", () => {
  expect(ev(t("sin( 30 )"))).toBe(0.5);
  expect(ev(t("cos( 90 )"))).toBe(0);
  expect(() => ev(t("tan( 90 )"))).toThrow("Math ERROR");
  expect(ev(t("sin⁻¹( 1 )"))).toBe(90);
});

test("natural display answers", () => {
  expect(shown([box("frac", t("1"), t("3")), tok("+"), box("frac", t("1"), t("6"))])).toBe("(1)/(2)");
  expect(shown(t("sin( 45 )"))).toBe("(√(2))/(2)");
  expect(shown([box("frac", t("2"), t("3")), tok("π")])).toBe("(2π)/(3)");
  expect(shown([box("frac", t("1"), t("4")), tok("π")])).toBe("(π)/(4)");
  expect(shown(t("0 . 1 + 0 . 2"))).toBe("(3)/(10)");
});

test("templates: roots, logs, calculus", () => {
  expect(ev([box("sqrt", t("16"))])).toBe(4);
  expect(ev([box("root", t("3"), [tok("neg"), tok("8")])])).toBe(-2);
  expect(ev([box("logb", t("2"), t("8"))])).toBe(3);
  expect(ev([box("int", [tok("X"), box("pow", t("2"))], t("0"), t("3"))])).toBeCloseTo(9, 9);
  expect(ev([box("ddx", [tok("X"), box("pow", t("3"))], t("2"))])).toBeCloseTo(12, 8);
  expect(ev([box("sum", t("X"), t("1"), t("100"))])).toBe(5050);
  expect(ev(t("2"), ctx()) && ev([tok("2"), box("e10", t("3"))])).toBe(2000);
});

test("errors", () => {
  expect(() => ev(t("1 ÷ 0"))).toThrow("Math ERROR");
  expect(() => ev(t("1 +"))).toThrow("Syntax ERROR");
  expect(() => ev([box("sqrt", [tok("neg"), tok("4")])])).toThrow("Math ERROR");
});

test("complex mode", () => {
  const c = ctx("CMPLX");
  expect(shown([box("sqrt", [tok("neg"), tok("4")])], c)).toBe("2i");
  expect(shown(t("( 1 + i ) ( 1 - i )"), c)).toBe("2");
});

test("memory, Pol and DMS", () => {
  const c = ctx();
  c.vars.A = 5;
  expect(ev(t("2 A"), c)).toBe(10);
  const p = ev(t("Pol( 3 , 4 )"), c);
  expect(p.pair[0]).toBe(5);
  expect(p.pair[1]).toBeCloseTo(53.13010235, 8);
  expect(c.vars.X).toBe(5);
  expect(ev(t("2 dms 30 dms 0 dms"))).toBe(2.5);
});

test("solve and equations", () => {
  expect(solve([tok("X"), box("pow", t("2")), tok("-"), tok("2")], ctx(), 1).x).toBeCloseTo(Math.SQRT2, 10);
  const r = solveEquations(3, [[1, -3, 2]]);
  expect(r).toEqual([{ label: "X₁", value: 2 }, { label: "X₂", value: 1 }]);
  const s = solveEquations(1, [[1, 1, 3], [1, -1, 1]]);
  expect(s).toEqual([{ label: "X", value: 2 }, { label: "Y", value: 1 }]);
});

test("base-n", () => {
  const c = ctx("BASE-N", { base: "hex" });
  expect(ev(t("F + 1"), c)).toBe(16);
  expect(seqText((show(16, c) as { seq: Seq }).seq)).toBe("00000010");
});

test("stats", () => {
  const c = ctx("STAT", { stat: { type: "A+BX", freq: false, rows: [{ x: 1, y: 2, f: 1 }, { x: 2, y: 4, f: 1 }, { x: 3, y: 6, f: 1 }] } });
  expect(ev(t("stat:x̄"), c)).toBe(2);
  expect(ev(t("stat:B"), c)).toBeCloseTo(2, 12);
  expect(ev(t("10 ŷ"), c)).toBeCloseTo(20, 10);
});

test("exact forms are never invented (security review regressions)", () => {
  expect(shown([box("frac", t("5"), t("4")), tok("π")])).toBe("(5π)/(4)");
  expect(shown(t("1000 . 001"))).toBe("1000.001");
  expect(shown(t("98765 . 4321"))).toBe("98765.4321");
  // a genuine (p + r√m)/q still shows exactly
  expect(shown([box("frac", [tok("1"), tok("+"), box("sqrt", t("5"))], t("2"))])).toBe("(1+√(5))/(2)");
});

test("statistics keep their digits for large, close values", () => {
  const c = ctx("STAT", { stat: { type: "1-VAR", freq: false, rows: [1000000001, 1000000002, 1000000003].map((x) => ({ x, y: 0, f: 1 })) } });
  expect(ev(t("stat:σx"), c)).toBeCloseTo(0.8164965809, 9);
});

test("nCr and nPr stay fast and correct", () => {
  expect(ev(t("10 nCr 3"))).toBe(120);
  const started = Date.now();
  expect(() => ev(t("1000000000 nCr 500000000"))).toThrow("Math ERROR");
  expect(() => ev(t("1000000000 nPr 500000000"))).toThrow("Math ERROR");
  expect(Date.now() - started).toBeLessThan(500);
});
