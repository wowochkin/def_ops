import { describe, expect, it } from 'vitest';
import { carryStageContinuity } from '../src/documents/continuity';
import { makeManualDecision } from '../src/documents/manual-decision';

describe('RUN-04 непрерывность между этапами', () => {
  it('сохраняет незавершённые сообщения, документы и последствия без явного события', () => {
    const previous = {
      resources: { fuel: 12 }, positions: { unit: [10, 20] }, formations: { unit: 'COLUMN' }, tasks: [{ id: 'task-1', status: 'ACTIVE' }],
      messages: [{ id: 'message-1', status: 'inTransit', remainingMs: 5000 }], deliveries: [{ id: 'supply-1', status: 'EN_ROUTE' }],
      channels: { main: { capacity: 1, status: 'DEGRADED' } }, documents: [{ id: 'order-1', revision: 2 }],
      observations: [{ id: 'observation-1', confidence: 'ESTIMATED' }], equipment: { vehicle: 'DAMAGED' }, morale: { unit: 'SHAKEN' },
      readiness: { unit: 0.7 }, terrain: { bridge: 'CLOSED' }, causeLinks: [{ cause: 'event-1', effect: 'task-1' }],
    };
    const next = carryStageContinuity(previous, {
      fromStageId: 'stage-1', toStageId: 'stage-2', operationalAt: '2030-01-01T12:00:00+03:00',
      events: [{ eventId: 'weather-2', component: 'terrain', value: { bridge: 'OPEN', ford: 'CLOSED' }, causeIds: ['rain-2'] }],
    });
    expect(next.resources).toEqual(previous.resources);
    expect(next.positions).toEqual(previous.positions);
    expect(next.formations).toEqual(previous.formations);
    expect(next.tasks).toEqual(previous.tasks);
    expect(next.messages).toEqual(previous.messages);
    expect(next.deliveries).toEqual(previous.deliveries);
    expect(next.channels).toEqual(previous.channels);
    expect(next.documents).toEqual(previous.documents);
    expect(next.observations).toEqual(previous.observations);
    expect(next.equipment).toEqual(previous.equipment);
    expect(next.morale).toEqual(previous.morale);
    expect(next.readiness).toEqual(previous.readiness);
    expect(next.causeLinks).toEqual(previous.causeLinks);
    expect(next.terrain).toEqual({ bridge: 'OPEN', ford: 'CLOSED' });
    expect(next.continuity).toEqual({
      fromStageId: 'stage-1', toStageId: 'stage-2', operationalAt: '2030-01-01T12:00:00+03:00',
      appliedEventIds: ['weather-2'], causeIds: ['rain-2'],
    });
    expect(next.messages).not.toBe(previous.messages);
    expect(previous.terrain).toEqual({ bridge: 'CLOSED' });
  });

  it('не принимает повторное или неотслеживаемое событие непрерывности', () => {
    expect(() => carryStageContinuity({ resources: { fuel: 1 } }, {
      fromStageId: 'a', toStageId: 'b', operationalAt: '2030-01-01T00:00:00Z',
      events: [{ eventId: '', component: 'resources', value: {}, causeIds: [] }],
    })).toThrow('событ');
    expect(() => carryStageContinuity({ resources: { fuel: 1 } }, {
      fromStageId: 'a', toStageId: 'b', operationalAt: '2030-01-01T00:00:00Z',
      events: [
        { eventId: 'same', component: 'resources', value: { fuel: 0 }, causeIds: [] },
        { eventId: 'same', component: 'resources', value: { fuel: 2 }, causeIds: [] },
      ],
    })).toThrow('повтор');
  });
});

describe('SIM-15 ручное решение', () => {
  it('создаёт связанный manual-расчёт, сохраняет исходный и не меняет оценку обучаемого', () => {
    const original = { id: 'calculation-1', type: 'model' as const, outcome: { losses: 4 }, reason: 'Модель v1', authorId: 'system', createdAt: '2030-01-01T06:00:00Z' };
    const assessment = { traineeId: 'trainee-1', score: 4, adjustments: [] as string[] };
    const result = makeManualDecision(original, {
      id: 'calculation-2', outcome: { losses: 2 }, reason: 'Ручное уточнение обстановки', authorId: 'director-1', createdAt: '2030-01-01T06:05:00Z',
    }, assessment);
    expect(result.manual).toEqual({
      id: 'calculation-2', type: 'manual', sourceCalculationId: 'calculation-1', outcome: { losses: 2 },
      reason: 'Ручное уточнение обстановки', authorId: 'director-1', createdAt: '2030-01-01T06:05:00Z',
    });
    expect(result.original).toEqual(original);
    expect(result.comparison).toEqual({ original, manual: result.manual });
    expect(result.assessment).toEqual(assessment);
    expect(result.assessment).not.toBe(assessment);
    expect(result.assessmentPolicy).toBe('UNCHANGED_BY_MANUAL_INTERVENTION');
    expect(original.type).toBe('model');
  });

  it('требует основание и автора', () => {
    const original = { id: 'calculation-1', type: 'model' as const, outcome: 1, reason: 'Модель', authorId: 'system', createdAt: '2030-01-01T06:00:00Z' };
    expect(() => makeManualDecision(original, { id: 'calculation-2', outcome: 0, reason: '', authorId: '', createdAt: '2030-01-01T06:05:00Z' }))
      .toThrow('основан');
  });
});
