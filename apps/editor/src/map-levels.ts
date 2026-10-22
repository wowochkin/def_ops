/**
 * Что рисуется на каждом уровне карты (Ставка, фронт, армия, корпус, дивизия): слои обобщения своего уровня, линии
 * фронта, обводы, реки. Без React — по этой же функции проверяется легенда (scripts/legend-check.ts).
 */
import type { MapDocument } from '@def-ops/core';
import type { LevelId } from './map-level-scale';

type MapLevel = LevelId;
/** Расчётные разграничительные линии — свой слой на каждом уровне карты; переключатель — видимость sim-bounds. */
const BOUND_LAYERS = ['sim-bounds', 'lvl-op-bounds', 'lvl-st-bounds'];

const LEVEL_LAYERS: Record<MapLevel, string[]> = {
  stavka: ['lvl-st-units', 'lvl-st-moves', 'lvl-st-bounds'],
  front: ['lvl-op-units', 'lvl-op-moves', 'lvl-op-bounds'],
  army: ['lvl-co-units', 'lvl-co-moves', 'lvl-op-bounds'],
  corps: ['sim-own', 'sim-enemy', 'sim-bounds'],
  division: ['sim-own', 'sim-enemy', 'sim-combat', 'sim-bounds'],
};
const ALL_LEVEL_LAYERS = new Set(Object.values(LEVEL_LAYERS).flat());
/** Слои уровня со своим переключателем: показываются, только если он включён. */
const SWITCHED = new Set(['sim-combat', ...BOUND_LAYERS]);
/** Видимость слоёв по уровню; бои и полосы — ещё и по своему переключателю (полосы всех уровней — по слою sim-bounds). */
export function withLevel(doc: MapDocument, level: MapLevel): MapDocument {
  const boundsOff = doc.layers.some((l) => l.id === 'sim-bounds' && !l.visible);
  const on = (l: MapDocument['layers'][number]) => !SWITCHED.has(l.id) || (BOUND_LAYERS.includes(l.id) ? !boundsOff : l.visible);
  // линия фронта у Ставки — в манере атласа (свой слой), наведённые переправы — только на уровне дивизии
  const frontOn = doc.layers.some((l) => l.id === 'sim-front' && l.visible);
  const theatreOn = doc.layers.some((l) => l.id === 'theatre' && l.visible);
  // исторические положения — своего масштаба: соединения у корпуса и дивизии, армии у фронта, у Ставки и армии — нет
  const ghostsOn = doc.layers.some((l) => l.id === 'hist-units' && l.visible);
  return { ...doc, layers: doc.layers.map((l) => (l.id === 'hist-units' ? { ...l, visible: (level === 'corps' || level === 'division') && ghostsOn }
    : l.id === 'lvl-op-hist' ? { ...l, visible: level === 'front' && ghostsOn }
    : ALL_LEVEL_LAYERS.has(l.id) ? { ...l, visible: LEVEL_LAYERS[level].includes(l.id) && on(l) }
    : l.id === 'lvl-st-front' ? { ...l, visible: level === 'stavka' && frontOn }
    : l.id === 'sim-front' && level === 'stavka' ? { ...l, visible: false }
    : l.id === 'theatre-crossings' ? { ...l, visible: level === 'division' && theatreOn }
    // линия фронта сутки назад — у корпуса и дивизии (выше — удары за сутки и двое), передний край на начало — у Ставки и фронта
    : l.id === 'sim-front-prev' ? { ...l, visible: (level === 'corps' || level === 'division') && l.visible }
    : l.id === 'sim-front-start' ? { ...l, visible: (level === 'stavka' || level === 'front') && l.visible }
    // обвод крепости на 1:1 000 000 — пятнышко под её знаком; реки для переправ — от армии и ниже
    : l.id === 'sim-fortress' && level === 'stavka' ? { ...l, visible: false }
    : l.id === 'rivers' && (level === 'stavka' || level === 'front') ? { ...l, visible: false } : l)) };
}
