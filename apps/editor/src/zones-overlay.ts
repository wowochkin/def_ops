/**
 * Зоны влияния сторон на карте «Командования»: сетка из расчёта (TurnView.zones, packages/sim/src/zones.ts) —
 * картинкой поверх подложки, под знаками: свои — красноватые, противник — голубоватые (цвета знаков сторон),
 * прозрачно (не больше ZONE_ALPHA, у противника — ZONE_ALPHA_ENEMY), спорное — без цвета. Картинка растягивается картой с плавной интерполяцией —
 * края мягкие. За ход зоны меняются плавно: от начала хода к концу — переход от зон на начало к зонам на конец
 * (видно при проигрывании хода в разборе).
 */
import type { ImageOverlay } from '@def-ops/core';
import type { ZoneGrid } from '@def-ops/sim';

/** Свои — цвет знаков (#d43834); противник — насыщенный голубой (оттенок знаков #2f6fae на пергаменте терялся). */
export const ZONE_OWN = [212, 56, 52];
export const ZONE_ENEMY = [60, 130, 225];
/** Наибольшая непрозрачность зоны: слегка подкрашено, знаки читаются. */
export const ZONE_ALPHA = 0.17;
/** Зона противника: голубой на пергаменте бледнее красного — непрозрачность выше, чтобы читалась. */
export const ZONE_ALPHA_ENEMY = 0.24;
/** Кривая прозрачности: средние значения заметнее (бледное у края — всё же видно). */
const CURVE = 0.6;

/** Пиксели картинки (RGBA), строка за строкой с севера — как сетка. */
export function zoneRgba(z: ZoneGrid, alpha = ZONE_ALPHA, enemy = ZONE_ALPHA_ENEMY): Uint8ClampedArray {
  const px = new Uint8ClampedArray(z.cols * z.rows * 4);
  z.v.forEach((x, i) => {
    if (!x) return;
    const c = x > 0 ? ZONE_OWN : ZONE_ENEMY;
    px.set([c[0], c[1], c[2], Math.round(255 * (x > 0 ? alpha : enemy) * Math.min(1, Math.abs(x) / 100) ** CURVE)], i * 4);
  });
  return px;
}

/** Картинка зон (data: URL) — в окне браузера, стороны по выбору; без canvas (проверки в node) — null. */
export function zoneUrl(z: ZoneGrid, sides: { own: boolean; enemy: boolean } = { own: true, enemy: true }): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = z.cols; c.height = z.rows;
  const g = c.getContext('2d');
  if (!g) return null;
  g.putImageData(new ImageData(zoneRgba(z, sides.own ? ZONE_ALPHA : 0, sides.enemy ? ZONE_ALPHA_ENEMY : 0) as unknown as Uint8ClampedArray<ArrayBuffer>, z.cols, z.rows), 0, 0);
  return c.toDataURL('image/png');
}

const ms = (t: string) => Date.parse(`${t}Z`);
const corners = (z: ZoneGrid): ImageOverlay['corners'] => { const [w, s, e, n] = z.bbox; return [[w, n], [e, n], [e, s], [w, s]]; };

/**
 * Наложения зон на время карты time: ход — от from до to; раньше начала хода — зон нет (их считали только на этот ход);
 * в течение хода — переход от зон на начало (prev) к зонам на конец (cur), шагом 5 %.
 */
export function zoneOverlays(o: { cur: ZoneGrid | null; prev: ZoneGrid | null; urls: { cur: string | null; prev: string | null }; from: string; to: string; time: string | null; on: boolean }): ImageOverlay[] {
  if (!o.on || !o.cur || !o.urls.cur || !o.time || ms(o.time) < ms(o.from)) return [];
  const full: ImageOverlay = { id: 'zones', name: 'Зоны влияния сторон', url: o.urls.cur, corners: corners(o.cur), opacity: 1, visible: true };
  // начала хода нет (первый ход) — зоны на конец, когда время карты дошло до конца хода
  if (!o.prev || !o.urls.prev) return ms(o.time) >= ms(o.to) ? [full] : [];
  const span = ms(o.to) - ms(o.from);
  const f = span <= 0 ? 1 : Math.round(Math.min(1, Math.max(0, (ms(o.time) - ms(o.from)) / span)) * 20) / 20;
  const out: ImageOverlay[] = [];
  if (f < 1) out.push({ id: 'zones-prev', name: 'Зоны влияния сторон на начало хода', url: o.urls.prev, corners: corners(o.prev), opacity: 1 - f, visible: true });
  if (f > 0) out.push({ ...full, opacity: f });
  return out;
}

/**
 * Зоны «Переигровки» на время time: кадры — снимки через сутки и последний. Между кадрами k и k+1 — переход от k (prev)
 * к k+1 (cur); до первого кадра — первый кадр; после последнего —
 * только последний (prev — нет, from = to = его время); кадров нет — cur: null.
 */
export function zonesAt(frames: { time: string; grid: ZoneGrid }[], time: string): { prev: ZoneGrid | null; cur: ZoneGrid | null; from: string; to: string } {
  if (!frames.length) return { prev: null, cur: null, from: time, to: time };
  const t = ms(time);
  const k = frames.findIndex((x) => ms(x.time) > t);
  if (k < 0) { const l = frames[frames.length - 1]; return { prev: null, cur: l.grid, from: l.time, to: l.time }; }
  if (k === 0) return { prev: null, cur: frames[0].grid, from: frames[0].time, to: frames[0].time };
  return { prev: frames[k - 1].grid, cur: frames[k].grid, from: frames[k - 1].time, to: frames[k].time };
}
