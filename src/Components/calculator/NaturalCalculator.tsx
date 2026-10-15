import React, { useCallback, useEffect, useRef, useState } from "react";
import Display from "./Display";
import {
  CalcError,
  DEFAULT_SETTINGS,
  evaluate,
  isMatrix,
  isPair,
  show,
  solve,
  solveEquations,
  toMatrix,
  type Base,
  type Ctx,
  type Mode,
  type Settings,
  type Shown,
  type StatData,
  type StatType,
  type Val,
} from "./engine";
import { CONSTANTS, CONVERSIONS } from "./tables";
import { clone, deleteBack, insertNode, isBox, moveLeft, moveRight, moveVertical, template, tok, box, tokensIn, type Cursor, type Kind, type Seq } from "./tree";

// The exam calculator (2026-10-15): a natural-display scientific calculator
// laid out and behaving like the Casio fx-991ES PLUS pupils use in class.
// Every key does what it does on the real one, with SHIFT (gold) and ALPHA
// (red) functions, and all eight modes: COMP, CMPLX, STAT, BASE-N, EQN,
// MATRIX, TABLE and VECTOR, plus SETUP, CONST, CONV, memories and CALC/SOLVE.

/* ------------------------------------------------------------------- keys */

type KeyDef = { id: string; label: string; shift?: string; alpha?: string; act: string; sAct?: string; aAct?: string; kind: "fn" | "num" | "op" | "red" };

const TOP: KeyDef[][] = [
  [
    { id: "CALC", label: "CALC", shift: "SOLVE", alpha: "=", act: "calc", sAct: "solve", aAct: "ins:=", kind: "fn" },
    { id: "INT", label: "∫dx", shift: "d/dx", alpha: ":", act: "tpl:int", sAct: "tpl:ddx", aAct: "ins::", kind: "fn" },
    { id: "INV", label: "x⁻¹", shift: "x!", act: "pow:-1", sAct: "post:!", kind: "fn" },
    { id: "LOGB", label: "log□□", shift: "Σ", act: "tpl:logb", sAct: "tpl:sum", kind: "fn" },
  ],
  [
    { id: "FRAC", label: "□⁄□", shift: "■□⁄□", act: "tpl:frac", sAct: "tpl:mixed", kind: "fn" },
    { id: "SQRT", label: "√□", shift: "∛□", act: "tpl:sqrt", sAct: "cbrt", kind: "fn" },
    { id: "SQ", label: "x²", shift: "x³", act: "pow:2", sAct: "pow:3", kind: "fn" },
    { id: "POW", label: "x■", shift: "■√□", act: "pow", sAct: "xroot", kind: "fn" },
    { id: "LOG", label: "log", shift: "10■", act: "ins:log(", sAct: "tenpow", kind: "fn" },
    { id: "LN", label: "ln", shift: "e■", act: "ins:ln(", sAct: "epow", kind: "fn" },
  ],
  [
    { id: "NEG", label: "(−)", shift: "∠", alpha: "A", act: "ins:neg", sAct: "ins:∠", aAct: "var:A", kind: "fn" },
    { id: "DMS", label: "°′″", shift: "←", alpha: "B", act: "dms", sAct: "undms", aAct: "var:B", kind: "fn" },
    { id: "HYP", label: "hyp", shift: "Abs", alpha: "C", act: "menu:hyp", sAct: "tpl:abs", aAct: "var:C", kind: "fn" },
    { id: "SIN", label: "sin", shift: "sin⁻¹", alpha: "D", act: "ins:sin(", sAct: "ins:sin⁻¹(", aAct: "var:D", kind: "fn" },
    { id: "COS", label: "cos", shift: "cos⁻¹", alpha: "E", act: "ins:cos(", sAct: "ins:cos⁻¹(", aAct: "var:E", kind: "fn" },
    { id: "TAN", label: "tan", shift: "tan⁻¹", alpha: "F", act: "ins:tan(", sAct: "ins:tan⁻¹(", aAct: "var:F", kind: "fn" },
  ],
  [
    { id: "RCL", label: "RCL", shift: "STO", act: "rcl", sAct: "sto", kind: "fn" },
    { id: "ENG", label: "ENG", shift: "←ENG", alpha: "i", act: "eng", sAct: "leng", aAct: "ins:i", kind: "fn" },
    { id: "LP", label: "(", shift: "%", act: "ins:(", sAct: "post:%", kind: "fn" },
    { id: "RP", label: ")", shift: ",", alpha: "X", act: "ins:)", sAct: "ins:,", aAct: "var:X", kind: "fn" },
    { id: "SD", label: "S⇔D", shift: "ab/c⇔d/c", alpha: "Y", act: "sd", sAct: "abcd", aAct: "var:Y", kind: "fn" },
    { id: "MPLUS", label: "M+", shift: "M−", alpha: "M", act: "mplus", sAct: "mminus", aAct: "var:M", kind: "fn" },
  ],
];

const PAD: KeyDef[][] = [
  [
    { id: "7", label: "7", shift: "CONST", act: "ins:7", sAct: "menu:const", kind: "num" },
    { id: "8", label: "8", shift: "CONV", act: "ins:8", sAct: "menu:conv", kind: "num" },
    { id: "9", label: "9", shift: "CLR", act: "ins:9", sAct: "menu:clr", kind: "num" },
    { id: "DEL", label: "DEL", shift: "INS", act: "del", sAct: "noop", kind: "red" },
    { id: "AC", label: "AC", shift: "OFF", act: "ac", sAct: "off", kind: "red" },
  ],
  [
    { id: "4", label: "4", shift: "MATRIX", act: "ins:4", sAct: "menu:matrix", kind: "num" },
    { id: "5", label: "5", shift: "VECTOR", act: "ins:5", sAct: "menu:vector", kind: "num" },
    { id: "6", label: "6", act: "ins:6", kind: "num" },
    { id: "MUL", label: "×", shift: "nPr", act: "ins:×", sAct: "ins:nPr", kind: "op" },
    { id: "DIV", label: "÷", shift: "nCr", act: "ins:÷", sAct: "ins:nCr", kind: "op" },
  ],
  [
    { id: "1", label: "1", shift: "STAT", act: "ins:1", sAct: "menu:stat", kind: "num" },
    { id: "2", label: "2", shift: "CMPLX", act: "ins:2", sAct: "menu:cmplx", kind: "num" },
    { id: "3", label: "3", shift: "BASE", act: "ins:3", sAct: "menu:base", kind: "num" },
    { id: "ADD", label: "+", shift: "Pol", act: "ins:+", sAct: "ins:Pol(", kind: "op" },
    { id: "SUB", label: "−", shift: "Rec", act: "ins:-", sAct: "ins:Rec(", kind: "op" },
  ],
  [
    { id: "0", label: "0", shift: "Rnd", act: "ins:0", sAct: "ins:Rnd(", kind: "num" },
    { id: "DOT", label: ".", shift: "Ran#", alpha: "RanInt", act: "ins:.", sAct: "ins:Ran#", aAct: "ins:RanInt#(", kind: "num" },
    { id: "EXP", label: "×10ˣ", shift: "π", alpha: "e", act: "e10", sAct: "ins:π", aAct: "ins:e", kind: "num" },
    { id: "ANS", label: "Ans", shift: "DRG▸", act: "ins:Ans", sAct: "menu:drg", kind: "num" },
    { id: "EQ", label: "=", act: "eq", kind: "num" },
  ],
];

// In BASE-N the same keys mean other things, as printed on the calculator.
const BASE_KEYS: Record<string, string> = {
  SQ: "base:dec",
  POW: "base:hex",
  LOG: "base:bin",
  LN: "base:oct",
  NEG: "ins:A",
  DMS: "ins:B",
  HYP: "ins:C",
  SIN: "ins:D",
  COS: "ins:E",
  TAN: "ins:F",
};

// Keys whose meaning needs something before them: pressed right after an
// answer, they carry on from Ans, as the calculator does.
const NEEDS_LEFT = /^(ins:(\+|-|×|÷|nPr|nCr|∠|and|or|xor|xnor)|pow.*|post:.*|e10)$/;

/* ------------------------------------------------------------------ state */

type MenuItem = { label: string; act: string };
type Menu = { title: string; items: MenuItem[]; twoDigit?: boolean };
type Screen =
  | { k: "main" }
  | { k: "menu"; menu: Menu; buf: string }
  | { k: "prompt"; vars: string[]; idx: number; then: "calc" | "solve" }
  | { k: "grid"; target: string; r: number; c: number }
  | { k: "eqnres"; lines: { label: string; value: Val }[] | string }
  | { k: "table"; stage: "f" | "start" | "end" | "step" | "view" }
  | { k: "confirm"; what: "setup" | "memory" | "all" };

type St = {
  mode: Mode;
  settings: Settings;
  vars: Record<string, Val>;
  ans: Val;
  stat: StatData;
  base: Base;
  shift: boolean;
  alpha: boolean;
  sto: boolean;
  rcl: boolean;
  root: Seq;
  cur: Cursor;
  main: Seq | null;
  done: boolean;
  result: Shown | null;
  value: Val;
  decimal: boolean;
  eng: number | null;
  dms: boolean;
  error: string | null;
  note: string | null;
  history: Seq[];
  hist: number;
  screen: Screen;
  eqnKind: 1 | 2 | 3 | 4;
  eqn: number[][];
  mats: Record<string, number[][]>;
  table: { f: Seq; start: number; end: number; step: number };
};

const VARS = ["A", "B", "C", "D", "E", "F", "X", "Y", "M"];

const fresh = (): St => {
  const root: Seq = [];
  return {
    mode: "COMP",
    settings: { ...DEFAULT_SETTINGS },
    vars: Object.fromEntries(VARS.map((v) => [v, 0])),
    ans: 0,
    stat: { type: "1-VAR", rows: [], freq: false },
    base: "dec",
    shift: false,
    alpha: false,
    sto: false,
    rcl: false,
    root,
    cur: { seq: root, i: 0 },
    main: null,
    done: false,
    result: null,
    value: 0,
    decimal: false,
    eng: null,
    dms: false,
    error: null,
    note: null,
    history: [],
    hist: -1,
    screen: { k: "main" },
    eqnKind: 1,
    eqn: [],
    mats: {},
    table: { f: [], start: 1, end: 5, step: 1 },
  };
};

const MODE_LABEL: Record<Mode, string> = {
  COMP: "",
  CMPLX: "CMPLX",
  STAT: "STAT",
  "BASE-N": "BASE",
  EQN: "EQN",
  MATRIX: "MAT",
  TABLE: "TABLE",
  VECTOR: "VCT",
};

const STAT_TYPES: StatType[] = ["1-VAR", "A+BX", "_+CX²", "ln X", "e^X", "A•B^X", "A•X^B", "1/X"];
const EQN_TYPES = ["anX+bnY=cn", "anX+bnY+cnZ=dn", "aX²+bX+c=0", "aX³+bX²+cX+d=0"];
const EQN_SHAPE: Record<number, [number, number]> = { 1: [2, 3], 2: [3, 4], 3: [1, 3], 4: [1, 4] };

/* ------------------------------------------------------------- component */

type Props = { onClose: () => void; hidden?: boolean };

const NaturalCalculator = ({ onClose, hidden = false }: Props) => {
  const st = useRef<St>(fresh());
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const s = st.current;

  const ctx = (): Ctx => {
    const vars: Record<string, Val> = { ...s.vars };
    Object.entries(s.mats).forEach(([name, rows]) => {
      vars[name] = toMatrix(rows, name.startsWith("Vct"));
    });
    if (isMatrix(s.ans)) vars[s.ans.size().length === 1 ? "VctAns" : "MatAns"] = s.ans;
    return { mode: s.mode, settings: { ...s.settings }, vars, ans: s.ans, stat: s.stat, base: s.base };
  };

  const newRow = (seq: Seq = []) => {
    s.root = seq;
    s.cur = { seq, i: seq.length };
  };

  const clearResult = () => {
    s.done = false;
    s.result = null;
    s.error = null;
    s.note = null;
    s.decimal = false;
    s.eng = null;
    s.dms = false;
  };

  const openMenu = (menu: Menu) => {
    s.screen = { k: "menu", menu, buf: "" };
  };

  const fail = (e: unknown) => {
    s.error = e instanceof CalcError ? e.message : "Math ERROR";
    s.result = null;
    s.done = false;
  };

  const showValue = (v: Val, c?: Ctx) => {
    const cx = c || ctx();
    s.value = v;
    s.result = show(v, cx, { decimal: s.decimal, eng: s.eng, dms: s.dms });
  };

  /* ---------------------------------------------------------- calculate */

  const calculate = () => {
    if (!s.root.length) {
      if (s.done && s.history.length) newRow(clone(s.history[s.history.length - 1]));
      else return;
    }
    const c = ctx();
    try {
      const v = evaluate(s.root, c);
      s.decimal = false;
      s.eng = null;
      // Typed in degrees, minutes and seconds: answered the same way.
      s.dms = typeof v === "number" && tokensIn(s.root).includes("dms");
      s.ans = isPair(v) ? v.pair[0] : v;
      Object.assign(s.vars, Object.fromEntries(VARS.map((k) => [k, c.vars[k]])));
      showValue(v, c);
      s.error = null;
      s.done = true;
      s.history.push(clone(s.root));
      if (s.history.length > 30) s.history.shift();
      s.hist = -1;
    } catch (e) {
      fail(e);
    }
  };

  // The value of what is on screen: the answer, or what has been typed.
  const currentValue = (): Val | null => {
    if (s.done) return s.value;
    if (!s.root.length) return s.ans;
    try {
      const v = evaluate(s.root, ctx());
      return v;
    } catch (e) {
      fail(e);
      return null;
    }
  };

  /* ------------------------------------------------------------- inputs */

  const startTyping = (act: string) => {
    if (s.error) {
      s.error = null;
    }
    if (s.done) {
      const carry = NEEDS_LEFT.test(act);
      clearResult();
      newRow(carry ? [tok("Ans")] : []);
    }
    s.hist = -1;
  };

  const insertTok = (v: string) => {
    s.cur = insertNode(s.cur, tok(v));
  };

  const insertTemplate = (k: Kind, fill?: Seq[], enter = 0) => {
    const { node } = template(k);
    if (fill) fill.forEach((seq, n) => (node.s[n] = seq));
    s.cur = insertNode(s.cur, node, enter);
  };

  const recall = (name: string) => {
    s.rcl = false;
    clearResult();
    const v = s.vars[name] ?? 0;
    s.note = `${name}=`;
    newRow([tok(name)]);
    s.done = true;
    showValue(v);
  };

  const store = (name: string) => {
    s.sto = false;
    const v = currentValue();
    if (v === null) return;
    if (typeof v !== "number" && !(s.mode === "CMPLX")) {
      s.error = "Math ERROR";
      return;
    }
    s.vars[name] = v;
    s.ans = v;
    if (s.done || !s.root.length) newRow([tok("Ans")]);
    s.note = `Ans→${name}`;
    s.done = true;
    showValue(v);
  };

  /* -------------------------------------------------------------- menus */

  const menus = {
    mode: (): Menu => ({
      title: "MODE",
      items: [
        { label: "COMP", act: "mode:COMP" },
        { label: "CMPLX", act: "mode:CMPLX" },
        { label: "STAT", act: "mode:STAT" },
        { label: "BASE-N", act: "mode:BASE-N" },
        { label: "EQN", act: "mode:EQN" },
        { label: "MATRIX", act: "mode:MATRIX" },
        { label: "TABLE", act: "mode:TABLE" },
        { label: "VECTOR", act: "mode:VECTOR" },
      ],
    }),
    setup: (): Menu => ({
      title: "SETUP",
      items: [
        { label: "MthIO", act: "set:mth" },
        { label: "LineIO", act: "set:line" },
        { label: "Deg", act: "set:deg" },
        { label: "Rad", act: "set:rad" },
        { label: "Gra", act: "set:gra" },
        { label: "Fix", act: "menu:fix" },
        { label: "Sci", act: "menu:sci" },
        { label: "Norm", act: "menu:norm" },
        { label: "a b/c", act: "set:mixed" },
        { label: "d/c", act: "set:improper" },
        { label: "CMPLX a+bi", act: "set:rect" },
        { label: "CMPLX r∠θ", act: "set:polar" },
        { label: `STAT Frequency ${s.stat.freq ? "(on)" : "(off)"}`, act: "set:freq" },
      ],
    }),
    digits: (kind: "fix" | "sci"): Menu => ({
      title: kind === "fix" ? "Fix 0~9?" : "Sci 0~9?",
      items: Array.from({ length: 10 }, (_, n) => ({ label: String(n), act: `set:${kind}${n}` })),
    }),
    norm: (): Menu => ({ title: "Norm 1~2?", items: [{ label: "Norm1", act: "set:norm1" }, { label: "Norm2", act: "set:norm2" }] }),
    hyp: (): Menu => ({
      title: "hyp",
      items: ["sinh", "cosh", "tanh", "sinh⁻¹", "cosh⁻¹", "tanh⁻¹"].map((f) => ({ label: f, act: `ins:${f}(` })),
    }),
    drg: (): Menu => ({ title: "DRG▸", items: [{ label: "°", act: "post:°" }, { label: "ʳ", act: "post:ʳ" }, { label: "ᵍ", act: "post:ᵍ" }] }),
    clr: (): Menu => ({ title: "CLR", items: [{ label: "Setup", act: "clr:setup" }, { label: "Memory", act: "clr:memory" }, { label: "All", act: "clr:all" }] }),
    const: (): Menu => ({ title: "CONST 01~40?", twoDigit: true, items: CONSTANTS.map((c) => ({ label: `${c.sym}  ${c.name}`, act: `ins:const:${c.sym}` })) }),
    conv: (): Menu => ({ title: "CONV 01~40?", twoDigit: true, items: CONVERSIONS.map((c) => ({ label: c.sym, act: `post:conv:${c.sym}` })) }),
    cmplx: (): Menu => ({
      title: "CMPLX",
      items: [
        { label: "arg", act: "ins:arg(" },
        { label: "Conjg", act: "ins:Conjg(" },
        { label: "▸r∠θ", act: "post:▸r∠θ" },
        { label: "▸a+bi", act: "post:▸a+bi" },
      ],
    }),
    base: (): Menu => ({
      title: "BASE",
      items: [
        { label: "and", act: "ins:and" },
        { label: "or", act: "ins:or" },
        { label: "xor", act: "ins:xor" },
        { label: "xnor", act: "ins:xnor" },
        { label: "Not(", act: "ins:Not(" },
        { label: "Neg(", act: "ins:Neg(" },
        { label: "d (decimal)", act: "ins:d" },
        { label: "h (hex)", act: "ins:h" },
        { label: "b (binary)", act: "ins:b" },
        { label: "o (octal)", act: "ins:o" },
      ],
    }),
    statType: (): Menu => ({ title: "STAT type", items: STAT_TYPES.map((t) => ({ label: t, act: `stattype:${t}` })) }),
    stat: (): Menu => ({
      title: "STAT",
      items: [
        { label: "Type", act: "menu:stattype" },
        { label: "Data", act: "grid:stat" },
        { label: "Sum", act: "menu:statsum" },
        { label: "Var", act: "menu:statvar" },
        ...(s.stat.type !== "1-VAR" ? [{ label: "Reg", act: "menu:statreg" }] : []),
        { label: "MinMax", act: "menu:statminmax" },
      ],
    }),
    statSum: (): Menu => ({
      title: "Sum",
      items: (s.stat.type === "1-VAR" ? ["Σx²", "Σx"] : ["Σx²", "Σx", "Σy²", "Σy", "Σxy", "Σx³", "Σx²y", "Σx⁴"]).map((v) => ({ label: v, act: `ins:stat:${v}` })),
    }),
    statVar: (): Menu => ({
      title: "Var",
      items: (s.stat.type === "1-VAR" ? ["n", "x̄", "σx", "sx"] : ["n", "x̄", "σx", "sx", "ȳ", "σy", "sy"]).map((v) => ({ label: v, act: `ins:stat:${v}` })),
    }),
    statReg: (): Menu => ({
      title: "Reg",
      items: [
        ...(s.stat.type === "_+CX²" ? ["A", "B", "C"] : ["A", "B", "r"]).map((v) => ({ label: v, act: `ins:stat:${v}` })),
        ...(s.stat.type === "_+CX²" ? ["x̂₁", "x̂₂", "ŷ"] : ["x̂", "ŷ"]).map((v) => ({ label: v, act: `post:${v}` })),
      ],
    }),
    statMinMax: (): Menu => ({
      title: "MinMax",
      items: (s.stat.type === "1-VAR" ? ["minX", "maxX", "Q1", "med", "Q3"] : ["minX", "maxX", "minY", "maxY"]).map((v) => ({ label: v, act: `ins:stat:${v}` })),
    }),
    eqnType: (): Menu => ({ title: "EQN type", items: EQN_TYPES.map((t, n) => ({ label: t, act: `eqntype:${n + 1}` })) }),
    matrix: (): Menu => ({
      title: "MATRIX",
      items: [
        { label: "Dim", act: "menu:matdim" },
        { label: "Data", act: "menu:matdata" },
        { label: "MatA", act: "ins:MatA" },
        { label: "MatB", act: "ins:MatB" },
        { label: "MatC", act: "ins:MatC" },
        { label: "MatAns", act: "ins:MatAns" },
        { label: "det", act: "ins:det(" },
        { label: "Trn", act: "ins:Trn(" },
      ],
    }),
    vector: (): Menu => ({
      title: "VECTOR",
      items: [
        { label: "Dim", act: "menu:vctdim" },
        { label: "Data", act: "menu:vctdata" },
        { label: "VctA", act: "ins:VctA" },
        { label: "VctB", act: "ins:VctB" },
        { label: "VctC", act: "ins:VctC" },
        { label: "VctAns", act: "ins:VctAns" },
        { label: "Dot", act: "ins:Dot(" },
        { label: "Angle", act: "ins:Angle(" },
        { label: "UnitV", act: "ins:UnitV(" },
      ],
    }),
    pick: (kind: "Mat" | "Vct", then: "dim" | "data"): Menu => ({
      title: `${kind === "Mat" ? "Matrix" : "Vector"}?`,
      items: ["A", "B", "C"].map((x) => ({ label: `${kind}${x}`, act: `${then}:${kind}${x}` })),
    }),
    matSize: (name: string): Menu => ({
      title: `${name} (m×n) m?`,
      items: ["3×3", "3×2", "3×1", "2×3", "2×2", "2×1", "1×3", "1×2"].map((d) => ({ label: d, act: `size:${name}:${d}` })),
    }),
    vctSize: (name: string): Menu => ({ title: `${name} dimension?`, items: ["3", "2"].map((d) => ({ label: d, act: `size:${name}:1×${d}` })) }),
  };

  /* --------------------------------------------------------------- grid */

  const gridShape = (target: string): { rows: number; cols: string[] } => {
    if (target === "stat") {
      const cols = ["x", ...(s.stat.type === "1-VAR" ? [] : ["y"]), ...(s.stat.freq ? ["FREQ"] : [])];
      return { rows: Math.min(s.stat.rows.length + 1, 80), cols };
    }
    if (target === "eqn") {
      const [r, c] = EQN_SHAPE[s.eqnKind];
      return { rows: r, cols: ["a", "b", "c", "d"].slice(0, c) };
    }
    const m = s.mats[target] || [[0]];
    return { rows: m.length, cols: m[0].map((_, k) => String(k + 1)) };
  };

  const gridGet = (target: string, r: number, c: number): number | null => {
    if (target === "stat") {
      const row = s.stat.rows[r];
      if (!row) return null;
      const key = gridShape(target).cols[c];
      return key === "x" ? row.x : key === "y" ? row.y : row.f;
    }
    if (target === "eqn") return s.eqn[r]?.[c] ?? 0;
    return s.mats[target]?.[r]?.[c] ?? 0;
  };

  const gridSet = (target: string, r: number, c: number, v: number) => {
    if (target === "stat") {
      if (!s.stat.rows[r]) s.stat.rows[r] = { x: 0, y: 0, f: 1 };
      const key = gridShape(target).cols[c];
      if (key === "x") s.stat.rows[r].x = v;
      else if (key === "y") s.stat.rows[r].y = v;
      else s.stat.rows[r].f = v;
      return;
    }
    if (target === "eqn") {
      s.eqn[r][c] = v;
      return;
    }
    s.mats[target][r][c] = v;
  };

  const openGrid = (target: string) => {
    if (target === "eqn") {
      const [r, c] = EQN_SHAPE[s.eqnKind];
      if (s.eqn.length !== r || s.eqn[0]?.length !== c) s.eqn = Array.from({ length: r }, () => Array(c).fill(0));
    }
    clearResult();
    newRow([]);
    s.screen = { k: "grid", target, r: 0, c: 0 };
  };

  const gridCommit = (): boolean => {
    const g = s.screen;
    if (g.k !== "grid" || !s.root.length) return false;
    try {
      const v = evaluate(s.root, { ...ctx(), mode: "COMP" });
      if (typeof v !== "number") throw new CalcError("Math");
      gridSet(g.target, g.r, g.c, v);
      newRow([]);
      s.error = null;
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const gridMove = (dr: number, dc: number) => {
    const g = s.screen;
    if (g.k !== "grid") return;
    const { rows, cols } = gridShape(g.target);
    let r = g.r + dr;
    let c = g.c + dc;
    if (c >= cols.length) {
      c = 0;
      r += 1;
    }
    if (c < 0) c = cols.length - 1;
    r = Math.max(0, Math.min(rows - 1, r));
    s.screen = { ...g, r, c };
  };

  /* ---------------------------------------------------------- mode/menu */

  const setMode = (m: Mode) => {
    s.mode = m;
    clearResult();
    newRow([]);
    s.main = null;
    s.screen = { k: "main" };
    if (m === "STAT") openMenu(menus.statType());
    if (m === "EQN") openMenu(menus.eqnType());
    if (m === "MATRIX") openMenu(menus.pick("Mat", "dim"));
    if (m === "VECTOR") openMenu(menus.pick("Vct", "dim"));
    if (m === "TABLE") s.screen = { k: "table", stage: "f" };
    if (m === "BASE-N") s.base = "dec";
  };

  const runMenuAct = (act: string) => {
    s.screen = s.mode === "TABLE" && act.startsWith("ins:") ? { k: "table", stage: "f" } : { k: "main" };
    run(act);
  };

  const menuKey = (id: string) => {
    const sc = s.screen;
    if (sc.k !== "menu") return;
    if (id === "AC" || id === "ON") {
      s.screen = s.mode === "TABLE" ? { k: "table", stage: "f" } : { k: "main" };
      return;
    }
    if (!/^[0-9]$/.test(id)) return;
    if (sc.menu.twoDigit) {
      const buf = sc.buf + id;
      if (buf.length < 2) {
        s.screen = { ...sc, buf };
        return;
      }
      const item = sc.menu.items[Number(buf) - 1];
      if (!item) {
        s.screen = { ...sc, buf: "" };
        return;
      }
      runMenuAct(item.act);
      return;
    }
    const n = id === "0" ? 10 : Number(id);
    const item = sc.menu.items[n - 1];
    if (item) runMenuAct(item.act);
  };

  /* ---------------------------------------------------------------- run */

  const run = (act: string) => {
    const [verb, ...restParts] = act.split(":");
    const arg = restParts.join(":");

    if (s.sto || s.rcl) {
      if (verb === "var") {
        if (s.sto) store(arg);
        else recall(arg);
        return;
      }
      if (verb !== "noop") {
        s.sto = false;
        s.rcl = false;
      }
    }

    switch (verb) {
      case "noop":
        return;
      case "ins":
      case "var": {
        startTyping(act);
        if (s.mode === "BASE-N" && verb === "var") return;
        insertTok(arg);
        return;
      }
      case "post":
        startTyping(act);
        insertTok(arg);
        return;
      case "tpl":
        startTyping(act);
        insertTemplate(arg as Kind);
        return;
      case "pow": {
        startTyping(act);
        if (!arg) insertTemplate("pow");
        else s.cur = insertNode(s.cur, box("pow", arg.split("").map((ch) => tok(ch))));
        return;
      }
      case "cbrt":
        startTyping(act);
        insertTemplate("root", [[tok("3")], []], 1);
        return;
      case "xroot":
        startTyping(act);
        insertTemplate("root");
        return;
      case "tenpow":
        startTyping(act);
        insertTok("1");
        insertTok("0");
        insertTemplate("pow");
        return;
      case "epow":
        startTyping(act);
        insertTok("e");
        insertTemplate("pow");
        return;
      case "e10":
        startTyping(act);
        insertTemplate("e10");
        return;
      case "dms":
        if (s.done && typeof s.value === "number") {
          s.dms = !s.dms;
          showValue(s.value);
          return;
        }
        startTyping(act);
        insertTok("dms");
        return;
      case "undms":
        if (s.done && typeof s.value === "number") {
          s.dms = false;
          showValue(s.value);
        }
        return;
      case "del":
        if (s.error) {
          s.error = null;
          return;
        }
        if (s.done) clearResult();
        if (s.screen.k === "grid" && !s.root.length && s.screen.target === "stat") {
          const g = s.screen;
          if (s.stat.rows[g.r]) s.stat.rows.splice(g.r, 1);
          return;
        }
        s.cur = deleteBack(s.root, s.cur);
        return;
      case "ac":
        s.error = null;
        if (s.screen.k === "grid") {
          if (s.root.length) {
            newRow([]);
            return;
          }
          s.screen = s.mode === "TABLE" ? { k: "table", stage: "f" } : { k: "main" };
          clearResult();
          newRow([]);
          return;
        }
        if (s.screen.k === "eqnres") {
          openGrid("eqn");
          return;
        }
        if (s.screen.k === "prompt") {
          s.screen = { k: "main" };
          newRow(s.main || []);
          s.main = null;
          return;
        }
        if (s.screen.k === "table") {
          if (s.screen.stage !== "f") {
            newRow(s.main || s.table.f);
            s.main = null;
          } else newRow([]);
          s.screen = { k: "table", stage: "f" };
          clearResult();
          return;
        }
        clearResult();
        newRow([]);
        return;
      case "off":
        onClose();
        return;
      case "eq":
        equals();
        return;
      case "mode":
        if (arg) {
          setMode(arg as Mode);
          return;
        }
        if (s.done || s.error) clearResult();
        s.screen = { k: "menu", menu: menus.mode(), buf: "" };
        return;
      case "setup":
        openMenu(menus.setup());
        return;
      case "menu": {
        const m: Record<string, () => Menu> = {
          hyp: menus.hyp,
          drg: menus.drg,
          clr: menus.clr,
          const: menus.const,
          conv: menus.conv,
          fix: () => menus.digits("fix"),
          sci: () => menus.digits("sci"),
          norm: menus.norm,
          stattype: menus.statType,
          statsum: menus.statSum,
          statvar: menus.statVar,
          statreg: menus.statReg,
          statminmax: menus.statMinMax,
          matdim: () => menus.pick("Mat", "dim"),
          matdata: () => menus.pick("Mat", "data"),
          vctdim: () => menus.pick("Vct", "dim"),
          vctdata: () => menus.pick("Vct", "data"),
        };
        const modeMenus: Record<string, [Mode, () => Menu]> = {
          stat: ["STAT", menus.stat],
          cmplx: ["CMPLX", menus.cmplx],
          base: ["BASE-N", menus.base],
          matrix: ["MATRIX", menus.matrix],
          vector: ["VECTOR", menus.vector],
        };
        if (modeMenus[arg]) {
          const [needs, make] = modeMenus[arg];
          if (s.mode !== needs) {
            s.note = `${needs} mode only (MODE)`;
            return;
          }
          openMenu(make());
          return;
        }
        if (m[arg]) openMenu(m[arg]());
        return;
      }
      case "set": {
        const st2 = s.settings;
        if (arg === "mth") st2.mathIO = true;
        else if (arg === "line") st2.mathIO = false;
        else if (arg === "deg" || arg === "rad" || arg === "gra") st2.angle = arg;
        else if (arg === "mixed") st2.mixed = true;
        else if (arg === "improper") st2.mixed = false;
        else if (arg === "rect") st2.polar = false;
        else if (arg === "polar") st2.polar = true;
        else if (arg === "freq") s.stat.freq = !s.stat.freq;
        else if (arg.startsWith("fix")) st2.disp = { k: "fix", n: Number(arg.slice(3)) };
        else if (arg.startsWith("sci")) st2.disp = { k: "sci", n: Number(arg.slice(3)) };
        else if (arg === "norm1" || arg === "norm2") st2.disp = { k: "norm", n: arg === "norm1" ? 1 : 2 };
        if (s.done) showValue(s.value);
        return;
      }
      case "clr":
        s.screen = { k: "confirm", what: arg as "setup" | "memory" | "all" };
        return;
      case "stattype":
        s.stat = { type: arg as StatType, rows: s.stat.rows, freq: s.stat.freq };
        openGrid("stat");
        return;
      case "grid":
        openGrid(arg);
        return;
      case "eqntype":
        s.eqnKind = Number(arg) as 1 | 2 | 3 | 4;
        openGrid("eqn");
        return;
      case "dim":
        openMenu(arg.startsWith("Vct") ? menus.vctSize(arg) : menus.matSize(arg));
        return;
      case "data":
        if (!s.mats[arg]) {
          openMenu(arg.startsWith("Vct") ? menus.vctSize(arg) : menus.matSize(arg));
          return;
        }
        openGrid(arg);
        return;
      case "size": {
        const [name, d] = arg.split(":");
        const [r, c] = d.split("×").map(Number);
        s.mats[name] = Array.from({ length: r }, () => Array(c).fill(0));
        openGrid(name);
        return;
      }
      case "base":
        if (s.done && typeof s.value === "number") {
          s.base = arg as Base;
          showValue(s.value);
          return;
        }
        s.base = arg as Base;
        return;
      case "calc":
        startPrompts("calc");
        return;
      case "solve":
        startPrompts("solve");
        return;
      case "sd":
        if (s.done && s.result && typeof s.value === "number") {
          s.decimal = !s.decimal;
          showValue(s.value);
        } else if (!s.done) {
          calculate();
        }
        return;
      case "abcd":
        if (s.done) {
          s.settings.mixed = !s.settings.mixed;
          showValue(s.value);
          s.settings.mixed = !s.settings.mixed;
        }
        return;
      case "eng":
      case "leng":
        if (!s.done) calculate();
        if (s.done && typeof s.value === "number") {
          s.eng = s.eng === null ? 0 : s.eng + (verb === "eng" ? 1 : -1);
          showValue(s.value);
        }
        return;
      case "mplus":
      case "mminus": {
        const v = currentValue();
        if (v === null || typeof v !== "number") return;
        s.vars.M = Number(((s.vars.M as number) + (verb === "mplus" ? v : -v)).toPrecision(15));
        s.ans = v;
        if (!s.done) s.history.push(clone(s.root));
        s.note = verb === "mplus" ? "M+" : "M−";
        s.done = true;
        showValue(v);
        return;
      }
      case "sto":
        s.sto = true;
        return;
      case "rcl":
        s.rcl = true;
        return;
      default:
        return;
    }
  };

  /* ------------------------------------------------------- CALC / SOLVE */

  const startPrompts = (then: "calc" | "solve") => {
    if (s.screen.k === "prompt") return;
    const expr = s.root.length ? s.root : s.done && s.history.length ? clone(s.history[s.history.length - 1]) : null;
    if (!expr || !expr.length) return;
    const names = tokensIn(expr).filter((v) => VARS.includes(v));
    const unique = [...new Set(names)];
    // Y=X+1: Y gets the answer, so it is not asked for.
    const parts = expr.findIndex((n) => !isBox(n) && n.v === "=");
    const lhs = parts === 1 && !isBox(expr[0]) && then === "calc" ? expr[0].v : null;
    const ask = unique.filter((v) => v !== lhs);
    if (then === "solve" && !ask.includes("X")) ask.unshift("X");
    clearResult();
    s.main = expr;
    if (!ask.length) {
      newRow(expr);
      s.main = null;
      if (then === "calc") calculate();
      else doSolve();
      return;
    }
    s.screen = { k: "prompt", vars: ask, idx: 0, then };
    newRow([]);
  };

  const promptNext = () => {
    const p = s.screen;
    if (p.k !== "prompt") return;
    const name = p.vars[p.idx];
    if (s.root.length) {
      try {
        const v = evaluate(s.root, ctx());
        s.vars[name] = v;
      } catch (e) {
        fail(e);
        return;
      }
    }
    if (p.idx + 1 < p.vars.length) {
      s.screen = { ...p, idx: p.idx + 1 };
      newRow([]);
      return;
    }
    s.screen = { k: "main" };
    newRow(s.main || []);
    s.main = null;
    if (p.then === "calc") {
      calculate();
      s.history.pop(); // the same line, already in the history
      s.history.push(clone(s.root));
    } else doSolve();
  };

  const doSolve = () => {
    try {
      const c = ctx();
      const { x, residual } = solve(s.root, c, Number(s.vars.X) || 0);
      s.vars.X = x;
      s.ans = x;
      s.done = true;
      s.value = x;
      const xs = show(x, c);
      const rs = show(residual, c);
      s.result = {
        kind: "lines",
        lines: [
          { label: "X=", seq: xs.kind === "seq" ? xs.seq : [] },
          { label: "L−R=", seq: rs.kind === "seq" ? rs.seq : [] },
        ],
      };
    } catch (e) {
      fail(e);
    }
  };

  /* ---------------------------------------------------------------- = */

  const equals = () => {
    const sc = s.screen;
    if (sc.k === "confirm") {
      if (sc.what === "setup" || sc.what === "all") {
        s.settings = { ...DEFAULT_SETTINGS };
        s.stat.freq = false;
      }
      if (sc.what === "memory" || sc.what === "all") {
        s.vars = Object.fromEntries(VARS.map((v) => [v, 0]));
        s.ans = 0;
      }
      if (sc.what === "all") {
        const keep = s.history;
        Object.assign(s, fresh());
        s.history = keep.length ? [] : [];
      }
      s.screen = { k: "main" };
      s.note = sc.what === "setup" ? "Setup cleared" : sc.what === "memory" ? "Memory cleared" : "All cleared";
      clearResult();
      newRow([]);
      return;
    }
    if (sc.k === "prompt") {
      promptNext();
      return;
    }
    if (sc.k === "grid") {
      if (gridCommit()) {
        if (sc.target === "stat") gridMove(1, 0);
        else gridMove(0, 1);
        return;
      }
      if (sc.target === "eqn" && !s.error) {
        try {
          const res = solveEquations(s.eqnKind, s.eqn);
          s.screen = { k: "eqnres", lines: res };
        } catch (e) {
          fail(e);
        }
      }
      return;
    }
    if (sc.k === "eqnres") {
      openGrid("eqn");
      return;
    }
    if (sc.k === "table") {
      tableStep();
      return;
    }
    calculate();
  };

  /* -------------------------------------------------------------- TABLE */

  const tableStep = () => {
    const sc = s.screen;
    if (sc.k !== "table") return;
    const num = (fallback: number) => {
      if (!s.root.length) return fallback;
      const v = evaluate(s.root, { ...ctx(), mode: "COMP" });
      if (typeof v !== "number") throw new CalcError("Math");
      return v;
    };
    try {
      if (sc.stage === "f") {
        if (!s.root.length && !s.table.f.length) return;
        if (s.root.length) s.table.f = clone(s.root);
        s.main = s.table.f;
        newRow([]);
        s.screen = { k: "table", stage: "start" };
      } else if (sc.stage === "start") {
        s.table.start = num(s.table.start);
        newRow([]);
        s.screen = { k: "table", stage: "end" };
      } else if (sc.stage === "end") {
        s.table.end = num(s.table.end);
        newRow([]);
        s.screen = { k: "table", stage: "step" };
      } else if (sc.stage === "step") {
        s.table.step = num(s.table.step);
        const { start, end, step } = s.table;
        if (step <= 0 || end < start || (end - start) / step + 1 > 30) throw new CalcError("Math");
        newRow([]);
        s.screen = { k: "table", stage: "view" };
      }
      s.error = null;
    } catch (e) {
      fail(e);
    }
  };

  const tableRows = (): { x: number; y: string }[] => {
    const { f, start, end, step } = s.table;
    const out: { x: number; y: string }[] = [];
    for (let x = start, n = 0; x <= end + 1e-9 && n < 30; x += step, n += 1) {
      const xv = Number(x.toPrecision(12));
      let y = "ERROR";
      try {
        const v = evaluate(f, { ...ctx(), mode: "COMP" }, { X: xv });
        const sh = show(v, { ...ctx(), mode: "COMP", settings: { ...s.settings, mathIO: false } });
        y = sh.kind === "seq" ? sh.seq.map((t) => (isBox(t) ? `^${t.s[0].map((u) => (isBox(u) ? "" : u.v)).join("")}` : t.v === "-" ? "−" : t.v)).join("") : "";
      } catch {
        y = "ERROR";
      }
      out.push({ x: xv, y });
    }
    return out;
  };

  /* -------------------------------------------------------------- keys */

  const press = (key: KeyDef | string) => {
    const def = typeof key === "string" ? findKey(key) : key;
    const id = typeof key === "string" ? key : key.id;
    if (s.screen.k === "menu") {
      menuKey(id);
      s.shift = false;
      s.alpha = false;
      bump();
      return;
    }
    if (s.screen.k === "confirm" && id !== "EQ") {
      if (id === "AC" || id === "ON") s.screen = { k: "main" };
      bump();
      return;
    }
    if (id === "SHIFT") {
      s.shift = !s.shift;
      s.alpha = false;
      bump();
      return;
    }
    if (id === "ALPHA") {
      s.alpha = !s.alpha;
      s.shift = false;
      bump();
      return;
    }
    if (id === "MODE") {
      run(s.shift ? "setup" : "mode");
      s.shift = false;
      s.alpha = false;
      bump();
      return;
    }
    if (id === "ON") {
      s.screen = s.mode === "TABLE" ? { k: "table", stage: "f" } : { k: "main" };
      clearResult();
      newRow([]);
      s.shift = s.alpha = s.sto = s.rcl = false;
      bump();
      return;
    }
    if (["UP", "DOWN", "LEFT", "RIGHT"].includes(id)) {
      arrow(id);
      s.shift = false;
      s.alpha = false;
      bump();
      return;
    }
    if (!def) return;
    let act = s.shift ? def.sAct || "noop" : s.alpha ? def.aAct || "noop" : def.act;
    if (s.mode === "BASE-N" && !s.shift && !s.alpha && BASE_KEYS[def.id]) act = BASE_KEYS[def.id];
    if (s.mode === "CMPLX" && def.id === "ENG" && !s.shift) act = "ins:i";
    if (s.screen.k === "eqnres" && act !== "ac" && act !== "eq") act = "noop";
    if (s.screen.k === "table" && s.screen.stage === "view" && act !== "ac" && act !== "eq") act = "noop";
    s.shift = false;
    s.alpha = false;
    run(act);
    bump();
  };

  const arrow = (id: string) => {
    const sc = s.screen;
    if (sc.k === "grid" && !s.root.length) {
      if (id === "UP") gridMove(-1, 0);
      if (id === "DOWN") gridMove(1, 0);
      if (id === "LEFT") gridMove(0, -1);
      if (id === "RIGHT") gridMove(0, 1);
      return;
    }
    if (s.error) {
      s.error = null;
      return;
    }
    if (id === "UP" || id === "DOWN") {
      const moved = !s.done && s.root.length ? moveVertical(s.root, s.cur, id === "UP" ? "up" : "down") : null;
      if (moved) {
        s.cur = moved;
        return;
      }
      if (sc.k !== "main" || !s.history.length) return;
      // Replay: earlier sums and their answers.
      let h = s.hist < 0 ? s.history.length : s.hist;
      h = id === "UP" ? Math.max(0, h - 1) : h + 1;
      if (h >= s.history.length) {
        s.hist = -1;
        clearResult();
        newRow([]);
        return;
      }
      s.hist = h;
      newRow(clone(s.history[h]));
      try {
        clearResult();
        const v = evaluate(s.root, ctx());
        s.done = true;
        showValue(v);
      } catch (e) {
        fail(e);
      }
      return;
    }
    if (s.done) {
      // Back to editing the sum that gave the answer.
      clearResult();
      s.cur = id === "LEFT" ? { seq: s.root, i: s.root.length } : { seq: s.root, i: 0 };
      return;
    }
    s.cur = id === "LEFT" ? moveLeft(s.root, s.cur) : moveRight(s.root, s.cur);
  };

  const findKey = (id: string): KeyDef | undefined => [...TOP, ...PAD].flat().find((k) => k.id === id);

  /* ------------------------------------------------------- keyboard + drag */

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, string> = {
      Enter: "EQ",
      "=": "EQ",
      Backspace: "DEL",
      Delete: "DEL",
      Escape: "AC",
      "+": "ADD",
      "-": "SUB",
      "*": "MUL",
      x: "MUL",
      "/": "DIV",
      ".": "DOT",
      "(": "LP",
      ")": "RP",
      "^": "POW",
      ArrowUp: "UP",
      ArrowDown: "DOWN",
      ArrowLeft: "LEFT",
      ArrowRight: "RIGHT",
    };
    const id = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    press(id);
  };

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const startDrag = (e: React.PointerEvent) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    const box2 = panelRef.current?.getBoundingClientRect();
    if (!box2) return;
    drag.current = { dx: e.clientX - box2.left, dy: e.clientY - box2.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!drag.current || !panelRef.current) return;
    const w = panelRef.current.offsetWidth;
    const h = panelRef.current.offsetHeight;
    setPos({
      x: Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - drag.current.dx)),
      y: Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - drag.current.dy)),
    });
  };

  useEffect(() => {
    if (!hidden) panelRef.current?.focus({ preventScroll: true });
  }, [hidden]);

  /* ------------------------------------------------------------- render */

  const sc = s.screen;
  const indicators = [
    s.shift ? "S" : "",
    s.alpha ? "A" : "",
    s.vars.M ? "M" : "",
    s.sto ? "STO" : "",
    s.rcl ? "RCL" : "",
    MODE_LABEL[s.mode],
    s.mode === "BASE-N" ? s.base.toUpperCase() : "",
    s.settings.angle === "deg" ? "D" : s.settings.angle === "rad" ? "R" : "G",
    s.settings.disp.k === "fix" ? "FIX" : s.settings.disp.k === "sci" ? "SCI" : "",
    s.settings.mathIO ? "Math" : "",
  ].filter(Boolean);

  const place = (c: Cursor) => {
    if (s.done) clearResult();
    s.cur = c;
    bump();
  };

  const renderShown = (r: Shown) => {
    if (r.kind === "seq") return <Display seq={r.seq} />;
    if (r.kind === "lines")
      return (
        <span className="tw-flex tw-flex-col tw-items-end tw-gap-1">
          {r.lines.map((l) => (
            <span key={l.label} className="tw-inline-flex tw-items-center tw-gap-2">
              <span className="tw-text-[0.8em]">{l.label.endsWith("=") ? l.label : `${l.label}=`}</span>
              <Display seq={l.seq} />
            </span>
          ))}
        </span>
      );
    return (
      <span className="tw-inline-flex tw-items-stretch tw-gap-1 tw-text-[0.85em]">
        <span className="tw-w-[5px] tw-border-0 tw-border-y-[1.5px] tw-border-l-[1.5px] tw-border-solid tw-border-current" />
        <span className="tw-grid tw-gap-x-4 tw-gap-y-1" style={{ gridTemplateColumns: `repeat(${r.cells[0].length}, auto)` }}>
          {r.cells.flat().map((cell, k) => (
            <span key={k} className="tw-text-right">
              <Display seq={cell} />
            </span>
          ))}
        </span>
        <span className="tw-w-[5px] tw-border-0 tw-border-y-[1.5px] tw-border-r-[1.5px] tw-border-solid tw-border-current" />
      </span>
    );
  };

  const fmtCell = (v: number | null) => {
    if (v === null) return "";
    const sh = show(v, { ...ctx(), mode: "COMP", settings: { ...s.settings, mathIO: false } });
    return sh.kind === "seq" ? sh.seq.map((t) => (isBox(t) ? `^${t.s[0].map((u) => (isBox(u) ? "" : u.v)).join("")}` : t.v === "-" ? "−" : t.v)).join("") : "";
  };

  const lcdBody = () => {
    if (sc.k === "menu") {
      return (
        <div className="tw-flex tw-h-full tw-flex-col">
          <div className="tw-mb-1 tw-text-[12px] tw-font-bold tw-tracking-wide">{sc.menu.title}{sc.buf ? `  ${sc.buf}_` : ""}</div>
          <div className={`tw-grid tw-flex-1 tw-content-start tw-gap-x-3 tw-gap-y-0.5 tw-overflow-y-auto ${sc.menu.twoDigit ? "tw-grid-cols-1" : "tw-grid-cols-2"}`}>
            {sc.menu.items.map((it, k) => (
              <button
                key={it.act}
                type="button"
                onClick={() => {
                  runMenuAct(it.act);
                  bump();
                }}
                className="tw-cursor-pointer tw-truncate tw-rounded tw-border-0 tw-bg-transparent tw-px-1 tw-py-0.5 tw-text-left tw-text-[14px] tw-text-inherit hover:tw-bg-black/10 [font-family:inherit]"
              >
                <span className="tw-mr-1 tw-font-bold">{sc.menu.twoDigit ? String(k + 1).padStart(2, "0") : k === 9 ? "0" : k + 1}</span>
                {it.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (sc.k === "confirm") {
      return (
        <div className="tw-flex tw-h-full tw-flex-col tw-justify-center tw-gap-2 tw-text-[15px]">
          <div className="tw-font-bold">{sc.what === "setup" ? "Reset setup?" : sc.what === "memory" ? "Clear memory?" : "Reset all?"}</div>
          <div>{"[=] : Yes"}</div>
          <div>{"[AC] : Cancel"}</div>
        </div>
      );
    }
    if (sc.k === "grid") {
      const { rows, cols } = gridShape(sc.target);
      const first = Math.max(0, Math.min(sc.r - 1, rows - 3));
      const visible = Array.from({ length: Math.min(3, rows) }, (_, k) => first + k);
      return (
        <div className="tw-flex tw-h-full tw-flex-col tw-gap-1">
          <div className="tw-text-[11.5px] tw-font-bold">
            {sc.target === "stat" ? `STAT ${s.stat.type}` : sc.target === "eqn" ? EQN_TYPES[s.eqnKind - 1] : sc.target}
            {sc.target === "eqn" ? "   (= with an empty cell solves)" : ""}
          </div>
          <table className="tw-w-full tw-border-collapse tw-text-[14px] [font-variant-numeric:tabular-nums]">
            <thead>
              <tr>
                <th className="tw-w-6" />
                {cols.map((cName) => (
                  <th key={cName} className="tw-text-center tw-font-semibold tw-italic">{cName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r}>
                  <td className="tw-text-[11px]">{r + 1}</td>
                  {cols.map((cName, c) => {
                    const on = r === sc.r && c === sc.c;
                    return (
                      <td
                        key={cName}
                        onClick={() => {
                          s.screen = { ...sc, r, c };
                          newRow([]);
                          bump();
                        }}
                        className={`tw-cursor-pointer tw-truncate tw-px-1 tw-text-right ${on ? "tw-bg-[#1d2a1d] tw-text-[#c9d6bf]" : ""}`}
                      >
                        {fmtCell(gridGet(sc.target, r, c))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tw-mt-auto tw-min-h-[1.6em] tw-text-right tw-text-[18px]">
            {s.root.length ? <Display seq={s.root} cursor={s.cur} onPlace={place} /> : null}
          </div>
        </div>
      );
    }
    if (sc.k === "eqnres") {
      return (
        <div className="tw-flex tw-h-full tw-flex-col tw-gap-1.5 tw-overflow-y-auto tw-text-[18px]">
          {typeof sc.lines === "string" ? (
            <div className="tw-m-auto tw-font-bold">{sc.lines}</div>
          ) : (
            sc.lines.map((l) => {
              const r = show(l.value, { ...ctx(), mode: "CMPLX" });
              return (
                <div key={l.label} className="tw-flex tw-items-center tw-justify-between tw-gap-3">
                  <span className="tw-italic">{`${l.label}=`}</span>
                  {renderShown(r)}
                </div>
              );
            })
          )}
        </div>
      );
    }
    if (sc.k === "table" && sc.stage === "view") {
      return (
        <div className="tw-h-full tw-overflow-y-auto">
          <table className="tw-w-full tw-border-collapse tw-text-[14px] [font-variant-numeric:tabular-nums]">
            <thead className="tw-sticky tw-top-0 tw-bg-[#c5d1bb]">
              <tr>
                <th className="tw-w-6" />
                <th className="tw-text-right tw-italic">{"X"}</th>
                <th className="tw-text-right tw-italic">{"f(X)"}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows().map((row, k) => (
                <tr key={k}>
                  <td className="tw-text-[11px]">{k + 1}</td>
                  <td className="tw-text-right">{fmtCell(row.x)}</td>
                  <td className="tw-text-right">{row.y}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    const label =
      sc.k === "prompt"
        ? `${sc.vars[sc.idx]}?`
        : sc.k === "table"
        ? sc.stage === "f"
          ? "f(X)="
          : sc.stage === "start"
          ? "Start?"
          : sc.stage === "end"
          ? "End?"
          : "Step?"
        : null;
    const promptValue =
      sc.k === "prompt"
        ? s.vars[sc.vars[sc.idx]]
        : sc.k === "table" && sc.stage !== "f"
        ? s.table[sc.stage as "start" | "end" | "step"]
        : null;
    return (
      <div className="tw-flex tw-h-full tw-flex-col">
        <div
          className="tw-min-h-[2.4em] tw-flex-1 tw-cursor-text tw-overflow-x-auto tw-overflow-y-hidden tw-text-[20px] tw-leading-[1.25]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) place({ seq: s.root, i: s.root.length });
          }}
        >
          {label ? <span className="tw-mr-1 tw-text-[0.8em] tw-font-semibold">{label}</span> : null}
          {s.error ? <span className="tw-sr-only">{"Error"}</span> : null}
          <Display seq={s.root} cursor={s.done || s.error ? null : s.cur} onPlace={place} />
        </div>
        <div className="tw-flex tw-min-h-[1.8em] tw-shrink-0 tw-items-end tw-justify-end tw-gap-2 tw-overflow-x-auto tw-overflow-y-hidden tw-pb-0.5 tw-text-[24px] tw-leading-tight">
          {s.error ? (
            <span className="tw-flex tw-w-full tw-flex-col tw-text-[15px]">
              <b className="tw-text-[19px]">{s.error}</b>
              <span>{"[AC] : Cancel   [◀][▶] : Goto"}</span>
            </span>
          ) : s.result ? (
            <>
              {s.note ? <span className="tw-mr-auto tw-self-start tw-text-[13px]">{s.note}</span> : null}
              {renderShown(s.result)}
            </>
          ) : promptValue !== null && promptValue !== undefined && !s.root.length ? (
            renderShown(show(promptValue, ctx()))
          ) : s.note ? (
            <span className="tw-text-[13px]">{s.note}</span>
          ) : null}
        </div>
      </div>
    );
  };

  const keyCls = (k: KeyDef) => {
    const base = "tw-relative tw-flex tw-w-full tw-cursor-pointer tw-select-none tw-items-center tw-justify-center tw-rounded-[9px] tw-border-0 tw-font-semibold tw-shadow-[0_2px_0_rgba(0,0,0,0.45)] active:tw-translate-y-[1px] active:tw-shadow-none [font-family:inherit]";
    if (k.kind === "num") return `${base} tw-h-[46px] tw-bg-[#e6e8ec] tw-text-[19px] tw-text-[#1d2026] hover:tw-bg-white mobile:tw-h-[42px]`;
    if (k.kind === "op") return `${base} tw-h-[46px] tw-bg-[#e6e8ec] tw-text-[22px] tw-text-[#1d2026] hover:tw-bg-white mobile:tw-h-[42px]`;
    if (k.kind === "red") return `${base} tw-h-[46px] tw-bg-[#e5733a] tw-text-[16px] tw-text-white hover:tw-brightness-110 mobile:tw-h-[42px]`;
    return `${base} tw-h-[32px] tw-bg-[#3a3e47] tw-text-[13.5px] tw-text-white hover:tw-bg-[#4a4f5a] mobile:tw-h-[30px]`;
  };

  const keyEl = (k: KeyDef) => (
    <div key={k.id} className="tw-flex tw-min-w-0 tw-flex-col tw-items-stretch">
      <div className="tw-flex tw-h-[15px] tw-items-end tw-justify-between tw-gap-0.5 tw-px-0.5 tw-text-[9.5px] tw-font-semibold tw-leading-none">
        <span className={`tw-whitespace-nowrap tw-text-[#f0b429] ${(k.shift || "").length > 6 ? "tw-text-[8px]" : ""}`}>{k.shift || ""}</span>
        <span className={`tw-whitespace-nowrap tw-text-[#ff6b6b] ${(k.alpha || "").length > 4 ? "tw-text-[8px]" : ""}`}>{k.alpha || ""}</span>
      </div>
      <button type="button" className={keyCls(k)} onMouseDown={(e) => e.preventDefault()} onClick={() => press(k)} aria-label={k.label}>
        {k.label}
      </button>
    </div>
  );

  const small = (id: string, label: string, cls: string, extra?: React.ReactNode) => (
    <div className="tw-flex tw-flex-col tw-items-stretch">
      <div className="tw-flex tw-h-[15px] tw-items-end tw-justify-center tw-text-[9.5px] tw-font-semibold tw-leading-none tw-text-[#f0b429]">{extra}</div>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => press(id)} className={`tw-h-[32px] tw-cursor-pointer tw-rounded-[9px] tw-border-0 tw-text-[12.5px] tw-font-bold tw-shadow-[0_2px_0_rgba(0,0,0,0.45)] active:tw-translate-y-[1px] mobile:tw-h-[30px] [font-family:inherit] ${cls}`}>
        {label}
      </button>
    </div>
  );

  const pad = (id: string, label: string, cls: string) => (
    <button
      type="button"
      aria-label={id.toLowerCase()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => press(id)}
      className={`tw-absolute tw-flex tw-cursor-pointer tw-items-center tw-justify-center tw-border-0 tw-bg-transparent tw-text-[13px] tw-text-white/85 hover:tw-text-white ${cls}`}
    >
      {label}
    </button>
  );

  const style: React.CSSProperties = { ...(pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : {}), ...(hidden ? { display: "none" } : {}) };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label="Calculator"
      style={style}
      className="tw-fixed tw-bottom-5 tw-right-5 tw-z-[70] tw-flex tw-max-h-[calc(100dvh-24px)] tw-w-[408px] tw-flex-col tw-overflow-hidden tw-rounded-[22px] tw-bg-[#24272e] tw-text-white tw-shadow-[0_24px_60px_rgba(0,0,0,0.45)] tw-outline-none mobile:tw-bottom-0 mobile:tw-left-0 mobile:tw-right-0 mobile:tw-top-auto mobile:tw-w-full mobile:tw-rounded-b-none [font-family:inherit]"
    >
      {/* Title bar: drag to move it off the question. */}
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={() => (drag.current = null)}
        className="tw-flex tw-cursor-move tw-items-center tw-justify-between tw-px-4 tw-pb-1 tw-pt-2.5 mobile:tw-cursor-default"
      >
        <span className="tw-text-[12px] tw-font-bold tw-tracking-[0.12em] tw-text-white/70">{"SCHOOLIVIO  ·  NATURAL DISPLAY"}</span>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="tw-cursor-pointer tw-rounded-full tw-border-0 tw-bg-white/10 tw-px-3 tw-py-1 tw-text-[12.5px] tw-font-semibold tw-text-white hover:tw-bg-white/20 [font-family:inherit]"
        >
          {"Hide"}
        </button>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2 tw-overflow-y-auto tw-px-3.5 tw-pb-3.5">
        {/* The screen. */}
        <div className="tw-rounded-[10px] tw-border-[3px] tw-border-solid tw-border-[#14161a] tw-bg-[#c5d1bb] tw-px-3 tw-pb-2 tw-pt-1 tw-text-[#16201a] tw-shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)]">
          <div className="tw-flex tw-h-[15px] tw-gap-2 tw-text-[10px] tw-font-bold tw-leading-[15px]">
            {indicators.map((x) => (
              <span key={x}>{x}</span>
            ))}
            {s.history.length && (sc.k === "main") ? <span className="tw-ml-auto">{"▲"}</span> : null}
          </div>
          <div className="tw-h-[140px] mobile:tw-h-[124px]">{lcdBody()}</div>
        </div>

        {/* SHIFT ALPHA · replay pad · MODE ON */}
        <div className="tw-grid tw-grid-cols-[1fr_1fr_2fr_1fr_1fr] tw-items-end tw-gap-2">
          {small("SHIFT", "SHIFT", "tw-bg-[#f0b429] tw-text-[#24272e]")}
          {small("ALPHA", "ALPHA", "tw-bg-[#ff6b6b] tw-text-white")}
          <div className="tw-relative tw-row-span-2 tw-h-[86px] tw-self-center tw-rounded-full tw-bg-[#3a3e47] tw-shadow-[0_2px_0_rgba(0,0,0,0.45)]">
            {pad("UP", "▲", "tw-left-1/3 tw-top-0 tw-h-1/3 tw-w-1/3")}
            {pad("DOWN", "▼", "tw-bottom-0 tw-left-1/3 tw-h-1/3 tw-w-1/3")}
            {pad("LEFT", "◀", "tw-left-0 tw-top-1/3 tw-h-1/3 tw-w-1/3")}
            {pad("RIGHT", "▶", "tw-right-0 tw-top-1/3 tw-h-1/3 tw-w-1/3")}
            <span className="tw-pointer-events-none tw-absolute tw-left-1/2 tw-top-1/2 tw--translate-x-1/2 tw--translate-y-1/2 tw-text-[8px] tw-font-bold tw-tracking-wider tw-text-white/45">{"REPLAY"}</span>
          </div>
          {small("MODE", "MODE", "tw-bg-[#3a3e47] tw-text-white", "SETUP")}
          {small("ON", "ON", "tw-bg-[#3a3e47] tw-text-white")}
          {TOP[0].map(keyEl)}
        </div>

        {TOP.slice(1).map((row, n) => (
          <div key={n} className="tw-grid tw-grid-cols-6 tw-gap-2">
            {row.map(keyEl)}
          </div>
        ))}

        <div className="tw-mt-1 tw-flex tw-flex-col tw-gap-1.5">
          {PAD.map((row, n) => (
            <div key={n} className="tw-grid tw-grid-cols-5 tw-gap-2.5">
              {row.map(keyEl)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NaturalCalculator;
