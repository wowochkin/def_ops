/**
 * Зоны влияния сторон на карте «Командования»: сетка из расчёта (TurnView.zones, packages/sim/src/zones.ts) —
 * картинкой поверх подложки, под знаками: свои — красноватые, противник — голубоватые (цвета знаков сторон),
 * прозрачно (не больше ZONE_ALPHA), спорное — без цвета. Картинка растягивается картой с плавной интерполяцией —
 * края мягкие. За ход зоны меняются плавно: от начала хода к концу — переход от зон на начало к зонам на конец
 * (видно при проигрывании хода в разборе).
 */
import type { ImageOverlay } from '@def-ops/core';
import type { ZoneGrid } from '@def-ops/sim';

/** Цвета знаков сторон (publish.ts: свои — #d43834, противник — #2f6fae). */
export const ZONE_OWN = [212, 56, 52];
export const ZONE_ENEMY = [47, 111, 174];
/** Наибольшая непрозрачность зоны: слегка подкрашено, знаки читаются. */
export const ZONE_ALPHA = 0.17;
/** Кривая прозрачности: средние значения заметнее (бледное у края — всё же видно). */
const CURVE = 0.6;

/** Пиксели картинки (RGBA), строка за строкой с севера — как сетка. */
export function zoneRgba(z: ZoneGrid, alpha = ZONE_ALPHA): Uint8ClampedArray {
  const px = new Uint8ClampedArray(z.cols * z.rows * 4);
  z.v.forEach((x, i) => {
    if (!x) return;
    const c = x > 0 ? ZONE_OWN : ZONE_ENEMY;
    px.set([c[0], c[1], c[2], Math.round(255 * alpha * Math.min(1, Math.abs(x) / 100) ** CURVE)], i * 4);
  });
  return px;
}

/** Картинка зон (data: URL) — в окне браузера; без canvas (проверки в node) — null. */
export function zoneUrl(z: ZoneGrid): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = z.cols; c.height = z.rows;
  const g = c.getContext('2d');
  if (!g) return null;
  g.putImageData(new ImageData(zoneRgba(z) as unknown as Uint8ClampedArray<ArrayBuffer>, z.cols, z.rows), 0, 0);
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
