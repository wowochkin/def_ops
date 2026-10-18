/**
 * Подсветка исполненного голосом: на FLASH_MS вокруг того, что изменилось, — та же светящаяся рамка, что в туре, но
 * без притемнения и подписи; место на карте — метка-пульс. Чистый модуль (без React): act в реестре зовёт flash, когда
 * действие исполнено голосом; рисует слой FlashLayer (voice/FlashLayer.tsx).
 *
 * Цель — CSS-селектор (`[data-hl="order-su_8gva"]`, `[data-action="command.turn"]`, `[data-tour="voice"]`) или место
 * на карте `{ at }`. Что подсветить, решает поле `highlight` действия: по параметрам или по тому, что исполнение
 * отметило (note — когда цель известна только после исполнения: какое соединение нашлось, какое место).
 */
import type { LngLat } from '@def-ops/core';
import type { MapEngine } from '../engine/types';

export type HlTarget = string | { at: LngLat };
export type Highlight = HlTarget | HlTarget[] | null | undefined;
export const FLASH_MS = 2500;

/** Элемент с `data-hl="name"`. */
export const hl = (name: string) => `[data-hl="${name}"]`;
/** Кнопка (элемент) действия реестра. */
export const btn = (action: string) => `[data-action="${action}"]`;
/** Элемент тура. */
export const tourEl = (name: string) => `[data-tour="${name}"]`;

/** at — когда подсветка началась (цель, найденная позже, гаснет вместе с остальными). */
export interface FlashState { seq: number; targets: string[]; spots: LngLat[]; ms: number; at: number }
let state: FlashState | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Что подсвечено сейчас (null — ничего). */
export function flashState(): FlashState | null { return state; }
/** Следить за подсветкой; возвращает отписку. */
export function onFlash(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

const split = (t: Highlight) => {
  const list = (Array.isArray(t) ? t : t ? [t] : []);
  return { targets: list.filter((x): x is string => typeof x === 'string'), spots: list.filter((x): x is { at: LngLat } => typeof x === 'object' && !!x).map((x) => x.at) };
};
function set(next: Omit<FlashState, 'seq' | 'at'> | null): void {
  if (timer) clearTimeout(timer);
  timer = null;
  state = next && (next.targets.length || next.spots.length) && next.ms > 0 ? { ...next, seq: ++seq, at: Date.now() } : null;
  if (state) { const my = state.seq; timer = setTimeout(() => { if (state?.seq === my) { state = null; timer = null; emit(); } }, state.ms); }
  emit();
}

/** Подсветить цели на ms (прежняя подсветка снимается). Пусто — снять. */
export function flash(targets: Highlight, ms = FLASH_MS): void { set({ ...split(targets), ms }); }

/** Метка на карте в точке at — вместе с тем, что подсвечено сейчас (или одна). */
export function flashMap(at: LngLat, ms = FLASH_MS): void {
  set(state ? { targets: state.targets, spots: [...state.spots, at], ms } : { targets: [], spots: [at], ms });
}

// ---------------------------------------------------------------- что отметило исполнение

let marked: HlTarget[] | null = null;
/** Исполнение действия отмечает, что изменилось (подсветится, если исполнено голосом). */
export function note(...t: HlTarget[]): void { marked = [...(marked ?? []), ...t]; }
/** highlight по отметке исполнения: `highlight: noted`. */
export function noted(): HlTarget[] | null { return marked; }
/** Перед исполнением — прежняя отметка не нужна (реестр). */
export function clearNoted(): void { marked = null; }

// ---------------------------------------------------------------- карта

/** Карта, на которой ставится метка: её движок (перевод координат, контейнер; вид — сдвинуть место из-под панели). */
export type FlashMapView = Pick<MapEngine, 'project' | 'unproject' | 'getContainer' | 'getView' | 'setView'>;
let mapView: FlashMapView | null = null;
/** Раздел с картой подключает её движок; возвращает отключение (снимает только своё). */
export function setFlashMapView(m: FlashMapView | null): () => void {
  mapView = m;
  emit();
  return () => { if (mapView === m) { mapView = null; emit(); } };
}
export function flashMapView(): FlashMapView | null { return mapView; }

export type HlRect = { left: number; top: number; width: number; height: number };
/** Отступ метки от края карты и от закрытия: ближе — метку не видно целиком. */
const SPOT_MARGIN = 24;
/**
 * Метку в точке p (координаты окна) не видно: она за краем карты map или под тем, что лежит поверх карты (covers —
 * панель голоса, легенда). Тогда слой сдвигает карту (showAt), как «покажи …».
 */
export function spotHidden(p: { x: number; y: number }, map: HlRect, covers: HlRect[]): boolean {
  const m = SPOT_MARGIN;
  if (p.x < map.left + m || p.x > map.left + map.width - m || p.y < map.top + m || p.y > map.top + map.height - m) return true;
  return covers.some((c) => p.x > c.left - m && p.x < c.left + c.width + m && p.y > c.top - m && p.y < c.top + c.height + m);
}
