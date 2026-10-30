// Вкладка «Итоги», часть «Потери»: пояснения (оценка для старого хода, нет исторических) и сравнение среднесуточно.
import { describe, expect, it } from 'vitest';
import type { HistoricalLoss, LossSeries, OperationSummary } from '@def-ops/sim';
import { histPerDay, lossesNote, sidePerDay } from '../src/results-view';

const series = (exact: boolean): LossSeries => ({
  exact, upTo: 48, days: ['1945-04-16', '1945-04-17'],
  rows: [
    { id: 'su', name: 'Советская сторона', side: 'su', echelon: 'side', parent: null, total: { personnel: 4800, tanks: 10, guns: 4 }, captured: 0, reinforced: 0, byDay: [{ personnel: 2400, tanks: 5, guns: 2 }, { personnel: 2400, tanks: 5, guns: 2 }] },
    { id: 'de', name: 'Немецкая сторона', side: 'de', echelon: 'side', parent: null, total: { personnel: 2400, tanks: 0, guns: 0 }, captured: 300, reinforced: 0, byDay: [{ personnel: 1200, tanks: 0, guns: 0 }, { personnel: 1200, tanks: 0, guns: 0 }] },
  ],
});
const KRIV: HistoricalLoss = { scope: 'su', from: '1945-04-16', to: '1945-05-08', irrecoverable: 78291, sanitary: 274184, total: 352475, perDay: 15325, source: 'Кривошеев 2001, гл. V', reliability: 'A', kb: 'op:berlin' };
const summary = (exact: boolean, losses: HistoricalLoss[]): OperationSummary => ({ version: 1, scenario: 't', seed: 1, start: '1945-04-16T05:00', upTo: 48, over: true, losses: series(exact), history: { losses } });

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
