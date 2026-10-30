/**
 * Вкладка «Итоги» без React: части вкладки, состояние «переигровки без вмешательства», пояснения части «Потери»,
 * сравнение потерь среднесуточно (периоды расчёта и истории разные) и таблица части «Сравнение»: ваша игра
 * (или расчёт), история, переигровка без вмешательства — с оценкой цветом и словами.
 */
import type { HistoricalLoss, OperationSummary } from '@def-ops/sim';
import type { SimResult } from './sim/protocol';

/** Части вкладки: разбор хода (в игре), потери сторон, сравнение с историей. */
export type ResultsPart = 'turn' | 'losses' | 'compare';
export const PART_TITLE: Record<ResultsPart, string> = { turn: 'Разбор хода', losses: 'Потери', compare: 'Сравнение' };

/** Переигровка без вмешательства того же сценария и seed — для сравнения. */
export type BaselineState = { state: 'off' } | { state: 'wait' } | { state: 'ready'; summary: OperationSummary } | { state: 'error'; text: string };

export const ESTIMATE_NOTE = 'оценка по убыли численности: ход записан до учёта потерь — пополнения и передачи не различаются';
export const NO_HISTORY_NOTE = 'Исторических потерь этой операции в базе знаний нет';

/** Пояснения части «Потери»: оценка для старого хода; исторических потерь нет. */
export function lossesNote(s: OperationSummary): string[] {
  const out: string[] = [];
  if (!s.losses.exact) out.push(ESTIMATE_NOTE);
  if (!s.history.losses.length) out.push(NO_HISTORY_NOTE);
  return out;
}

/** Суток в периоде истории (оба конца включительно). */
export function histDays(h: HistoricalLoss): number | null {
  if (!h.from) return null;
  const d = (x: string) => Date.parse(`${x.slice(0, 10)}T00:00Z`);
  return Math.round((d(h.to) - d(h.from)) / 86400000) + 1;
}
/** Люди в исторической строке: всего, иначе безвозвратные + санитарные, иначе убитые + пленные; нет — null. */
export function histPeople(h: HistoricalLoss): number | null {
  if (h.total != null) return h.total;
  if (h.irrecoverable != null || h.sanitary != null) return (h.irrecoverable ?? 0) + (h.sanitary ?? 0);
  if (h.killed != null || h.captured != null) return (h.killed ?? 0) + (h.captured ?? 0);
  return null;
}
/** Историческая убыль людей в сутки: среднесуточная по источнику, иначе люди / сутки периода. */
export function histPerDay(h: HistoricalLoss): number | null {
  if (h.perDay != null) return h.perDay;
  const p = histPeople(h), n = histDays(h);
  return p != null && n ? Math.round(p / n) : null;
}
/** Расчётная убыль людей стороны в сутки: за сколько суток посчитано и сколько в среднем. */
export function sidePerDay(s: OperationSummary, scope: string): { days: number; perDay: number } | null {
  const r = s.losses.rows.find((x) => x.id === scope);
  if (!r) return null;
  const days = Math.max(0.1, Math.round((s.losses.upTo / 24) * 10) / 10);
  return { days, perDay: Math.round(r.total.personnel / days) };
}
/** Исторические строки по стороне или штабу. */
export function historyOf(s: OperationSummary, scope: string): HistoricalLoss[] {
  return s.history.losses.filter((h) => h.scope === scope);
}
/** Первая историческая строка стороны с людьми — для сравнения в сутки. */
export function sideHistory(s: OperationSummary, side: 'su' | 'de'): HistoricalLoss | null {
  return historyOf(s, side).find((h) => histPeople(h) != null) ?? null;
}
/** Что в исторической строке словами (числа с пробелами): «безвозвратные 78 291, санитарные 274 184, всего 352 475». */
export function histText(h: HistoricalLoss): string {
  const n = (x: number) => x.toLocaleString('ru-RU');
  const parts: string[] = [];
  if (h.irrecoverable != null) parts.push(`безвозвратные ${n(h.irrecoverable)}`);
  if (h.sanitary != null) parts.push(`санитарные ${n(h.sanitary)}`);
  if (h.killed != null) parts.push(`убито ${n(h.killed)}`);
  if (h.captured != null) parts.push(`пленных ${n(h.captured)}`);
  if (h.total != null) parts.push(`${parts.length ? 'всего ' : ''}${n(h.total)} чел.`);
  if (h.tanks != null) parts.push(`танков и САУ ${n(h.tanks)}`);
  if (h.guns != null) parts.push(`орудий и миномётов ${n(h.guns)}`);
  return parts.join(', ');
}
/** Период исторической строки: «16.04–08.05» или «к 01.05». */
export function histPeriod(h: HistoricalLoss): string {
  const dm = (x: string) => `${x.slice(8, 10)}.${x.slice(5, 7)}`;
  return h.from ? `${dm(h.from)}–${dm(h.to)}` : `к ${dm(h.to)}`;
}

// ——— часть «Сравнение» ———

/**
 * События таблицы сравнения; for — чья это удача (немецкое — исход котла). В данных окружение Берлина и соединение
 * 1 БФ с 1 УФ — одно событие ring (47 А и 4 гв. ТА у Кетцина), поэтому одна строка. Событий, которых нет в истории
 * сценария, в таблице нет.
 */
export const COMPARE_EVENTS: { id: string; title: string; for: 'su' | 'de' }[] = [
  { id: 'seelow', title: 'Прорыв Зееловских высот', for: 'su' },
  { id: 'ring', title: 'Окружение Берлина — соединение фронтов (Кетцин)', for: 'su' },
  { id: 'torgau', title: 'Выход к Эльбе (Торгау)', for: 'su' },
  { id: 'pocket', title: 'Котёл 9-й армии', for: 'su' },
  { id: 'breakout', title: 'Исход котла: остатки 9-й армии у 12-й', for: 'de' },
  { id: 'reichstag_taken', title: 'Взятие рейхстага', for: 'su' },
];

export type Cell = { kind: 'date'; date: string } | { kind: 'num'; value: number; unit: string } | { kind: 'pending' } | { kind: 'never' } | { kind: 'none'; why: string };
export interface Diff { tone: 'better' | 'worse' | 'same' | 'none'; text: string }
/** Строка сравнения; src — источник исторической ячейки (подсказка), note — пояснение под строкой. */
export interface CompareRow { id: string; title: string; game: Cell; history: Cell; baseline: Cell; vsHistory: Diff; vsBaseline: Diff; src?: string; note?: string }

/** «Как в истории»: в пределах ±1 сут и ±10 %. */
export const SAME_DAYS = 1;
export const SAME_SHARE = 0.1;
export const TABLE_NOTE = 'мерило „от штата“ вводит этап 1 (п. 10)';
const NO_DATA: Diff = { tone: 'none', text: 'нет данных' };
const NO_BASE: Cell = { kind: 'none', why: 'не считалась' };
const NO_HIST: Cell = { kind: 'none', why: 'в истории нет' };

const num = (value: number, unit: string): Cell => ({ kind: 'num', value, unit });
const fmt1 = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00Z`);

/** Оценка события: d — сутки (+ — позже), mine — событие в пользу стороны игрока. */
function eventDiff(d: number, mine: boolean, ref: string): Diff {
  if (Math.abs(d) <= SAME_DAYS) return { tone: 'same', text: ref ? 'как в истории' : 'так же' };
  const earlier = d < 0;
  return { tone: earlier === mine ? 'better' : 'worse', text: `на ${fmt1(Math.abs(d))} сут ${earlier ? 'раньше' : 'позже'}${ref ? ` ${ref}` : ''}` };
}
/** Оценка числа: больше — лучше (more), иначе меньше — лучше. */
function numDiff(a: Cell, b: Cell, more: boolean, ref: string): Diff {
  if (a.kind !== 'num' || b.kind !== 'num') return NO_DATA;
  if (b.value === 0) return a.value === 0 ? { tone: 'same', text: ref ? 'как в истории' : 'так же' } : NO_DATA;
  const share = (a.value - b.value) / Math.abs(b.value);
  if (Math.abs(share) <= SAME_SHARE) return { tone: 'same', text: ref ? 'как в истории' : 'так же' };
  return { tone: (share > 0) === more ? 'better' : 'worse', text: `на ${Math.round(Math.abs(share) * 100)} % ${share > 0 ? 'больше' : 'меньше'}` };
}

function eventCell(s: OperationSummary, id: string): Cell {
  const e = s.events?.find((x) => x.id === id);
  if (!e) return { kind: 'none', why: 'нет в сценарии' };
  return e.simulated ? { kind: 'date', date: e.simulated.slice(0, 10) } : s.over ? { kind: 'never' } : { kind: 'pending' };
}
/** Сравнение даты события a с b (история или без вмешательства). */
function eventVs(a: Cell, b: Cell, mine: boolean, ref: string): Diff {
  if (a.kind === 'pending') return { tone: 'none', text: 'ещё не наступило' };
  if (b.kind === 'none' || b.kind === 'pending') return NO_DATA;
  if (a.kind === 'never') return b.kind === 'never' ? { tone: 'same', text: ref ? 'как в истории' : 'так же' } : { tone: mine ? 'worse' : 'better', text: 'не случилось' };
  if (a.kind !== 'date') return NO_DATA;
  if (b.kind === 'never') return { tone: mine ? 'better' : 'worse', text: ref ? 'в истории не было' : 'без вмешательства не случилось' };
  if (b.kind !== 'date') return NO_DATA;
  return eventDiff((dayOf(a.date) - dayOf(b.date)) / 86400000, mine, ref);
}

/** Последний посчитанный индекс ряда и его сутки от начала (час — 24 i, не дальше upTo). */
function lastOf(v: (number | null)[], upTo: number): { i: number; days: number } | null {
  for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return { i, days: Math.min(24 * i, upTo) / 24 };
  return null;
}
function tempoOf(v: (number | null)[], upTo: number): number | null {
  const first = v.findIndex((x) => x != null), last = lastOf(v, upTo);
  if (first < 0 || !last || last.days <= first) return null;
  return Math.round(((v[first]! - v[last.i]!) / (last.days - first)) * 10) / 10;
}
const sideDays = (s: OperationSummary) => Math.max(0.1, s.losses.upTo / 24);

/** Потери своей стороны в сутки: расчёт — total / сутки, история — perDay или total / сутки периода. */
function lossCells(s: OperationSummary, side: 'su' | 'de', what: 'personnel' | 'tanks' | 'guns'): Cell {
  const r = s.losses.rows.find((x) => x.id === side);
  if (!r) return { kind: 'none', why: 'нет данных' };
  const v = r.total[what] / sideDays(s);
  return num(what === 'personnel' ? Math.round(v) : Math.round(v * 10) / 10, what === 'personnel' ? 'чел./сут' : 'в сутки');
}
function lossHistory(s: OperationSummary, side: 'su' | 'de', what: 'personnel' | 'tanks' | 'guns'): { cell: Cell; h: HistoricalLoss | null } {
  const hs = historyOf(s, side);
  if (what === 'personnel') {
    const h = sideHistory(s, side), v = h && histPerDay(h);
    return v != null ? { cell: num(v, 'чел./сут'), h } : { cell: NO_HIST, h: null };
  }
  const h = hs.find((x) => x[what] != null) ?? null, d = h && histDays(h);
  return h && d ? { cell: num(Math.round((h[what]! / d) * 10) / 10, 'в сутки'), h } : { cell: NO_HIST, h: null };
}

/** Остальные события сверки (не в таблице): сколько в пределах ±2 сут из скольких (в идущей игре — из наступивших). */
export function otherEvents(s: OperationSummary): { hit: number; total: number } {
  const ids = new Set(COMPARE_EVENTS.map((e) => e.id));
  // игра идёт — только наступившие: события впереди ещё не промах
  const rest = (s.events ?? []).filter((e) => !ids.has(e.id) && (s.over || e.simulated != null));
  return { hit: rest.filter((e) => e.days != null && Math.abs(e.days) <= 2).length, total: rest.length };
}

/**
 * Таблица сравнения: события COMPARE_EVENTS (что есть в истории сценария); по советским фронтам — темп и удаление от
 * Берлина к концу; потери своей стороны в сутки (люди, танки, орудия); укомплектованность (от штата, иначе от
 * начала операции); дивизий в строю. Тон — с точки зрения стороны игрока: для немцев раннее советское событие и
 * близость советских фронтов к Берлину — хуже.
 */
/**
 * Переигровка без вмешательства на те же часы, что игра: удаление и силы — по те же сутки, потери — за те же сутки
 * (сутки byDay), чтобы игру после двух ходов не сравнивать с концом операции. Ход не длиннее игры — как есть.
 */
export function baselineAt(b: OperationSummary, game: OperationSummary): OperationSummary {
  if (b.upTo <= game.upTo) return b;
  const n = game.distance?.days.length ?? 0, k = Math.max(1, Math.ceil(game.upTo / 24));
  const cutSide = (x: OperationSummary['sides']['su'], m: number) => ({ ...x, strength: x.strength.slice(0, m), divisions: x.divisions.slice(0, m), manningFromTable: x.manningFromTable?.slice(0, m) ?? null });
  const sum = (l: { personnel: number; tanks: number; guns: number }[]) => l.reduce((a, d) => ({ personnel: a.personnel + d.personnel, tanks: a.tanks + d.tanks, guns: a.guns + d.guns }), { personnel: 0, tanks: 0, guns: 0 });
  return {
    ...b,
    upTo: game.upTo,
    distance: b.distance && { days: b.distance.days.slice(0, n), rows: b.distance.rows.map((r) => ({ ...r, game: r.game.slice(0, n), history: r.history.slice(0, n) })) },
    losses: { ...b.losses, upTo: Math.min(b.upTo, 24 * k), days: b.losses.days.slice(0, k), rows: b.losses.rows.map((r) => ({ ...r, total: sum(r.byDay.slice(0, k)), byDay: r.byDay.slice(0, k) })) },
    ...(b.sides && game.sides ? { sides: { su: cutSide(b.sides.su, game.sides.su.strength.length), de: cutSide(b.sides.de, game.sides.de.strength.length) } } : {}),
  };
}

export function compareRows(game: OperationSummary, full: OperationSummary | null, side: 'su' | 'de'): CompareRow[] {
  const baseline = full && baselineAt(full, game);
  const rows: CompareRow[] = [];
  const su = side === 'su';
  for (const e of COMPARE_EVENTS) {
    const ge = game.events?.find((x) => x.id === e.id);
    if (!ge) continue;
    const mine = e.for === side;
    const g = eventCell(game, e.id), h: Cell = { kind: 'date', date: ge.historical.slice(0, 10) };
    const b = baseline ? eventCell(baseline, e.id) : NO_BASE;
    rows.push({ id: e.id, title: e.title, game: g, history: h, baseline: b, vsHistory: eventVs(g, h, mine, 'истории'), vsBaseline: baseline ? eventVs(g, b, mine, '') : NO_DATA });
  }
  for (const f of game.distance?.rows ?? []) {
    const bf = baseline?.distance?.rows.find((x) => x.hq === f.hq);
    const t = (v: (number | null)[] | undefined, upTo: number): Cell => { const x = v && tempoOf(v, upTo); return x == null ? { kind: 'none', why: 'нет данных' } : num(x, 'км/сут'); };
    // история — за те же сутки, что посчитаны в игре (в идущей игре — не за всю операцию)
    const gl = lastOf(f.game, game.upTo);
    const th = gl ? t(f.history.slice(0, gl.i + 1), game.upTo) : t(f.history, 24 * (f.history.length - 1));
    const tg = t(f.game, game.upTo), tb = baseline ? t(bf?.game, baseline.upTo) : NO_BASE;
    rows.push({ id: `tempo-${f.hq}`, title: `${f.name}: темп, км/сут`, game: tg, history: th.kind === 'none' ? NO_HIST : th, baseline: tb, vsHistory: numDiff(tg, th, su, 'истории'), vsBaseline: numDiff(tg, tb, su, '') });
    const last = lastOf(f.game, game.upTo);
    const dg: Cell = last ? num(f.game[last.i]!, 'км') : { kind: 'none', why: 'нет данных' };
    // история — на последние сутки с положениями армий не позже конца расчёта; сравнение — на эту же дату
    let j = last ? last.i : -1;
    while (j >= 0 && (f.history[j] == null || f.game[j] == null)) j--;
    const dh: Cell = j >= 0 ? num(f.history[j]!, 'км') : NO_HIST;
    const atJ: Cell = j >= 0 ? num(f.game[j]!, 'км') : dg;
    const bl = bf && baseline ? lastOf(bf.game, baseline.upTo) : null;
    const db: Cell = !baseline ? NO_BASE : bl ? num(bf!.game[bl.i]!, 'км') : { kind: 'none', why: 'нет данных' };
    const day = j >= 0 ? game.distance.days[j] : '';
    rows.push({
      id: `dist-${f.hq}`, title: `${f.name}: удаление от Берлина к концу, км`, game: dg, history: dh, baseline: db, vsHistory: numDiff(atJ, dh, !su, 'истории'), vsBaseline: numDiff(dg, db, !su, ''),
      ...(last && j >= 0 && j !== last.i ? { note: `история — на ${day.slice(8, 10)}.${day.slice(5, 7)}, сравнение на эту дату (расчёт тогда — ${fmt1(f.game[j]!)} км)` } : {}),
    });
  }
  const LOSS: [what: 'personnel' | 'tanks' | 'guns', title: string][] = [['personnel', 'потери людей в сутки'], ['tanks', 'потери танков в сутки'], ['guns', 'потери орудий в сутки']];
  for (const [what, title] of LOSS) {
    const g = lossCells(game, side, what), { cell: h, h: src } = lossHistory(game, side, what);
    const b = baseline ? lossCells(baseline, side, what) : NO_BASE;
    rows.push({
      id: `loss-${what}`, title, game: g, history: h, baseline: b, vsHistory: numDiff(g, h, false, 'истории'), vsBaseline: numDiff(g, b, false, ''),
      ...(src ? { src: `${src.source}, надёжность ${src.reliability}, ${histPeriod(src)}` } : {}),
      ...(src?.note ? { note: src.note } : side === 'de' && src ? { note: 'по советскому донесению' } : {}),
    });
  }
  const st = game.sides?.[side];
  if (st) {
    const table = st.manningFromTable;
    const manning = (s: OperationSummary | null): Cell => {
      const x = s?.sides?.[side];
      if (!x) return s ? { kind: 'none', why: 'нет данных' } : NO_BASE;
      const v = table ? x.manningFromTable?.at(-1) : x.strength0 ? (x.strength.at(-1) ?? 0) / x.strength0 : null;
      return v == null ? { kind: 'none', why: 'нет данных' } : num(Math.round(v * 100), '%');
    };
    const mg = manning(game), mb = baseline ? manning(baseline) : NO_BASE;
    rows.push({ id: 'manning', title: table ? 'укомплектованность к концу, % от штата' : 'укомплектованность к концу, % от начала операции', game: mg, history: NO_HIST, baseline: mb, vsHistory: NO_DATA, vsBaseline: numDiff(mg, mb, true, ''), ...(table ? {} : { note: TABLE_NOTE }) });
    const dv = (s: OperationSummary | null): Cell => { const x = s?.sides?.[side]?.divisions.at(-1); return x == null ? (s ? { kind: 'none', why: 'нет данных' } : NO_BASE) : num(x, ''); };
    const g = dv(game), b = baseline ? dv(baseline) : NO_BASE;
    rows.push({ id: 'divisions', title: 'дивизий в строю к концу', game: g, history: NO_HIST, baseline: b, vsHistory: NO_DATA, vsBaseline: numDiff(g, b, true, '') });
  }
  return rows;
}

/** Итогов в сохранении нет: пока они пересчитываются по сохранённому ходу — «считаются…». */
export const resultsEmpty = (recomputing: boolean): string => (recomputing
  ? 'В этом сохранении итогов не было — они считаются…'
  : 'В этом сохранении итогов нет — рассчитайте операцию заново.');

/** Данные сохранения с пересчитанными сводкой и разбором — чтобы при следующем открытии не считать снова. */
export function recomputedReplay<D extends { result: SimResult }>(d: D, x: { summary: OperationSummary; debriefs?: SimResult['debriefs'] }): D {
  return { ...d, result: { ...d.result, operation: x.summary, ...(x.debriefs ? { debriefs: x.debriefs } : {}) } };
}

/** Агентный расчёт без сводки операции или со сводкой до сравнения (без событий) — сводку пересчитать из хода. */
export function summaryNeeded(r: SimResult): boolean {
  return r.engine === 'agents' && (!r.operation || !Array.isArray(r.operation.events) || !r.debriefs);
}
