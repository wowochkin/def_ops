/**
 * Линейный график по дням: несколько серий (модели), ось — дни, значение — км. Наведение — перекрестие и
 * подсказка со значениями всех серий в этот день; легенда сверху (серий больше одной), подписи концов линий.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SERIES } from './data';

export interface Series { name: string; points: { x: string; y: number }[] }

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export function LineChart({ series, unit, yLabel, height = 220, zeroLabel, xFmt = dm }: { series: Series[]; unit: string; yLabel: string; height?: number; zeroLabel?: string; xFmt?: (x: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  // ширина — по контейнеру: текст и линии не раздуваются на широком экране
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const xs = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort(), [series]);
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y)));
  const nice = (v: number) => { const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };
  const top = nice(max * 1.1);
  const H = height, L = 40, R = 130, T = 12, B = 26;
  const x = (i: number) => L + (xs.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (xs.length - 1));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const step = Math.max(1, Math.ceil(xs.length / 8));
  // подписи концов линий — раздвинуть, чтобы не наезжали
  const ends = series.map((s, k) => { const p = [...s.points].sort((a, b) => a.x.localeCompare(b.x)).pop(); return p ? { k, y: y(p.y) } : null; }).filter(Boolean) as { k: number; y: number }[];
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  const endY = new Map(ends.map((e) => [e.k, e.y]));
  return (
    <div className="mdl-chart" ref={box}>
      {series.length > 1 && <div className="mdl-legend">{series.map((s, k) => <span key={s.name}><i style={{ background: SERIES[k] }} />{s.name}</span>)}</div>}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={yLabel} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; let best = 0, bd = Infinity; xs.forEach((_, i) => { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } }); setHover(best); }}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 6} y={y(t) + 3.5} className="ax" textAnchor="end">{Math.round(t)}</text></g>)}
        {zeroLabel && <text x={W - R + 4} y={y(0) + 3.5} className="ax">{zeroLabel}</text>}
        {xs.map((d, i) => (i % step === 0 || i === xs.length - 1) && <text key={d} x={x(i)} y={H - 8} className="ax" textAnchor="middle">{xFmt(d)}</text>)}
        <text x={L} y={T - 2} className="ax">{unit}</text>
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />}
        {series.map((s, k) => {
          const pts = xs.map((d, i) => { const p = s.points.find((q) => q.x === d); return p ? [x(i), y(p.y)] : null; }).filter(Boolean) as [number, number][];
          const last = pts[pts.length - 1];
          return <g key={s.name}>
            <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={SERIES[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover != null && (() => { const p = s.points.find((q) => q.x === xs[hover]); return p ? <circle cx={x(hover)} cy={y(p.y)} r={4} fill={SERIES[k]} stroke="#fff" strokeWidth={2} /> : null; })()}
            {last && series.length <= 4 && <text x={last[0] + 6} y={(endY.get(k) ?? last[1]) + 3.5} className="lbl">{s.name.length > 22 ? `${s.name.slice(0, 21)}…` : s.name}</text>}
          </g>;
        })}
      </svg>
      {hover != null && <div className="mdl-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
        <b>{xFmt(xs[hover])}</b>
        {series.map((s, k) => { const p = s.points.find((q) => q.x === xs[hover]); return <div key={s.name}><i style={{ background: SERIES[k] }} />{s.name}: {p ? `${p.y} ${unit}` : '—'}</div>; })}
      </div>}
    </div>
  );
}
