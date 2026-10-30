/**
 * Слой разбора хода на карте, пока открыта часть «Ход» вкладки «Итоги» (по образцу CommanderOverlay: engine.project,
 * перерисовка на engine.on('view')): у каждого ключевого события — круг с номером (тот же, что в списке), у движения —
 * стрелка от начала к концу; свои — красные, противник — синие; раскрытое событие — крупнее. Щелчок по метке — то же,
 * что щелчок по событию в списке (command.debrief.event).
 */
import { useEffect, useState } from 'react';
import type { LngLat } from '@def-ops/core';
import type { KeyEvent } from '@def-ops/sim';
import type { MapEngine } from './engine/types';
import { Arrow } from './CommanderOverlay';
import { act } from './voice/registry';

type Pt = [number, number];

export function DebriefOverlay({ engine, events, open, side }: { engine: MapEngine; events: KeyEvent[]; open: number | null; side: 'su' | 'de' }) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const off = engine.on('view', () => redraw((n) => n + 1));
    const resize = () => redraw((n) => n + 1);
    window.addEventListener('resize', resize);
    return () => { off(); window.removeEventListener('resize', resize); };
  }, [engine]);
  const host = engine.getContainer().getBoundingClientRect();
  const px = (p: LngLat): Pt => engine.project(p) as Pt;
  const cls = (e: KeyEvent) => (e.side === side ? 'own' : 'foe');
  // раскрытое — последним: поверх остальных
  const order = events.map((_, i) => i).sort((a, b) => (a + 1 === open ? 1 : 0) - (b + 1 === open ? 1 : 0));
  return (
    <>
      <svg className="cm-overlay db-overlay" style={{ left: host.left, top: host.top, width: host.width, height: host.height }}>
        <defs>
          {[['own', '#b3261e'], ['foe', '#1d4ed8']].map(([k, col]) => (
            <marker key={k} id={`db-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={col} /></marker>
          ))}
        </defs>
        {order.map((i) => {
          const e = events[i], n = i + 1, big = open === n;
          return e.from && e.to ? <Arrow key={`a${e.id}`} a={px(e.from)} b={px(e.to)} cls={`db-arrow ${cls(e)}${big ? ' on' : ''}`} marker={`db-${cls(e)}`} wide={big ? 9 : 7} /> : null;
        })}
        {order.map((i) => {
          const e = events[i], n = i + 1, big = open === n, q = px(e.at), r = big ? 15 : 11;
          return <g key={`m${e.id}`} className={`db-mk ${cls(e)}${big ? ' on' : ''}`} data-hl={`debrief-mk-${n}`} onClick={() => { void act('command.debrief.event', { n }, { by: 'mouse' }); }}>
            <title>{e.title}</title>
            <circle cx={q[0]} cy={q[1]} r={r} />
            <text x={q[0]} y={q[1] + (big ? 5 : 4)} textAnchor="middle">{n}</text>
          </g>;
        })}
      </svg>
      <div className="cm-maplegend db-legend">
        <span><i className="db-l own" />свои: событие и движение</span><span><i className="db-l foe" />противник</span><span>номер — событие в списке «Итогов»</span>
      </div>
    </>
  );
}
