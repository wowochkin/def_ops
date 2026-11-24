import { describe, expect, it } from 'vitest';
import { createAutonomyProfile, updateAutonomyProfile } from '../src/profile/autonomy-profile';
import { fixedOperationalIntervals, scheduleInterval, scheduleOperationalRange } from '../src/scheduler/interval-scheduler';
import { blueNorthTarget, makeProfile, makeScheduleInput, makeState, makeTemplate } from './fixtures/autonomy';

const planned = { eventId: 'planned-1', kind: 'PLANNED' as const, operationalSecond: 30 };
const reactive = { eventId: 'reactive-1', kind: 'REACTIVE' as const, operationalSecond: 40 };

describe('AutonomyProfile и фиксированные интервалы', () => {
  it('полностью отключает вероятностную область при интенсивности ноль, сохраняя плановые и реактивные события', () => {
    const input = makeScheduleInput({
      profile: makeProfile('HIGH', {}, { categories: { logistics: 0 } }),
      plannedReactiveEvents: [planned, reactive],
    });
    const result = scheduleInterval(input);
    expect(result.attempts).toBe(0);
    expect(result.createdEvents).toEqual([]);
    expect(result.trace.rejection).toBe('ZERO_INTENSITY');
    expect(result.plannedReactiveEvents).toEqual([planned, reactive]);
  });

  it('OFF сохраняет непрерывный сюжетный контур на всём диапазоне', () => {
    const result = scheduleOperationalRange({
      ...makeScheduleInput(),
      profile: makeProfile('OFF'),
      fromSecond: 0,
      toSecond: 7200,
      plannedReactiveEvents: [reactive, planned],
    });
    expect(result.attempts).toBe(0);
    expect(result.createdEvents).toEqual([]);
    expect(result.plannedReactiveEvents.map(event => event.eventId).sort()).toEqual(['planned-1', 'reactive-1']);
  });

  it('разбивает только оперативное время на стабильные интервалы профиля', () => {
    expect(fixedOperationalIntervals(0, 7200, 30)).toEqual([
      { index: 0, startSecond: 0, endSecond: 1800 },
      { index: 1, startSecond: 1800, endSecond: 3600 },
      { index: 2, startSecond: 3600, endSecond: 5400 },
      { index: 3, startSecond: 5400, endSecond: 7200 },
    ]);
    expect(fixedOperationalIntervals(100, 1700, 30)).toEqual([]);
  });

  it('не создаёт попыток на паузе', () => {
    const result = scheduleOperationalRange({ ...makeScheduleInput(), fromSecond: 0, toSecond: 7200, instanceState: 'PAUSED' });
    expect(result.results).toEqual([]);
    expect(result.attempts).toBe(0);
    expect(result.createdEvents).toEqual([]);
  });

  it('отклоняет обычное изменение профиля после SEALED', () => {
    const profile = makeProfile('HIGH');
    expect(updateAutonomyProfile(profile, { intensity: { categories: { logistics: 0 } } }, 'APPROVED').intensity.categories.logistics).toBe(0);
    expect(() => updateAutonomyProfile(profile, { level: 'LOW' }, 'SEALED')).toThrow(/SEALED/);
  });

  it('требует числовые настройки CUSTOM из версионного методического профиля', () => {
    expect(() => createAutonomyProfile({ profileId: 'broken', level: 'CUSTOM' })).toThrow(/CUSTOM/);
    expect(() => makeProfile('CUSTOM', { manualApprovalShare: 2 })).toThrow(/ручного утверждения/);
    expect(() => makeProfile('CUSTOM', { attemptsPerOperationalHour: Number.NaN })).toThrow(/интенсивность/);
  });
});

describe('AC-19: воспроизводимость непрерывного хода, паузы и скачка', () => {
  it('даёт одинаковые ключи, события и контрольные хеши при разном UI и порядке сетевых событий', () => {
    const shared = {
      ...makeScheduleInput(),
      templates: [
        makeTemplate(),
        makeTemplate({ templateId: 'recon-01', category: 'reconnaissance' }),
      ],
      fromSecond: 0,
      toSecond: 7200,
      plannedReactiveEvents: [planned, reactive],
    };
    const continuousFirst = scheduleOperationalRange({ ...shared, toSecond: 3600 });
    const continuousSecond = scheduleOperationalRange({
      ...shared,
      fromSecond: 3600,
      state: continuousFirst.state,
      journal: continuousFirst.results,
    });
    const continuousEvents = [...continuousFirst.createdEvents, ...continuousSecond.createdEvents];
    const continuousHashes = [...continuousFirst.results, ...continuousSecond.results].map(result => result.trace.controlHash);

    const jump = scheduleOperationalRange({ ...shared, plannedReactiveEvents: [reactive, planned] });
    expect(jump.createdEvents).toEqual(continuousEvents);
    expect(jump.results.map(result => result.trace.controlHash)).toEqual(continuousHashes);
    expect(jump.results.flatMap(result => result.traces.map(trace => trace.selectionKey))).toEqual(
      [...continuousFirst.results, ...continuousSecond.results].flatMap(result => result.traces.map(trace => trace.selectionKey)),
    );

    const replay = scheduleOperationalRange({ ...shared, journal: jump.results });
    expect(replay.results.every(result => result.replayed)).toBe(true);
    expect(replay.createdEvents).toEqual(jump.createdEvents);
    expect(replay.controlHash).toBe(jump.controlHash);
  });

  it('обрабатывает скачок в порядке оперативного времени и не повторяет розыгрыш', () => {
    const input = { ...makeScheduleInput(), fromSecond: 0, toSecond: 10_800 };
    const first = scheduleOperationalRange(input);
    const repeated = scheduleOperationalRange({ ...input, journal: [...first.results].reverse() });
    expect(repeated.results.map(result => result.trace.interval.index)).toEqual([0, 1, 2]);
    expect(repeated.controlHash).toBe(first.controlHash);
    expect(repeated.results.every(result => result.replayed)).toBe(true);
    expect(repeated.results.flatMap(result => result.createdEvents)).toEqual(first.results.flatMap(result => result.createdEvents));
  });
});

describe('Области интенсивности', () => {
  it('ноль стороны или района отключает только соответствующую ячейку', () => {
    const redSouth = { sideId: 'red', areaId: 'area-south', latitude: 50.5, longitude: 30.5 };
    const template = makeTemplate({
      applicability: {
        ...makeTemplate().applicability,
        sideIds: ['blue', 'red'],
        geography: {
          ...makeTemplate().applicability.geography,
          areaIds: ['area-north', 'area-south'],
        },
      },
    });
    const state = makeState({ environmentCoverageAreaIds: ['area-north', 'area-south'] });
    const profile = makeProfile('HIGH', {}, { sides: { red: 0 } });
    const result = scheduleInterval(makeScheduleInput({
      profile,
      templates: [template],
      state,
      targets: [blueNorthTarget, redSouth],
    }));
    expect(result.traces.length).toBeGreaterThan(0);
    expect(result.traces.every(trace => trace.target?.sideId === 'blue')).toBe(true);
  });
});
