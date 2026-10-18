/**
 * Показать место на карте там, где его видно: центр карты смещается к свободной части, если край карты закрыт
 * панелью голоса или легендой (они лежат поверх карты). «Покажи Зелов» не ставит Зелов под панель.
 */
import type { LngLat } from '@def-ops/core';
import type { MapEngine } from './types';

export type Rect = { left: number; top: number; width: number; height: number };

/**
 * На сколько пикселей сдвинуть место от центра карты map, чтобы оно было в свободной части: каждое закрытие covers
 * отрезает от карты полосу у того края, где отрезать меньше всего площади; место — посередине оставшегося.
 * Сдвиг не больше трети размера карты.
 */
export function freeOffset(map: Rect, covers: Rect[]): { dx: number; dy: number } {
  const right = map.left + map.width, bottom = map.top + map.height;
  const pad = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const c of covers) {
    const l = Math.max(map.left, c.left), r = Math.min(right, c.left + c.width);
    const t = Math.max(map.top, c.top), b = Math.min(bottom, c.top + c.height);
    if (r <= l || b <= t) continue;
    const cut = [
      { side: 'right' as const, px: right - l, lost: (right - l) * map.height },
      { side: 'left' as const, px: r - map.left, lost: (r - map.left) * map.height },
      { side: 'bottom' as const, px: bottom - t, lost: (bottom - t) * map.width },
      { side: 'top' as const, px: b - map.top, lost: (b - map.top) * map.width },
    ].reduce((a, x) => (x.lost < a.lost ? x : a));
    pad[cut.side] = Math.max(pad[cut.side], cut.px);
  }
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return { dx: clamp((pad.left - pad.right) / 2, map.width / 3) || 0, dy: clamp((pad.top - pad.bottom) / 2, map.height / 3) || 0 };
}

/** Что лежит поверх карты: панель голоса и легенда (видимые). */
const COVERS = '[data-tour="voice"], .legend';

/**
 * Поставить место at в середину свободной части карты (zoom — масштаб, не задан — прежний). Закрытия ищутся в окне
 * (панель голоса — одна на окно, легенда — в контейнере карты или рядом).
 */
export function showAt(en: Pick<MapEngine, 'getView' | 'setView'> & Partial<Pick<MapEngine, 'project' | 'unproject' | 'getContainer'>>, at: LngLat, zoom?: number): void {
  en.setView({ center: at, zoom: zoom ?? en.getView().zoom });
  // движок без перевода координат (проверки в node) или окна нет — просто в центр
  if (typeof document === 'undefined' || !en.project || !en.unproject || !en.getContainer) return;
  const box = en.getContainer().getBoundingClientRect();
  const covers = [...document.querySelectorAll(COVERS)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const { dx, dy } = freeOffset({ left: box.left, top: box.top, width: box.width, height: box.height }, covers);
  if (!dx && !dy) return;
  // место сейчас в центре; новый центр — точка, что на (dx, dy) от него в обратную сторону
  const c = en.project(at);
  en.setView({ center: en.unproject([c[0] - dx, c[1] - dy]) });
}
