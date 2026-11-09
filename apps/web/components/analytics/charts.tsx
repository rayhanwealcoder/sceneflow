"use client";

import { useState, type ReactNode } from "react";

/*
 * Small SVG charts (no library). Marks are thin, hues are fixed per series (never cycled), text uses the
 * app's text tokens, and every plot has a hover layer. Colours come from --viz-* tokens in globals.css,
 * which are stepped separately for dark mode.
 */

const W = 640;
const PAD = { top: 12, right: 16, bottom: 26, left: 36 };
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, v);
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export interface Series {
  key: string;
  label: string;
  values: number[];
  /** 1..2 → --viz-1 / --viz-2 */
  slot: 1 | 2;
}

function Tooltip({ x, children }: { x: number; children: ReactNode }) {
  const left = Math.min(Math.max(0, (x / W) * 100), 100);
  return (
    <div className="viz-tip" style={{ left: `${left}%` }}>
      {children}
    </div>
  );
}

/** Line chart over categorical x (days). ≤ 2 series: legend + direct end labels, crosshair tooltip. */
export function LineChart({ labels, series, height = 200, empty }: { labels: string[]; series: Series[]; height?: number; empty: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const iw = W - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const total = series.reduce((a, s) => a + s.values.reduce((b, v) => b + v, 0), 0);
  if (!n || !total) return <div className="viz-empty muted small">{empty}</div>;

  return (
    <div className="viz-wrap">
      <div className="viz-legend small">
        {series.map((s) => (
          <span key={s.key}>
            <i className="viz-swatch" style={{ background: `var(--viz-${s.slot})` }} /> {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="viz" role="img" aria-label={series.map((s) => s.label).join(" and ")} onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        let best = 0;
        for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
        setHover(best);
      }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="viz-axis-text">
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="viz-baseline" />
        {labels.map((l, i) => (n <= 10 || i % Math.ceil(n / 8) === 0 || i === n - 1) && (
          <text key={l} x={x(i)} y={height - 8} textAnchor="middle" className="viz-axis-text">
            {l.slice(5)}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} className="viz-crosshair" />}
        {series.map((s) => (
          <g key={s.key} style={{ color: `var(--viz-${s.slot})` }}>
            <path d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {n > 1 && <text x={x(n - 1) + 6} y={y(s.values[n - 1] ?? 0) + 4} className="viz-direct" fill="currentColor">{fmt(s.values[n - 1] ?? 0)}</text>}
            {hover !== null && <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill="currentColor" className="viz-marker" />}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)}>
          <strong>{labels[hover]}</strong>
          {series.map((s) => (
            <div key={s.key}>
              <i className="viz-swatch" style={{ background: `var(--viz-${s.slot})` }} /> {s.label}: {s.values[hover] ?? 0}
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/** Engagement timeline: sessions watching each slice of the video, with scene bands underneath. */
export function TimelineChart({ values, duration, scenes, height = 180, empty }: { values: number[]; duration: number; scenes: Array<{ sceneId: string; name: string; start: number; end: number }>; height?: number; empty: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const max = niceMax(Math.max(1, ...values));
  const iw = W - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(1, n)) * iw;
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  if (!duration || !values.some((v) => v > 0)) return <div className="viz-empty muted small">{empty}</div>;
  const area = `M${x(0)},${y(0)} ` + values.map((v, i) => `L${x(i + 0.5).toFixed(1)},${y(v).toFixed(1)}`).join(" ") + ` L${x(n)},${y(0)} Z`;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i + 0.5).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const tx = (t: number) => PAD.left + (t / duration) * iw;
  const secs = (i: number) => ((i / n) * duration).toFixed(1);

  return (
    <div className="viz-wrap">
      <svg viewBox={`0 0 ${W} ${height}`} className="viz" role="img" aria-label="Viewers over the length of the video" onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        setHover(Math.min(n - 1, Math.max(0, Math.floor(((px - PAD.left) / iw) * n))));
      }}>
        {scenes.map((s, i) => (
          <g key={s.sceneId}>
            <rect x={tx(s.start)} y={PAD.top} width={Math.max(0, tx(s.end) - tx(s.start))} height={ih} className={`viz-band ${i % 2 ? "alt" : ""}`} />
            {tx(s.end) - tx(s.start) > 40 && (
              <text x={tx(s.start) + 4} y={height - 8} className="viz-axis-text">
                {s.name}
              </text>
            )}
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} className="viz-grid" />
            <text x={PAD.left - 6} y={y(max * f) + 4} textAnchor="end" className="viz-axis-text">
              {fmt(Math.round(max * f))}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--viz-1)" opacity={0.18} />
        <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="viz-baseline" />
        {hover !== null && (
          <>
            <line x1={x(hover + 0.5)} x2={x(hover + 0.5)} y1={PAD.top} y2={y(0)} className="viz-crosshair" />
            <circle cx={x(hover + 0.5)} cy={y(values[hover] ?? 0)} r={4} fill="var(--viz-1)" className="viz-marker" />
          </>
        )}
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover + 0.5)}>
          <strong>
            {secs(hover)}–{secs(hover + 1)} s
          </strong>
          <div>{values[hover]} viewer{values[hover] === 1 ? "" : "s"}</div>
          {scenes.find((s) => (hover / n) * duration >= s.start && (hover / n) * duration < s.end)?.name && <div className="muted">{scenes.find((s) => (hover / n) * duration >= s.start && (hover / n) * duration < s.end)!.name}</div>}
        </Tooltip>
      )}
    </div>
  );
}

/** Funnel as thin horizontal bars: loaded → played → 25 → 50 → 75 → complete. One hue, values labelled. */
export function Funnel({ steps }: { steps: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="viz-funnel">
      {steps.map((s, i) => (
        <div key={s.label} className="viz-funnel-row small" title={`${s.label}: ${s.value}`}>
          <span className="viz-funnel-label">{s.label}</span>
          <span className="viz-funnel-track">
            <i style={{ width: `${(s.value / max) * 100}%`, background: "var(--viz-1)", opacity: 1 - i * 0.08 }} />
          </span>
          <span className="viz-funnel-value">
            {s.value}
            {i > 0 && steps[0]!.value ? <span className="muted"> · {Math.round((s.value / steps[0]!.value) * 100)}%</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
