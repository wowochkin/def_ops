/**
 * Подсказка при наведении на карте просмотра (переигровка, игра, театр): ближайший к курсору знак, надпись,
 * стрелка или линия видимых слоёв в текущий момент — название и заметка кадра (численность, что делает).
 * Ищется по геометрии, а не по событиям знаков: слои просмотра закрыты, карта свободно перетаскивается.
 */
import { useEffect, useMemo, useState } from 'react';
import { documentAt, type Feature, type MapDocument, type TimeInstant } from '@def-ops/core';
import type { MapEngine } from './engine/types';

const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Заметка кадра на момент времени (последний ключевой кадр не позже него). */
function noteAt(f: Feature, t: TimeInstant | null): string | undefined {
  const k = [...(f.keyframes ?? [])].filter((x) => !t || String(x.t) <= String(t)).pop() ?? f.keyframes?.[0];
  return k?.note;
}

export function MapHover({ engine, doc, time, skip = [] }: { engine: MapEngine | null; doc: MapDocument | null; time: TimeInstant | null; skip?: string[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; title: string; note?: string } | null>(null);
  const shown = useMemo(() => (doc ? documentAt(doc, time) : null), [doc, time]);
  useEffect(() => {
    const host = engine?.getContainer().parentElement;
    if (!engine || !host || !shown) return;
    const vis = new Set(shown.layers.filter((l) => l.visible && !skip.includes(l.id)).map((l) => l.id));
    const feats = shown.features.filter((f) => vis.has(f.layerId) && !f.hidden && f.name);
    let raf = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if ((e.target as Element).closest('.rp-tools, .legend, .player, .scalebar, .maplibregl-ctrl, .pick-hint, .cmd-notice, button, select')) { setTip(null); return; }
        const r = host.getBoundingClientRect();
        const p: [number, number] = [e.clientX - r.left, e.clientY - r.top];
        let best: Feature | null = null, bd = 14;
        for (const f of feats) {
          let d = Infinity;
          if (f.kind === 'symbol' || f.kind === 'label') { const q = engine.project(f.at); d = Math.hypot(q[0] - p[0], q[1] - p[1]) - (f.kind === 'symbol' ? 6 : 10); }
          else if ('points' in f && f.points.length > 1) {
            const pts = f.points.map((x) => engine.project(x) as [number, number]);
            for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(p, pts[i - 1], pts[i]) - (f.kind === 'arrow' ? 6 : 2));
          }
          // знаки важнее линий: при равном расстоянии берётся знак
          if (d < bd || (best && d <= bd + 2 && f.kind === 'symbol' && best.kind !== 'symbol')) { bd = d; best = f; }
        }
        setTip(best ? { x: e.clientX, y: e.clientY, title: best.name!, note: noteAt(best, time) } : null);
      });
    };
    const leave = () => setTip(null);
    host.addEventListener('mousemove', move);
    host.addEventListener('mouseleave', leave);
    return () => { cancelAnimationFrame(raf); host.removeEventListener('mousemove', move); host.removeEventListener('mouseleave', leave); };
  }, [engine, shown, time, skip.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tip) return null;
  return <div className="map-tip" style={{ left: tip.x + 14, top: tip.y + 12 }}><b>{tip.title}</b>{tip.note && <span>{tip.note}</span>}</div>;
}

/** Подписи знаков: все — как есть; «при наведении» — у знаков без текста (надписи фронтов остаются: их мало). */
export function withoutLabels(doc: MapDocument, on: boolean): MapDocument {
  if (on) return doc;
  return { ...doc, features: doc.features.map((f) => (f.kind === 'symbol' && f.style.text ? { ...f, style: { ...f.style, text: '' } } : f)) };
}
