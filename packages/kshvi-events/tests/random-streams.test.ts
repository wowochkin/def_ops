import { describe, expect, it } from 'vitest';
import { scheduleInterval } from '../src/scheduler/interval-scheduler';
import { drawPoisson, randomForKey, type SchedulerRandomKey } from '../src/scheduler/weighted-choice';
import { makeProfile, makeScheduleInput, makeTemplate } from './fixtures/autonomy';

function key(purpose: SchedulerRandomKey['purpose'], ordinal = 0): SchedulerRandomKey {
  return {
    algorithmVersion: 1,
    seed: 'stream-seed',
    branchId: 'branch-main',
    snapshotHash: 'snapshot-v1',
    templateSetVersion: 'catalog-v1',
    intervalIndex: 3,
    category: 'logistics',
    targetKey: 'blue/area-north',
    purpose,
    ordinal,
  };
}

describe('Разделённые воспроизводимые потоки', () => {
  it('использует разные ключи категории, цели и утверждения', () => {
    const category = randomForKey(key('category'));
    const target = randomForKey(key('target'));
    const approval = randomForKey(key('approval'));
    expect(new Set([category.key, target.key, approval.key]).size).toBe(3);
    expect(new Set([category.digest, target.digest, approval.digest]).size).toBe(3);
    expect(randomForKey(key('category'))).toEqual(category);
    expect(category.value).toBeGreaterThanOrEqual(0);
    expect(category.value).toBeLessThan(1);
  });

  it('получает воспроизводимый Poisson по λ·Δt', () => {
    const first = drawPoisson(3.2 * 0.5, key('attempts'));
    expect(drawPoisson(3.2 * 0.5, key('attempts'))).toEqual(first);
    expect(first.count).toBeGreaterThanOrEqual(0);
    expect(drawPoisson(0, key('attempts')).count).toBe(0);

    let total = 0;
    const samples = 1200;
    for (let index = 0; index < samples; index += 1) {
      total += drawPoisson(1.6, key('attempts', index)).count;
    }
    expect(total / samples).toBeGreaterThan(1.45);
    expect(total / samples).toBeLessThan(1.75);
  });

  it('добавление шаблона категории A не меняет ключи и выбор категории B', () => {
    const reconA = makeTemplate({ templateId: 'recon-a', category: 'reconnaissance', baseWeight: 2 });
    const reconB = makeTemplate({ templateId: 'recon-b', category: 'reconnaissance', baseWeight: 3 });
    const logistics = makeTemplate({ templateId: 'logistics-a', category: 'logistics' });
    const input = makeScheduleInput({
      profile: makeProfile('CUSTOM', { attemptsPerOperationalHour: 20, maxEventsPerInterval: 100, maxEventsPerStage: 1000 }),
      templates: [reconB, reconA],
      categories: ['reconnaissance'],
    });
    const baseline = scheduleInterval(input);
    const changed = scheduleInterval({
      ...input,
      templates: [...input.templates, logistics],
      categories: ['reconnaissance', 'logistics'],
    });
    const project = (result: typeof baseline) => result.traces.filter(trace => trace.category === 'reconnaissance').map(trace => ({
      attemptOrdinal: trace.attemptOrdinal,
      selectionKey: trace.selectionKey,
      targetKey: trace.targetKey,
      selectedTemplateId: trace.selectedTemplateId,
      parameters: trace.parameters,
      createdEventIds: trace.createdEvents.map(event => event.eventId),
    }));
    expect(project(changed)).toEqual(project(baseline));
    expect(changed.traces.some(trace => trace.category === 'logistics')).toBe(true);
  });

  it('изменение зерна меняет розыгрыш без требования равного числа событий', () => {
    const input = makeScheduleInput();
    const first = scheduleInterval(input);
    const second = scheduleInterval({ ...input, seed: 'another-seed' });
    expect(second.trace.controlHash).not.toBe(first.trace.controlHash);
    expect(second.attempts).toBeGreaterThan(0);
  });
});
