import { describe, expect, it } from 'vitest';
import type { EventResult } from '@def-ops/sim';
import { clearExpoBaseline, rebaseEvents, setExpoBaseline } from '../src/expo/baseline';
import { axes, axisNote, dayMonth, feedLines, forecast, rankOf, shiftText } from '../src/expo/score';

const ev = (id: string, historical: string, simulated: string | null, days: number | null): EventResult =>
  ({ id, title: `событие ${id}`, historical, simulated, days, at: null } as unknown as EventResult);

describe('оценка по трём осям', () => {
  const keys = ['a', 'b', 'c'];

  it('history-like run is neutral', () => {
    const d = axes([ev('a', '1945-04-19', '1945-04-19', 0), ev('b', '1945-04-21', '1945-04-21', 0), ev('c', '1945-04-30', null, null)], keys, '1945-04-22T05:00', 1000, 1000);
    expect(d).toMatchObject({ speed: 0, cost: 0, intent: 1, done: 2, due: 2, days: 0, lossRatio: 1 });
  });

  it('event not yet simulated does not move speed or price', () => {
    const d = axes([ev('a', '1945-04-19', null, null), ev('c', '1945-04-30', null, null)], keys, '1945-04-22T05:00', 1300, 1000);
    expect(d.days).toBeNull();
    expect(d.speed).toBe(0);
    expect(d.intent).toBe(-1);
    expect(d.lossRatio).toBeCloseTo(1.3);
    expect(d.cost).toBe(-1);
  });

  it('earlier and cheaper is better', () => {
    const d = axes([ev('a', '1945-04-19', '1945-04-18', -1)], keys, '1945-04-20T00:00', 850, 1000);
    expect(d.speed).toBeCloseTo(1 / 3);
    expect(d.cost).toBeCloseTo(0.5);
  });

  it('undone event does not inflate the price when losses are the losses', () => {
    const d = axes([ev('a', '1945-04-19', '1945-04-19', 0), ev('b', '1945-04-20', null, null)], keys, '1945-04-22T05:00', 600, 1000);
    expect(d.lossRatio).toBeCloseTo(0.6);
    expect(d.intent).toBe(0);
  });

  it('rank by sum of axes', () => {
    expect(rankOf({ speed: 1, cost: 0.5, intent: 1 })).toBe('Маршал Советского Союза');
    expect(rankOf({ speed: 0, cost: 0, intent: 0 })).toBe('Генерал-полковник');
    expect(rankOf({ speed: -1, cost: -1, intent: -1 })).toBe('Генерал-майор');
    expect(rankOf({ speed: 1, cost: 1, intent: 1 }, false)).toBe('Провал');
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

describe('нуль шкал — ход «как было»', () => {
  const keys = ['a'];
  const late = ev('a', '1945-04-19', '1945-04-21', 2);

  it('тот же сдвиг, что у базы, — как в истории; опережение базы — быстрее', () => {
    setExpoBaseline([late]);
    const same = rebaseEvents([late]);
    expect(same[0].days).toBe(0);
    expect(axes(same, keys, '1945-04-22T05:00', 1000, 1000).speed).toBe(0);
    const ahead = rebaseEvents([ev('a', '1945-04-19', '1945-04-20', 1)]);
    expect(ahead[0].days).toBe(-1);
    expect(ahead[0].historical).toBe('1945-04-21');
    expect(feedLines([], ahead)).toEqual(['20 апреля — событие a (в истории — 21 апреля)']);
    clearExpoBaseline();
  });
});


describe('итоговый досчёт просроченных и невыполненных задач', () => {
  it('учитывает опоздание несвершившегося события и не награждает экономию на невыполненном', () => {
    const events = [
      ev('a', '1945-04-18', '1945-04-18', 0),
      ev('b', '1945-04-19', null, null),
    ];
    const result = axes(events, ['a', 'b'], '1945-04-22T05:00', 500, 1000, true);
    expect(result).toMatchObject({ done: 1, due: 2, lossRatio: 0.5 });
    expect(result.days).toBe(1.5);
    expect(result.speed).toBeCloseTo(-0.5);
    expect(result.cost).toBe(0);

    const beforeFinal = axes(events, ['a', 'b'], '1945-04-22T05:00', 500, 1000, false);
    expect(beforeFinal.days).toBe(0);
    expect(beforeFinal.cost).toBe(0);
  });
});
