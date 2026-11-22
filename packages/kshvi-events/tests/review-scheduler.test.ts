import { expect, it } from 'vitest';
import { fixedOperationalIntervals, scheduleInterval } from '../src/scheduler/interval-scheduler';
import { makeProfile, makeScheduleInput, makeTemplate } from './fixtures/autonomy';

it('I1: невыровненный диапазон включает уже закрытый интервал', () => {
  expect(fixedOperationalIntervals(100, 2000, 30)).toEqual([{ index: 0, startSecond: 0, endSecond: 1800 }]);
});

it('I2: scheduler создаёт разрешённый причинный каскад, а не только корневые события', () => {
  const parent = makeTemplate({ templateId: 'parent', cascade: { allowedTemplateIds: ['child'], maxDepth: 2, maxEvents: 4 } });
  const child = makeTemplate({ templateId: 'child', cascade: { allowedTemplateIds: [], maxDepth: 2, maxEvents: 4 } });
  const input = makeScheduleInput({
    profile: makeProfile('CUSTOM', { attemptsPerOperationalHour: 12, maxEventsPerInterval: 20, maxEventsPerStage: 100, maxCascadeDepth: 2, maxCascadeEvents: 4, manualApprovalShare: 0 }),
    templates: [parent, child],
    categories: ['logistics'],
  });
  const result = scheduleInterval(input);
  const cascaded = result.createdEvents.find(event => event.cascadeDepth > 0);
  expect(cascaded).toBeDefined();
  expect(cascaded?.templateId).toBe('child');
  expect(cascaded?.causeEventIds.length).toBeGreaterThan(0);
});
