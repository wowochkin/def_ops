/**
 * Подсказка при наведении на карте просмотра (переигровка, игра, театр): ближайший к курсору знак, надпись,
 * стрелка или линия видимых слоёв в текущий момент — название и заметка кадра (численность, что делает).
 * Ищется по геометрии, а не по событиям знаков: слои просмотра закрыты, карта свободно перетаскивается.
 */
import { useEffect, useRef, useState } from 'react';
import type { Feature, MapDocument, TimeInstant } from '@def-ops/core';
import type { MapEngine } from './engine/types';
import { nearestFeature, shownFeatures } from './map-pick';

/** Заметка кадра на момент времени (последний ключевой кадр не позже него). */
function noteAt(f: Feature, t: TimeInstant | null): string | undefined {
  const k = [...(f.keyframes ?? [])].filter((x) => !t || String(x.t) <= String(t)).pop() ?? f.keyframes?.[0];
  return k?.note;
}

export function MapHover({ engine, doc, time, skip = [] }: { engine: MapEngine | null; doc: MapDocument | null; time: TimeInstant | null; skip?: string[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; title: string; note?: string } | null>(null);
  // обстановка на момент — только когда мышь над картой (при проигрывании время меняется на каждом кадре)
  const cur = useRef({ doc, time });
  cur.current = { doc, time };
  useEffect(() => {
    const host = engine?.getContainer().parentElement;
    if (!engine || !host) return;
    let cache: { doc: MapDocument; time: TimeInstant | null; feats: Feature[] } | null = null;
    const featsNow = () => {
      const { doc: d, time: t } = cur.current;
      if (!d) return [];
      if (cache && cache.doc === d && cache.time === t) return cache.feats;
      cache = { doc: d, time: t, feats: shownFeatures(d, t, skip) };
      return cache.feats;
    };
    let raf = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if ((e.target as Element).closest('.rp-tools, .legend, .player, .scalebar, .maplibregl-ctrl, .pick-hint, .cmd-notice, button, select')) { setTip(null); return; }
        const r = host.getBoundingClientRect();
        const p: [number, number] = [e.clientX - r.left, e.clientY - r.top];
        const best = nearestFeature(featsNow(), (x) => engine.project(x), p);
        setTip(best ? { x: e.clientX, y: e.clientY, title: best.name!, note: noteAt(best, cur.current.time) } : null);
      });
    };
    const leave = () => setTip(null);
    host.addEventListener('mousemove', move);
    host.addEventListener('mouseleave', leave);
    return () => { cancelAnimationFrame(raf); host.removeEventListener('mousemove', move); host.removeEventListener('mouseleave', leave); };
  }, [engine, skip.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tip) return null;
  return <div className="map-tip" style={{ left: tip.x + 14, top: tip.y + 12 }}><b>{tip.title}</b>{tip.note && <span>{tip.note}</span>}</div>;
}

/** Подписи знаков: все — как есть; «при наведении» — у знаков без текста (надписи фронтов остаются: их мало). */
export function withoutLabels(doc: MapDocument, on: boolean): MapDocument {
  if (on) return doc;
  return { ...doc, features: doc.features.map((f) => (f.kind === 'symbol' && f.style.text ? { ...f, style: { ...f.style, text: '' } } : f)) };
}
