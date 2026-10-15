import React from "react";
import { isBox, type Box, type Cursor, type Seq } from "./tree";

// Draws a row the way the calculator's screen does: fractions stacked, roots
// with their bar, powers raised, integrals and sums with their limits. With
// a cursor, the blinking bar sits where the next key goes, and tapping a
// symbol (or an empty box) moves the cursor there.

const LABEL: Record<string, string> = {
  "-": "−",
  neg: "−",
  "×": "×",
  "÷": "÷",
  nPr: "P",
  nCr: "C",
  dms: "°",
  "×10": "×10",
  and: " and ",
  or: " or ",
  xor: " xor ",
  xnor: " xnor ",
  ",": ",",
};

export const tokenLabel = (v: string) => {
  if (LABEL[v]) return LABEL[v];
  if (v.startsWith("const:")) return v.slice(6);
  if (v.startsWith("conv:")) return v.slice(5);
  if (v.startsWith("stat:")) return v.slice(5);
  return v;
};

const ITALIC = /^([A-FXYM]|e|i|const:.*)$/;

type Props = {
  seq: Seq;
  cursor?: Cursor | null;
  onPlace?: (c: Cursor) => void;
};

const Caret = () => <span aria-hidden="true" className="calc-caret tw-mx-[-1px] tw-inline-block tw-h-[1.05em] tw-w-[2px] tw-translate-y-[0.12em] tw-bg-current" />;

const Slot = ({ seq, cursor, onPlace, className = "" }: Props & { className?: string }) => {
  const here = !!cursor && cursor.seq === seq;
  if (!seq.length) {
    return (
      <span
        className={`tw-inline-flex tw-items-center ${className}`}
        onMouseDown={(e) => {
          if (!onPlace) return;
          e.preventDefault();
          e.stopPropagation();
          onPlace({ seq, i: 0 });
        }}
      >
        {here ? <Caret /> : null}
        <span className="tw-inline-block tw-h-[0.85em] tw-w-[0.62em] tw-border tw-border-dashed tw-border-current tw-opacity-55" />
      </span>
    );
  }
  return (
    <span className={`tw-inline-flex tw-items-center tw-whitespace-nowrap ${className}`}>
      {seq.map((n, k) => (
        <React.Fragment key={k}>
          {here && cursor!.i === k ? <Caret /> : null}
          {isBox(n) ? (
            <BoxView node={n} cursor={cursor} onPlace={onPlace} />
          ) : (
            <span
              className={ITALIC.test(n.v) ? "tw-italic" : ""}
              onMouseDown={(e) => {
                if (!onPlace) return;
                e.preventDefault();
                e.stopPropagation();
                onPlace({ seq, i: k + 1 });
              }}
            >
              {tokenLabel(n.v)}
            </span>
          )}
        </React.Fragment>
      ))}
      {here && cursor!.i === seq.length ? <Caret /> : null}
    </span>
  );
};

const small = "tw-text-[0.72em]";

const BoxView = ({ node, cursor, onPlace }: { node: Box } & Omit<Props, "seq">) => {
  const p = { cursor, onPlace };
  const [a, b, c] = node.s;
  switch (node.t) {
    case "frac":
      return <Frac top={<Slot seq={a} {...p} />} bottom={<Slot seq={b} {...p} />} />;
    case "mixed":
      return (
        <span className="tw-inline-flex tw-items-center">
          <Slot seq={a} {...p} />
          <Frac top={<Slot seq={b} {...p} />} bottom={<Slot seq={c} {...p} />} />
        </span>
      );
    case "sqrt":
      return <Radical body={<Slot seq={a} {...p} />} />;
    case "root":
      return <Radical index={<Slot seq={a} {...p} className={small} />} body={<Slot seq={b} {...p} />} />;
    case "pow":
      return <Slot seq={a} {...p} className={`${small} tw-mb-[0.9em] tw-self-start`} />;
    case "e10":
      return (
        <span className="tw-inline-flex tw-items-center">
          {"×10"}
          <Slot seq={a} {...p} className={`${small} tw-mb-[0.9em] tw-self-start`} />
        </span>
      );
    case "logb":
      return (
        <span className="tw-inline-flex tw-items-center">
          {"log"}
          <Slot seq={a} {...p} className={`${small} tw-mt-[0.8em] tw-self-end`} />
          {"("}
          <Slot seq={b} {...p} />
          {")"}
        </span>
      );
    case "abs":
      return (
        <span className="tw-inline-flex tw-items-stretch">
          <span className="tw-mx-[1px] tw-w-[1.5px] tw-bg-current" />
          <Slot seq={a} {...p} className="tw-px-[2px]" />
          <span className="tw-mx-[1px] tw-w-[1.5px] tw-bg-current" />
        </span>
      );
    case "int":
      return (
        <span className="tw-inline-flex tw-items-center">
          <span className="tw-text-[1.5em] tw-leading-none">{"∫"}</span>
          <span className={`tw-mr-[2px] tw-inline-flex tw-flex-col tw-justify-between tw-self-stretch ${small}`}>
            <Slot seq={c} {...p} />
            <Slot seq={b} {...p} />
          </span>
          <Slot seq={a} {...p} />
          <span className="tw-ml-[3px]">{"dx"}</span>
        </span>
      );
    case "ddx":
      return (
        <span className="tw-inline-flex tw-items-center">
          <Frac top={<span>{"d"}</span>} bottom={<span>{"dx"}</span>} />
          {"("}
          <Slot seq={a} {...p} />
          {")"}
          <span className="tw-mx-[2px] tw-w-[1.5px] tw-self-stretch tw-bg-current" />
          <span className={`tw-self-end ${small} tw-inline-flex tw-items-center`}>
            <span className="tw-italic">{"x"}</span>
            {"="}
            <Slot seq={b} {...p} />
          </span>
        </span>
      );
    case "sum":
      return (
        <span className="tw-inline-flex tw-items-center">
          <span className={`tw-inline-flex tw-flex-col tw-items-center ${small}`}>
            <Slot seq={c} {...p} />
            <span className="tw-text-[1.9em] tw-leading-[0.9]">{"Σ"}</span>
            <span className="tw-inline-flex tw-items-center">
              <span className="tw-italic">{"x"}</span>
              {"="}
              <Slot seq={b} {...p} />
            </span>
          </span>
          {"("}
          <Slot seq={a} {...p} />
          {")"}
        </span>
      );
    default:
      return null;
  }
};

const Frac = ({ top, bottom }: { top: React.ReactNode; bottom: React.ReactNode }) => (
  <span className="tw-mx-[2px] tw-inline-flex tw-flex-col tw-items-center tw-align-middle tw-text-[0.92em]">
    <span className="tw-px-[2px] tw-pb-[1px]">{top}</span>
    <span className="tw-h-[1.5px] tw-w-full tw-bg-current" />
    <span className="tw-px-[2px] tw-pt-[1px]">{bottom}</span>
  </span>
);

const Radical = ({ index, body }: { index?: React.ReactNode; body: React.ReactNode }) => (
  <span className="tw-inline-flex tw-items-end">
    {index ? <span className="tw-mb-[0.7em] tw-mr-[-0.35em]">{index}</span> : null}
    <span className="tw-text-[1.1em] tw-leading-none">{"√"}</span>
    <span className="tw-border-0 tw-border-t-[1.5px] tw-border-solid tw-border-current tw-pl-[1px] tw-pt-[1px]">{body}</span>
  </span>
);

// An empty screen shows just the cursor, not an empty box.
const Display = ({ seq, cursor, onPlace }: Props) =>
  seq.length ? <Slot seq={seq} cursor={cursor} onPlace={onPlace} /> : cursor && cursor.seq === seq ? <Caret /> : null;

export default Display;
