// Вкладка «Итоги», часть «Потери»: пояснения (оценка для старого хода, нет исторических) и сравнение среднесуточно.
import { describe, expect, it } from 'vitest';
import type { HistoricalLoss, LossSeries, OperationSummary } from '@def-ops/sim';
import type { EventResult, SideTotals } from '@def-ops/sim';
import type { SimResult } from '../src/sim/protocol';
import { compareRows, histPerDay, lossesNote, otherEvents, sidePerDay, summaryNeeded, TABLE_NOTE } from '../src/results-view';

const series = (exact: boolean): LossSeries => ({
  exact, upTo: 48, days: ['1945-04-16', '1945-04-17'],
  rows: [
    { id: 'su', name: 'Советская сторона', side: 'su', echelon: 'side', parent: null, total: { personnel: 4800, tanks: 10, guns: 4 }, captured: 0, reinforced: 0, byDay: [{ personnel: 2400, tanks: 5, guns: 2 }, { personnel: 2400, tanks: 5, guns: 2 }] },
    { id: 'de', name: 'Немецкая сторона', side: 'de', echelon: 'side', parent: null, total: { personnel: 2400, tanks: 0, guns: 0 }, captured: 300, reinforced: 0, byDay: [{ personnel: 1200, tanks: 0, guns: 0 }, { personnel: 1200, tanks: 0, guns: 0 }] },
  ],
});
const KRIV: HistoricalLoss = { scope: 'su', from: '1945-04-16', to: '1945-05-08', irrecoverable: 78291, sanitary: 274184, total: 352475, perDay: 15325, source: 'Кривошеев 2001, гл. V', reliability: 'A', kb: 'op:berlin' };
const totals = (table: boolean): SideTotals => ({ strength0: 10000, strength: [10000, 9000, 8000], divisions: [3, 3, 2], manningFromTable: table ? [0.8, 0.72, 0.64] : null });
const summary = (exact: boolean, losses: HistoricalLoss[], o: Partial<OperationSummary> = {}): OperationSummary => ({
  version: 1, scenario: 't', seed: 1, start: '1945-04-16T05:00', upTo: 48, over: true, losses: series(exact), history: { losses },
  events: [], distance: { days: ['1945-04-16', '1945-04-17', '1945-04-18'], rows: [] }, sides: { su: totals(true), de: totals(true) }, ...o,
});
const ev = (id: string, historical: string, simulated: string | null): EventResult => ({
  id, title: id, historical, simulated, at: simulated,
  days: simulated ? Math.round((Date.parse(simulated.slice(0, 10)) - Date.parse(historical)) / 86400000) : null,
});
const DE_HIST: HistoricalLoss = { scope: 'de', from: '1945-04-16', to: '1945-05-09', killed: 218691, captured: 250534, source: 'ЖБД 1 БФ', reliability: 'A', note: 'по советскому донесению, только полоса 1 БФ' };

describe('итоги: потери сторон', () => {
  it('losses part texts', () => {
    const old = lossesNote(summary(false, []));
    expect(old.some((x) => /оценка по убыли численности/.test(x) && /пополнения и передачи не различаются/.test(x))).toBe(true);
    expect(old).toContain('Исторических потерь этой операции в базе знаний нет');
    expect(lossesNote(summary(true, [KRIV]))).toEqual([]);
  });

  it('per day: расчёт и история', () => {
    const s = summary(true, [KRIV]);
    expect(sidePerDay(s, 'su')).toEqual({ days: 2, perDay: 2400 });
    expect(histPerDay(KRIV)).toBe(15325);
    // без среднесуточного — всего за период (сутки включительно)
    expect(histPerDay({ ...KRIV, perDay: undefined })).toBe(Math.round(352475 / 23));
    // немцы по донесению: убитые и пленные
    expect(histPerDay({ scope: 'de', from: '1945-04-16', to: '1945-05-09', killed: 218691, captured: 250534, source: 'x', reliability: 'A' })).toBe(Math.round((218691 + 250534) / 24));
  });
});

describe('итоги: сравнение с историей и без вмешательства', () => {
  // seelow — на 2 сут раньше; ring — на 1 сут позже (в пределах); torgau — нет даты; прочие — breakout (немецкое)
  const game = summary(true, [KRIV, DE_HIST], {
    events: [ev('seelow', '1945-04-19', '1945-04-17T11:00'), ev('ring', '1945-04-25', '1945-04-26T05:00'), ev('torgau', '1945-04-23', null), ev('breakout', '1945-05-01', '1945-04-29T05:00'), ev('zossen', '1945-04-21', '1945-04-21T05:00'), ev('spremberg', '1945-04-18', null)],
    distance: { days: ['1945-04-16', '1945-04-17', '1945-04-18'], rows: [{ hq: 'su_1bf', name: '1-й Белорусский фронт', game: [70, 50, 30], history: [70, 60, 40] }] },
  });
  const find = (rows: ReturnType<typeof compareRows>, id: string) => rows.find((r) => r.id === id)!;

  it('compare rows su', () => {
    const rows = compareRows(game, null, 'su');
    const seelow = find(rows, 'seelow');
    expect(seelow.title).toBe('Прорыв Зееловских высот');
    expect(seelow.game).toEqual({ kind: 'date', date: '1945-04-17' });
    expect(seelow.history).toEqual({ kind: 'date', date: '1945-04-19' });
    expect(seelow.vsHistory).toEqual({ tone: 'better', text: 'на 2 сут раньше истории' });
    expect(find(rows, 'ring').vsHistory).toEqual({ tone: 'same', text: 'как в истории' });
    expect(find(rows, 'torgau').game).toEqual({ kind: 'never' });
    expect(find(rows, 'torgau').vsHistory).toEqual({ tone: 'worse', text: 'не случилось' });
    // немецкое событие на 2 сут раньше — для советской стороны хуже
    expect(find(rows, 'breakout').vsHistory.tone).toBe('worse');
    // событий не из списка в таблице нет — они в «остальных»
    expect(rows.some((r) => r.id === 'zossen')).toBe(false);
    expect(otherEvents(game)).toEqual({ hit: 1, total: 2 });
    // без базовой — сравнивать не с чем
    expect(seelow.baseline.kind).toBe('none');
    expect(seelow.vsBaseline.tone).toBe('none');
    // потери в сутки: 2400 против 15 325 — меньше
    const loss = find(rows, 'loss-personnel');
    expect(loss.game).toEqual({ kind: 'num', value: 2400, unit: 'чел./сут' });
    expect(loss.vsHistory.tone).toBe('better');
    expect(loss.vsHistory.text).toBe('на 84 % меньше');
    // фронт: темп (70 − 30) / 2 сут = 20 км/сут против (70 − 40) / 2 = 15; удаление 30 против 40
    expect(find(rows, 'tempo-su_1bf').game).toEqual({ kind: 'num', value: 20, unit: 'км/сут' });
    expect(find(rows, 'tempo-su_1bf').vsHistory.tone).toBe('better');
    expect(find(rows, 'dist-su_1bf').vsHistory).toEqual({ tone: 'better', text: 'на 25 % меньше' });
    expect(find(rows, 'divisions').game).toEqual({ kind: 'num', value: 2, unit: '' });
    // истории на последние сутки нет — сравнение на последнюю дату с положениями армий
    const g2 = { ...game, distance: { ...game.distance, rows: [{ ...game.distance.rows[0], history: [70, 60, null] }] } };
    const d2 = find(compareRows(g2, null, 'su'), 'dist-su_1bf');
    expect(d2.history).toEqual({ kind: 'num', value: 60, unit: 'км' });
    expect(d2.vsHistory).toEqual({ tone: 'better', text: 'на 17 % меньше' });
    expect(d2.note).toBe('история — на 17.04, сравнение на эту дату (расчёт тогда — 50 км)');
  });

  it('pending and 15 % less', () => {
    const open = { ...game, over: false };
    expect(find(compareRows(open, null, 'su'), 'torgau')).toMatchObject({ game: { kind: 'pending' }, vsHistory: { tone: 'none', text: 'ещё не наступило' } });
    const s15 = summary(true, [{ ...KRIV, perDay: 2824 }]);
    expect(find(compareRows(s15, null, 'su'), 'loss-personnel').vsHistory).toEqual({ tone: 'better', text: 'на 15 % меньше' });
  });

  it('baseline column', () => {
    const base = { ...game, events: [ev('seelow', '1945-04-19', '1945-04-19T11:00'), ev('ring', '1945-04-25', '1945-04-26T05:00'), ev('torgau', '1945-04-23', '1945-04-24T05:00'), ev('breakout', '1945-05-01', '1945-05-01T05:00')] };
    const rows = compareRows(game, base, 'su');
    expect(find(rows, 'seelow').baseline).toEqual({ kind: 'date', date: '1945-04-19' });
    expect(find(rows, 'seelow').vsBaseline).toEqual({ tone: 'better', text: 'на 2 сут раньше' });
    expect(find(rows, 'ring').vsBaseline.tone).toBe('same');
    expect(find(rows, 'torgau').vsBaseline).toEqual({ tone: 'worse', text: 'не случилось' });
    expect(find(rows, 'loss-personnel').vsBaseline.tone).toBe('same');
  });

  it('baseline cut to game hours', () => {
    // игра — первые сутки; без вмешательства — двое суток: сравнение на те же сутки
    const g1: OperationSummary = { ...game, upTo: 24, over: false, distance: { days: ['1945-04-16', '1945-04-17'], rows: [{ hq: 'su_1bf', name: '1-й Белорусский фронт', game: [70, 50], history: [70, 60] }] }, sides: { su: { ...totals(true), strength: [10000, 9000], divisions: [3, 3], manningFromTable: [0.8, 0.72] }, de: totals(true) } };
    const rows = compareRows(g1, game, 'su');
    expect(find(rows, 'dist-su_1bf').baseline).toEqual({ kind: 'num', value: 50, unit: 'км' });
    expect(find(rows, 'dist-su_1bf').vsBaseline.tone).toBe('same');
    // потери без вмешательства за первые сутки (2400), а не среднее за всю операцию
    expect(find(rows, 'loss-personnel').baseline).toEqual({ kind: 'num', value: 2400, unit: 'чел./сут' });
    expect(find(rows, 'manning').baseline).toEqual({ kind: 'num', value: 72, unit: '%' });
    expect(find(rows, 'divisions').baseline).toEqual({ kind: 'num', value: 3, unit: '' });
  });

  it('tempo over the same days in a 1-day game', () => {
    // игра — первые сутки (70 → 64), история — на всю операцию (70 → 60 → 40): темп истории — за те же сутки (10), не 15
    const g1: OperationSummary = { ...game, upTo: 24, over: false, distance: { days: ['1945-04-16', '1945-04-17', '1945-04-18'], rows: [{ hq: 'su_1bf', name: '1-й Белорусский фронт', game: [70, 64, null], history: [70, 60, 40] }] } };
    const t = find(compareRows(g1, null, 'su'), 'tempo-su_1bf');
    expect(t.game).toEqual({ kind: 'num', value: 6, unit: 'км/сут' });
    expect(t.history).toEqual({ kind: 'num', value: 10, unit: 'км/сут' });
    expect(t.vsHistory).toEqual({ tone: 'worse', text: 'на 40 % меньше' });
  });

  it('compare rows for de', () => {
    const rows = compareRows(game, null, 'de');
    // советское событие раньше — для немцев хуже; не случилось — лучше; немецкое раньше — лучше
    expect(find(rows, 'seelow').vsHistory.tone).toBe('worse');
    expect(find(rows, 'torgau').vsHistory.tone).toBe('better');
    expect(find(rows, 'breakout').vsHistory.tone).toBe('better');
    // советский фронт ближе к Берлину — для немцев хуже
    expect(find(rows, 'dist-su_1bf').vsHistory.tone).toBe('worse');
    expect(find(rows, 'tempo-su_1bf').vsHistory.tone).toBe('worse');
    // потери — свои (немецкие): 1200 в сутки против (218 691 + 250 534) / 24
    const loss = find(rows, 'loss-personnel');
    expect(loss.game).toEqual({ kind: 'num', value: 1200, unit: 'чел./сут' });
    expect(loss.history).toEqual({ kind: 'num', value: Math.round((218691 + 250534) / 24), unit: 'чел./сут' });
    expect(loss.note).toMatch(/по советскому донесению/);
    expect(loss.vsHistory.tone).toBe('better');
  });

  it('manning without stage 1', () => {
    const withTable = find(compareRows(game, null, 'su'), 'manning');
    expect(withTable.title).toMatch(/от штата/);
    expect(withTable.game).toEqual({ kind: 'num', value: 64, unit: '%' });
    const s = summary(true, [KRIV], { sides: { su: totals(false), de: totals(false) } });
    const m = find(compareRows(s, null, 'su'), 'manning');
    expect(m.title).toMatch(/от начала операции/);
    expect(m.game).toEqual({ kind: 'num', value: 80, unit: '%' });
    expect(m.note).toBe(TABLE_NOTE);
    expect(TABLE_NOTE).toBe('мерило „от штата“ вводит этап 1 (п. 10)');
  });

  it('saved replay without operation', () => {
    const r = { engine: 'agents' } as SimResult;
    expect(summaryNeeded(r)).toBe(true);
    // сводка до сравнения (без событий) — тоже пересчитать
    expect(summaryNeeded({ ...r, operation: { ...game, events: undefined } as unknown as OperationSummary })).toBe(true);
    expect(summaryNeeded({ ...r, operation: game })).toBe(false);
    expect(summaryNeeded({ engine: 'army' } as SimResult)).toBe(false);
    expect(summaryNeeded({} as SimResult)).toBe(false);
  });
});
