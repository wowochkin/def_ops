/**
 * Уставные пресеты по первоисточникам.
 *
 *  rkka.* — система тактических знаков РККА 1942–1945 по TM 30-430, ch. XII (1946).
 *           Свои — красным, противник — синим (там же, с. XII-1).
 *  sa.*   — система Советской Армии по «Рабочей карте командира» (1967), БУСВ (1983)
 *           и «Основным условным обозначениям». Цвета: красный — мотострелковые,
 *           танковые, ВДВ, авиация, флот; ЧЁРНЫЙ — артиллерия, ракетные, зенитные,
 *           инженерные, химические войска, связь и другие специальные войска;
 *           синий — противник (все рода войск); коричневый — дороги и маршруты;
 *           жёлтый — заливка зон химического заражения.
 *  std.*  — общие знаки без привязки к уставу (топография, подписи, особые отметки).
 *
 * Фабрики вызываются только при создании объекта (импорт из presets.ts безопасен).
 */
import type { ArrowStyle, AreaStyle, Decoration, LineStyle, Side, StrokeLayer, SymbolStyle, TextStyle } from './model';
import { baseArrow, layer as L, stops, sym, textStyle } from './presets';

const RED = '#d43834', BLUE = '#2f6fae', BLACK = '#1f1f1f', BROWN = '#8a5a2b', YELLOW = '#f2dc3c';
export const SIDE_COLORS: Record<Side, string> = { own: RED, enemy: BLUE, neutral: BLACK };

/** Род войск по правилам цвета СА: боевые (красный у своих) или специальные (чёрный у своих). */
type Service = 'combat' | 'support';
const col = (side: Side | undefined, def: Side, service: Service = 'combat') => {
  const s = side ?? def;
  if (s === 'enemy') return BLUE;
  if (s === 'neutral') return BLACK;
  return service === 'support' ? BLACK : RED;
};

type Entry<T> = { name: string; group: string; style: (side?: Side) => T };
type Table<T> = Record<string, Entry<T>>;
const RK = 'РККА 1942–45', SA = 'СА 1967–83', ST = 'Общие';

/* ================================ стрелки ================================ */
const lineArrow = (c: string, p: Partial<ArrowStyle> = {}) => baseArrow({
  tailWidth: 0.1, neckWidth: 0.1, headWidth: 10, headLength: 12, barbSweep: 2.5, fill: stops([0, c, 1]),
  centerLine: { color: c, width: 1.6 }, ...p,
});
const deco = (glyph: string, at: number, size: number, c: string): Decoration => ({ type: 'glyph', glyph, at, length: size, width: size, fill: c, stroke: { color: '#ffffff', width: Math.max(0.8, size * 0.08) } });
const ticksDeco = (at: number, to: number, repeat: number, c: string, len = 7): Decoration => ({ type: 'tick', at, to, repeat, length: 1.4, width: len, fill: c });
/** Черточки ступени на колонне: 3 — батальон, 2 — рота, 1 — взвод [СА]. */
const echelon = (k: number, c: string, at = 0.78): Decoration[] => Array.from({ length: k }, (_, i) => ({ type: 'tick', at: at - i * 0.035, length: 1.4, width: 7, fill: c }));

export const STD_ARROWS: Table<ArrowStyle> = {
  /* ---- РККА [TM XII-7, XII-8] ---- */
  'rkka.attackPlanned': { name: 'Направление атаки (намеченное)', group: RK, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 1.6, dash: [7, 4] } }) },
  'rkka.offensive': { name: 'Наступление (фактическое)', group: RK, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 2 } }) },
  'rkka.mainEffort': {
    name: 'Направление главного удара', group: RK,
    style: (s) => baseArrow({
      tailWidth: 12, neckWidth: 12, headWidth: 26, headLength: 22, barbSweep: 0, fill: stops([0, col(s, 'own'), 0]), headOpacity: 0,
      outline: { color: col(s, 'own'), width: 1.5, dash: [7, 4] }, outlineTail: false,
    }),
  },
  'rkka.withdrawal': { name: 'Отход', group: RK, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 1.6 } }) },
  'rkka.withdrawalFailed': { name: 'Отход после неудачной атаки', group: RK, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 1.6, dash: [3, 3] } }) },
  'rkka.feint': { name: 'Демонстрация (ложное движение)', group: RK, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 1.4, dash: [8, 3, 2, 3] } }) },
  'rkka.colInfantry': { name: 'Колонна пехоты (со штабом)', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('flagSquare', 0.5, 10, col(s, 'own'))] }) },
  'rkka.colInfTank': { name: 'Колонна пехоты с танками', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('markDiamond', 0.5, 16, col(s, 'own'))] }) },
  'rkka.colInfArt': { name: 'Колонна пехоты с артиллерией', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('eqMark', 0.5, 12, col(s, 'own'))] }) },
  'rkka.colCavalry': { name: 'Колонна кавалерии', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('flagSquareHalf', 0.5, 12, col(s, 'own'))] }) },
  'rkka.colTank': { name: 'Колонна танков', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('markDiamond', 0.35, 16, col(s, 'own')), deco('markDiamond', 0.65, 16, col(s, 'own'))] }) },
  'rkka.colArtHorse': { name: 'Колонна артиллерии на конной тяге', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('eqMark', 0.3, 12, col(s, 'own')), deco('eqMark', 0.7, 12, col(s, 'own'))] }) },
  'rkka.colArtMotor': { name: 'Колонна артиллерии на мехтяге', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('eqMark', 0.3, 12, col(s, 'own')), { type: 'glyph', glyph: 'ring', at: 0.55, to: 0.8, repeat: 0.1, length: 5, width: 5, fill: col(s, 'own'), stroke: { color: '#ffffff', width: 0.6 } }] }) },
  'rkka.colMotor': { name: 'Автомобильная колонна', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [{ type: 'glyph', glyph: 'ring', at: 0.2, to: 0.8, repeat: 0.12, length: 5, width: 5, fill: col(s, 'own'), stroke: { color: '#ffffff', width: 0.6 } }] }) },
  'rkka.colMech': { name: 'Колонна мотопехоты', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [{ type: 'glyph', glyph: 'ring', at: 0.2, to: 0.56, repeat: 0.12, length: 5, width: 5, fill: col(s, 'own'), stroke: { color: '#ffffff', width: 0.6 } }, deco('markDiamond', 0.72, 14, col(s, 'own'))] }) },
  'rkka.colRail': { name: 'Перевозка войск по железной дороге', group: RK, style: (s) => lineArrow(col(s, 'own'), { decorations: [ticksDeco(0.05, 0.85, 0.02, col(s, 'own'), 6)] }) },
  /* ---- СА [Помбрик; БУСВ; «Основные усл. обозначения»] ---- */
  'sa.attack': { name: 'Направление наступления (атаки) и контратаки', group: SA, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 1.6, dash: [7, 4] } }) },
  'sa.column': { name: 'Походная колонна батальона (общее)', group: SA, style: (s) => lineArrow(col(s, 'own'), { decorations: echelon(3, col(s, 'own')) }) },
  'sa.columnTank': { name: 'Походная колонна танковой роты', group: SA, style: (s) => lineArrow(col(s, 'own'), { decorations: [...echelon(2, col(s, 'own'), 0.82), deco('saTank', 0.55, 14, col(s, 'own'))] }) },
  'sa.columnBmp': { name: 'Походная колонна роты на БМП', group: SA, style: (s) => lineArrow(col(s, 'own'), { decorations: [...echelon(2, col(s, 'own'), 0.82), deco('saBmp', 0.55, 14, col(s, 'own'))] }) },
  'sa.columnArt': { name: 'Походная колонна артиллерийского дивизиона', group: SA, style: (s) => lineArrow(col(s, 'own', 'support'), { decorations: [...echelon(3, col(s, 'own', 'support'), 0.85), deco('eqMark', 0.55, 12, col(s, 'own', 'support'))] }) },
  'sa.fireBorder': { name: 'Граница полосы огня (основной сектор)', group: SA, style: (s) => lineArrow(col(s, 'own'), { decorations: [deco('dotMark', 0, 5, col(s, 'own'))] }) },
  'sa.fireBorderAux': { name: 'Граница полосы огня (дополнительный сектор)', group: SA, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 1.4, dash: [5, 3] }, decorations: [deco('dotMark', 0, 5, col(s, 'own'))] }) },
  'sa.reconDetachment': { name: 'Разведывательный отряд', group: SA, style: (s) => lineArrow(col(s, 'own'), { decorations: [{ type: 'glyph', glyph: 'ring', at: 0.15, length: 9, width: 9, fill: col(s, 'own'), stroke: { color: '#ffffff', width: 0.6 } }] }) },
  /* ---- общие (не по уставу; оформление исторических карт) ---- */
  'std.airStrike': { name: 'Удар авиации', group: ST, style: (s) => lineArrow(col(s, 'own'), { decorations: [{ type: 'glyph', glyph: 'plane', at: 0.35, length: 18, width: 18, fill: col(s, 'own') }] }) },
  'std.seaLanding': { name: 'Высадка морского десанта', group: ST, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 2.4 }, decorations: [{ type: 'glyph', glyph: 'anchor', at: 0.3, length: 16, width: 16, fill: col(s, 'own'), stroke: { color: col(s, 'own'), width: 1.4 } }] }) },
  'std.airLanding': { name: 'Выброска воздушного десанта', group: ST, style: (s) => lineArrow(col(s, 'own'), { centerLine: { color: col(s, 'own'), width: 1.6, dash: [5, 3] }, decorations: [{ type: 'glyph', glyph: 'rkkaAirborne', at: 0.3, length: 16, width: 16, fill: col(s, 'own'), stroke: { color: '#ffffff', width: 1.2 } }] }) },
};

/* ================================ линии ================================ */
const hooks = (size = 7): StrokeLayer['endCaps'] => ({ type: 'hook', size, side: -1 });
const tbars = (size = 8): StrokeLayer['endCaps'] => ({ type: 'bar', size });
const zig = (amp = 2.6, wl = 9) => ({ type: 'zigzag' as const, amplitude: amp, wavelength: wl });
const saLbl = (c: string, size = 9.5): TextStyle => textStyle({ font: 'PT Sans Narrow', size, weight: 400, italic: true, color: c });

export const STD_LINES: Table<LineStyle> = {
  /* ---- РККА: разграничительные линии [TM XII-8] ---- */
  'rkka.boundaryFormation': { name: 'Разграничительная линия соединений (дивизий)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'own'), endCaps: hooks(), ticks: { spacing: 22, length: 3, width: 1, side: 0, shape: 'circle', fit: true } })] }) },
  'rkka.boundaryUnit': { name: 'Разграничительная линия частей (полков)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.3, color: col(s, 'own'), dash: [10, 3, 2, 3], endCaps: hooks() })] }) },
  'rkka.boundaryElement': { name: 'Разграничительная линия подразделений (батальонов)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.2, color: col(s, 'own'), dash: [6, 3], endCaps: hooks() })] }) },
  'rkka.boundaryArmy': { name: 'Разграничительная линия армий', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.9, color: col(s, 'own'), dash: [13, 4, 2, 4, 2, 4], endCaps: hooks(9) })] }) },
  'rkka.boundaryFront': { name: 'Разграничительная линия фронтов', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 2.4, color: col(s, 'own'), dash: [16, 4, 2.5, 4, 2.5, 4], endCaps: hooks(11) })] }) },
  /* ---- РККА: фортификация [TM XII-13, XII-14] ---- */
  'rkka.trench': { name: 'Траншея (окоп) с зубцами к противнику', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.5, color: col(s, 'own'), ticks: { spacing: 5, length: 3, width: 1, side: 1 } })] }) },
  'rkka.commTrench': { name: 'Ход сообщения', group: RK, style: (s) => ({ smooth: true, layers: [L({ offset: 1.8, width: 1, color: col(s, 'neutral'), pattern: zig(1.3, 6) }), L({ offset: -1.8, width: 1, color: col(s, 'neutral'), pattern: zig(1.3, 6) })] }) },
  'rkka.commTrenchCovered': { name: 'Ход сообщения перекрытый', group: RK, style: (s) => ({ smooth: true, layers: [L({ offset: 1.8, width: 1, color: col(s, 'neutral'), pattern: zig(1.3, 6) }), L({ offset: -1.8, width: 1.6, color: col(s, 'neutral'), pattern: zig(1.3, 6) })] }) },
  'rkka.commTrenchHidden': { name: 'Ход сообщения скрытый', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.1, color: col(s, 'neutral'), dash: [4, 3], endCaps: { type: 'arrow', size: 5, start: false } })] }) },
  /* ---- РККА: заграждения [TM XII-14] ---- */
  'rkka.wire1': { name: 'Проволочное заграждение (один ряд)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: zig(3, 12) }), L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 6, length: 3.4, width: 0.9, side: 0, shape: 'x', fit: true, every: 2 } })] }) },
  'rkka.wire3': { name: 'Проволочное заграждение (три ряда)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: zig(3, 12) }), L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 6, length: 2.6, width: 1, side: 0, shape: 'dot', fit: true, every: 2 } })] }) },
  'rkka.wire10': { name: 'Проволочное заграждение (десять рядов)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: zig(3, 12) }), L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 6, length: 3, width: 0.9, side: 0, shape: 'circle', fit: true, every: 2 } })] }) },
  'rkka.wireLow': { name: 'Низкое проволочное заграждение', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: zig(2.4, 12) }), L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 3, length: 2.2, width: 0.8, side: 0, shape: 'circle', fit: true } })] }) },
  'rkka.concertina': { name: 'Спираль Бруно (концертина)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: { type: 'loops', amplitude: 2.2, wavelength: 4.5 } })] }) },
  'rkka.inconspicuous': { name: 'Малозаметное препятствие', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: zig(3, 12), dash: [2.5, 2] })] }) },
  'rkka.removable': { name: 'Переносное препятствие (рогатки)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), ticks: { spacing: 9, length: 3.6, width: 0.9, side: 0, shape: 'x' } })] }) },
  'rkka.electrified': { name: 'Электризованное проволочное заграждение', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), pattern: zig(3, 12) }), L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 6, length: 4.5, width: 0.7, side: 0, shape: 'slash', count: 3, fit: true, every: 2 } })] }) },
  'rkka.wireFence': { name: 'Проволочный забор (усиленный)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), ticks: { spacing: 3.6, length: 3, width: 0.9, side: 0, shape: 'x' } })] }) },
  'rkka.atBarrier': { name: 'Противотанковое заграждение (общее)', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'neutral'), pattern: zig(3, 10) }), L({ width: 0, color: col(s, 'neutral'), ticks: { spacing: 5, length: 4, width: 1.3, side: 0, shape: 'x', fit: true, every: 2 } })] }) },
  'rkka.atDitch': { name: 'Противотанковый ров', group: RK, style: (s) => ({ smooth: true, layers: [L({ offset: 2.4, width: 0.9, color: col(s, 'neutral') }), L({ offset: -2.4, width: 0.9, color: col(s, 'neutral') }), L({ width: 0.8, color: col(s, 'neutral'), dash: [3, 2] })] }) },
  'rkka.escarp': { name: 'Противотанковый эскарп', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.1, color: col(s, 'neutral'), pattern: zig(3.5, 11) })] }) },
  'rkka.dragonTeeth': { name: 'Надолбы', group: RK, style: (s) => ({ smooth: true, layers: [L({ offset: 2.6, width: 0, color: col(s, 'neutral'), ticks: { spacing: 3, length: 4.4, width: 1, side: 0, shape: 'slash' } }), L({ offset: -2.6, width: 0, color: col(s, 'neutral'), ticks: { spacing: 3, length: 4.4, width: 1, side: 0, shape: 'slash' } })] }) },
  'rkka.abatis': { name: 'Лесной завал', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'neutral'), ticks: { spacing: 2.6, length: 4.4, width: 0.9, side: 0, shape: 'chevron' } })] }) },
  'rkka.minesAP': { name: 'Противопехотное минное поле (полосой)', group: RK, style: (s) => ({ smooth: true, layers: [L({ offset: 2.2, width: 0, color: col(s, 'neutral'), ticks: { spacing: 5, length: 2.4, width: 0.8, side: 0, shape: 'circle' } }), L({ offset: -2.2, width: 0, color: col(s, 'neutral'), ticks: { spacing: 5, length: 2.4, width: 0.8, side: 0, shape: 'circle', phase: 1 } })] }) },
  'rkka.minesAT': { name: 'Противотанковое минное поле (полосой)', group: RK, style: (s) => ({ smooth: true, layers: [L({ offset: 2.2, width: 0, color: col(s, 'neutral'), ticks: { spacing: 5, length: 2.6, width: 0.8, side: 0, shape: 'dot' } }), L({ offset: -2.2, width: 0, color: col(s, 'neutral'), ticks: { spacing: 5, length: 2.6, width: 0.8, side: 0, shape: 'dot', phase: 1 } })] }) },
  /* ---- РККА: связь и пути подвоза [TM XII-11, XII-13] ---- */
  'rkka.supplyAxis': { name: 'Путь подвоза и эвакуации', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.2, color: col(s, 'own'), dash: [6, 4], ticks: { spacing: 10, length: 3.5, width: 1, side: 0, shape: 'cross' } })] }) },
  'rkka.messenger': { name: 'Связь посыльными', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.1, color: col(s, 'own'), dash: [4, 3] })] }) },
  'rkka.telegraphLine': { name: 'Постоянная телеграфная линия', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1.1, color: col(s, 'own'), dash: [8, 2, 1.5, 2, 1.5, 2] })] }) },
  'rkka.cable': { name: 'Кабельная линия', group: RK, style: (s) => ({ smooth: true, layers: [L({ width: 1, color: col(s, 'own'), pattern: { type: 'wave', amplitude: 1.2, wavelength: 4 } })] }) },

  /* ---- СА: рубежи и линии [Помбрик, БУСВ, «Основные»] ---- */
  'sa.frontLine': { name: 'Фронт (рубеж), занимаемый подразделениями', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 2, color: col(s, 'own'), endCaps: { type: 'bend', size: 10, side: -1 } })] }) },
  'sa.startLine': { name: 'Исходный рубеж, рубеж регулирования', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.5, color: col(s, 'own'), dash: [8, 4], endCaps: tbars() })] }) },
  'sa.attackLine': { name: 'Рубеж перехода в атаку', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.5, color: col(s, 'own'), dash: [8, 4], endCaps: tbars() })], marks: [{ glyph: 'markArrow', at: [0.5], size: 14 }] }) },
  'sa.deployLine': { name: 'Рубеж развёртывания в батальонные колонны', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.5, color: col(s, 'own'), dash: [8, 4], endCaps: tbars() })], marks: [{ glyph: 'markArrow3', at: [0.5], size: 14 }] }) },
  'sa.dismountLine': { name: 'Рубеж спешивания', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.5, color: col(s, 'own'), dash: [8, 4], endCaps: tbars() })], marks: [{ glyph: 'markT', at: [0.33, 0.66], size: 10 }] }) },
  'sa.tankFireLine': { name: 'Огневой рубеж танкового подразделения', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.5, color: col(s, 'own'), dash: [8, 4], endCaps: tbars() })], marks: [{ glyph: 'markDiamond', at: [0.06, 0.94], size: 16, orient: 'tangent' }] }) },
  'sa.meetLine': { name: 'Рубеж вероятной встречи с противником', group: SA, style: () => ({ smooth: true, layers: [L({ offset: 2.2, width: 1.4, color: BLUE, dash: [8, 4], endCaps: tbars(7) }), L({ offset: -2.2, width: 1.4, color: RED, dash: [8, 4], endCaps: tbars(7) })] }) },
  'sa.miningLine': { name: 'Рубеж минирования', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.3, color: col(s, 'own', 'support'), dash: [7, 3, 1.4, 3], endCaps: tbars(7) })] }) },
  'sa.seaLanding': { name: 'Участок высадки морского десанта', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'own'), dash: [5, 3], endCaps: tbars() }), L({ width: 4, color: col(s, 'own'), dash: [6, 14] })] }) },
  'sa.notOccupied': { name: 'Рубеж (позиция) обороны, не занятый подразделениями', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'own'), dash: [10, 6], ticks: { spacing: 8, length: 3, width: 1, side: 1 } })] }) },
  'sa.positionTime': { name: 'Положение подразделения к определённому времени', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.6, color: col(s, 'own'), endCaps: { type: 'bend', size: 8, side: -1 } })], labels: [{ text: '09.00', at: [0.5], offset: -8, style: saLbl(col(s, 'own')) }] }) },
  'sa.boundaryDivision': { name: 'Разграничительная линия между дивизиями (бригадами)', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'own'), endCaps: hooks() })] }) },
  'sa.boundaryRegiment': { name: 'Разграничительная линия между полками', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.3, color: col(s, 'own'), dash: [10, 3, 2, 3], endCaps: hooks() })] }) },
  'sa.boundaryBattalion': { name: 'Разграничительная линия между батальонами', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.2, color: col(s, 'own'), dash: [6, 3], endCaps: hooks() })] }) },
  'sa.trench': { name: 'Траншея', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.5, color: col(s, 'own'), ticks: { spacing: 5, length: 3, width: 1, side: 1 } })] }) },
  'sa.commTrench': { name: 'Ход сообщения', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.4, color: col(s, 'own') })] }) },
  'sa.nzo': { name: 'Неподвижный заградительный огонь (рубеж НЗО)', group: SA, style: (s) => ({ smooth: false, layers: [L({ width: 1.6, color: col(s, 'own', 'support'), endCaps: tbars(7) })] }) },
  'sa.wire': { name: 'Проволочное заграждение (штрихи — число рядов)', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'own', 'support'), pattern: zig(2.2, 14) }), L({ width: 0, color: col(s, 'own', 'support'), ticks: { spacing: 7, length: 4.4, width: 0.9, side: 0, shape: 'slash', count: 2, fit: true, every: 2 } })] }) },
  'sa.wireLow': { name: 'Малозаметное заграждение (спираль, сеть на низких кольях)', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'own', 'support'), pattern: { type: 'loops', amplitude: 2.2, wavelength: 4.5 } })] }) },
  'sa.hedgehogs': { name: 'Заграждение из ежей', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 0, color: col(s, 'own', 'support'), ticks: { spacing: 6, length: 4.4, width: 1.3, side: 0, shape: 'x' } })] }) },
  'sa.atDitch': { name: 'Противотанковый ров', group: SA, style: (s) => ({ smooth: true, layers: [L({ offset: 2.4, width: 1, color: col(s, 'own', 'support') }), L({ offset: -2.4, width: 1, color: col(s, 'own', 'support') }), L({ width: 0.9, color: col(s, 'own', 'support'), dash: [3.5, 2.5] })] }) },
  'sa.escarp': { name: 'Эскарп (контрэскарп)', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.1, color: col(s, 'own', 'support'), pattern: zig(2.4, 16) })] }) },
  'sa.dragonTeeth': { name: 'Надолбы', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 0, color: col(s, 'own', 'support'), ticks: { spacing: 3, length: 5, width: 1.1, side: 0, shape: 'slash' } })] }) },
  'sa.abatisMined': { name: 'Минированный завал', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 0.9, color: col(s, 'own', 'support'), ticks: { spacing: 8, length: 5, width: 0.9, side: 0, shape: 'chevron' } }), L({ width: 0, color: col(s, 'own', 'support'), offset: -2.5, ticks: { spacing: 8, length: 2, width: 0.8, side: 0, shape: 'circle', phase: 1 } })] }) },
  'sa.aerosol': { name: 'Рубеж постановки аэрозольной (дымовой) завесы', group: SA, style: (s) => ({ smooth: true, layers: [L({ width: 1.2, color: col(s, 'own', 'support'), dash: [4, 3], endCaps: tbars(7) })], marks: [{ glyph: 'markV', at: [0.3, 0.7], size: 10 }] }) },
  'sa.route': { name: 'Маршрут движения', group: SA, style: () => ({ smooth: true, layers: [L({ width: 1.4, color: BROWN })] }) },

  /* ---- общие: дороги, границы, завесы ---- */
  'std.road': { name: 'Шоссе / дорога с покрытием', group: ST, style: () => ({ smooth: true, layers: [L({ width: 4, color: '#3a3a3a' }), L({ width: 2.4, color: '#f6e7b4' })] }) },
  'std.dirtRoad': { name: 'Грунтовая дорога', group: ST, style: () => ({ smooth: true, layers: [L({ width: 1.1, color: '#3a3a3a', dash: [6, 3] })] }) },
  'std.winterRoad': { name: 'Зимняя дорога', group: ST, style: () => ({ smooth: true, layers: [L({ width: 1.4, color: '#3a3a3a', dash: [0.1, 2.4], cap: 'round' })] }) },
  'std.border': { name: 'Государственная граница', group: ST, style: () => ({ smooth: false, layers: [L({ width: 6, color: '#c9a6d6', opacity: 0.6 }), L({ width: 1.6, color: '#5b2a74', dash: [10, 3, 2, 3, 2, 3] })] }) },
  'std.smoke': { name: 'Дымовая завеса (на исторических картах)', group: ST, style: () => ({ smooth: true, layers: [L({ width: 7, color: '#8a8a8a', opacity: 0.35, cap: 'round' }), L({ width: 1, color: '#6a6a6a', pattern: { type: 'wave', amplitude: 2, wavelength: 8 } })] }) },
  'std.frontLine': { name: 'Передний край (линия соприкосновения)', group: ST, style: (s) => ({ smooth: true, layers: [L({ width: 2.4, color: col(s, 'own'), cap: 'round' })] }) },
};

/* ================================ районы ================================ */
const area = (p: Partial<AreaStyle>): AreaStyle => ({ smooth: true, fill: null, fillOpacity: 1, hatch: null, edge: [], cross: null, ...p });

export const STD_AREAS: Table<AreaStyle> = {
  /* ---- РККА [TM XII-7, XII-8, XII-10, XII-12, XII-14] ---- */
  'rkka.position': { name: 'Район расположения части', group: RK, style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own') })] }) },
  'rkka.positionPlanned': { name: 'Район, намеченный к занятию', group: RK, style: (s) => area({ edge: [L({ width: 1.5, color: col(s, 'own'), dash: [6, 4] })] }) },
  'rkka.positionCav': { name: 'Район расположения кавалерии', group: RK, style: (s) => area({ hatch: { color: col(s, 'own'), width: 1, spacing: 4, angle: -45, opacity: 1 }, edge: [L({ width: 1.6, color: col(s, 'own') })] }) },
  'rkka.defense': { name: 'Расположение войск в обороне (опорный пункт)', group: RK, style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own'), ticks: { spacing: 6, length: 3.5, width: 1.1, side: -1 } })] }) },
  'rkka.concentration': { name: 'Сосредоточенный огонь (участок)', group: RK, style: (s) => area({ smooth: false, hatch: { color: col(s, 'own'), width: 0.8, spacing: 3, angle: 45, opacity: 1 }, edge: [L({ width: 1, color: col(s, 'own') })] }) },
  'rkka.destructionFire': { name: 'Огонь на уничтожение', group: RK, style: (s) => area({ hatch: { color: col(s, 'own'), width: 0.8, spacing: 3, angle: 45, opacity: 1 }, edge: [L({ width: 1, color: col(s, 'own') })] }) },
  'rkka.minefieldAP': { name: 'Минное поле противопехотное', group: RK, style: (s) => area({ smooth: false, hatch: { color: col(s, 'neutral'), width: 0.8, spacing: 6, angle: 0, opacity: 1, pattern: 'circles' } }) },
  'rkka.minefieldAT': { name: 'Минное поле противотанковое', group: RK, style: (s) => area({ smooth: false, hatch: { color: col(s, 'neutral'), width: 1.1, spacing: 6, angle: 0, opacity: 1, pattern: 'dots' } }) },
  'rkka.contaminated': { name: 'Заражённый участок', group: RK, style: (s) => area({ smooth: false, hatch: { color: col(s, 'neutral'), width: 0.8, spacing: 3, angle: 45, opacity: 1 }, edge: [L({ width: 1, color: col(s, 'neutral') })] }) },
  'rkka.inundation': { name: 'Затопление', group: RK, style: () => area({ fill: '#bfe3f7', fillOpacity: 0.5, hatch: { color: BLUE, width: 0.6, spacing: 3, angle: 90, opacity: 0.9 }, edge: [L({ width: 1, color: BLUE })] }) },
  'rkka.encircled': { name: 'Окружённая группировка', group: RK, style: (s) => area({ fill: col(s, 'enemy'), fillOpacity: 0.1, hatch: { color: col(s, 'enemy'), width: 0.8, spacing: 5, angle: -45, opacity: 0.8 }, edge: [L({ width: 1.8, color: col(s, 'enemy') })] }) },
  /* ---- СА ---- */
  'sa.unitArea': { name: 'Район, занимаемый подразделением', group: SA, style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own') })] }) },
  'sa.unitAreaSupport': { name: 'Район подразделения специальных войск', group: SA, style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own', 'support') })] }) },
  'sa.unitAreaPlanned': { name: 'Район, намеченный к занятию', group: SA, style: (s) => area({ edge: [L({ width: 1.5, color: col(s, 'own'), dash: [6, 4] })] }) },
  'sa.defense': { name: 'Расположение подразделения в обороне (опорный пункт)', group: SA, style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own'), ticks: { spacing: 6, length: 3.5, width: 1.1, side: -1 } })] }) },
  'sa.minefieldAT': { name: 'Противотанковое минное поле', group: SA, style: (s) => area({ smooth: false, hatch: { color: col(s, 'own', 'support'), width: 1.4, spacing: 6, angle: 0, opacity: 1, pattern: 'dots' }, edge: [L({ width: 1, color: col(s, 'own', 'support') })] }) },
  'sa.minefieldAP': { name: 'Противопехотное минное поле', group: SA, style: (s) => area({ smooth: false, hatch: { color: col(s, 'own', 'support'), width: 0.8, spacing: 6, angle: 0, opacity: 1, pattern: 'circles' }, edge: [L({ width: 1, color: col(s, 'own', 'support') })] }) },
  'sa.chemArea': { name: 'Участок, заражённый ОВ', group: SA, style: (s) => area({ fill: YELLOW, fillOpacity: 0.85, edge: [L({ width: 1.4, color: col(s, 'enemy') })] }) },
  'sa.bioArea': { name: 'Участок, заражённый биологическими средствами', group: SA, style: (s) => area({ fill: '#b89268', fillOpacity: 0.5, hatch: { color: '#4a3020', width: 1.2, spacing: 4, angle: 45, opacity: 1 }, edge: [L({ width: 1.4, color: col(s, 'enemy') })] }) },
  'sa.fireZone': { name: 'Район (зона) пожара', group: SA, style: () => area({ edge: [L({ width: 1.8, color: RED })] }) },
  'sa.smokeZone': { name: 'Участок задымления', group: SA, style: () => area({ hatch: { color: BLACK, width: 0.6, spacing: 4, angle: 30, opacity: 0.6 }, edge: [L({ width: 1.2, color: BLACK })] }) },
  'sa.landingArea': { name: 'Район высадки воздушного десанта', group: SA, style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own'), dash: [6, 4] })] }) },
  'sa.crossingSector': { name: 'Участок форсирования', group: SA, style: (s) => area({ edge: [L({ width: 1.5, color: col(s, 'own'), dash: [6, 4] })] }) },
  'sa.treatmentArea': { name: 'Район специальной обработки', group: SA, style: (s) => area({ edge: [L({ width: 1.6, color: col(s, 'own', 'support') })] }) },
  'sa.concFire': { name: 'Сосредоточенный огонь (участок)', group: SA, style: (s) => area({ smooth: false, edge: [L({ width: 1.4, color: col(s, 'own', 'support') })] }) },
  /* ---- общие ---- */
  'std.bridgehead': { name: 'Плацдарм', group: ST, style: (s) => area({ fill: col(s, 'own'), fillOpacity: 0.12, edge: [L({ width: 2.2, color: col(s, 'own') })] }) },
  'std.partisanArea': { name: 'Партизанский район (край)', group: ST, style: () => area({ fill: RED, fillOpacity: 0.06, hatch: { color: RED, width: 0.6, spacing: 6, angle: 45, opacity: 0.6, pattern: 'cross' }, edge: [L({ width: 1.4, color: RED, dash: [2, 3] })] }) },
  'std.forest': { name: 'Лес', group: ST, style: () => area({ fill: '#d9ecc6', fillOpacity: 1, hatch: { color: '#6a9f58', width: 0.7, spacing: 9, angle: 0, opacity: 1, pattern: 'trees' }, edge: [L({ width: 0.6, color: '#6a9f58', dash: [2, 2] })] }) },
  'std.swamp': { name: 'Болото', group: ST, style: () => area({ fill: '#e3f1f6', fillOpacity: 0.7, hatch: { color: '#4a90c0', width: 0.8, spacing: 6, angle: 0, opacity: 1, pattern: 'swamp' } }) },
};

/* ============================== точечные знаки ============================== */
const g = (type: string, size: number, def: Side, service: Service = 'combat', p: Partial<SymbolStyle> = {}) =>
  (s?: Side) => sym(type, { size, color: col(s, def, service), fill: '#ffffff', strokeWidth: Math.max(0.9, size * 0.065), textStyle: textStyle({ font: 'PT Sans Narrow', size: size * 0.4, weight: 400, italic: true }), ...p });

export const STD_SYMBOLS: Table<SymbolStyle> = {
  /* ---- РККА: штабы и пункты управления [TM XII-7] ---- */
  'rkka.hqFront': { name: 'Штаб фронта (группы армий)', group: RK, style: g('rkkaHqFront', 26, 'own', 'combat', { text: '1БФ' }) },
  'rkka.hqArmy': { name: 'Штаб армии', group: RK, style: g('rkkaHqArmy', 26, 'own', 'combat', { text: '2А' }) },
  'rkka.hqCorps': { name: 'Штаб корпуса (ск, тк, кк)', group: RK, style: g('rkkaHqCorps', 24, 'own', 'combat', { text: '9ск' }) },
  'rkka.hqCorpsCav': { name: 'Штаб кавалерийского корпуса', group: RK, style: g('rkkaHqCorpsCav', 24, 'own', 'combat', { text: '2кк' }) },
  'rkka.hqDivision': { name: 'Штаб соединения (дивизии, бригады)', group: RK, style: g('rkkaHqDivision', 24, 'own', 'combat', { text: '4сд' }) },
  'rkka.hqDivisionCav': { name: 'Штаб кавалерийской дивизии', group: RK, style: g('rkkaHqDivisionCav', 24, 'own', 'combat', { text: '5кд' }) },
  'rkka.hqRegiment': { name: 'Штаб части (полка)', group: RK, style: g('rkkaHqRegiment', 22, 'own', 'combat', { text: '10сп' }) },
  'rkka.hqRegimentCav': { name: 'Штаб кавалерийского полка', group: RK, style: g('rkkaHqRegimentCav', 22, 'own', 'combat', { text: '15кп' }) },
  'rkka.hqBattalion': { name: 'Штаб подразделения (батальона)', group: RK, style: g('rkkaHqBattalion', 20, 'own', 'combat', { text: '3' }) },
  'rkka.cp': { name: 'Командный пункт', group: RK, style: g('rkkaCp', 22, 'own', 'combat', { text: '2А' }) },
  'rkka.op': { name: 'Наблюдательный пункт', group: RK, style: g('stdOp', 13, 'own') },
  'rkka.opSurveyed': { name: 'Наблюдательный пункт (координаты определены)', group: RK, style: g('rkkaOpSurveyed', 13, 'own') },
  'rkka.opReserve': { name: 'Запасный наблюдательный пункт', group: RK, style: g('stdOp', 13, 'own', 'combat', { text: '3' }) },
  'rkka.trafficMain': { name: 'Главный пост регулирования движения', group: RK, style: g('rkkaTrafficMain', 18, 'own') },
  'rkka.trafficPost': { name: 'Пост регулирования движения', group: RK, style: g('rkkaTrafficPost', 18, 'own') },
  'rkka.trafficAux': { name: 'Вспомогательный пост регулирования', group: RK, style: g('rkkaAirWarning', 10, 'own') },
  'rkka.messageCenter': { name: 'Пункт сбора донесений', group: RK, style: g('rkkaMessageCenter', 18, 'own') },
  'rkka.telegraph': { name: 'Телеграф', group: RK, style: g('rkkaTelegraph', 10, 'own') },
  /* ---- РККА: пехотное оружие и артиллерия [TM XII-9, XII-10] ---- */
  'rkka.lmg': { name: 'Ручной пулемёт', group: RK, style: g('rkkaLmg', 13, 'own') },
  'rkka.hmg': { name: 'Станковый пулемёт (7,62 мм)', group: RK, style: g('rkkaHmg', 13, 'own') },
  'rkka.hmg12': { name: 'Крупнокалиберный пулемёт (12,7 мм)', group: RK, style: g('rkkaHmg12', 13, 'own') },
  'rkka.atRifle': { name: 'Противотанковое ружьё', group: RK, style: g('rkkaAtRifle', 13, 'own') },
  'rkka.atGunSmall': { name: 'Противотанковая пушка малого калибра (45–57 мм)', group: RK, style: g('rkkaAtGunSmall', 15, 'own') },
  'rkka.infHowitzer': { name: 'Полковая пушка (76-мм)', group: RK, style: g('rkkaInfHowitzer', 14, 'own') },
  'rkka.mortar50': { name: 'Миномёт 50-мм', group: RK, style: g('rkkaMortar50', 13, 'own') },
  'rkka.mortar82': { name: 'Миномёт 82-мм', group: RK, style: g('rkkaMortar82', 13, 'own') },
  'rkka.mortar120': { name: 'Миномёт 120-мм', group: RK, style: g('rkkaMortar120', 14, 'own') },
  'rkka.gun76': { name: 'Пушка 76-мм (артиллерия вообще)', group: RK, style: g('rkkaGun76', 15, 'own') },
  'rkka.gunMed': { name: 'Пушка средняя (100–122 мм)', group: RK, style: g('rkkaGunMed', 15, 'own') },
  'rkka.gunHeavy': { name: 'Пушка тяжёлая (152–203 мм)', group: RK, style: g('rkkaGunHeavy', 15, 'own') },
  'rkka.howitzer': { name: 'Гаубица 122-мм', group: RK, style: g('rkkaHowitzer', 15, 'own') },
  'rkka.howHeavy': { name: 'Гаубица средняя и тяжёлая (от 152 мм)', group: RK, style: g('rkkaHowHeavy', 15, 'own') },
  'rkka.gunMountain': { name: 'Горная пушка 76-мм', group: RK, style: g('rkkaGunMountain', 15, 'own') },
  'rkka.rocket': { name: 'Реактивная установка', group: RK, style: g('rkkaRocket', 16, 'own') },
  'rkka.battery': { name: 'Батарея на огневой позиции', group: RK, style: g('rkkaBattery', 18, 'own') },
  'rkka.batteryPlanned': { name: 'Намеченная огневая позиция батареи', group: RK, style: g('rkkaBatteryPlanned', 18, 'own') },
  'rkka.observer': { name: 'Наблюдатель', group: RK, style: g('rkkaObserver', 12, 'own') },
  'rkka.soundRanging': { name: 'Пост звуковой разведки', group: RK, style: g('rkkaSoundRanging', 13, 'own') },
  /* ---- РККА: танки и бронетехника [TM XII-10] ---- */
  'rkka.tankLight': { name: 'Танк лёгкий (или тип не указан)', group: RK, style: g('rkkaTankLight', 18, 'own') },
  'rkka.tankMedium': { name: 'Танк средний', group: RK, style: g('rkkaTankMedium', 18, 'own') },
  'rkka.tankHeavy': { name: 'Танк тяжёлый', group: RK, style: g('rkkaTankHeavy', 18, 'own') },
  'rkka.spg': { name: 'Самоходная артиллерийская установка', group: RK, style: g('rkkaSpg', 18, 'own') },
  'rkka.tankMine': { name: 'Танк-тральщик', group: RK, style: g('rkkaTankMine', 18, 'own') },
  'rkka.armoredCar': { name: 'Бронеавтомобиль лёгкий', group: RK, style: g('rkkaArmoredCar', 15, 'own') },
  'rkka.armoredCarHeavy': { name: 'Бронеавтомобиль тяжёлый', group: RK, style: g('rkkaArmoredCarHeavy', 15, 'own') },
  'rkka.halfTrack': { name: 'Полугусеничный бронетранспортёр', group: RK, style: g('rkkaHalfTrack', 15, 'own') },
  'rkka.armoredTrain': { name: 'Бронепоезд', group: RK, style: g('armoredTrain', 18, 'own') },
  /* ---- РККА: авиация и ПВО [TM XII-11, XII-12] ---- */
  'rkka.airfield': { name: 'Аэродром (З — запасный, Л — ложный)', group: RK, style: g('rkkaAirfield', 16, 'own') },
  'rkka.airdrome': { name: 'Постоянный аэродром', group: RK, style: g('rkkaAirdrome', 16, 'own') },
  'rkka.landingField': { name: 'Посадочная площадка', group: RK, style: g('rkkaLandingField', 16, 'own') },
  'rkka.landingHeavy': { name: 'Посадочная площадка для тяжёлых самолётов', group: RK, style: g('stdLandingT', 16, 'own') },
  'rkka.airborne': { name: 'Высадка воздушного десанта', group: RK, style: g('rkkaAirborne', 18, 'own') },
  'rkka.airCargo': { name: 'Сброс грузов на парашютах', group: RK, style: g('rkkaAirCargo', 18, 'own') },
  'rkka.airFighter': { name: 'Истребительный авиаполк', group: RK, style: g('rkkaAirFighter', 18, 'own') },
  'rkka.airAttack': { name: 'Штурмовой авиаполк', group: RK, style: g('rkkaAirAttack', 18, 'own') },
  'rkka.airBomber': { name: 'Бомбардировочный авиаполк', group: RK, style: g('rkkaAirBomber', 18, 'own') },
  'rkka.airRecon': { name: 'Разведывательный авиаполк', group: RK, style: g('rkkaAirRecon', 18, 'own') },
  'rkka.aaBattery': { name: 'Зенитная артиллерийская батарея', group: RK, style: g('rkkaAaBattery', 18, 'own') },
  'rkka.aaMg': { name: 'Зенитный пулемёт', group: RK, style: g('rkkaAaMg', 15, 'own') },
  'rkka.aaGunSmall': { name: 'Зенитная пушка малого калибра', group: RK, style: g('rkkaAaGunSmall', 15, 'own') },
  'rkka.searchlight': { name: 'Зенитный прожектор', group: RK, style: g('rkkaSearchlight', 16, 'own') },
  'rkka.balloon': { name: 'Аэростат заграждения', group: RK, style: g('rkkaBalloon', 16, 'own') },
  'rkka.airWarning': { name: 'Пост ВНОС (воздушного наблюдения)', group: RK, style: g('rkkaAirWarning', 13, 'own') },
  /* ---- РККА: фортификация [TM XII-13, XII-14] ---- */
  'rkka.trenchSquad': { name: 'Окоп стрелкового отделения', group: RK, style: g('rkkaTrenchSquad', 16, 'own') },
  'rkka.trenchLmg': { name: 'Окоп ручного пулемёта', group: RK, style: g('rkkaTrenchLmg', 16, 'own') },
  'rkka.trenchHmg': { name: 'Окоп станкового пулемёта', group: RK, style: g('rkkaTrenchHmg', 16, 'own') },
  'rkka.trenchMortar': { name: 'Окоп миномёта', group: RK, style: g('rkkaTrenchMortar', 16, 'own') },
  'rkka.trenchAtGun': { name: 'Окоп противотанкового орудия', group: RK, style: g('rkkaTrenchAtGun', 16, 'own') },
  'rkka.trenchReserve': { name: 'Запасный окоп', group: RK, style: g('rkkaTrenchReserve', 16, 'own') },
  'rkka.mgCovered': { name: 'Перекрытая пулемётная площадка', group: RK, style: g('rkkaMgCovered', 16, 'own') },
  'rkka.mgSplinter': { name: 'Противоосколочное пулемётное сооружение', group: RK, style: g('rkkaMgSplinter', 15, 'own') },
  'rkka.dzot': { name: 'ДЗОТ (усиленное дерево-земляное пулемётное сооружение)', group: RK, style: g('rkkaDzot', 15, 'own') },
  'rkka.dot': { name: 'ДОТ (железобетонное пулемётное сооружение)', group: RK, style: g('rkkaDot', 15, 'own') },
  'rkka.fort': { name: 'Форт', group: RK, style: g('rkkaFort', 20, 'own') },
  'rkka.turret': { name: 'Бронированная пулемётная башня', group: RK, style: g('rkkaTurret', 14, 'own') },
  'rkka.shelter': { name: 'Убежище (общее)', group: RK, style: g('stdShelter', 14, 'own') },
  'rkka.shelterEarth': { name: 'Лёгкое земляное убежище', group: RK, style: g('rkkaShelterEarth', 14, 'own') },
  'rkka.atStrongpoint': { name: 'Противотанковый опорный пункт', group: RK, style: g('rkkaAtStrongpoint', 20, 'own') },
  /* ---- РККА: заграждения [TM XII-14] ---- */
  'rkka.mineAT': { name: 'Противотанковая мина', group: RK, style: g('stdMineAT', 6, 'neutral') },
  'rkka.mineAP': { name: 'Противопехотная мина', group: RK, style: g('stdMineAP', 6, 'neutral') },
  'rkka.charge': { name: 'Заряд ВВ (фугас)', group: RK, style: g('saFougasse', 11, 'neutral') },
  'rkka.delayedMine': { name: 'Мина замедленного действия', group: RK, style: g('rkkaDelayedMine', 11, 'neutral') },
  'rkka.boobyTrap': { name: 'Мина-сюрприз', group: RK, style: g('rkkaBoobyTrap', 10, 'neutral') },
  'rkka.unremovable': { name: 'Неизвлекаемая мина', group: RK, style: g('rkkaUnremovableMine', 10, 'neutral') },
  'rkka.fragMine': { name: 'Противопехотная осколочная мина', group: RK, style: g('rkkaFragMine', 10, 'neutral') },
  'rkka.tankTrap': { name: 'Танковая ловушка', group: RK, style: g('rkkaTankTrap', 12, 'neutral') },
  /* ---- РККА: тыл [TM XII-16, XII-17] ---- */
  'rkka.supplyStation': { name: 'Станция снабжения', group: RK, style: g('rkkaSupplyStation', 18, 'own') },
  'rkka.armyDepot': { name: 'Армейский склад (пункт снабжения танкового корпуса)', group: RK, style: g('rkkaArmyDepot', 15, 'own') },
  'rkka.divSupply': { name: 'Дивизионный пункт снабжения', group: RK, style: g('rkkaDivSupply', 14, 'own') },
  'rkka.fuelPoint': { name: 'Дивизионный пункт горючего', group: RK, style: g('rkkaFuelPoint', 14, 'own') },
  'rkka.ammoPoint': { name: 'Полковой (батальонный) пункт боепитания', group: RK, style: g('rkkaAmmoPoint', 18, 'own', 'combat', { text: 'П АБ' }) },
  'rkka.medDivision': { name: 'Дивизионный медицинский пункт', group: RK, style: g('rkkaMedDivision', 14, 'own') },
  'rkka.medRegiment': { name: 'Полковой медицинский пункт', group: RK, style: g('stdMedRegiment', 14, 'own') },
  'rkka.medBattalion': { name: 'Батальонный медицинский пункт', group: RK, style: g('stdMedBattalion', 14, 'own') },
  'rkka.hospital': { name: 'Госпиталь (ВПГ — полевой подвижной)', group: RK, style: g('rkkaHospital', 18, 'own', 'combat', { text: 'ВПГ' }) },
  'rkka.vehicleCollection': { name: 'Сборный пункт аварийных машин', group: RK, style: g('stdVehicleCollection', 14, 'own') },
  /* ---- РККА: разведка [TM XII-7, XII-10] ---- */
  'rkka.reconInf': { name: 'Пехотный разведывательный дозор', group: RK, style: g('rkkaReconInf', 14, 'own') },
  'rkka.reconCav': { name: 'Кавалерийский разведывательный дозор', group: RK, style: g('rkkaReconCav', 14, 'own') },
  'rkka.reconTank': { name: 'Танковый разведывательный дозор', group: RK, style: g('rkkaReconTank', 14, 'own') },
  'rkka.assembly': { name: 'Сборный район (К, З, П)', group: RK, style: g('rkkaAssembly', 16, 'own') },

  /* ---- СА: пункты управления и связь ---- */
  'sa.cpRegiment': { name: 'Пункт управления (штаб) полка', group: SA, style: g('saCpRegiment', 24, 'own', 'combat', { text: '5 мсп' }) },
  'sa.cpBattalion': { name: 'Командно-наблюдательный пункт батальона', group: SA, style: g('saCpBattalion', 20, 'own') },
  'sa.cpCompany': { name: 'КНП роты', group: SA, style: g('saCpCompany', 18, 'own') },
  'sa.cpPlatoon': { name: 'КНП взвода', group: SA, style: g('saCpPlatoon', 18, 'own') },
  'sa.op': { name: 'Наблюдательный пункт (А, В, И, Т, Х — вид)', group: SA, style: g('stdOp', 13, 'own') },
  'sa.traffic': { name: 'Пост регулирования (Р, К, КПП, КТП)', group: SA, style: g('saTraffic', 13, 'own') },
  'sa.commsNode': { name: 'Узел связи полевой (подвижный)', group: SA, style: g('saCommsNode', 13, 'own', 'support') },
  'sa.commsNodeFixed': { name: 'Узел связи стационарный', group: SA, style: g('saCommsNodeFixed', 13, 'own', 'support') },
  'sa.radio': { name: 'Радиостанция подвижная', group: SA, style: g('saRadio', 16, 'own', 'support') },
  'sa.radioPortable': { name: 'Радиостанция переносная', group: SA, style: g('saRadioPortable', 16, 'own', 'support') },
  'sa.radioTank': { name: 'Радиостанция в танке', group: SA, style: g('saRadioTank', 16, 'own', 'support') },
  'sa.radioReceiver': { name: 'Радиоприёмник', group: SA, style: g('saRadioReceiver', 16, 'own', 'support', { text: '306' }) },
  /* ---- СА: стрелковое оружие и артиллерия ---- */
  'sa.lmg': { name: 'Ручной пулемёт', group: SA, style: g('saLmg', 13, 'own') },
  'sa.hmg': { name: 'Ротный (станковый) пулемёт', group: SA, style: g('saHmg', 13, 'own') },
  'sa.hmgHeavy': { name: 'Крупнокалиберный пулемёт', group: SA, style: g('saHmgHeavy', 13, 'own') },
  'sa.rpg': { name: 'Ручной противотанковый гранатомёт', group: SA, style: g('saRpg', 13, 'own') },
  'sa.spg9': { name: 'Станковый противотанковый гранатомёт', group: SA, style: g('saSpg9', 13, 'own', 'support') },
  'sa.ags': { name: 'Автоматический станковый гранатомёт', group: SA, style: g('saAgs', 13, 'own') },
  'sa.atgm': { name: 'Переносной противотанковый ракетный комплекс', group: SA, style: g('saAtgm', 14, 'own', 'support') },
  'sa.flameLight': { name: 'Огнемёт лёгкий пехотный', group: SA, style: g('saFlameLight', 12, 'own', 'support') },
  'sa.flameHeavy': { name: 'Огнемёт тяжёлый пехотный', group: SA, style: g('saFlameHeavy', 12, 'own', 'support') },
  'sa.gun': { name: 'Орудие (общее обозначение)', group: SA, style: g('saGun0', 16, 'own', 'support') },
  'sa.gun122': { name: 'Орудие калибра до 122 мм', group: SA, style: g('saGun1', 16, 'own', 'support') },
  'sa.gun155': { name: 'Орудие калибра до 155 мм', group: SA, style: g('saGun2', 16, 'own', 'support') },
  'sa.gun155p': { name: 'Орудие калибра более 155 мм', group: SA, style: g('saGun3', 16, 'own', 'support') },
  'sa.atGun': { name: 'Противотанковая пушка (общее)', group: SA, style: g('saAtGun0', 16, 'own', 'support') },
  'sa.atGun85': { name: 'Противотанковая пушка до 85 мм', group: SA, style: g('saAtGun1', 16, 'own', 'support') },
  'sa.atGun100': { name: 'Противотанковая пушка до 100 мм', group: SA, style: g('saAtGun2', 16, 'own', 'support') },
  'sa.atGun100p': { name: 'Противотанковая пушка более 100 мм', group: SA, style: g('saAtGun3', 16, 'own', 'support') },
  'sa.mortar': { name: 'Миномёт (общее)', group: SA, style: g('saMortar0', 15, 'own', 'support') },
  'sa.mortarMed': { name: 'Миномёт малого и среднего калибра', group: SA, style: g('saMortar1', 15, 'own', 'support') },
  'sa.mortarLarge': { name: 'Миномёт крупного калибра (более 120 мм)', group: SA, style: g('saMortar3', 15, 'own', 'support') },
  'sa.mrl': { name: 'Боевая машина реактивной артиллерии (общее)', group: SA, style: g('saMrl0', 16, 'own', 'support') },
  'sa.mrlMed': { name: 'БМ РА среднего калибра', group: SA, style: g('saMrl2', 16, 'own', 'support') },
  'sa.spGun': { name: 'Самоходное орудие', group: SA, style: g('saSpGun', 18, 'own', 'support') },
  'sa.spMortar': { name: 'Самоходный миномёт', group: SA, style: g('saSpMortar', 18, 'own', 'support') },
  'sa.aa': { name: 'Зенитное орудие (общее)', group: SA, style: g('saAa1', 15, 'own', 'support') },
  'sa.aaSmall': { name: 'Зенитное орудие малого калибра', group: SA, style: g('saAa2', 15, 'own', 'support') },
  'sa.aaMed': { name: 'Зенитное орудие среднего калибра', group: SA, style: g('saAa3', 15, 'own', 'support') },
  'sa.aaSp': { name: 'Зенитная самоходная установка', group: SA, style: g('saAaSp', 18, 'own', 'support') },
  'sa.battery': { name: 'Артиллерийская батарея на огневой позиции', group: SA, style: g('saBattery', 18, 'own', 'support') },
  'sa.mortarBattery': { name: 'Миномётная батарея на огневой позиции', group: SA, style: g('saMortarBattery', 18, 'own', 'support') },
  /* ---- СА: танки и машины ---- */
  'sa.tank': { name: 'Танк (общее)', group: SA, style: g('saTank', 18, 'own') },
  'sa.tankAmph': { name: 'Танк плавающий', group: SA, style: g('saTankAmph', 18, 'own') },
  'sa.tankMine': { name: 'Танк с минным тралом', group: SA, style: g('saTankMine', 18, 'own') },
  'sa.tankDozer': { name: 'Танк с бульдозерным оборудованием', group: SA, style: g('saTankDozer', 18, 'own') },
  'sa.bmp': { name: 'Боевая машина пехоты', group: SA, style: g('saBmp', 16, 'own') },
  'sa.btr': { name: 'Бронетранспортёр', group: SA, style: g('saBtr', 16, 'own') },
  'sa.truck': { name: 'Автомобиль', group: SA, style: g('saTruck', 15, 'own') },
  'sa.ambulance': { name: 'Санитарный автомобиль (транспортёр)', group: SA, style: g('saAmbulance', 15, 'own') },
  'sa.helicopter': { name: 'Вертолёт', group: SA, style: g('saHelicopter', 16, 'own') },
  'sa.landingT': { name: 'Посадочная площадка (площадка приземления)', group: SA, style: g('stdLandingT', 15, 'own') },
  /* ---- СА: фортификация ---- */
  'sa.trenchCovered': { name: 'Окоп с перекрытой щелью (блиндажом)', group: SA, style: g('saTrenchCovered', 16, 'own') },
  'sa.tankDug': { name: 'Танк в окопе', group: SA, style: g('saTankDug', 18, 'own') },
  'sa.shelterOpen': { name: 'Открытая щель', group: SA, style: g('stdShelter', 14, 'own') },
  'sa.shelterCovered': { name: 'Перекрытая щель', group: SA, style: g('saShelterCovered', 14, 'own') },
  'sa.dugout': { name: 'Блиндаж', group: SA, style: g('saDugout', 15, 'own') },
  'sa.semiCaponierArt': { name: 'Артиллерийский полукапонир', group: SA, style: g('saSemiCaponierArt', 16, 'own', 'support') },
  'sa.semiCaponierMg': { name: 'Пулемётный полукапонир', group: SA, style: g('saSemiCaponierMg', 16, 'own', 'support') },
  'sa.longTerm': { name: 'Долговременное сооружение', group: SA, style: g('saLongTerm', 16, 'own', 'support') },
  'sa.fieldStructure': { name: 'Огневое сооружение из местных материалов', group: SA, style: g('saFieldStructure', 16, 'own', 'support') },
  /* ---- СА: заграждения ---- */
  'sa.mineAT': { name: 'Противотанковая мина', group: SA, style: g('stdMineAT', 6, 'own', 'support') },
  'sa.mineAP': { name: 'Противопехотная мина', group: SA, style: g('stdMineAP', 6, 'own', 'support') },
  'sa.fougasse': { name: 'Фугас неуправляемый', group: SA, style: g('saFougasse', 12, 'own', 'support') },
  'sa.fougasseRadio': { name: 'Фугас, управляемый по радио', group: SA, style: g('saFougasseRadio', 12, 'own', 'support') },
  'sa.fougasseWire': { name: 'Фугас, управляемый по проводам', group: SA, style: g('saFougasseWire', 12, 'own', 'support') },
  'sa.hedgehog': { name: 'Ёж противотанковый', group: SA, style: g('saHedgehog', 9, 'own', 'support') },
  /* ---- СА: переправы ---- */
  'sa.bridge': { name: 'Мост на жёстких опорах', group: SA, style: g('bridge', 18, 'own', 'support') },
  'sa.bridgeDestroyed': { name: 'Мост разрушенный', group: SA, style: g('bridgeDestroyed', 18, 'enemy') },
  'sa.pontoonBridge': { name: 'Мост на плавучих опорах', group: SA, style: g('saPontoonBridge', 18, 'own', 'support') },
  'sa.iceCrossing': { name: 'Ледяная переправа', group: SA, style: g('saIceCrossing', 18, 'own', 'support') },
  'sa.ford': { name: 'Брод', group: SA, style: g('saFord', 18, 'own', 'support') },
  'sa.ferry': { name: 'Паромная переправа', group: SA, style: g('saFerry', 15, 'own', 'support') },
  /* ---- СА: тыл ---- */
  'sa.depot': { name: 'Полковой склад (Г, П, А, ВТИ, АБТИ)', group: SA, style: g('saDepot', 14, 'own') },
  'sa.medRegiment': { name: 'Медицинский пункт полка', group: SA, style: g('stdMedRegiment', 14, 'own') },
  'sa.medBattalion': { name: 'Медицинский пункт батальона', group: SA, style: g('stdMedBattalion', 14, 'own') },
  'sa.medCompany': { name: 'Медицинский пост роты', group: SA, style: g('saMedCompany', 14, 'own') },
  'sa.pointBattalion': { name: 'Заправочный (Г), продовольственный (П), боепитания (Б) пункт батальона', group: SA, style: g('saPointBattalion', 14, 'own') },
  'sa.servicePoint': { name: 'Пункт обслуживания на маршруте', group: SA, style: g('saServicePoint', 18, 'own') },
  'sa.vehicleCollection': { name: 'Сборный пункт повреждённых машин', group: SA, style: g('stdVehicleCollection', 14, 'own') },
  /* ---- СА: разведка и охранение ---- */
  'sa.reconPatrol': { name: 'Боевой разведывательный дозор', group: SA, style: g('saReconPatrol', 14, 'own') },
  'sa.footPatrol': { name: 'Пешие дозорные', group: SA, style: g('saFootPatrol', 14, 'own') },
  'sa.secret': { name: 'Секрет', group: SA, style: g('saSecret', 13, 'own') },
  'sa.guardPost': { name: 'Сторожевой пост', group: SA, style: g('saGuardPost', 16, 'own') },
  'sa.ambush': { name: 'Подразделение в засаде', group: SA, style: g('saAmbush', 16, 'own') },
  'sa.prisoner': { name: 'Место захвата пленного', group: SA, style: g('saPrisoner', 13, 'enemy') },
  'sa.documents': { name: 'Место изъятия документов убитого', group: SA, style: g('saDocuments', 13, 'enemy') },

  /* ---- общие (не по уставу) ---- */
  'std.plane': { name: 'Самолёт (силуэт)', group: ST, style: g('plane', 20, 'own') },
  'std.ship': { name: 'Боевой корабль', group: ST, style: g('ship', 22, 'own') },
  'std.boat': { name: 'Катер (бронекатер)', group: ST, style: g('boat', 14, 'own') },
  'std.navalBase': { name: 'Военно-морская база', group: ST, style: g('anchor', 18, 'own') },
  'std.coastBattery': { name: 'Береговая батарея', group: ST, style: g('coastBattery', 18, 'own') },
  'std.partisans': { name: 'Партизанский отряд (бригада)', group: ST, style: g('partisans', 16, 'own') },
  'std.demolition': { name: 'Разрушение (подрыв) объекта', group: ST, style: g('explosion', 16, 'own', 'support') },
  'std.fire': { name: 'Пожар', group: ST, style: () => sym('fire', { size: 14, color: '#e0651f', fill: '#ffffff', strokeWidth: 1 }) },
  'std.height': { name: 'Отметка высоты', group: ST, style: () => sym('height', { size: 10, color: '#3a2a1a', fill: '#ffffff', strokeWidth: 1, text: '120,5' }) },
  'std.northArrow': { name: 'Стрелка «север»', group: ST, style: () => sym('northArrow', { size: 30, color: BLACK, fill: '#ffffff', strokeWidth: 1.2 }) },
  'std.unitOval': { name: 'Соединение (овал)', group: ST, style: (s) => sym('armyOval', { size: 40, aspect: 0.5, color: col(s, 'own'), fill: s === 'enemy' ? '#c9dff0' : '#f1c3cc', strokeWidth: 1.5 }) },
  'std.mechCorps': { name: 'Танковый (механизированный) корпус', group: ST, style: (s) => sym('tankArmy', { size: 40, aspect: 0.5, color: col(s, 'own'), fill: s === 'enemy' ? '#c9dff0' : '#f1c3cc', strokeWidth: 1.4 }) },
};

/* ================================ подписи ================================ */
export const STD_LABELS: Table<TextStyle> = {
  'rkka.unit': { name: 'Обозначение части/соединения', group: RK, style: (s) => textStyle({ font: 'PT Sans Narrow', size: 12, weight: 700, color: col(s, 'own') }) },
  'sa.unit': { name: 'Надпись (наклонный чертёжный шрифт)', group: SA, style: (s) => textStyle({ font: 'PT Sans Narrow', size: 12, weight: 400, italic: true, color: s === 'enemy' ? BLUE : BLACK }) },
  'sa.time': { name: 'Время и дата («9.00 15.07»)', group: SA, style: (s) => textStyle({ font: 'PT Sans Narrow', size: 10, weight: 400, italic: true, color: s === 'enemy' ? BLUE : BLACK }) },
  'std.note': { name: 'Пояснительная надпись', group: ST, style: () => textStyle({ font: 'PT Sans Narrow', size: 11, weight: 400, color: BLACK, align: 'start' }) },
};
