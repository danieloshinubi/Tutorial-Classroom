import React, { useLayoutEffect, useRef, useState } from "react";

// Charts the assistant draws (show_chart): bar, line or pie, as plain SVG so
// nothing extra ships. The first series takes the school's own colour.
const COLORS = ["var(--brand)", "#e0913a", "#3a8fd9", "#8a63d2"];

const short = (n) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(v * 100) / 100);
};

const full = (n, unit) => {
  const v = (Number(n) || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
  if (!unit) return v;
  if (unit === "%") return `${v}%`;
  // A symbol (₦, $) goes in front; a word the model chose ("count",
  // "pupils") read as "count2", so words are left off.
  return /[A-Za-z]/.test(unit) ? v : `${unit}${v}`;
};

const niceMax = (max) => {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

const Pie = ({ chart }) => {
  const values = chart.series[0].values.map((v) => Math.max(0, Number(v) || 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  let angle = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const a0 = angle;
    const a1 = angle + (v / total) * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a) => `${100 + 80 * Math.cos(a)} ${100 + 80 * Math.sin(a)}`;
    const d = values.length === 1 ? "M100 20 A80 80 0 1 1 99.99 20 Z" : `M100 100 L${p(a0)} A80 80 0 ${large} 1 ${p(a1)} Z`;
    return { d, i, v };
  });
  const palette = (i) => (i < COLORS.length ? COLORS[i] : `hsl(${(i * 67) % 360} 55% 55%)`);
  return (
    <div className="ai-pie">
      <svg viewBox="0 0 200 200" role="img" aria-label={chart.title}>
        {slices.map((s) => (
          <path key={s.i} d={s.d} fill={palette(s.i)} stroke="var(--surface)" strokeWidth="1.5">
            <title>{`${chart.labels[s.i]}: ${full(s.v, chart.unit)}`}</title>
          </path>
        ))}
      </svg>
      <ul className="ai-legend">
        {slices.map((s) => (
          <li key={s.i}>
            <i style={{ background: palette(s.i) }} />
            <span>{chart.labels[s.i]}</span>
            <b>{`${full(s.v, chart.unit)} · ${Math.round((s.v / total) * 100)}%`}</b>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Drawn at the width it is shown at, so labels stay readable on a phone
// instead of shrinking with a fixed-size drawing.
const useWidth = (fallback) => {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};

const Cartesian = ({ chart }) => {
  const [ref, W] = useWidth(520);
  const H = 220;
  const left = 44;
  const bottom = 46;
  const top = 12;
  const plotW = W - left - 10;
  const plotH = H - top - bottom;
  const all = chart.series.flatMap((s) => s.values.map(Number)).filter((n) => !Number.isNaN(n));
  const max = niceMax(Math.max(0, ...all));
  const y = (v) => top + plotH - (Math.max(0, Number(v) || 0) / max) * plotH;
  const n = chart.labels.length;
  const band = plotW / Math.max(1, n);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const everyNth = Math.ceil(n / 12);

  return (
    <div ref={ref}>
    <svg className="ai-cart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={chart.title}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - 10} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={left - 6} y={y(t) + 4} textAnchor="end" className="ai-axis">
            {short(t)}
          </text>
        </g>
      ))}
      {chart.labels.map((label, i) =>
        i % everyNth === 0 ? (
          <text
            key={label + i}
            x={left + band * i + band / 2}
            y={H - bottom + 16}
            textAnchor={n > 6 ? "end" : "middle"}
            transform={n > 6 ? `rotate(-35 ${left + band * i + band / 2} ${H - bottom + 16})` : undefined}
            className="ai-axis"
          >
            {label.length > 14 ? `${label.slice(0, 13)}…` : label}
          </text>
        ) : null
      )}
      {chart.type === "line"
        ? chart.series.map((s, si) => {
            const pts = s.values.map((v, i) => `${left + band * i + band / 2},${y(v)}`).join(" ");
            return (
              <g key={s.name + si}>
                <polyline points={pts} fill="none" stroke={COLORS[si]} strokeWidth="2.2" strokeLinejoin="round" />
                {s.values.map((v, i) => (
                  <circle key={i} cx={left + band * i + band / 2} cy={y(v)} r="3" fill={COLORS[si]}>
                    <title>{`${s.name ? `${s.name} · ` : ""}${chart.labels[i]}: ${full(v, chart.unit)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })
        : chart.series.map((s, si) => {
            const groupW = band * 0.72;
            const barW = groupW / chart.series.length;
            return s.values.map((v, i) => (
              <rect
                key={`${si}-${i}`}
                x={left + band * i + (band - groupW) / 2 + barW * si}
                y={y(v)}
                width={Math.max(1, barW - 2)}
                height={Math.max(0, top + plotH - y(v))}
                rx="3"
                fill={COLORS[si]}
              >
                <title>{`${s.name ? `${s.name} · ` : ""}${chart.labels[i]}: ${full(v, chart.unit)}`}</title>
              </rect>
            ));
          })}
    </svg>
    </div>
  );
};

const Chart = ({ chart }) => (
  <figure className="ai-chart">
    <figcaption>{chart.title}</figcaption>
    {chart.type === "pie" ? <Pie chart={chart} /> : <Cartesian chart={chart} />}
    {chart.type !== "pie" && chart.series.length > 1 ? (
      <ul className="ai-legend inline">
        {chart.series.map((s, i) => (
          <li key={s.name + i}>
            <i style={{ background: COLORS[i] }} />
            <span>{s.name}</span>
          </li>
        ))}
      </ul>
    ) : null}
  </figure>
);

export default Chart;
