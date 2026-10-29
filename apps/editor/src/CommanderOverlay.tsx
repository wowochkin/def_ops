/**
 * Слой на карте, пока открыта вкладка «Командующий» (по образцу AgentMark: engine.project, перерисовка на engine.on('view')):
 * действующий замысел — сплошная стрелка; варианты, проигранные «в уме», — пунктир; соперник, как его видит этот
 * командующий (по сводке с задержкой), — точки; группировки противника по его разведке — круги.
 */
import { useEffect, useState } from 'react';
import type { LngLat } from '@def-ops/core';
import type { AgentCommander, AgentTrace } from '@def-ops/sim';
import type { MapEngine } from './engine/types';
import { hqCentroid, intentOf, OBJECTIVE_AT, viewAt } from './commander-view';

type Pt = [number, number];
const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Стрелка от a к b: прямая или дугой (bend — смещение середины, px); конец укорочен под наконечник. */
function Arrow({ a, b, cls, bend = 0, label, marker, side = 1, wide = 7 }: { a: Pt; b: Pt; cls: string; bend?: number; label?: string; marker: string; side?: 1 | -1; wide?: number }) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 14) return null;
  const nx = -dy / len, ny = dx / len;
  const c: Pt = [(a[0] + b[0]) / 2 + nx * bend, (a[1] + b[1]) / 2 + ny * bend];
  const mid: Pt = [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
  const d = `M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`;
  // подпись — сбоку от середины стрелки, не на ней и не у объекта
  const lx = mid[0] + nx * 13 * side, ly = mid[1] + ny * 13 * side + 4;
  return (
    <g className={cls}>
      <path className="casing" d={d} strokeWidth={wide} />
      <path className="line" d={d} markerEnd={`url(#${marker})`} />
      {label && <text x={lx} y={ly} textAnchor="middle">{label}</text>}
    </g>
  );
}

export function CommanderOverlay({ engine, trace, c, tick, names }: { engine: MapEngine; trace: AgentTrace; c: AgentCommander; tick: number; names: Record<string, string> }) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const off = engine.on('view', () => redraw((n) => n + 1));
    const resize = () => redraw((n) => n + 1);
    window.addEventListener('resize', resize);
    return () => { off(); window.removeEventListener('resize', resize); };
  }, [engine]);
  const host = engine.getContainer().getBoundingClientRect();
  const px = (p: LngLat): Pt => engine.project(p) as Pt;
  const v = viewAt(c, tick);
  const from = hqCentroid(trace, c.hq, tick);
  const obj = c.objective ? OBJECTIVE_AT[c.objective] : undefined;
  // сплошная стрелка — действующий замысел; пунктир — варианты «в уме» последнего решения
  const d = v.decision, o = intentOf(v.decisions);
  const goal = (x: { target: LngLat | null } | null): LngLat | null => x?.target ?? obj?.at ?? null;
  const rival = v.snapshot?.picture.rival;
  const rivalFrom = rival ? hqCentroid(trace, rival.hq, rival.asOf) : null;
  const id = `cm-${c.hq}`;
  const a = from ? px(from) : null;
  return (
    <>
      <svg className="cm-overlay" style={{ left: host.left, top: host.top, width: host.width, height: host.height }}>
        <defs>
          {[['solid', '#b3261e'], ['dash', '#b3261e'], ['dot', '#d97706']].map(([k, col]) => (
            <marker key={k} id={`${id}-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={col} /></marker>
          ))}
        </defs>
        {v.snapshot?.picture.pockets.slice(0, 8).map((k, i) => { const q = px(k.center); return (
          <g key={`p${i}`} className="grp"><circle cx={q[0]} cy={q[1]} r={9 + Math.sqrt(k.enemyEst) * 3} /><text x={q[0]} y={q[1] + 3} textAnchor="middle">≈{Math.round(k.enemyEst)}</text></g>); })}
        {v.snapshot?.picture.enemyReserves.slice(0, 8).map((k, i) => { const q = px(k.at); return (
          <g key={`r${i}`} className="grp res"><circle cx={q[0]} cy={q[1]} r={8 + Math.sqrt(k.strength) * 3} /><text x={q[0]} y={q[1] + 3} textAnchor="middle">≈{Math.round(k.strength)}</text></g>); })}
        {rival && rivalFrom && obj && <Arrow a={px(rivalFrom)} b={px(obj.at)} cls="rival" marker={`${id}-dot`} wide={7} label={`${names[rival.hq] ?? rival.hq}, как его видит ${c.name.split(' ')[0]}`} />}
        {a && d && d.options.map((x, i) => {
          if (i === d.chosen || !(x.mind || x.target)) return null;
          const g = goal(x);
          return g ? <Arrow key={i} a={a} b={px(g)} cls="mind" marker={`${id}-dash`} bend={(i % 2 ? 1 : -1) * (30 + 14 * i)} label={short(x.label, 28)} side={-1} wide={5} /> : null;
        })}
        {a && o && (() => { const g = goal(o); return g ? <Arrow a={a} b={px(g)} cls="intent" marker={`${id}-solid`} label={short(o.label, 40)} wide={9} /> : null; })()}
        {a && <rect className="origin" x={a[0] - 6} y={a[1] - 6} width={12} height={12} transform={`rotate(45 ${a[0]} ${a[1]})`} />}
        {obj && <g className="obj"><circle cx={px(obj.at)[0]} cy={px(obj.at)[1]} r={13} /><text x={px(obj.at)[0]} y={px(obj.at)[1] + 28} textAnchor="middle">{obj.name}</text></g>}
      </svg>
      <div className="cm-maplegend">
        <span><i className="l-solid" />действующий замысел</span><span><i className="l-dash" />вариант, проигранный «в уме»</span>
        <span><i className="l-dot" />соперник, как его видит {c.name.split(' ')[0]}</span><span><i className="l-circ" />группировка противника по разведке</span>
      </div>
    </>
  );
}
