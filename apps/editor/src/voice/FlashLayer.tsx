/**
 * Слой подсветки исполненного голосом (voice/highlight): вокруг каждой цели — светящаяся рамка тура, без притемнения
 * и подписи; место на карте — метка-пульс. Появляется и гаснет плавно (CSS), через FLASH_MS снимается. Цели меряются
 * каждый кадр, пока подсветка видна: вкладка, которую действие открыло, дорисовывается позже, карта ещё едет к месту.
 * Цель в прокручиваемом списке — прокручивается в поле зрения; место на карте под панелью голоса или легендой (или за
 * краем карты) — карта сдвигается, как у «покажи …» (showAt). Подключается в оболочке одной строкой: `<FlashLayer />`.
 */
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { COVERS, showAt } from '../engine/free-center';
import { flashMapView, flashState, onFlash, spotHidden, type HlRect } from './highlight';

const PAD = 6;
const shown = (el: Element, r: DOMRect) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
/** Первый видимый элемент по селектору (неверный селектор — нет). */
function findShown(sel: string): { el: Element; rect: DOMRect } | null {
  let list: NodeListOf<Element>;
  try { list = document.querySelectorAll(sel); } catch { return null; }
  for (const el of list) { const r = el.getBoundingClientRect(); if (shown(el, r)) return { el, rect: r }; }
  return null;
}
const rectOf = (r: DOMRect): HlRect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

type View = { frames: (HlRect & { key: string })[]; spots: { key: string; x: number; y: number }[] };

export function FlashLayer() {
  const st = useSyncExternalStore(onFlash, flashState, flashState);
  const [view, setView] = useState<View | null>(null);

  useLayoutEffect(() => {
    if (!st) { setView(null); return; }
    const scrolled = new Set<string>();
    let moved = false;
    let last = '';
    let raf = 0;
    const measure = () => {
      const frames: View['frames'] = [];
      for (const sel of st.targets) {
        const f = findShown(sel);
        if (!f) continue;
        if (!scrolled.has(sel)) { scrolled.add(sel); f.el.scrollIntoView?.({ block: 'nearest' }); }
        const r = rectOf(f.el.getBoundingClientRect());
        frames.push({ key: sel, left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD });
      }
      const spots: View['spots'] = [];
      const map = flashMapView();
      if (map) {
        const box = rectOf(map.getContainer().getBoundingClientRect());
        const covers = [...document.querySelectorAll(COVERS)].map((e) => rectOf(e.getBoundingClientRect())).filter((r) => r.width > 0 && r.height > 0);
        st.spots.forEach((at, i) => {
          const [x, y] = map.project(at);
          const p = { x: box.left + x, y: box.top + y };
          // под панелью или за краем — один раз сдвинуть карту, как «покажи …»
          if (!moved && spotHidden(p, box, covers)) { moved = true; showAt(map, at); }
          if (p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height) spots.push({ key: `${i}`, ...p });
        });
      }
      const next = { frames, spots };
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setView(next); }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [st]);

  if (!st || !view) return null;
  // найденное позже (вкладка дорисовалась) гаснет вместе с остальными: анимация — с того же начала
  const late = { animationDelay: `${-Math.min(st.ms, Date.now() - st.at)}ms` };
  return (
    <div className="hl-layer" aria-hidden="true" data-seq={st.seq} style={{ ['--hl-ms' as string]: `${st.ms}ms` }}>
      {view.frames.map((f) => <div key={`${st.seq}-${f.key}`} className="hl-frame" data-target={f.key} style={{ ...late, left: f.left, top: f.top, width: f.width, height: f.height }} />)}
      {view.spots.map((s) => <div key={`${st.seq}-s${s.key}`} className="hl-spot" style={{ ...late, left: s.x, top: s.y }} />)}
    </div>
  );
}
