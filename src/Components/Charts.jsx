import React, { useId, useState } from "react";

// Categorical hues, validated for colour-vision deficiency against both the
// light and dark chart surfaces. Assigned in fixed order, never cycled.
// Series are always direct-labelled or legended as well, so identity never
// rests on colour alone.
export const SERIES = ["var(--c1)", "var(--c2)", "var(--c3)"];

const fmt = (n) => (n === null || n === undefined ? "—" : `${n}%`);

/* ------------------------------------------------------------------ tooltip */
const useTooltip = () => {
  const [tip, setTip] = useState(null);
  const node = tip ? (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.title}</strong>
      {tip.lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  ) : null;
  return [node, setTip];
};

/* -------------------------------------------------------------- stat tiles */
export const StatRow = ({ stats }) => (
  <div className="stat-row">
    {stats.map((stat) => (
      <div className="stat" key={stat.label}>
        <div className="stat-value" style={stat.tone ? { color: stat.tone } : undefined}>
          {stat.value}
        </div>
        <div className="stat-label">{stat.label}</div>
        {stat.note ? <div className="stat-note">{stat.note}</div> : null}
      </div>
    ))}
  </div>
);

/* ------------------------------------------------- horizontal bars: by course
   One measure across named categories, so a single hue and no legend — the
   title names the series. Values are direct-labelled at the end of each bar. */
export const CourseBars = ({ rows, max = 100 }) => {
  const [tip, setTip] = useTooltip();
  if (!rows.length) return null;

  const rowH = 34;
  const height = rows.length * rowH;

  return (
    <div className="chart-wrap">
      <div className="bars" style={{ height }}>
        {rows.map((row, i) => {
          const width = row.value === null ? 0 : Math.max(0, Math.min(100, (row.value / max) * 100));
          return (
            <div
              className="bar-row"
              key={row.label}
              style={{ top: i * rowH }}
              onMouseMove={(e) =>
                setTip({
                  x: e.nativeEvent.offsetX + 14,
                  y: i * rowH,
                  title: row.label,
                  lines: row.detail || [fmt(row.value)],
                })
              }
              onMouseLeave={() => setTip(null)}
            >
              <span className="bar-label">{row.label}</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${width}%`, background: row.color || "var(--c1)" }}
                />
              </span>
              <span className="bar-value">{fmt(row.value)}</span>
            </div>
          );
        })}
      </div>
      {tip}
    </div>
  );
};

/* -------------------------------------------- stacked: turned in vs missing
   Two categories of one whole. Legended, with a 2px surface gap between the
   segments so the boundary reads even when the hues do not. */
export const TurnInBar = ({ done, missing }) => {
  const total = done + missing;
  if (total === 0) return null;
  const donePct = Math.round((done / total) * 100);

  return (
    <div>
      <div className="stack">
        <span
          className="stack-seg"
          style={{ width: `${donePct}%`, background: "var(--c2)" }}
          title={`${done} turned in`}
        />
        <span
          className="stack-seg"
          style={{ width: `${100 - donePct}%`, background: "var(--c3)" }}
          title={`${missing} missing`}
        />
      </div>
      <div className="legend">
        <span className="legend-item">
          <span className="swatch" style={{ background: "var(--c2)" }} />
          {`Turned in — ${done}`}
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: "var(--c3)" }} />
          {`Missing — ${missing}`}
        </span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------- trend of every mark
   Marks in the order they happened. A crosshair and tooltip follow the
   pointer; the axis is fixed 0–100 so a run of good marks cannot be flattened
   by autoscaling. */
export const TrendLine = ({ points }) => {
  const [tip, setTip] = useTooltip();
  const gradientId = useId();

  if (points.length < 2) return null;

  const w = 640;
  const h = 200;
  const pad = { top: 12, right: 16, bottom: 26, left: 34 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const x = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (v / 100) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${pad.top + innerH} L${x(0)},${pad.top + innerH} Z`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart-svg" role="img"
           aria-label="Marks over time, as a percentage">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--c1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={w - pad.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.left - 8} y={y(v) + 4} className="axis" textAnchor="end">{v}</text>
          </g>
        ))}

        {/* 50% is the line that matters to a parent, so it is drawn, not implied. */}
        <line x1={pad.left} x2={w - pad.right} y1={y(50)} y2={y(50)} className="threshold" />

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} className="trend" />

        {points.map((p, i) => (
          <circle
            key={`${p.label}-${i}`}
            cx={x(i)}
            cy={y(p.value)}
            r="5"
            className="dot"
            onMouseEnter={() =>
              setTip({
                x: Math.min(x(i), w - 150),
                y: y(p.value) - 8,
                title: p.label,
                lines: [
                  `${p.course} · ${p.kind}`,
                  `${p.value}%`,
                  p.late ? "Submitted late" : null,
                ].filter(Boolean),
              })
            }
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      {tip}
    </div>
  );
};

/* ------------------------------------------------------- participation split
   Where the student actually speaks. A donut earns its place here only
   because the parts are few and the whole is the point. */
export const ParticipationDonut = ({ rows }) => {
  const total = rows.reduce((n, r) => n + r.value, 0);
  if (total === 0) return null;

  const size = 150;
  const r = 56;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="donut" role="img"
           aria-label="Class contributions by course">
        {rows.map((row, i) => {
          const share = row.value / total;
          const dash = share * c;
          const seg = (
            <circle
              key={row.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={SERIES[i % SERIES.length]}
              strokeWidth="18"
              strokeDasharray={`${Math.max(0, dash - 2)} ${c - dash + 2}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += dash;
          return seg;
        })}
        <text x={size / 2} y={size / 2 - 2} className="donut-total" textAnchor="middle">
          {total}
        </text>
        <text x={size / 2} y={size / 2 + 16} className="donut-cap" textAnchor="middle">
          {total === 1 ? "post" : "posts"}
        </text>
      </svg>
      <div className="legend column">
        {rows.map((row, i) => (
          <span className="legend-item" key={row.label}>
            <span className="swatch" style={{ background: SERIES[i % SERIES.length] }} />
            {`${row.label} — ${row.value}`}
          </span>
        ))}
      </div>
    </div>
  );
};
