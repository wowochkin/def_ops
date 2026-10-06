/**
 * Пресеты условных знаков, откалиброванные по образцам:
 *  - «Инфографика» — современная схема «Разгром берлинской группировки»;
 *  - «Атлас» — карта из исторического атласа (стрелки-клинья с градиентом);
 *  - «Тактика» — крупномасштабная схема штурма (позиции полков по датам).
 * Размеры — в экранных пикселях на «печатном» масштабе образцов (~1:1 к изображению);
 * при создании объекта они пересчитываются в масштаб документа (см. scaleStyle).
 */
import type {
  ArrowStyle, AreaStyle, LineStyle, SymbolStyle, TextStyle, StrokeLayer, ColorStop, SymbolType, Side,
} from './model';
import { STD_ARROWS, STD_LINES, STD_AREAS, STD_SYMBOLS, STD_LABELS } from './presets-std';

export const PALETTE = {
  inf: {
    paper: '#cfeae6', red: '#e75d50', frontFill: '#f8c0a9', frontEdge: '#b8443c', blue: '#33587f',
    navy: '#3c5078', cross: '#c8463f', hatch: '#3d6b95', hatchBg: '#d3e9ec', rail: '#6f6a6a', river: '#68a5d6', text: '#1d1d1d',
  },
  atlas: {
    paper: '#f8f0d0', red: '#d43834', darkRed: '#b8282c', blue: '#2f6fae', water: '#c8e8fc', orange: '#eca85c',
    pink: '#f1c3cc', magenta: '#a8329a', brown: '#8b3a2c', green: '#7fb87a', text: '#222222',
  },
  tac: { paper: '#fcecd0', red: '#d43834', blue: '#3070b0', ditch: '#a9d8f2', block: '#dcd0dc', park: '#d9ecd0' },
};

type ArrowP = Partial<ArrowStyle>;
export const stops = (...s: [number, string, number][]): ColorStop[] => s.map(([t, color, opacity]) => ({ t, color, opacity }));

export function baseArrow(p: ArrowP = {}): ArrowStyle {
  return {
    smooth: true, tailWidth: 24, neckWidth: 20, taper: 1, headWidth: 50, headLength: 34, barbSweep: 6, headCurve: 1,
    tailShape: 'flat', tailNotch: 0.35, fill: stops([0, '#e75d50', 1]), headFill: null, headOpacity: 1,
    outline: null, outlineTail: true, centerLine: null, highlight: null, decorations: [], anchorOverlap: 3, ...p,
  };
}

const C = PALETTE;

/* ---------------------------- стрелки ---------------------------- */
export const ARROW_PRESETS: Record<string, { name: string; group: string; style: (side?: Side) => ArrowStyle }> = {
  'inf.attack': {
    name: 'Удар (сплошная)', group: 'Инфографика',
    style: () => baseArrow({ tailWidth: 24, neckWidth: 17, headWidth: 44, headLength: 32, barbSweep: 10, fill: stops([0, C.inf.red, 1]) }),
  },
  'inf.attackFade': {
    name: 'Удар (хвост растворяется)', group: 'Инфографика',
    style: () => baseArrow({ tailWidth: 24, neckWidth: 16, headWidth: 42, headLength: 31, barbSweep: 10, fill: stops([0, C.inf.red, 0], [0.4, C.inf.red, 0.95], [1, C.inf.red, 1]) }),
  },
  'inf.tank': {
    name: 'Танковые соединения', group: 'Инфографика',
    style: () => baseArrow({
      tailWidth: 9, neckWidth: 9, headWidth: 22, headLength: 18, barbSweep: 5,
      fill: stops([0, C.inf.red, 0], [0.5, C.inf.red, 0.75], [1, C.inf.red, 0.9]),
      outline: { color: '#ffffff', width: 1.6 }, outlineTail: true,
      decorations: [{ type: 'diamond', at: 0.5, length: 30, width: 15, fill: C.inf.red, stroke: { color: '#ffffff', width: 1.6 } }],
    }),
  },
  'inf.counter': {
    name: 'Контрудар противника', group: 'Инфографика',
    style: () => baseArrow({ tailWidth: 10, neckWidth: 8, headWidth: 22, headLength: 20, barbSweep: 4, fill: stops([0, C.inf.navy, 0], [0.55, C.inf.navy, 1], [1, C.inf.navy, 1]) }),
  },
  'inf.retreat': {
    name: 'Отход противника (тонкая)', group: 'Инфографика',
    style: () => baseArrow({ tailWidth: 3, neckWidth: 3, headWidth: 13, headLength: 13, barbSweep: 3, fill: stops([0, C.inf.navy, 1]) }),
  },
  'atlas.p1': {
    name: 'Удар 16–19 апр. (жёлто-красная)', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 32, neckWidth: 6, headWidth: 14, headLength: 21, barbSweep: 6, headCurve: 1, tailShape: 'notch', tailNotch: 0.28,
      fill: stops([0, '#f6dc9c', 0.45], [0.55, '#f0a874', 0.85], [1, '#d9443a', 1]), headFill: C.atlas.red,
      outline: { color: C.atlas.red, width: 1.1 }, outlineTail: false,
      highlight: { color: '#fff3c4', opacity: 0.85, widthRatio: 0.55 },
    }),
  },
  'atlas.p2': {
    name: 'Удар 20–25 апр. (розово-красная)', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 32, neckWidth: 6, headWidth: 14, headLength: 21, barbSweep: 6, tailShape: 'notch', tailNotch: 0.28,
      fill: stops([0, '#f8dcd6', 0.45], [0.55, '#eea092', 0.85], [1, '#d6403a', 1]), headFill: C.atlas.red,
      outline: { color: C.atlas.red, width: 1.1 }, outlineTail: false,
      highlight: { color: '#fff8f2', opacity: 0.7, widthRatio: 0.5 },
    }),
  },
  'atlas.p3': {
    name: 'Удар 26 апр.–8 мая (бледная)', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 36, neckWidth: 6, headWidth: 14, headLength: 21, barbSweep: 6, tailShape: 'notch', tailNotch: 0.3,
      fill: stops([0, '#fbe9ea', 0.55], [0.6, '#f1b9bf', 0.85], [1, '#de5a60', 1]), headFill: C.atlas.red,
      outline: { color: C.atlas.red, width: 1.1 }, outlineTail: false,
      highlight: { color: '#ffffff', opacity: 0.6, widthRatio: 0.5 },
    }),
  },
  'atlas.magenta': {
    name: 'Удар (малиновая, 2-й Бел. фр.)', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 32, neckWidth: 6, headWidth: 14, headLength: 21, barbSweep: 6, tailShape: 'notch', tailNotch: 0.28,
      fill: stops([0, '#f7dbe6', 0.5], [0.5, '#e597b4', 0.95], [1, '#c8285a', 1]), headFill: '#c8243f',
      outline: { color: '#c8243f', width: 1.1 }, outlineTail: false,
      highlight: { color: '#fff4f8', opacity: 0.75, widthRatio: 0.5 },
    }),
  },
  'atlas.polish': {
    name: 'Войско Польское', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 30, neckWidth: 6, headWidth: 14, headLength: 20, barbSweep: 6, tailShape: 'notch', tailNotch: 0.3,
      fill: stops([0, '#ecd3ea', 0.7], [1, '#a8329a', 1]), headFill: C.atlas.magenta,
      outline: { color: C.atlas.magenta, width: 1.1 }, outlineTail: false,
      highlight: { color: '#ffffff', opacity: 0.5, widthRatio: 0.45 },
    }),
  },
  'atlas.german': {
    name: 'Контрудар немецких войск', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 30, neckWidth: 5, headWidth: 13, headLength: 19, barbSweep: 5, tailShape: 'notch', tailNotch: 0.3,
      fill: stops([0, '#f1dfb0', 0.75], [0.6, '#9cbbd6', 0.95], [1, C.atlas.blue, 1]), headFill: C.atlas.blue,
      outline: { color: C.atlas.blue, width: 1.1 }, outlineTail: false,
    }),
  },
  'atlas.allied': {
    name: 'Удар войск союзников', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 30, neckWidth: 5, headWidth: 13, headLength: 19, barbSweep: 5, tailShape: 'notch', tailNotch: 0.3,
      fill: stops([0, '#f6e2b8', 0.75], [0.6, '#d9a476', 0.95], [1, C.atlas.brown, 1]), headFill: C.atlas.brown,
      outline: { color: C.atlas.brown, width: 1.1 }, outlineTail: false,
    }),
  },
  'atlas.thin': {
    name: 'Тонкая стрелка', group: 'Атлас',
    style: () => baseArrow({ tailWidth: 1.6, neckWidth: 1.6, headWidth: 9, headLength: 14, barbSweep: 4, fill: stops([0, C.atlas.red, 1]) }),
  },
  'atlas.tank': {
    name: 'Танковый корпус (ромб)', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 1.6, neckWidth: 1.6, headWidth: 9, headLength: 14, barbSweep: 4, fill: stops([0, C.atlas.red, 1]),
      decorations: [
        { type: 'diamond', at: 0.38, length: 15, width: 8, fill: C.atlas.red, stroke: null },
        { type: 'bar', at: 0.48, to: 0.72, length: 0, width: 4.5, fill: C.atlas.red, stroke: null },
      ],
    }),
  },
  'atlas.flotilla': {
    name: 'Речная флотилия', group: 'Атлас',
    style: () => baseArrow({
      tailWidth: 1.4, neckWidth: 1.4, headWidth: 8, headLength: 12, barbSweep: 3, fill: stops([0, C.atlas.red, 1]),
      decorations: [{ type: 'chevron', at: 0.12, to: 0.8, repeat: 0.22, length: 4, width: 9, fill: C.atlas.red, stroke: { color: C.atlas.red, width: 1.3 } }],
    }),
  },
  'tac.attack': {
    name: 'Атака полка (объёмная)', group: 'Тактика',
    style: () => baseArrow({
      tailWidth: 26, neckWidth: 5, headWidth: 12, headLength: 16, barbSweep: 3, taper: 1.3,
      fill: stops([0, '#f6c9c4', 0.5], [0.5, '#e46a62', 0.9], [1, C.tac.red, 1]), headFill: C.tac.red,
      highlight: { color: '#ffffff', opacity: 0.75, widthRatio: 0.55 },
    }),
  },
  'tac.thin': {
    name: 'Тонкая стрелка', group: 'Тактика',
    style: () => baseArrow({ tailWidth: 1.8, neckWidth: 1.8, headWidth: 9, headLength: 13, barbSweep: 4, fill: stops([0, C.tac.red, 1]) }),
  },
};

/* ---------------------------- линии ---------------------------- */
export const layer = (p: Partial<StrokeLayer> & { width: number; color: string }): StrokeLayer => ({ offset: 0, opacity: 1, ...p });
const L = layer;

export const LINE_PRESETS: Record<string, { name: string; group: string; style: (side?: Side) => LineStyle; closed?: boolean }> = {
  'inf.fortification': {
    name: 'Укрепления (зубцы)', group: 'Инфографика',
    style: () => ({ smooth: true, layers: [L({ width: 5, color: C.inf.blue, ticks: { spacing: 14, length: 7, width: 2.6, side: 1 } })] }),
  },
  'inf.frontEdge': {
    name: 'Кромка фронта', group: 'Инфографика',
    style: () => ({ smooth: true, layers: [L({ width: 9, color: C.inf.frontEdge, cap: 'round' })] }),
  },
  'inf.rail': {
    name: 'Железная дорога', group: 'Инфографика',
    style: () => ({ smooth: true, layers: [L({ width: 1.3, color: C.inf.rail, ticks: { spacing: 22, length: 2.2, width: 1.1, side: 0 } })] }),
  },
  'inf.river': {
    name: 'Река', group: 'Инфографика',
    style: () => ({ smooth: true, layers: [L({ width: 2.2, color: C.inf.river, cap: 'round' })] }),
  },
  'atlas.front15': {
    name: 'Фронт к исходу 15 апр.', group: 'Атлас',
    style: () => ({ smooth: true, layers: [
      L({ offset: 3.4, width: 3.6, color: C.atlas.orange }),
      L({ offset: 0.6, width: 1.6, color: C.atlas.red }),
      L({ offset: -2.2, width: 1.6, color: C.atlas.blue, ticks: { spacing: 7, length: 2.6, width: 1, side: -1 } }),
    ] }),
  },
  'atlas.front19': {
    name: 'Фронт к исходу 19 апр.', group: 'Атлас',
    style: () => ({ smooth: true, layers: [
      L({ offset: 1.6, width: 1.6, color: C.atlas.red, dash: [1.4, 2.4], cap: 'butt' }),
      L({ offset: -1.4, width: 1.6, color: C.atlas.blue }),
    ] }),
  },
  'atlas.front25': {
    name: 'Фронт к исходу 25 апр.', group: 'Атлас',
    style: () => ({ smooth: true, layers: [
      L({ offset: 3.6, width: 3.2, color: '#f1b4b6' }),
      L({ offset: 3.6, width: 1.4, color: C.atlas.red, dash: [5, 3] }),
      L({ offset: 0.8, width: 1.4, color: C.atlas.red }),
      L({ offset: -1.6, width: 1.6, color: C.atlas.blue }),
    ] }),
  },
  'atlas.frontDresden': {
    name: 'Фронт на дрезденском напр. 5 мая', group: 'Атлас',
    style: () => ({ smooth: true, layers: [
      L({ offset: 3.4, width: 3.2, color: '#f1b4b6' }),
      L({ offset: 3.4, width: 1.2, color: '#ffffff', dash: [2, 6] }),
      L({ offset: 0.8, width: 1.4, color: C.atlas.red }),
      L({ offset: -1.6, width: 1.6, color: C.atlas.blue }),
    ] }),
  },
  'atlas.meetLine': {
    name: 'Рубеж встречи с союзниками', group: 'Атлас',
    style: () => ({ smooth: true, layers: [
      L({ width: 9, color: '#f4c9c7', opacity: 0.9 }),
      L({ offset: 2, width: 1.6, color: C.atlas.red, dash: [6, 4] }),
      L({ offset: -2, width: 1.6, color: C.atlas.brown, dash: [6, 4] }),
    ] }),
  },
  'atlas.defense': {
    name: 'Оборонительный рубеж', group: 'Атлас',
    style: () => ({ smooth: true, layers: [L({ width: 1.5, color: C.atlas.blue, ticks: { spacing: 4.5, length: 3, width: 1, side: 1 } })] }),
  },
  'atlas.defenseDouble': {
    name: 'Рубеж (двойной, с зубцами)', group: 'Атлас',
    style: () => ({ smooth: true, layers: [
      L({ offset: 1.5, width: 1.3, color: C.atlas.blue }),
      L({ offset: -1.5, width: 1.3, color: C.atlas.blue, ticks: { spacing: 4.5, length: 3, width: 1, side: -1 } }),
    ] }),
  },
  'atlas.river': {
    name: 'Река', group: 'Атлас',
    style: () => ({ smooth: true, layers: [L({ width: 1.3, color: '#5ba8dc', cap: 'round' })] }),
  },
  'atlas.rail': {
    name: 'Железная дорога', group: 'Атлас',
    style: () => ({ smooth: true, layers: [L({ width: 2.2, color: '#77716b' }), L({ width: 1, color: '#f8f0d0', dash: [8, 8] })] }),
  },
  'tac.pos28': {
    name: 'Позиция к исходу 28 апр.', group: 'Тактика',
    style: () => ({ smooth: true, layers: [L({ width: 2.4, color: C.tac.red, endTicks: { length: 7, width: 2.4, side: -1 } })] }),
  },
  'tac.pos29': {
    name: 'Позиция утром 29 апр.', group: 'Тактика',
    style: () => ({ smooth: true, layers: [
      L({ offset: 1.9, width: 1.8, color: C.tac.red }), L({ offset: -1.9, width: 1.8, color: C.tac.red, endTicks: { length: 6, width: 1.8, side: -1 } }),
    ] }),
  },
  'tac.pos30m': {
    name: 'Позиция утром 30 апр.', group: 'Тактика',
    style: () => ({ smooth: true, layers: [
      L({ offset: 1.9, width: 1.8, color: C.tac.red }), L({ offset: -1.9, width: 1.8, color: C.tac.red, dash: [8, 4] }),
    ] }),
  },
  'tac.pos30e': {
    name: 'Позиция к исходу 30 апр.', group: 'Тактика',
    style: () => ({ smooth: true, layers: [
      L({ offset: 1.9, width: 1.8, color: C.tac.red }), L({ offset: -1.9, width: 2, color: C.tac.red, dash: [2, 2.6] }),
    ] }),
  },
  'tac.pos2may': {
    name: 'Позиция утром 2 мая', group: 'Тактика',
    style: () => ({ smooth: true, layers: [
      L({ offset: 1.9, width: 1.8, color: C.tac.red }), L({ offset: -1.9, width: 1.8, color: C.tac.red, dash: [9, 3, 2, 3] }),
    ] }),
  },
  'tac.enemyDefense': {
    name: 'Оборона противника', group: 'Тактика',
    style: () => ({ smooth: false, layers: [L({ width: 3, color: C.tac.blue, ticks: { spacing: 13, length: 7, width: 2, side: 1 } })] }),
  },
  'tac.ditch': {
    name: 'Противотанковый ров с водой', group: 'Тактика',
    style: () => ({ smooth: false, layers: [
      L({ width: 11, color: '#7dbbe0' }), L({ width: 8.4, color: '#b8e0f4' }), L({ width: 1.2, color: C.tac.blue, dash: [6, 4] }),
    ] }),
  },
};

/* ---------------------------- районы ---------------------------- */
export const AREA_PRESETS: Record<string, { name: string; group: string; style: (side?: Side) => AreaStyle }> = {
  'inf.frontZone': {
    name: 'Территория наступающих', group: 'Инфографика',
    style: () => ({ smooth: true, fill: C.inf.frontFill, fillOpacity: 1, hatch: null, edge: [], cross: null }),
  },
  'inf.encircled': {
    name: 'Окружённая группировка', group: 'Инфографика',
    style: () => ({
      smooth: true, fill: C.inf.hatchBg, fillOpacity: 1, hatch: { color: C.inf.hatch, width: 1.5, spacing: 5, angle: -45, opacity: 1 },
      edge: [L({ width: 5.5, color: C.inf.blue, ticks: { spacing: 11, length: 5, width: 3, side: -1 } })], cross: null,
    }),
  },
  'inf.destroyed': {
    name: 'Окружена и уничтожена', group: 'Инфографика',
    style: () => ({
      smooth: true, fill: C.inf.hatchBg, fillOpacity: 1, hatch: { color: C.inf.hatch, width: 1.5, spacing: 5, angle: -45, opacity: 1 },
      edge: [L({ width: 5.5, color: C.inf.blue })],
      cross: { color: C.inf.cross, width: 10, opacity: 0.95, angle: 0, spread: 100, extend: 1.18 },
    }),
  },
  'inf.cityCenter': {
    name: 'Городской квартал', group: 'Инфографика',
    style: () => ({ smooth: false, fill: '#a09a62', fillOpacity: 1, hatch: null, edge: [L({ width: 1, color: '#5a5530' })], cross: null }),
  },
  'atlas.encircled': {
    name: 'Окружённая группировка', group: 'Атлас',
    style: () => ({
      smooth: true, fill: '#d6e8f2', fillOpacity: 0.85, hatch: null,
      edge: [L({ width: 1.6, color: C.atlas.blue, ticks: { spacing: 4.5, length: 3, width: 1, side: -1 } })], cross: null,
    }),
  },
  'atlas.city': {
    name: 'Город (застройка)', group: 'Атлас',
    style: () => ({ smooth: false, fill: '#e7b98a', fillOpacity: 1, hatch: null, edge: [L({ width: 0.8, color: '#7b5a3a' })], cross: null }),
  },
  'atlas.lake': {
    name: 'Озеро', group: 'Атлас',
    style: () => ({ smooth: true, fill: C.atlas.water, fillOpacity: 1, hatch: null, edge: [L({ width: 0.8, color: '#5ba8dc' })], cross: null }),
  },
  'tac.block': {
    name: 'Квартал', group: 'Тактика',
    style: () => ({ smooth: false, fill: C.tac.block, fillOpacity: 1, hatch: null, edge: [L({ width: 1, color: '#8d8790' })], cross: null }),
  },
  'tac.enemyStrongpoint': {
    name: 'Опорный пункт противника', group: 'Тактика',
    style: () => ({
      smooth: false, fill: null, fillOpacity: 1, hatch: null,
      edge: [L({ width: 3, color: C.tac.blue, ticks: { spacing: 13, length: 7, width: 2, side: -1 } })], cross: null,
    }),
  },
};

/* ---------------------------- знаки ---------------------------- */
export const sym = (type: SymbolType, p: Partial<SymbolStyle>): SymbolStyle => ({
  type, size: 10, color: '#000', fill: '#fff', aspect: 0.5, strokeWidth: 1.2, ...p,
});

export const SYMBOL_PRESETS: Record<string, { name: string; group: string; style: (side?: Side) => SymbolStyle }> = {
  'inf.settlement': { name: 'Населённый пункт', group: 'Инфографика', style: () => sym('settlement', { size: 10, color: '#ffffff', fill: '#000000', strokeWidth: 1.2 }) },
  'atlas.town': { name: 'Населённый пункт', group: 'Атлас', style: () => sym('town', { size: 6, color: '#4a4a4a', fill: '#ffffff', strokeWidth: 1 }) },
  'atlas.tankArmy': { name: 'Танковая армия', group: 'Атлас', style: () => sym('tankArmy', { size: 48, aspect: 0.54, color: C.atlas.red, fill: C.atlas.pink, strokeWidth: 1.6 }) },
  'atlas.cavalry': { name: 'Кавалерийский корпус', group: 'Атлас', style: () => sym('cavalryCorps', { size: 40, aspect: 0.5, color: C.atlas.red, fill: C.atlas.pink, strokeWidth: 1.5 }) },
  'atlas.army': { name: 'Армия во втором эшелоне', group: 'Атлас', style: () => sym('armyOval', { size: 46, aspect: 0.5, color: C.atlas.red, fill: C.atlas.pink, strokeWidth: 1.5 }) },
  'atlas.reserve': { name: 'Резерв противника (Р)', group: 'Атлас', style: () => sym('reserve', { size: 18, aspect: 1.3, color: C.atlas.blue, fill: '#c9dff0', strokeWidth: 1.4, text: 'Р' }) },
  'atlas.fortCity': { name: 'Город-крепость', group: 'Атлас', style: () => sym('fortifiedCity', { size: 15, color: C.atlas.blue, fill: '#ffffff' }) },
  'atlas.aviation': { name: 'Авиация', group: 'Атлас', style: () => sym('aviation', { size: 28, color: C.atlas.red }) },
  'atlas.dateBox': {
    name: 'Дата в рамке', group: 'Атлас',
    style: () => sym('dateBox', { size: 11, color: C.atlas.red, fill: '#ffffff', strokeWidth: 1.2, text: '8.V.1945', textStyle: textStyle({ font: 'PT Sans Narrow', size: 11, weight: 700, color: C.atlas.blue }) }),
  },
  'atlas.meeting': {
    name: 'Дата встречи с союзниками', group: 'Атлас',
    style: () => sym('meeting', { size: 14, color: C.atlas.red, strokeWidth: 1.4, text: '25.4', textStyle: textStyle({ font: 'PT Serif', size: 10, weight: 700, color: C.atlas.red }) }),
  },
  'tac.victoryFlag': { name: 'Знамя Победы', group: 'Тактика', style: () => sym('victoryFlag', { size: 34, color: '#b02a26', fill: '#e2302b', strokeWidth: 1.6 }) },
  'tac.pennant': { name: 'Огневая точка противника', group: 'Тактика', style: () => sym('pennant', { size: 14, color: C.tac.blue }) },
};

/* ---------------------------- надписи ---------------------------- */
export function textStyle(p: Partial<TextStyle> = {}): TextStyle {
  return {
    font: 'PT Sans Narrow', size: 14, weight: 700, italic: false, color: '#000', halo: null,
    letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.15, ...p,
  };
}

export const LABEL_PRESETS: Record<string, { name: string; group: string; style: (side?: Side) => TextStyle }> = {
  'inf.city': { name: 'Город', group: 'Инфографика', style: () => textStyle({ font: 'Roboto Condensed', size: 16, weight: 500, color: C.inf.text, align: 'start', halo: { color: '#ffffff', width: 1.4 } }) },
  'inf.capital': { name: 'Столица', group: 'Инфографика', style: () => textStyle({ font: 'Roboto Condensed', size: 21, weight: 400, color: C.inf.text, uppercase: true, halo: { color: '#ffffff', width: 2 } }) },
  'inf.front': { name: 'Название фронта', group: 'Инфографика', style: () => textStyle({ font: 'Roboto Condensed', size: 30, weight: 700, color: '#111111', uppercase: true, lineHeight: 1.05 }) },
  'inf.frontNote': { name: 'Подпись фронта', group: 'Инфографика', style: () => textStyle({ font: 'Roboto Condensed', size: 17, weight: 400, color: '#2a2a2a', uppercase: true, lineHeight: 1.2 }) },
  'atlas.unit': { name: 'Объединение (65 А)', group: 'Атлас', style: () => textStyle({ font: 'PT Sans Narrow', size: 13, weight: 700, color: C.atlas.red }) },
  'atlas.unitSmall': { name: 'Соединение (3 гв.тк)', group: 'Атлас', style: () => textStyle({ font: 'PT Sans Narrow', size: 10, weight: 700, color: C.atlas.red }) },
  'atlas.enemyUnit': { name: 'Соединение противника', group: 'Атлас', style: () => textStyle({ font: 'PT Sans Narrow', size: 11, weight: 700, color: C.atlas.blue }) },
  'atlas.front': { name: 'Название фронта', group: 'Атлас', style: () => textStyle({ font: 'PT Sans Narrow', size: 18, weight: 700, color: C.atlas.red }) },
  'atlas.city': { name: 'Город', group: 'Атлас', style: () => textStyle({ font: 'PT Serif', size: 12, weight: 700, color: '#222222', align: 'start' }) },
  'atlas.town': { name: 'Малый пункт', group: 'Атлас', style: () => textStyle({ font: 'PT Serif', size: 10.5, weight: 400, italic: true, color: '#222222', align: 'start' }) },
  'atlas.date': { name: 'Дата', group: 'Атлас', style: () => textStyle({ font: 'PT Serif', size: 9, weight: 400, color: C.atlas.red }) },
  'atlas.water': { name: 'Гидроним', group: 'Атлас', style: () => textStyle({ font: 'PT Serif', size: 10, weight: 400, italic: true, color: '#3c8ccc', letterSpacing: 0.5 }) },
  'atlas.region': { name: 'Регион (разрядка)', group: 'Атлас', style: () => textStyle({ font: 'PT Serif', size: 13, weight: 700, color: '#333333', letterSpacing: 14, uppercase: true }) },
  'tac.unit': { name: 'Полк/дивизия', group: 'Тактика', style: () => textStyle({ font: 'PT Sans Narrow', size: 15, weight: 700, color: PALETTE.tac.red }) },
  'tac.place': { name: 'Объект', group: 'Тактика', style: () => textStyle({ font: 'PT Serif', size: 15, weight: 400, italic: true, color: '#111111' }) },
};

/* ---------------------------- масштабирование ---------------------------- */
const SIZE_KEYS = new Set([
  'tailWidth', 'neckWidth', 'headWidth', 'headLength', 'barbSweep', 'width', 'length', 'spacing', 'offset', 'size',
  'strokeWidth', 'letterSpacing', 'anchorOverlap', 'dash', 'amplitude', 'wavelength',
]);

/** Масштабирует все размерные поля стиля в k раз (ширины, длины, шаги, пунктиры, кегль). */
export function scaleStyle<T>(style: T, k: number): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return key === 'dash' ? v.map((x) => x * k) : v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [kk, vv] of Object.entries(v)) o[kk] = walk(vv, kk);
      return o;
    }
    if (typeof v === 'number' && key && SIZE_KEYS.has(key)) return v * k;
    return v;
  };
  return walk(style) as T;
}

export type PresetKind = 'arrow' | 'line' | 'area' | 'symbol' | 'label';
// пресеты уставного стиля (знаки с учётом принадлежности: свои/противник/нейтральное)
Object.assign(ARROW_PRESETS, STD_ARROWS);
Object.assign(LINE_PRESETS, STD_LINES);
Object.assign(AREA_PRESETS, STD_AREAS);
Object.assign(SYMBOL_PRESETS, STD_SYMBOLS);
Object.assign(LABEL_PRESETS, STD_LABELS);

export const PRESETS = { arrow: ARROW_PRESETS, line: LINE_PRESETS, area: AREA_PRESETS, symbol: SYMBOL_PRESETS, label: LABEL_PRESETS };
