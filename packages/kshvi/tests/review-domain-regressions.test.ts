import { expect, it } from 'vitest';
import { buildDebrief, publishDebrief } from '../src/assessment/debrief';
import { calculateMetric } from '../src/assessment/metric-engine';
import { deliveryDelayMetric, sent } from './fixtures/metric-fixture';
import { applyBranchDecision, createBranch } from '../src/replay/branch';
import { compareBranches } from '../src/replay/branch-diff';
import { restoreAt } from '../src/replay/replay-engine';
import { officialBranch } from './fixtures/branch-fixture';
import { makeReplayArchive, replayEvent } from './fixtures/replay-archive';

it('R06: публикация повторно фильтрует материалы при смене PRIVATE на PUBLIC', () => {
  const debrief = buildDebrief({
    scope: 'PRIVATE', instanceId: 'hq-1', trainingQuestions: ['q1'], audience: 'PRIVATE', allowedSideIds: ['blue'],
    materials: [{ id: 'private-secret', section: 'KEY_DECISIONS', instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['q1'], audience: ['PRIVATE'], payload: { text: 'Скрытое содержимое' } }],
    referenceIntent: { instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['q1'], audience: ['PRIVATE'], content: { text: 'Замысел' } }, deviations: [],
  });
  const published = publishDebrief(debrief, { revision: 2, audience: ['PUBLIC'], publishedBy: 'leader', publishedAt: '2026-11-21T12:00:00Z' });
  expect(JSON.stringify(published)).not.toContain('Скрытое содержимое');
  expect(published.materials.some(material => material.id === 'private-secret')).toBe(false);
  expect(published.materials.every(material => material.audience.includes('PUBLIC'))).toBe(true);
});

it('R09: метрика исключает события вне периода и сохраняет граничные события', () => {
  const outsideSent = { ...sent, occurredAt: '2030-01-01T00:00:00.000Z' };
  const outsideDelivered = {
    ...sent, eventId: 'delivered-2030', sequence: 2, type: 'message.delivered', occurredAt: '2030-01-01T00:00:07.000Z',
    payload: { messageId: 'm1', timestamp: '2030-01-01T00:00:07.000Z' },
  };
  const outside = calculateMetric(deliveryDelayMetric, [outsideSent, outsideDelivered]);
  expect(outside.value).toBe('UNKNOWN');
  expect(outside.evidence).toEqual([]);

  const boundary = calculateMetric(deliveryDelayMetric, [
    { ...sent, occurredAt: deliveryDelayMetric.period.from },
    { ...outsideDelivered, eventId: 'delivered-boundary', occurredAt: deliveryDelayMetric.period.to, payload: { messageId: 'm1', timestamp: '2026-11-21T06:00:07.000Z' } },
  ]);
  expect(boundary.value).toBe(7);
  expect(boundary.evidence.map(link => link.eventId)).toEqual(['sent-1', 'delivered-boundary']);
});

it('R10: частный разбор фильтрует отклонения по инстанции, стороне, вопросу и аудитории', () => {
  const base = { rationale: 'Обоснование', consequences: ['Последствие'] };
  const debrief = buildDebrief({
    scope: 'PRIVATE', instanceId: 'hq-1', trainingQuestions: ['q1'], audience: 'PRIVATE', allowedSideIds: ['blue'], materials: [],
    referenceIntent: { instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['q1'], audience: ['PRIVATE'], content: { text: 'Замысел' } }, deviations: [
      { ...base, decisionId: 'allowed', instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['q1'], audience: ['PRIVATE'] },
      { ...base, decisionId: 'other-instance', instanceId: 'hq-2', sideId: 'blue', trainingQuestions: ['q1'], audience: ['PRIVATE'] },
      { ...base, decisionId: 'other-question', instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['q2'], audience: ['PRIVATE'] },
      { ...base, decisionId: 'other-side', instanceId: 'hq-1', sideId: 'red', trainingQuestions: ['q1'], audience: ['PRIVATE'] },
      { ...base, decisionId: 'other-audience', instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['q1'], audience: ['PUBLIC'] },
    ],
  });
  expect(debrief.deviations.map(deviation => deviation.decisionId)).toEqual(['allowed']);
});

it('R12: сравнение ветвей видит оперативное и астрономическое время событий и снимков', () => {
  const left = officialBranch();
  const right = applyBranchDecision(createBranch(left, { branchId: 'time-branch' }), {
    eventId: 'time-alt', type: 'decision', operationalAt: '2030-01-01T06:00:00.000Z', wallClockAt: '2030-01-01T09:00:00.000Z',
    payload: {}, changes: [],
  });
  const diff = compareBranches(left, right);
  const time = diff.differences.find(difference => difference.kind === 'TIME');
  expect(time).toBeDefined();
  expect(JSON.stringify(time)).toContain('2030-01-01T06:00:00.000Z');
  expect(JSON.stringify(time)).toContain('2030-01-01T09:00:00.000Z');
});

it('R13: последовательность ветви продолжает текущую точку линии без коллизий', () => {
  const official = officialBranch();
  official.events = [makeReplayArchive().events[2]];
  const branch = createBranch(official, { branchId: 'sequence-branch' });
  const first = applyBranchDecision(branch, {
    eventId: 'sequence-alt-1', type: 'decision', operationalAt: '2026-11-21T06:04:00.000Z', wallClockAt: '2026-11-21T09:04:00.000Z', payload: {}, changes: [],
  });
  expect(first.events[0].sequence).toBe(4);
  const second = applyBranchDecision(first, {
    eventId: 'sequence-alt-2', type: 'decision', operationalAt: '2026-11-21T06:05:00.000Z', wallClockAt: '2026-11-21T09:05:00.000Z', payload: {}, changes: [],
  });
  expect(second.events.map(event => event.sequence)).toEqual([4, 5]);
});

it('R14: часы реплея выбирают снимок и события только запрошенной ветви', () => {
  const archive = makeReplayArchive();
  const alternativeSnapshot = {
    ...archive.snapshots[0], snapshotId: 'alternative-snapshot', branchId: 'alternative',
    operationalAt: '2030-01-01T06:00:00.000Z', wallClockAt: '2030-01-01T09:00:00.000Z',
  };
  const alternativeEvent = {
    ...replayEvent(1), eventId: 'alternative-time', branchId: 'alternative',
    operationalAt: '2030-01-01T06:01:00.000Z', wallClockAt: '2030-01-01T09:01:00.000Z',
  };
  archive.branchId = 'alternative';
  archive.snapshots.push(alternativeSnapshot);
  archive.events.push(alternativeEvent);
  archive.controlPoints = [];
  const frame = restoreAt({ archive, cursor: { branchId: 'alternative', sequence: 1 } });
  expect(frame.clock.operationalAt).toBe('2030-01-01T06:01:00.000Z');
  expect(frame.clock.wallClockAt).toBe('2030-01-01T09:01:00.000Z');
});

it('R15: контрольные точки с одинаковым sequence разделены по branchId', () => {
  const archive = makeReplayArchive();
  archive.branchId = 'alternative';
  archive.snapshots = [{ ...archive.snapshots[0], branchId: 'alternative', snapshotId: 'alternative-snapshot' }];
  archive.events = [{ ...archive.events[0], branchId: 'alternative', eventId: 'alternative-event' }];
  archive.controlPoints = [];
  const expected = restoreAt({ archive, cursor: 1 }).stateHash!;
  archive.controlPoints = [
    { branchId: 'official', sequence: 1, stateHash: '0'.repeat(64) },
    { branchId: 'alternative', sequence: 1, stateHash: expected },
  ];
  expect(() => restoreAt({ archive, cursor: 1 })).not.toThrow();
  expect(restoreAt({ archive, cursor: 1 }).stateHash).toBe(expected);
});
