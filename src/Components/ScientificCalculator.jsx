import React, { useEffect, useRef, useState } from "react";
import "mathlive";
import { create, all } from "mathjs";

const math = create(all, {});

/* ============================================================================
   LaTeX -> a plain expression mathjs can evaluate.
   ---------------------------------------------------------------------------
   MathLive's <math-field> edits and returns LaTeX ("natural display" is the
   editing experience; LaTeX is just its serialisation). mathjs's own parser
   understands ordinary calculator notation, not LaTeX — this bridges the two
   with a small hand-written reader rather than a generic regex substitution,
   because \frac{}{}, \sqrt{}, and nested exponents all need real brace
   matching to survive nesting (\frac{1}{\sqrt{2}} breaks under naive regex).
   ============================================================================ */

// Reads a balanced {...} group starting at s[i] === '{'. Returns [inner, next
// index]. Tolerant of an unterminated group (returns what it has) so a
// half-typed expression never throws while the student is still typing.
const readGroup = (s, i) => {
  let depth = 0;
  const start = i;
  for (; i < s.length; i += 1) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") {
      depth -= 1;
      if (depth === 0) return [s.slice(start + 1, i), i + 1];
    }
  }
  return [s.slice(start + 1), s.length];
};

const skipSpace = (s, i) => {
  while (s[i] === " " || s[i] === "\\," || s[i] === "~") i += 1;
  return i;
};

// LaTeX lets a single-character argument skip its braces entirely — and
// MathLive actually produces this shorthand on its own: typing "1/4" into a
// fraction template and it collapsing to two single digits serialises as
// \frac14, not \frac{1}{4}. Every brace-taking command below reads its
// argument through this, not readGroup directly, so that shorthand doesn't
// silently break instead of just evaluating.
const readArg = (s, i) => {
  i = skipSpace(s, i);
  if (s[i] === "{") return readGroup(s, i);
  return [s[i] || "", i + 1];
};

// Reads whatever comes right after \log_{base} as its argument — MathLive
// can hand that back wrapped as \left(...\right), as plain (...), as a bare
// {...} group, or (typing a single digit with no wrapping at all) as just
// one character. All four are legitimate depending on how the student typed
// it, so this reads whichever one is actually there instead of assuming one.
const readLogArgument = (s, i) => {
  i = skipSpace(s, i);
  if (s.startsWith("\\left(", i)) {
    const start = i + 6;
    let depth = 0;
    let j = start;
    for (; j < s.length; j += 1) {
      if (s.startsWith("\\left(", j)) depth += 1;
      else if (s.startsWith("\\right)", j) && depth === 0) break;
      else if (s.startsWith("\\right)", j)) depth -= 1;
    }
    return [s.slice(start, j), j + 7];
  }
  if (s[i] === "(") {
    let depth = 0;
    let j = i;
    for (; j < s.length; j += 1) {
      if (s[j] === "(") depth += 1;
      else if (s[j] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return [s.slice(i + 1, j), j + 1];
  }
  if (s[i] === "{") return readGroup(s, i);
  return [s[i] || "", i + 1];
};

const transformLatex = (s) => {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("\\frac", i)) {
      i = skipSpace(s, i + 5);
      const [num, i1] = readArg(s, i);
      i = skipSpace(s, i1);
      const [den, i2] = readArg(s, i);
      i = i2;
      out += `((${transformLatex(num)})/(${transformLatex(den)}))`;
    } else if (s.startsWith("\\sqrt", i)) {
      i += 5;
      if (s[i] === "[") {
        const close = s.indexOf("]", i);
        const n = s.slice(i + 1, close);
        i = skipSpace(s, close + 1);
        const [rad, i1] = readArg(s, i);
        i = i1;
        out += `nthRoot((${transformLatex(rad)}), (${transformLatex(n)}))`;
      } else {
        const [rad, i1] = readArg(s, i);
        i = i1;
        out += `sqrt(${transformLatex(rad)})`;
      }
    } else if (s.startsWith("\\left|", i)) {
      // Absolute value — find the matching \right| at the same depth.
      i += 6;
      let depth = 0;
      let j = i;
      for (; j < s.length; j += 1) {
        if (s.startsWith("\\left", j)) depth += 1;
        else if (s.startsWith("\\right|", j) && depth === 0) break;
        else if (s.startsWith("\\right", j)) depth -= 1;
      }
      out += `abs(${transformLatex(s.slice(i, j))})`;
      i = j + 7;
    } else if (s.startsWith("\\left", i)) {
      i += 5;
    } else if (s.startsWith("\\right", i)) {
      i += 6;
    } else if (s.startsWith("\\cdot", i) || s.startsWith("\\times", i)) {
      out += "*";
      i += s.startsWith("\\cdot", i) ? 5 : 6;
    } else if (s.startsWith("\\div", i)) {
      out += "/";
      i += 4;
    } else if (s.startsWith("\\pi", i)) {
      out += "pi";
      i += 3;
    } else if (
      s.startsWith("\\arcsin", i) || s.startsWith("\\arccos", i) || s.startsWith("\\arctan", i)
    ) {
      out += `a${s.substr(i + 4, 3)}`;
      i += 7;
    } else if (s.startsWith("\\sin", i) || s.startsWith("\\cos", i) || s.startsWith("\\tan", i)) {
      out += s.substr(i + 1, 3);
      i += 4;
    } else if (s.startsWith("\\ln", i)) {
      out += "log";
      i += 3;
    } else if (s.startsWith("\\log", i)) {
      i += 4;
      if (s[i] === "_") {
        // log base b of x, however x is wrapped: (log(x)/log(b)), the
        // change-of-base identity — mathjs has no logBase(b, x) of its own.
        i += 1;
        const [base, i1] = readArg(s, i);
        const [arg, i2] = readLogArgument(s, i1);
        out += `(log(${transformLatex(arg)})/log(${transformLatex(base)}))`;
        i = i2;
      } else {
        out += "log10";
      }
    } else if (s.startsWith("\\%", i)) {
      out += "/100";
      i += 2;
    } else if (s.startsWith("^", i)) {
      const [exp, i1] = readArg(s, i + 1);
      out += `^(${transformLatex(exp)})`;
      i = i1;
    } else if (s.startsWith("\\", i)) {
      // An unrecognised command (\, \! spacing, \placeholder, etc.) — drop
      // the backslash and its name rather than feeding mathjs garbage.
      i += 1;
      while (i < s.length && /[a-zA-Z]/.test(s[i])) i += 1;
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
};

// Inserts the "*" a calculator user never types but always means: 2π, 3(4+5),
// (a)(b), 2sin(x). mathjs's parser requires it explicitly.
//
// The digit-then-"(" rule has one real function-name collision: transformLatex
// emits log10(...) for \log, and naively this regex sees "0(" and inserts
// log10*(...) — multiplying the log10 *function* by its own argument, which
// mathjs rejects outright. Guarded by name since it's the one function name
// this codebase emits that ends in a digit right before a call.
const insertImplicitMultiplication = (expr) =>
  expr
    .replace(/(\d)(\s*)([a-zA-Z(])/g, "$1*$3")
    .replace(/(\))(\s*)([a-zA-Z0-9(])/g, "$1*$3")
    .replace(/log10\*\(/g, "log10(");

// Wraps every call to fnNames' arguments (deg->rad) or every call's result
// (rad->deg for inverse trig) — needs real paren matching since the
// argument can itself contain parens.
const wrapFnArgs = (expr, fnNames, wrap) => {
  let out = expr;
  for (const fn of fnNames) {
    let idx = 0;
    while ((idx = out.indexOf(`${fn}(`, idx)) !== -1) {
      const openAt = idx + fn.length;
      let depth = 0;
      let j = openAt;
      for (; j < out.length; j += 1) {
        if (out[j] === "(") depth += 1;
        else if (out[j] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const inner = out.slice(openAt + 1, j);
      const replacement = wrap(fn, inner);
      out = out.slice(0, idx) + replacement + out.slice(j + 1);
      idx += replacement.length;
    }
  }
  return out;
};

const DIRECT_TRIG = ["sin", "cos", "tan"];
const INVERSE_TRIG = ["asin", "acos", "atan"];

// A definite integral is handled as its own top-level case (Simpson's rule)
// rather than folded into the general reader — mathjs has no integral
// operator, and a numeric approximation only makes sense for the whole
// expression, not embedded arbitrarily inside a larger one.
const INTEGRAL_RE = /^\\int_\{([^{}]*)\}\^\{([^{}]*)\}(.*)$/;

export const evaluateLatex = (latex, angleMode) => {
  const trimmed = latex.trim();
  if (!trimmed) return null;

  const integralMatch = trimmed.match(INTEGRAL_RE);
  if (integralMatch) {
    const [, lowerLatex, upperLatex, rest] = integralMatch;
    const dMatch = rest.match(/^(.*)\\,?\s*d([a-zA-Z])\s*$/) || rest.match(/^(.*)d([a-zA-Z])\s*$/);
    if (!dMatch) throw new Error("Write an integral as ∫ₐᵇ f(x) dx.");
    const [, integrandLatex, variable] = dMatch;
    const lower = evaluateLatex(lowerLatex, angleMode);
    const upper = evaluateLatex(upperLatex, angleMode);
    const integrandExpr = prepareExpression(transformLatex(integrandLatex), angleMode);
    const compiled = math.compile(integrandExpr);
    const f = (x) => compiled.evaluate({ [variable]: x, pi: Math.PI, e: Math.E });
    return simpson(f, lower, upper, 400);
  }

  const expr = prepareExpression(transformLatex(trimmed), angleMode);
  const value = math.evaluate(expr);
  return typeof value === "object" && value !== null && "re" in value ? value.re : value;
};

const prepareExpression = (rawExpr, angleMode) => {
  let expr = insertImplicitMultiplication(rawExpr);
  if (angleMode === "deg") {
    expr = wrapFnArgs(expr, DIRECT_TRIG, (fn, inner) => `${fn}((${inner})*pi/180)`);
    expr = wrapFnArgs(expr, INVERSE_TRIG, (fn, inner) => `(${fn}(${inner})*180/pi)`);
  }
  return expr;
};

function simpson(f, a, b, n) {
  const steps = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / steps;
  let sum = f(a) + f(b);
  for (let i = 1; i < steps; i += 1) {
    sum += f(a + i * h) * (i % 2 === 0 ? 2 : 4);
  }
  return (sum * h) / 3;
}

/* ============================================================================
   The widget
   ============================================================================ */

const BUTTON_ROWS = [
  [["shift", "Shift", "shift"], ["deg", "DEG", "modebtn"], ["(", "(", "op"], [")", ")", "op"], ["AC", "AC", "clear"], ["DEL", "DEL", "clear"]],
  [["x^2", "x²", "fn"], ["x^{}", "xⁿ", "fn"], ["sqrt{}", "√", "fn"], ["frac{}{}", "a/b", "fn"], ["sin(", "sin", "fn"], ["cos(", "cos", "fn"]],
  [["7", "7", "digit"], ["8", "8", "digit"], ["9", "9", "digit"], ["/", "÷", "op"], ["tan(", "tan", "fn"], ["log(", "log", "fn"]],
  [["4", "4", "digit"], ["5", "5", "digit"], ["6", "6", "digit"], ["*", "×", "op"], ["ln(", "ln", "fn"], ["!", "x!", "fn"]],
  [["1", "1", "digit"], ["2", "2", "digit"], ["3", "3", "digit"], ["-", "−", "op"], ["pi", "π", "fn"], ["%", "%", "fn"]],
  [["0", "0", "digit"], [".", ".", "digit"], ["Ans", "Ans", "fn"], ["+", "+", "op"], ["int", "∫", "fn"], ["=", "=", "equals"]],
];

const SHIFT_MAP = {
  "x^2": ["sqrt{}", "√"],
  "sin(": ["arcsin(", "sin⁻¹"],
  "cos(": ["arccos(", "cos⁻¹"],
  "tan(": ["arctan(", "tan⁻¹"],
  "log(": ["10^{}", "10ˣ"],
  "ln(": ["e^{}", "eˣ"],
};

// One panel: an editable natural-display expression on top, the evaluated
// result underneath — the same two-line reading the reference calculator
// uses, so "what am I computing" and "what did it come out to" are never the
// same line fighting for space.
const ScientificCalculator = ({ onClose }) => {
  const fieldRef = useRef(null);
  const [latex, setLatex] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [angleMode, setAngleMode] = useState("deg");
  const [shifted, setShifted] = useState(false);
  const [lastAnswer, setLastAnswer] = useState(0);

  useEffect(() => {
    const mf = fieldRef.current;
    if (!mf) return undefined;
    mf.mathVirtualKeyboardPolicy = "off";
    mf.smartFence = true;
    const onInput = () => setLatex(mf.value);
    mf.addEventListener("input", onInput);
    return () => mf.removeEventListener("input", onInput);
  }, []);

  const press = (token) => {
    const mf = fieldRef.current;
    if (!mf) return;
    mf.focus();
    if (token === "AC") {
      mf.value = "";
      setLatex("");
      setResult(null);
      setError("");
      return;
    }
    if (token === "DEL") {
      mf.executeCommand("deleteBackward");
      setLatex(mf.value);
      return;
    }
    if (token === "shift") {
      setShifted((v) => !v);
      return;
    }
    if (token === "deg") {
      setAngleMode((m) => (m === "deg" ? "rad" : "deg"));
      return;
    }
    if (token === "=") {
      evaluate();
      return;
    }
    if (token === "Ans") {
      mf.insert(String(lastAnswer));
      setLatex(mf.value);
      return;
    }
    if (token === "int") {
      mf.insert("\\int_{#0}^{#1}#2\\,d#3");
      setLatex(mf.value);
      return;
    }
    if (token === "x^2") {
      mf.insert("^{2}");
    } else if (token === "x^{}") {
      mf.insert("^{#0}");
    } else if (token === "sqrt{}") {
      mf.insert("\\sqrt{#0}");
    } else if (token === "frac{}{}") {
      mf.insert("\\frac{#0}{#1}");
    } else if (["sin(", "cos(", "tan("].includes(token)) {
      mf.insert(`\\${token}`);
    } else if (["arcsin(", "arccos(", "arctan("].includes(token)) {
      mf.insert(`\\${token}`);
    } else if (token === "log(") {
      mf.insert("\\log(#0)");
    } else if (token === "10^{}") {
      mf.insert("10^{#0}");
    } else if (token === "ln(") {
      mf.insert("\\ln(#0)");
    } else if (token === "e^{}") {
      mf.insert("e^{#0}");
    } else if (token === "pi") {
      mf.insert("\\pi");
    } else if (token === "!") {
      mf.insert("!");
    } else if (token === "%") {
      mf.insert("\\%");
    } else if (token === "*") {
      mf.insert("\\times");
    } else if (token === "/") {
      mf.insert("\\div");
    } else {
      mf.insert(token);
    }
    setShifted(false);
    setLatex(mf.value);
  };

  const evaluate = () => {
    setError("");
    try {
      const value = evaluateLatex(latex, angleMode);
      if (value === null || Number.isNaN(value)) {
        setResult(null);
        return;
      }
      const rounded = Math.round(value * 1e10) / 1e10;
      setResult(rounded);
      setLastAnswer(rounded);
    } catch (err) {
      setError(err.message || "Can't work that out — check the expression.");
      setResult(null);
    }
  };

  const labelFor = (token, label) => {
    if (shifted && SHIFT_MAP[token]) return SHIFT_MAP[token][1];
    return label;
  };
  const tokenFor = (token) => (shifted && SHIFT_MAP[token] ? SHIFT_MAP[token][0] : token);

  return (
    <div className="calc-shell" role="dialog" aria-label="Scientific calculator">
      <div className="calc-bar">
        <span>{"Calculator"}</span>
        <button type="button" className="calc-close" onClick={onClose} aria-label="Close calculator">{"✕"}</button>
      </div>

      <div className="calc-display">
        <div className="calc-mode-row">
          <span className={`calc-mode ${angleMode}`}>{angleMode.toUpperCase()}</span>
          {shifted ? <span className="calc-mode shift">{"SHIFT"}</span> : null}
        </div>
        <math-field ref={fieldRef} className="calc-field" onKeyDown={(e) => e.key === "Enter" && evaluate()} />
        <div className="calc-result">
          {error ? <span className="calc-error">{error}</span> : result !== null ? result : " "}
        </div>
      </div>

      <div className="calc-pad">
        {BUTTON_ROWS.map((row, ri) => (
          <div className="calc-row" key={ri}>
            {row.map(([token, label, kind]) => (
              <button
                key={token}
                type="button"
                className={`calc-btn calc-${kind}${token === "shift" && shifted ? " active" : ""}`}
                onClick={() => press(tokenFor(token))}
              >
                {labelFor(token, label)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScientificCalculator;
