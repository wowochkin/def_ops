/**
 * Условные обозначения карты по уровню: на каждом уровне — только то, что на нём нарисовано, и каждый элемент можно
 * скрыть или показать. Элемент — целый слой-переключатель (key без match: «Котлы», «Ист. фронт»…) или часть знаков
 * (match: удары противника, отходы, свои войска…), которые скрываются отдельно, по списку скрытых. Без React.
 */
import type { Feature, MapDocument } from '@def-ops/core';
import type { LevelId } from './map-level-scale';

export interface LegendItem {
  id: string;
  /** Подпись; у части элементов — своя на уровне. */
  text: string | Partial<Record<LevelId, string>>;
  cls: string;
  mark?: string;
  levels: LevelId[];
  /** Слой-переключатель (меню «Слои»), к которому относится элемент: выключен — элемент тоже скрыт. */
  key?: string;
  /** Знаки элемента: по ним — есть ли он на карте сейчас и что скрыть. */
  match: (f: Feature) => boolean;

  /** Только на экране командования (замысел, тыл, реки, зоны влияния). */
  command?: boolean;
}

const ALL: LevelId[] = ['stavka', 'front', 'army', 'corps', 'division'];
const UNITS = new Set(['lvl-st-units', 'lvl-op-units', 'lvl-co-units']);
const MOVES = new Set(['lvl-st-moves', 'lvl-op-moves', 'lvl-co-moves']);
const BOUNDS = new Set(['sim-bounds', 'lvl-op-bounds', 'lvl-st-bounds']);
const TOWN = new Set(['atlas.town', 'atlas.city']);
type Styled = { style?: { hatch?: unknown; cross?: { mode?: string } | null; tip?: string } };
const st = (f: Feature) => (f as Feature & Styled).style ?? {};
/** Знак войск: дивизии на крупных уровнях, объединения и их подписи — на обзорных (без пунктов и крепостей). */
const troop = (f: Feature) => f.layerId === 'sim-own' || f.layerId === 'sim-enemy' || (UNITS.has(f.layerId) && !TOWN.has(f.preset ?? '') && f.preset !== 'atlas.fortCity');
const halted = (f: Feature) => MOVES.has(f.layerId) && f.kind === 'arrow' && st(f).tip === 'bar';
const blow = (f: Feature, presets: string[]) => MOVES.has(f.layerId) && presets.includes(f.preset ?? '') && !halted(f);

export const LEGEND_ITEMS: LegendItem[] = [
  { id: 'own', cls: 'lg-own', text: 'советские войска', levels: ALL, match: (f) => troop(f) && (f.layerId === 'sim-own' || f.side === 'own') },
  { id: 'enemy', cls: 'lg-enemy', text: 'немецкие войска', levels: ALL, match: (f) => troop(f) && (f.layerId === 'sim-enemy' || f.side === 'enemy') },
  { id: 'reserve', cls: 'lg-reserve', text: 'на марше или в резерве', levels: ['front', 'army'], match: (f) => UNITS.has(f.layerId) && !!st(f).hatch },
  { id: 'routed', cls: 'lg-routed', text: 'разгромлено', levels: ['front', 'army'], match: (f) => UNITS.has(f.layerId) && st(f).cross?.mode === 'slash' },
  { id: 'destroyed', cls: 'lg-destroyed', mark: '✕', text: 'соединение уничтожено', levels: ['corps', 'division'], match: (f) => (f.layerId === 'sim-own' || f.layerId === 'sim-enemy') && st(f).cross?.mode === 'x' },
  { id: 'ghosts', key: 'ghosts', cls: 'lg-ghost', text: { front: 'историческое положение армий', corps: 'историческое положение', division: 'историческое положение' }, levels: ['front', 'corps', 'division'],
    match: (f) => f.layerId === 'hist-units' || f.layerId === 'lvl-op-hist' },
  { id: 'front', key: 'front', cls: 'lg-front', text: 'линия фронта (расчёт)', levels: ALL, match: (f) => f.layerId === 'sim-front' || f.layerId === 'lvl-st-front' },
  { id: 'front-prev', key: 'front', cls: 'lg-front-prev', text: 'линия фронта сутки назад', levels: ['corps', 'division'], match: (f) => f.layerId === 'sim-front-prev' },
  { id: 'front-start', key: 'front', cls: 'lg-front-start', text: 'передний край на начало операции', levels: ['stavka', 'front'], match: (f) => f.layerId === 'sim-front-start' },
  { id: 'hfront', key: 'hfront', cls: 'lg-hfront', text: 'линия фронта (история)', levels: ALL, match: (f) => f.layerId === 'hist-front' },
  { id: 'bounds', key: 'bounds', cls: 'lg-bound', text: 'разграничительная линия фронтов', levels: ALL, match: (f) => BOUNDS.has(f.layerId) && f.preset !== 'rkka.boundaryArmy' },
  { id: 'bounds-army', key: 'bounds', cls: 'lg-barmy', text: 'разграничительная линия армий', levels: ['front', 'army'], match: (f) => BOUNDS.has(f.layerId) && f.preset === 'rkka.boundaryArmy' },
  { id: 'hbounds', key: 'hbounds', cls: 'lg-hbound', text: 'разграничительная линия по директиве', levels: ALL, match: (f) => f.layerId === 'hist-bounds' },
  // Ставка — удары за двое суток стрелками атласа; фронт и армия — за сутки стрелками объединений и корпусов
  { id: 'blow', cls: 'lg-atlas', text: { stavka: 'главный удар фронта (за двое суток; Y — расходящиеся)', front: 'удар армии (за сутки)', army: 'удар корпуса (за сутки)' }, levels: ['stavka', 'front', 'army'],
    match: (f) => blow(f, ['atlas.p2', 'inf.attackFade']) },
  { id: 'blow-enemy', cls: 'lg-atlas-de', text: { stavka: 'удар противника (за двое суток)', front: 'удар противника (за сутки)', army: 'удар противника (за сутки)' }, levels: ['stavka', 'front', 'army'],
    match: (f) => blow(f, ['atlas.german', 'inf.counter']) },
  { id: 'halted', cls: 'lg-bar', text: 'удар остановлен: рубеж и дата', levels: ['stavka', 'front', 'army'], match: halted },
  { id: 'axis', cls: 'lg-axis', mark: '◆', text: { front: 'ось танковой армии, даты по суткам', army: 'ось танкового корпуса, даты по суткам' }, levels: ['front', 'army'],
    match: (f) => MOVES.has(f.layerId) && (f.preset === 'atlas.tankAxis' || f.preset === 'atlas.date') },
  { id: 'retreat', cls: 'lg-retreat', text: 'отход', levels: ['stavka', 'front', 'army'], match: (f) => blow(f, ['atlas.thin', 'inf.retreat']) },
  // у корпусов рубежи обороны не рисуются (сливались в частокол)
  { id: 'defense', cls: 'lg-defense', text: { stavka: 'оборона', front: 'рубеж обороны' }, levels: ['stavka', 'front'], match: (f) => MOVES.has(f.layerId) && f.preset === 'atlas.defense' },
  { id: 'combat', key: 'combat', cls: 'lg-arrow', text: 'бой за ход', levels: ['division'], match: (f) => f.layerId === 'sim-combat' },
  { id: 'pockets', key: 'pockets', cls: 'lg-pocket', text: 'котёл (окружённые)', levels: ALL, match: (f) => f.layerId === 'sim-pockets' },
  { id: 'corps', cls: 'lg-corps', text: 'корпус — контур его дивизий', levels: ['corps'], match: (f) => f.layerId === 'sim-corps' },
  { id: 'fort', cls: 'lg-fort', mark: '✲', text: 'крепость (перечёркнута — пала)', levels: ['stavka', 'front', 'army'], match: (f) => UNITS.has(f.layerId) && f.preset === 'atlas.fortCity' },
  // обвод по застройке на 1:1 000 000 — пятнышко под знаком крепости: у Ставки его нет
  { id: 'fortress', key: 'fortress', cls: 'lg-fortline', text: 'крепость: обвод по застройке', levels: ['front', 'army', 'corps', 'division'], match: (f) => f.layerId === 'sim-fortress' },
  { id: 'theatre', key: 'theatre', cls: 'lg-belt', text: 'укреплённая полоса (зубцы к противнику)', levels: ALL, match: (f) => f.layerId === 'theatre' },
  { id: 'crossings', key: 'theatre', cls: 'lg-crossing', mark: '⊓', text: 'наведённая переправа', levels: ['division'], match: (f) => f.layerId === 'theatre-crossings' },
  { id: 'towns', cls: 'lg-town', text: 'населённый пункт', levels: ['stavka', 'front', 'army'], match: (f) => UNITS.has(f.layerId) && TOWN.has(f.preset ?? '') },
  { id: 'flag', cls: 'lg-flag', mark: '⚑', text: 'Знамя Победы', levels: ALL, match: (f) => f.layerId === 'sim-marks' },
  // где и когда событие было по истории (знак бледный), — со слоем исторических положений
  { id: 'flag-hist', key: 'ghosts', cls: 'lg-flag lg-hist', mark: '⚑', text: 'Знамя Победы по истории', levels: ALL, match: (f) => f.layerId === 'hist-marks' },
  // экран командования
  { id: 'plan', key: 'plan', cls: 'lg-plan', text: 'замысел: проекты приказов и документов', levels: ALL, command: true, match: (f) => f.layerId === 'plan' },
  { id: 'rear', key: 'rear', cls: 'lg-rear', mark: '▲', text: 'тыл: базы и подвоз', levels: ALL, command: true, match: (f) => f.layerId === 'logistics' },
  { id: 'rivers', key: 'rivers', cls: 'lg-river', text: 'реки (для переправ)', levels: ['army', 'corps', 'division'], command: true, match: (f) => f.layerId === 'rivers' },
  { id: 'zones-own', key: 'zones', cls: 'lg-zone-own', text: 'зона влияния своих войск', levels: ALL, command: true, match: () => false },
  { id: 'zones-enemy', key: 'zones', cls: 'lg-zone-enemy', text: 'зона влияния противника (по разведке)', levels: ALL, command: true, match: () => false },
];

export const legendText = (it: LegendItem, level: LevelId): string => (typeof it.text === 'string' ? it.text : it.text[level] ?? Object.values(it.text)[0] ?? it.id);

/** Элементы легенды уровня: на экране переигровки — без элементов командования. */
export function legendFor(level: LevelId, o: { command?: boolean } = {}): LegendItem[] {
  return LEGEND_ITEMS.filter((it) => it.levels.includes(level) && (o.command || !it.command));
}

/** Элемент по названию или id (голос: «скрой отходы»): точное совпадение, иначе — по началу слов. */
export function findLegendItem(q: string, items: LegendItem[], level: LevelId): LegendItem | null {
  const s = q.trim().toLowerCase().replace(/ё/g, 'е');
  if (!s) return null;
  const t = (it: LegendItem) => legendText(it, level).toLowerCase().replace(/ё/g, 'е');
  const stem = (w: string) => w.slice(0, Math.max(4, w.length - 2));
  const words = s.split(/[^a-zа-я0-9]+/).filter((w) => w.length > 2).map(stem);
  return items.find((it) => it.id === s) ?? items.find((it) => t(it) === s)
    ?? items.find((it) => words.length > 0 && words.every((w) => t(it).includes(w))) ?? null;
}

/** Элементы легенды на карте сейчас (для голоса: «скрой отходы» — элемент, а не слой); ставит легенда. */
export const shownLegend: { items: LegendItem[]; level: LevelId } = { items: [], level: 'division' };

/** Карта без знаков скрытых элементов этого уровня. */
export function withHidden(doc: MapDocument, level: LevelId, hidden: ReadonlySet<string>): MapDocument {
  const off = legendFor(level, { command: true }).filter((it) => hidden.has(it.id));
  if (!off.length) return doc;
  return { ...doc, features: doc.features.filter((f) => !off.some((it) => it.match(f))) };
}

/** Слой рисуется на уровне (как в withLevel): обобщения — каждое на своём уровне, дивизии — у корпуса и дивизии. */
export function onLevel(layer: string, level: LevelId): boolean {
  if (layer.startsWith('lvl-st-')) return level === 'stavka';
  if (layer === 'lvl-op-bounds') return level === 'front' || level === 'army';
  if (layer.startsWith('lvl-op-')) return level === 'front';
  if (layer.startsWith('lvl-co-')) return level === 'army';
  if (['sim-own', 'sim-enemy', 'sim-bounds', 'hist-units', 'sim-front-prev'].includes(layer)) return level === 'corps' || level === 'division';
  if (layer === 'sim-combat' || layer === 'theatre-crossings') return level === 'division';
  if (layer === 'sim-front-start') return level === 'stavka' || level === 'front';
  if (layer === 'sim-front') return level !== 'stavka';
  if (layer === 'sim-fortress') return level !== 'stavka';
  if (layer === 'rivers') return level !== 'stavka' && level !== 'front';
  return true;
}

const ms = (t: string) => Date.parse(t.length <= 16 ? `${t}:00Z` : t);
/** Знак на карте в час time (без времени — всегда). */
const at = (f: Feature, time: string | null) => {
  if (!time || !f.time) return true;
  const t = ms(time);
  return (f.time.from == null || ms(f.time.from) <= t) && (f.time.to == null || t < ms(f.time.to));
};

/**
 * Элементы, которые есть на карте уровня в час time (doc — до скрытия, чтобы скрытое осталось в легенде и его можно было
 * вернуть); always — элементы не из знаков (зоны влияния), когда они есть.
 */
export function presentItems(items: LegendItem[], level: LevelId, doc: MapDocument, time: string | null, always: ReadonlySet<string> = new Set()): LegendItem[] {
  const live = doc.features.filter((f) => onLevel(f.layerId, level) && at(f, time));
  return items.filter((it) => always.has(it.id) || live.some((f) => it.match(f)));
}

/**
 * Сверка легенды с картой уровня в час time. drawnDoc — карта, как она нарисована на уровне (withLevel со всеми слоями),
 * allDoc — до уровня. uncovered — знаки на карте без строки легенды (слой · знак), empty — строки без знаков на карте,
 * missing — строки, чьи знаки на карте есть, а строки нет.
 */
export function legendGaps(drawnDoc: MapDocument, allDoc: MapDocument, level: LevelId, time: string): { uncovered: string[]; empty: string[]; missing: string[] } {
  const items = legendFor(level);
  const vis = new Set(drawnDoc.layers.filter((l) => l.visible).map((l) => l.id));
  const drawn = drawnDoc.features.filter((f) => vis.has(f.layerId) && !f.hidden && at(f, time));
  const present = new Set(presentItems(items, level, allDoc, time).map((x) => x.id));
  const uncovered = [...new Set(drawn.filter((f) => !items.some((it) => it.match(f))).map((f) => `${f.layerId} · ${f.preset ?? f.kind}`))];
  const has = (id: string) => drawn.some((f) => items.find((x) => x.id === id)!.match(f));
  return {
    uncovered,
    empty: items.filter((it) => present.has(it.id) && !has(it.id)).map((it) => it.id),
    missing: items.filter((it) => !present.has(it.id) && has(it.id)).map((it) => it.id),
  };
}
