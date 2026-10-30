import { describe, expect, it } from 'vitest';
import type { EventResult } from '@def-ops/sim';
import { axes, axisNote, dayMonth, feedLines, forecast, rankOf, shiftText } from '../src/expo/score';

const ev = (id: string, historical: string, simulated: string | null, days: number | null): EventResult =>
  ({ id, title: `событие ${id}`, historical, simulated, days, at: null } as unknown as EventResult);

describe('оценка по трём осям', () => {
  const keys = ['a', 'b', 'c'];

  it('history-like run is neutral', () => {
    const d = axes([ev('a', '1945-04-19', '1945-04-19', 0), ev('b', '1945-04-21', '1945-04-21', 0), ev('c', '1945-04-30', null, null)], keys, '1945-04-22T05:00', 1000, 1000);
    expect(d).toMatchObject({ speed: 0, cost: 0, intent: 1, done: 2, due: 2, days: 0, lossRatio: 1 });
  });

  it('overdue event counts as late by elapsed days; not due yet is ignored', () => {
    const d = axes([ev('a', '1945-04-19', null, null), ev('c', '1945-04-30', null, null)], keys, '1945-04-22T05:00', 1300, 1000);
    expect(d.days).toBe(3);
    expect(d.speed).toBe(-1);
    expect(d.intent).toBe(-1);
    expect(d.cost).toBe(-1);
  });

  it('earlier and cheaper is better', () => {
    const d = axes([ev('a', '1945-04-19', '1945-04-18', -1)], keys, '1945-04-20T00:00', 850, 1000);
    expect(d.speed).toBeCloseTo(1 / 3);
    expect(d.cost).toBeCloseTo(0.5);
  });

  it('rank by sum of axes', () => {
    expect(rankOf({ speed: 1, cost: 0.5, intent: 1 })).toBe('Маршал Советского Союза');
    expect(rankOf({ speed: 0, cost: 0, intent: 0 })).toBe('Генерал-полковник');
    expect(rankOf({ speed: -1, cost: -1, intent: -1 })).toBe('Генерал-майор');
  });

  it('forecast and texts', () => {
    expect(forecast([ev('rt', '1945-05-02', '1945-04-29', -3)], 'rt')).toBe('Берлин пал бы 29 апреля — на три дня раньше истории');
    expect(forecast([ev('rt', '1945-04-30', null, null)], 'rt')).toBe('К концу расчёта Берлин не пал бы (в истории — 30 апреля)');
    expect(shiftText(1)).toBe('на день позже истории');
    expect(shiftText(-7)).toBe('на 7 дней раньше истории');
    expect(dayMonth('1945-05-02')).toBe('2 мая');
    expect(axisNote('cost', axes([], keys, '1945-04-20', 800, 1000))).toBe('потери меньше истории на 20 %');
  });

  it('feed lists events of the segment in order', () => {
    const before = [ev('a', '1945-04-19', '1945-04-18', -1), ev('b', '1945-04-21', null, null), ev('c', '1945-04-25', null, null)];
    const after = [ev('a', '1945-04-19', '1945-04-18', -1), ev('b', '1945-04-21', '1945-04-21', 0), ev('c', '1945-04-25', '1945-04-20', -5)];
    expect(feedLines(before, after)).toEqual(['20 апреля — событие c (в истории — 25 апреля)', '21 апреля — событие b (как в истории)']);
  });
});
