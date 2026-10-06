/**
 * Знаки и масштаб карты.
 *
 *  - Размер оформления: знак нарисован при некотором зуме (его коэффициент
 *    f.scale); при другом зуме оформление растёт или уменьшается вместе с
 *    картой только в пределах коридора SymbolSizing, дальше — постоянный
 *    экранный размер. Геометрия при этом остаётся на местности.
 *  - Видимость по масштабу: слой и знак видны только в своём диапазоне
 *    масштабов «1 : N» (ScaleRange).
 */
import type { Feature, Layer, MapDocument, ScaleRange, SymbolSizing } from './model';
import { scaleDenominator } from './cartography';

/** По умолчанию: от половины до полутора размеров, с которыми знак нарисован. */
export const DEFAULT_SIZING: SymbolSizing = { min: 0.5, max: 1.5 };

/** Готовые режимы для интерфейса. */
export const SIZING_MODES: { id: string; name: string; title: string; sizing: SymbolSizing }[] = [
  { id: 'limited', name: '×0,5–×1,5', title: 'Растут и уменьшаются с картой, но не больше чем в полтора и не меньше чем в два раза', sizing: DEFAULT_SIZING },
  { id: 'screen', name: 'постоянные', title: 'Один размер на экране при любом масштабе', sizing: { min: 1, max: 1 } },
  { id: 'geo', name: 'по местности', title: 'Растут вместе с картой без ограничений (как на бумажной карте под лупой)', sizing: { min: 0, max: null } },
];

export function sizingOf(doc: Pick<MapDocument, 'sizing'>): SymbolSizing {
  return doc.sizing ?? DEFAULT_SIZING;
}

export function sizingModeId(s: SymbolSizing): string {
  return SIZING_MODES.find((m) => m.sizing.min === s.min && m.sizing.max === s.max)?.id ?? 'custom';
}

/**
 * Во сколько раз изменить размеры стиля знака при зуме zoom, чтобы его экранный
 * размер остался в коридоре. 1 — оставить как есть (внутри коридора).
 */
export function sizeFactor(f: Pick<Feature, 'scale' | 'sizeRef'>, refZoom: number, zoom: number, sizing: SymbolSizing): number {
  // экранный размер относительно того, с которым знак нарисован
  const t = (f.sizeRef ?? f.scale ?? 1) * Math.pow(2, zoom - refZoom);
  const lo = Math.max(0, sizing.min);
  const hi = sizing.max == null ? Infinity : Math.max(lo, sizing.max);
  const c = Math.min(Math.max(t, lo), hi);
  return t > 0 ? c / t : 1;
}

/** Масштаб «1 : N» на экране для вида документа (по широте центра вида). */
export function viewDenominator(lat: number, zoom: number): number {
  return scaleDenominator(lat, zoom);
}

export function inScaleRange(r: ScaleRange | null | undefined, denominator: number): boolean {
  if (!r) return true;
  // небольшой допуск: «от 1:50 000» включает экранные 1:49 700
  if (r.from != null && denominator < r.from * 0.97) return false;
  if (r.to != null && denominator > r.to * 1.03) return false;
  return true;
}

export function hasScaleRange(r: ScaleRange | null | undefined): r is ScaleRange {
  return !!r && (r.from != null || r.to != null);
}

/** Виден ли знак на масштабе: и по своему диапазону, и по диапазону слоя. */
export function visibleAtScale(f: Pick<Feature, 'scales'>, layer: Pick<Layer, 'scales'> | undefined, denominator: number): boolean {
  return inScaleRange(layer?.scales, denominator) && inScaleRange(f.scales, denominator);
}

/** Подпись диапазона: «1:200 000 – 1:2 000 000», «1:500 000 и крупнее», «1:50 000 и мельче». */
export function scaleRangeLabel(r: ScaleRange | null | undefined): string {
  if (!hasScaleRange(r)) return 'на любых';
  const f = (n: number) => `1:${n.toLocaleString('ru-RU').replace(/\s/g, ' ')}`;
  if (r.from != null && r.to != null) return `${f(r.from)} – ${f(r.to)}`;
  if (r.from != null) return `${f(r.from)} и мельче`;
  return `${f(r.to!)} и крупнее`;
}

/** Масштабы для выбора границ диапазона. */
export const RANGE_SCALES = [10_000, 25_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
