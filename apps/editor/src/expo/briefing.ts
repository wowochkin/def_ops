/**
 * Ввод в обстановку — доклад начальника штаба по пунктам (`bank-data/*.briefing.json`, готовит `npm run expo:briefing`):
 * пункт — заголовок, доводы, крупные цифры с источником и кадр карты (рамка, уровень знаков, стрелки задачи, полосы
 * обороны противника, разграничительные линии, подписи местности — знаками атласа полного режима). Фраза голоса пункта —
 * в заготовках (`brief-<фронт>-<номер>`), пункт меняется по её концу.
 */
import { createFeature, type Feature, type LngLat, type MapDocument } from '@def-ops/core';
import data from './bank-data/berlin-1945.briefing.json';
import type { FrontId } from './settings';
import { ORDERS_LAYER } from './stage-doc';

export interface BriefFact { value: string; label: string; source: string }
export interface BriefMap {
  bbox: [number, number, number, number];
  level: 'front' | 'corps';
  arrows?: { points: LngLat[]; preset: string }[];
  /** Полосы и позиции обороны противника. */
  defense?: LngLat[][];
  /** Разграничительные линии фронтов. */
  bounds?: LngLat[][];
  labels?: { text: string; at: LngLat; preset: string }[];
}
export interface BriefPoint { title: string; lines: string[]; facts: BriefFact[]; map: BriefMap }
export type Briefing = Record<FrontId, BriefPoint[]>;

export const BRIEFING = data as unknown as Briefing;

/** Знаки пункта поверх карты; масштаб — под зум `zoom` (как у стрелок приказа). */
export function briefFeatures(doc: MapDocument, m: BriefMap, zoom: number): Feature[] {
  const k = Math.pow(2, doc.refZoom - zoom);
  const out: Feature[] = [];
  const add = (f: Feature, id: string) => out.push({ ...f, id: `brief-${id}` });
  m.arrows?.forEach((a, i) => add(createFeature('arrow', a.preset, { points: a.points, layerId: ORDERS_LAYER }, k, 'own'), `arrow-${i}`));
  m.defense?.forEach((l, i) => add(createFeature('line', 'atlas.defenseDouble', { points: l, layerId: ORDERS_LAYER }, k * 1.4, 'enemy'), `def-${i}`));
  m.bounds?.forEach((l, i) => add(createFeature('line', 'rkka.boundaryFront', { points: l, layerId: ORDERS_LAYER }, k * 1.6, 'own'), `bound-${i}`));
  m.labels?.forEach((l, i) => add(createFeature('label', l.preset, { at: l.at, text: l.text, layerId: ORDERS_LAYER }, k * (l.preset === 'atlas.region' ? 1.1 : 1.6), 'neutral'), `label-${i}`));
  return out;
}
