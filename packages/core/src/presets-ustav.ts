/**
 * Стиль «Уставной» — знаки штабной (рабочей) карты в системе советских
 * тактических условных обозначений. Цвет — по принадлежности:
 * свои — красный, противник — синий, нейтральное (сооружения, заграждения,
 * топография) — чёрный.
 *
 * Размеры — в пикселях на «печатном» масштабе (как у остальных пресетов).
 * Все фабрики стилей вызываются только при создании объекта, поэтому
 * модуль можно импортировать из presets.ts без проблем порядка загрузки.
 */
import type { ArrowStyle, AreaStyle, LineStyle, Side, SymbolStyle, TextStyle } from './model';
import { baseArrow, layer as L, stops, sym, textStyle } from './presets';

export const SIDE_COLORS: Record<Side, string> = { own: '#d43834', enemy: '#2f6fae', neutral: '#1f1f1f' };
const col = (side: Side | undefined, def: Side) => SIDE_COLORS[side ?? def];

type Table<T> = Record<string, { name: string; group: string; style: (side?: Side) => T }>;
const G = 'Уставной';

/* ------------------------------ действия войск ------------------------------ */
export const USTAV_ARROWS: Table<ArrowStyle> = {
  'ustav.attackMain': {
    name: 'Направление главного удара', group: G,
    style: (s) => baseArrow({ tailWidth: 13, neckWidth: 10, headWidth: 26, headLength: 22, barbSweep: 6, fill: stops([0, col(s, 'own'), 1]) }),
  },
  'ustav.attack': {
    name: 'Направление удара (вспомогательного)', group: G,
    style: (s) => baseArrow({ tailWidth: 6, neckWidth: 5, headWidth: 16, headLength: 16, barbSweep: 4, fill: stops([0, col(s, 'own'), 1]) }),
  },
  'ustav.counterattack': {
    name: 'Контратака / контрудар', group: G,
    style: (s) => baseArrow({
      tailWidth: 10, neckWidth: 8, headWidth: 22, headLength: 20, barbSweep: 5,
      fill: stops([0, col(s, 'own'), 0]), headFill: col(s, 'own'),
      outline: { color: col(s, 'own'), width: 1.6, dash: [6, 3] },
    }),
  },
  'ustav.retreat': {
    name: 'Отход', group: G,
    style: (s) => baseArrow({
      tailWidth: 0.1, neckWidth: 0.1, headWidth: 12, headLength: 13, barbSweep: 3,
      fill: stops([0, col(s, 'own'), 1]), centerLine: { color: col(s, 'own'), width: 2, dash: [7, 4] },
    }),
  },
  'ustav.march': {
    name: 'Марш (маршрут движения)', group: G,
    style: (s) => baseArrow({
      tailWidth: 1.6, neckWidth: 1.6, headWidth: 10, headLength: 12, barbSweep: 3, fill: stops([0, col(s, 'own'), 1]),
      decorations: [{ type: 'chevron', at: 0.1, to: 0.85, repeat: 0.15, length: 4, width: 8, fill: col(s, 'own'), stroke: { color: col(s, 'own'), width: 1.4 } }],
    }),
  },
  'ustav.pursuit': {
    name: 'Преследование', group: G,
    style: (s) => baseArrow({
      tailWidth: 6, neckWidth: 5, headWidth: 16, headLength: 16, barbSweep: 4, fill: stops([0, col(s, 'own'), 1]),
      decorations: [{ type: 'chevron', at: 0.55, to: 0.75, repeat: 0.12, length: 7, width: 16, fill: col(s, 'own'), stroke: { color: col(s, 'own'), width: 2.4 } }],
    }),
  },
  'ustav.airStrike': {
    name: 'Удар авиации', group: G,
    style: (s) => baseArrow({
      tailWidth: 1.6, neckWidth: 1.6, headWidth: 10, headLength: 13, barbSweep: 3, fill: stops([0, col(s, 'own'), 1]),
      decorations: [{ type: 'glyph', glyph: 'plane', at: 0.35, length: 18, width: 18, fill: col(s, 'own') }],
    }),
  },
  'ustav.seaLanding': {
    name: 'Высадка морского десанта', group: G,
    style: (s) => baseArrow({
      tailWidth: 4, neckWidth: 4, headWidth: 14, headLength: 15, barbSweep: 4, fill: stops([0, col(s, 'own'), 1]),
      decorations: [{ type: 'glyph', glyph: 'anchor', at: 0.3, length: 16, width: 16, fill: col(s, 'own'), stroke: { color: col(s, 'own'), width: 1.4 } }],
    }),
  },
  'ustav.airLanding': {
    name: 'Выброска воздушного десанта', group: G,
    style: (s) => baseArrow({
      tailWidth: 0.1, neckWidth: 0.1, headWidth: 12, headLength: 13, barbSweep: 3,
      fill: stops([0, col(s, 'own'), 1]), centerLine: { color: col(s, 'own'), width: 1.6, dash: [5, 3] },
      decorations: [{ type: 'glyph', glyph: 'parachute', at: 0.3, length: 16, width: 16, fill: col(s, 'own'), stroke: { color: col(s, 'own'), width: 1.2 } }],
    }),
  },
  'ustav.tankThrust': {
    name: 'Удар танков', group: G,
    style: (s) => baseArrow({
      tailWidth: 4, neckWidth: 4, headWidth: 14, headLength: 15, barbSweep: 4, fill: stops([0, col(s, 'own'), 1]),
      decorations: [{ type: 'diamond', at: 0.4, length: 16, width: 9, fill: col(s, 'own'), stroke: null }],
    }),
  },
  'ustav.fireDirection': {
    name: 'Направление огня (сектор обстрела)', group: G,
    style: (s) => baseArrow({
      tailWidth: 0.1, neckWidth: 0.1, headWidth: 8, headLength: 10, barbSweep: 2,
      fill: stops([0, col(s, 'own'), 1]), centerLine: { color: col(s, 'own'), width: 1, dash: [2, 2] },
    }),
  },
};

/* ------------------------ линии, рубежи, разграничения ------------------------ */
const lbl = (color: string, size = 10, p: Partial<TextStyle> = {}) => textStyle({ font: 'PT Sans Narrow', size, weight: 700, color, ...p });

export const USTAV_LINES: Table<LineStyle> = {
  'ustav.frontLine': {
    name: 'Передний край (линия соприкосновения)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 2.4, color: col(s, 'own'), cap: 'round' })] }),
  },
  'ustav.defenseLine': {
    name: 'Оборонительный рубеж (позиция)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 2, color: col(s, 'own'), ticks: { spacing: 7, length: 4, width: 1.4, side: 1 } })] }),
  },
  'ustav.startLine': {
    name: 'Исходный рубеж для наступления', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.6, color: col(s, 'own'), dash: [10, 4] })], labels: [{ text: 'ИР', at: [0.04, 0.96], offset: 8, style: lbl(col(s, 'own')) }] }),
  },
  'ustav.attackLine': {
    name: 'Рубеж атаки (перехода в атаку)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.6, color: col(s, 'own'), dash: [4, 3] })], labels: [{ text: 'РА', at: [0.04, 0.96], offset: 8, style: lbl(col(s, 'own')) }] }),
  },
  'ustav.deployLine': {
    name: 'Рубеж развёртывания', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'own'), dash: [12, 3, 2, 3] })], labels: [{ text: 'РР', at: [0.04, 0.96], offset: 8, style: lbl(col(s, 'own')) }] }),
  },
  'ustav.controlLine': {
    name: 'Рубеж регулирования', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.2, color: col(s, 'own'), dash: [2, 3] })], labels: [{ text: 'Рег.', at: [0.04, 0.96], offset: 8, style: lbl(col(s, 'own')) }] }),
  },
  'ustav.boundaryFront': {
    name: 'Разграничительная линия фронтов', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 2.2, color: col(s, 'own'), dash: [16, 4, 2.5, 4, 2.5, 4] })], labels: [{ text: '1 БФ | 2 БФ', at: [0.5], offset: 9, style: lbl(col(s, 'own'), 11) }] }),
  },
  'ustav.boundaryArmy': {
    name: 'Разграничительная линия армий', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.8, color: col(s, 'own'), dash: [13, 4, 2, 4, 2, 4] })], labels: [{ text: '5 уд. А | 8 гв. А', at: [0.5], offset: 8, style: lbl(col(s, 'own'), 10) }] }),
  },
  'ustav.boundaryCorps': {
    name: 'Разграничительная линия корпусов', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.6, color: col(s, 'own'), dash: [12, 4, 2, 4, 2, 4, 2, 4] })], labels: [{ text: '9 ск | 26 гв. ск', at: [0.5], offset: 8, style: lbl(col(s, 'own'), 9.5) }] }),
  },
  'ustav.boundaryDivision': {
    name: 'Разграничительная линия дивизий', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'own'), dash: [10, 4, 2, 4] })], labels: [{ text: '150 сд | 171 сд', at: [0.5], offset: 7, style: lbl(col(s, 'own'), 9) }] }),
  },
  'ustav.boundaryRegiment': {
    name: 'Разграничительная линия полков', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.1, color: col(s, 'own'), dash: [8, 3, 1.5, 3] })], labels: [{ text: '756 сп | 674 сп', at: [0.5], offset: 6, style: lbl(col(s, 'own'), 8.5) }] }),
  },
  'ustav.boundaryBattalion': {
    name: 'Разграничительная линия батальонов', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'own'), dash: [6, 3] })] }),
  },
  // ---- фортификация
  'ustav.trench': {
    name: 'Траншея', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.3, color: col(s, 'neutral'), pattern: { type: 'zigzag', amplitude: 2.2, wavelength: 7 } })] }),
  },
  'ustav.commTrench': {
    name: 'Ход сообщения', group: G,
    style: (s) => ({ smooth: true, layers: [L({ offset: 1.3, width: 0.9, color: col(s, 'neutral') }), L({ offset: -1.3, width: 0.9, color: col(s, 'neutral') })] }),
  },
  'ustav.fortifiedRegion': {
    name: 'Укреплённый район (передний край УР)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 2, color: col(s, 'enemy'), ticks: { spacing: 9, length: 6, width: 1.4, side: 1, shape: 'semicircle' } })] }),
  },
  // ---- заграждения
  'ustav.wire': {
    name: 'Проволочное заграждение на кольях', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), ticks: { spacing: 8, length: 5, width: 1, side: 0, shape: 'x' } })] }),
  },
  'ustav.wireMulti': {
    name: 'Проволочное заграждение многорядное', group: G,
    style: (s) => ({ smooth: true, layers: [
      L({ offset: 2.2, width: 0.8, color: col(s, 'neutral'), ticks: { spacing: 8, length: 4.4, width: 0.9, side: 0, shape: 'x' } }),
      L({ offset: -2.2, width: 0.8, color: col(s, 'neutral'), ticks: { spacing: 8, length: 4.4, width: 0.9, side: 0, shape: 'x' } }),
    ] }),
  },
  'ustav.wireElectric': {
    name: 'Электризуемое заграждение', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), ticks: { spacing: 8, length: 5, width: 1, side: 0, shape: 'x' } })], labels: [{ text: 'ϟ', at: [0.5], offset: 7, style: lbl(col(s, 'neutral'), 12) }] }),
  },
  'ustav.wireLow': {
    name: 'Малозаметное заграждение (спираль, сеть)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: { type: 'wave', amplitude: 1.8, wavelength: 5 } })] }),
  },
  'ustav.dragonTeeth': {
    name: 'Надолбы', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 6, length: 4.5, width: 4.5, side: 1, shape: 'triangle' } })] }),
  },
  'ustav.atDitch': {
    name: 'Противотанковый ров', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.6, color: col(s, 'neutral'), ticks: { spacing: 7, length: 5, width: 4, side: 1, shape: 'triangle' } })] }),
  },
  'ustav.escarp': {
    name: 'Эскарп / контрэскарп', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 1.6, color: col(s, 'neutral'), ticks: { spacing: 3.5, length: 3, width: 0.9, side: 1 } })] }),
  },
  'ustav.abatis': {
    name: 'Завал (лесной)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0.8, color: col(s, 'neutral'), ticks: { spacing: 7, length: 6, width: 1.3, side: 0, shape: 'x' } }), L({ width: 0.8, color: col(s, 'neutral'), offset: 0, ticks: { spacing: 7, length: 6, width: 1.3, side: 1, angle: 35 } })] }),
  },
  'ustav.minesAT': {
    name: 'Минное поле противотанковое (полоса)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 7, length: 4, width: 1, side: 0, shape: 'circle' } })] }),
  },
  'ustav.minesAP': {
    name: 'Минное поле противопехотное (полоса)', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 5, length: 2.2, width: 1, side: 0, shape: 'dot' } })] }),
  },
  'ustav.fireBarrage': {
    name: 'Огневой вал / подвижный заградительный огонь', group: G,
    style: (s) => ({ smooth: true, layers: [L({ width: 6, color: col(s, 'own'), opacity: 0.18 }), L({ width: 0.8, color: col(s, 'own'), ticks: { spacing: 4, length: 3, width: 0.9, side: 0 } })] }),
  },
  'ustav.smoke': {
    name: 'Дымовая завеса', group: G,
    style: () => ({ smooth: true, layers: [L({ width: 7, color: '#8a8a8a', opacity: 0.35, cap: 'round' }), L({ width: 1, color: '#6a6a6a', pattern: { type: 'wave', amplitude: 2, wavelength: 8 } })] }),
  },
  // ---- дороги, пути, границы
  'ustav.road': {
    name: 'Шоссе / дорога с покрытием', group: G,
    style: () => ({ smooth: true, layers: [L({ width: 4, color: '#3a3a3a' }), L({ width: 2.4, color: '#f6e7b4' })] }),
  },
  'ustav.dirtRoad': {
    name: 'Грунтовая дорога', group: G,
    style: () => ({ smooth: true, layers: [L({ width: 1.1, color: '#3a3a3a', dash: [6, 3] })] }),
  },
  'ustav.iceRoad': {
    name: 'Ледовая дорога (переправа)', group: G,
    style: () => ({ smooth: true, layers: [L({ width: 4, color: '#bfe3f7' }), L({ width: 1.2, color: '#2f6fae', dash: [5, 3] })] }),
  },
  'ustav.border': {
    name: 'Государственная граница', group: G,
    style: () => ({ smooth: false, layers: [L({ width: 6, color: '#c9a6d6', opacity: 0.6 }), L({ width: 1.6, color: '#5b2a74', dash: [10, 3, 2, 3, 2, 3] })] }),
  },
};

/* ------------------------------------ районы ------------------------------------ */
const area = (p: Partial<AreaStyle>): AreaStyle => ({ smooth: true, fill: null, fillOpacity: 1, hatch: null, edge: [], cross: null, ...p });

export const USTAV_AREAS: Table<AreaStyle> = {
  'ustav.concentration': {
    name: 'Район сосредоточения', group: G,
    style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own') })] }),
  },
  'ustav.defenseArea': {
    name: 'Район обороны (опорный пункт)', group: G,
    style: (s) => area({ edge: [L({ width: 1.8, color: col(s, 'own'), ticks: { spacing: 7, length: 4, width: 1.3, side: -1 } })] }),
  },
  'ustav.bridgehead': {
    name: 'Плацдарм', group: G,
    style: (s) => area({ fill: col(s, 'own'), fillOpacity: 0.12, edge: [L({ width: 2.2, color: col(s, 'own') })] }),
  },
  'ustav.landingZone': {
    name: 'Район высадки (выброски) десанта', group: G,
    style: (s) => area({ fill: col(s, 'own'), fillOpacity: 0.08, edge: [L({ width: 1.4, color: col(s, 'own'), dash: [6, 3] })] }),
  },
  'ustav.encircled': {
    name: 'Окружённая группировка', group: G,
    style: (s) => area({ fill: col(s, 'enemy'), fillOpacity: 0.1, hatch: { color: col(s, 'enemy'), width: 0.8, spacing: 5, angle: -45, opacity: 0.8 }, edge: [L({ width: 1.8, color: col(s, 'enemy') })] }),
  },
  'ustav.nzo': {
    name: 'Участок неподвижного заградительного огня (НЗО)', group: G,
    style: (s) => area({ smooth: false, hatch: { color: col(s, 'own'), width: 0.8, spacing: 3.5, angle: 45, opacity: 1 }, edge: [L({ width: 1, color: col(s, 'own') })] }),
  },
  'ustav.fireConcentration': {
    name: 'Участок сосредоточенного огня', group: G,
    style: (s) => area({ hatch: { color: col(s, 'own'), width: 0.7, spacing: 4, angle: 0, opacity: 1, pattern: 'cross' }, edge: [L({ width: 1, color: col(s, 'own') })] }),
  },
  'ustav.minefieldAT': {
    name: 'Минное поле противотанковое', group: G,
    style: (s) => area({ smooth: false, hatch: { color: col(s, 'neutral'), width: 0.8, spacing: 7, angle: 0, opacity: 1, pattern: 'circles' }, edge: [L({ width: 0.8, color: col(s, 'neutral'), dash: [4, 2] })] }),
  },
  'ustav.minefieldAP': {
    name: 'Минное поле противопехотное', group: G,
    style: (s) => area({ smooth: false, hatch: { color: col(s, 'neutral'), width: 1, spacing: 5, angle: 0, opacity: 1, pattern: 'dots' }, edge: [L({ width: 0.8, color: col(s, 'neutral'), dash: [4, 2] })] }),
  },
  'ustav.contamination': {
    name: 'Район заражения (ОВ)', group: G,
    style: () => area({ fill: '#f3e27a', fillOpacity: 0.45, hatch: { color: '#9a7a00', width: 0.7, spacing: 4, angle: 45, opacity: 0.7 }, edge: [L({ width: 1.2, color: '#9a7a00', dash: [5, 3] })] }),
  },
  'ustav.flooding': {
    name: 'Район затопления', group: G,
    style: () => area({ fill: '#bfe3f7', fillOpacity: 0.6, hatch: { color: '#2f6fae', width: 0.6, spacing: 4, angle: 0, opacity: 0.8 }, edge: [L({ width: 1, color: '#2f6fae', dash: [5, 3] })] }),
  },
  'ustav.partisanArea': {
    name: 'Партизанский район (край)', group: G,
    style: () => area({ fill: '#d43834', fillOpacity: 0.06, hatch: { color: '#d43834', width: 0.6, spacing: 6, angle: 45, opacity: 0.6, pattern: 'cross' }, edge: [L({ width: 1.4, color: '#d43834', dash: [2, 3] })] }),
  },
  'ustav.forest': {
    name: 'Лес', group: G,
    style: () => area({ fill: '#d9ecc6', fillOpacity: 1, hatch: { color: '#6a9f58', width: 0.7, spacing: 9, angle: 0, opacity: 1, pattern: 'trees' }, edge: [L({ width: 0.6, color: '#6a9f58', dash: [2, 2] })] }),
  },
  'ustav.swamp': {
    name: 'Болото', group: G,
    style: () => area({ fill: '#e3f1f6', fillOpacity: 0.7, hatch: { color: '#4a90c0', width: 0.8, spacing: 6, angle: 0, opacity: 1, pattern: 'swamp' }, edge: [] }),
  },
};

/* --------------------------------- точечные знаки --------------------------------- */
const g = (type: string, size: number, defSide: Side, p: Partial<SymbolStyle> = {}) =>
  (s?: Side) => sym(type, { size, color: col(s, defSide), fill: '#ffffff', strokeWidth: Math.max(0.9, size * 0.07), ...p });

export const USTAV_SYMBOLS: Table<SymbolStyle> = {
  // управление и связь
  'ustav.cp': { name: 'Командный пункт (КП)', group: G, style: g('cp', 22, 'own') },
  'ustav.hq': { name: 'Штаб (с номером соединения)', group: G, style: g('hq', 22, 'own', { text: '52' }) },
  'ustav.reserveCp': { name: 'Запасной командный пункт (ЗКП)', group: G, style: g('reserveCp', 22, 'own') },
  'ustav.op': { name: 'Наблюдательный пункт (НП)', group: G, style: g('op', 14, 'own') },
  'ustav.opArt': { name: 'Наблюдательный пункт артиллерийский', group: G, style: g('op', 14, 'own', { text: 'А' }) },
  'ustav.cop': { name: 'Командно-наблюдательный пункт (КНП)', group: G, style: g('cop', 22, 'own') },
  'ustav.commsNode': { name: 'Узел связи', group: G, style: g('commsNode', 14, 'own') },
  'ustav.radio': { name: 'Радиостанция', group: G, style: g('radio', 16, 'own') },
  // огневые средства
  'ustav.gun': { name: 'Орудие (пушка)', group: G, style: g('gun', 14, 'own') },
  'ustav.howitzer': { name: 'Гаубица', group: G, style: g('howitzer', 14, 'own') },
  'ustav.atGun': { name: 'Противотанковое орудие', group: G, style: g('atGun', 14, 'own') },
  'ustav.mortar': { name: 'Миномёт', group: G, style: g('mortar', 14, 'own') },
  'ustav.rocket': { name: 'Реактивная установка (гвардейский миномёт)', group: G, style: g('rocket', 15, 'own') },
  'ustav.aaGun': { name: 'Зенитное орудие', group: G, style: g('aaGun', 14, 'own') },
  'ustav.hmg': { name: 'Станковый пулемёт', group: G, style: g('hmg', 13, 'own') },
  'ustav.lmg': { name: 'Ручной пулемёт', group: G, style: g('lmg', 12, 'own') },
  'ustav.battery': { name: 'Огневая позиция батареи', group: G, style: g('battery', 20, 'own') },
  // бронетанковые
  'ustav.tank': { name: 'Танк', group: G, style: g('tank', 16, 'own') },
  'ustav.tankDug': { name: 'Танк в окопе', group: G, style: g('tankDug', 16, 'own') },
  'ustav.spg': { name: 'Самоходная артиллерийская установка (САУ)', group: G, style: g('spg', 16, 'own') },
  'ustav.armoredCar': { name: 'Бронеавтомобиль', group: G, style: g('armoredCar', 15, 'own') },
  'ustav.armoredTrain': { name: 'Бронепоезд', group: G, style: g('armoredTrain', 18, 'own') },
  // авиация, ПВО, десант
  'ustav.plane': { name: 'Самолёт (истребитель, штурмовик)', group: G, style: g('plane', 20, 'own') },
  'ustav.bomber': { name: 'Бомбардировщик', group: G, style: g('bomber', 24, 'own') },
  'ustav.airfield': { name: 'Аэродром', group: G, style: g('airfield', 22, 'own') },
  'ustav.landingStrip': { name: 'Посадочная площадка', group: G, style: g('landingStrip', 14, 'own') },
  'ustav.parachute': { name: 'Воздушный десант', group: G, style: g('parachute', 18, 'own') },
  'ustav.searchlight': { name: 'Зенитный прожектор', group: G, style: g('searchlight', 14, 'own') },
  'ustav.balloon': { name: 'Аэростат заграждения', group: G, style: g('balloon', 16, 'own') },
  // флот
  'ustav.ship': { name: 'Боевой корабль', group: G, style: g('ship', 22, 'own') },
  'ustav.boat': { name: 'Катер (бронекатер)', group: G, style: g('boat', 14, 'own') },
  'ustav.navalBase': { name: 'Военно-морская база (якорная стоянка)', group: G, style: g('anchor', 18, 'own') },
  'ustav.coastBattery': { name: 'Береговая батарея', group: G, style: g('coastBattery', 18, 'own') },
  // фортификация
  'ustav.pillbox': { name: 'ДОТ (долговременная огневая точка)', group: G, style: g('pillbox', 13, 'neutral') },
  'ustav.dzot': { name: 'ДЗОТ (дерево-земляная огневая точка)', group: G, style: g('dzot', 13, 'neutral') },
  'ustav.dugout': { name: 'Блиндаж', group: G, style: g('dugout', 13, 'neutral') },
  'ustav.trenchSquad': { name: 'Окоп (стрелковая ячейка, окоп отделения)', group: G, style: g('trenchSquad', 14, 'neutral') },
  'ustav.shelter': { name: 'Щель, убежище', group: G, style: g('shelter', 13, 'neutral') },
  // заграждения
  'ustav.mineAT': { name: 'Противотанковая мина', group: G, style: g('mineAT', 8, 'neutral') },
  'ustav.mineAP': { name: 'Противопехотная мина', group: G, style: g('mineAP', 8, 'neutral') },
  'ustav.fougasse': { name: 'Фугас', group: G, style: g('fougasse', 12, 'neutral') },
  'ustav.demolition': { name: 'Разрушение (подрыв) объекта', group: G, style: g('explosion', 14, 'neutral') },
  'ustav.dragonTooth': { name: 'Надолба (одиночная)', group: G, style: g('dragonTooth', 8, 'neutral') },
  // переправы и дороги
  'ustav.bridge': { name: 'Мост', group: G, style: g('bridge', 16, 'neutral') },
  'ustav.bridgeDestroyed': { name: 'Мост разрушен', group: G, style: g('bridgeDestroyed', 16, 'neutral') },
  'ustav.pontoon': { name: 'Понтонный (наплавной) мост', group: G, style: g('pontoon', 18, 'own') },
  'ustav.ferry': { name: 'Паромная переправа', group: G, style: g('ferry', 18, 'own') },
  'ustav.ford': { name: 'Брод', group: G, style: g('ford', 18, 'neutral') },
  'ustav.kpp': { name: 'Контрольно-пропускной пункт (КПП)', group: G, style: g('kpp', 18, 'own') },
  'ustav.railStation': { name: 'Станция снабжения (выгрузки)', group: G, style: g('railStation', 12, 'own', { text: 'СС' }) },
  // тыл
  'ustav.depotAmmo': { name: 'Склад боеприпасов', group: G, style: g('depot', 16, 'own', { text: 'Б' }) },
  'ustav.depotFuel': { name: 'Склад горючего (ГСМ)', group: G, style: g('depot', 16, 'own', { text: 'ГСМ' }) },
  'ustav.depotFood': { name: 'Склад продовольствия', group: G, style: g('depot', 16, 'own', { text: 'П' }) },
  'ustav.dop': { name: 'Дивизионный обменный пункт (ДОП)', group: G, style: g('supply', 18, 'own') },
  'ustav.medical': { name: 'Медицинский пункт (МПП, МПБ)', group: G, style: g('medical', 14, 'own') },
  'ustav.hospital': { name: 'Госпиталь (медсанбат)', group: G, style: g('hospital', 14, 'own') },
  'ustav.repair': { name: 'Ремонтный пункт / СПАМ', group: G, style: g('repair', 14, 'own') },
  // особые
  'ustav.partisans': { name: 'Партизанский отряд (бригада)', group: G, style: g('partisans', 16, 'own') },
  'ustav.fire': { name: 'Пожар', group: G, style: () => sym('fire', { size: 14, color: '#e0651f', fill: '#ffffff', strokeWidth: 1 }) },
  'ustav.height': { name: 'Отметка высоты', group: G, style: () => sym('height', { size: 10, color: '#3a2a1a', fill: '#ffffff', strokeWidth: 1, text: '120,5' }) },
  'ustav.northArrow': { name: 'Стрелка «север»', group: G, style: () => sym('northArrow', { size: 30, color: '#1f1f1f', fill: '#ffffff', strokeWidth: 1.2 }) },
  'ustav.unitOval': { name: 'Соединение (овал с номером)', group: G, style: (s) => sym('armyOval', { size: 40, aspect: 0.5, color: col(s, 'own'), fill: s === 'enemy' ? '#c9dff0' : '#f1c3cc', strokeWidth: 1.5 }) },
  'ustav.mechCorps': { name: 'Механизированный (танковый) корпус', group: G, style: (s) => sym('tankArmy', { size: 40, aspect: 0.5, color: col(s, 'own'), fill: s === 'enemy' ? '#c9dff0' : '#f1c3cc', strokeWidth: 1.4 }) },
};

/* ------------------------------------ подписи ------------------------------------ */
export const USTAV_LABELS: Table<TextStyle> = {
  'ustav.unit': { name: 'Обозначение части/соединения', group: G, style: (s) => textStyle({ font: 'PT Sans Narrow', size: 12, weight: 700, color: col(s, 'own') }) },
  'ustav.time': { name: 'Время и дата (к исходу 19.4)', group: G, style: (s) => textStyle({ font: 'PT Sans Narrow', size: 10, weight: 400, color: col(s, 'own'), italic: true }) },
  'ustav.note': { name: 'Пояснительная надпись', group: G, style: () => textStyle({ font: 'PT Sans Narrow', size: 11, weight: 400, color: '#1f1f1f', align: 'start' }) },
};
