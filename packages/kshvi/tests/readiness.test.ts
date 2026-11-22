import { describe, expect, it } from 'vitest';
import { assertReadyForTask, type ReadinessState } from '../src/forces/readiness';
import {
  advanceReadiness,
  authorizePartialReadiness,
  type ReadinessActivity,
  type ReadinessStage,
} from '../src/forces/readiness-stage';

const START = '2030-01-01T06:00:00.000Z';
const DUE = '2030-01-01T08:00:00.000Z';

function activity(id: string, overrides: Partial<ReadinessActivity> = {}): ReadinessActivity {
  return {
    id,
    kind: 'SIGNAL',
    title: 'Довести сигнал',
    responsibleNodeId: 'hq-1',
    startAt: START,
    dueAt: DUE,
    durationMinutes: 30,
    dependsOn: [],
    requiresSignal: false,
    preconditions: [],
    resources: [],
    reportRequired: true,
    criterion: { id: `criterion-${id}`, description: 'Результат подтверждён' },
    ...overrides,
  };
}

function stage(activities: readonly ReadinessActivity[]): ReadinessStage {
  return {
    id: 'readiness-stage-1',
    title: 'Обеспечение боевой готовности',
    startsAt: START,
    dueAt: DUE,
    signal: { id: 'signal-1', sentAt: START, senderNodeId: 'hq-0' },
    activities,
    completionCriterionIds: activities.map(item => item.criterion.id),
    adverseOutcomes: ['PARTIAL', 'FAILED'],
  };
}

function state(limitations: ReadinessState['limitations'] = []): ReadinessState {
  return {
    subjectId: 'force-1',
    subjectKind: 'FORCE',
    initialLevel: 0.4,
    requiredLevel: 0.8,
    status: 'NOT_STARTED',
    completedActivityIds: [],
    activityRecords: [],
    reports: [],
    criterionResults: {},
    limitations,
    authorizations: [],
    history: [],
  };
}

const effects = {
  id: 'readiness-effects-test',
  version: 1,
  status: 'APPROVED' as const,
  approvedBy: 'Методист',
  rules: [
    { code: 'SIGNAL_NOT_RECEIVED' as const, orderProcessingDelayMinutes: 20, capabilityFactor: 0.8, movementFactor: 0.7, resourceFactor: 1 },
    { code: 'PERSONNEL_SHORTAGE' as const, orderProcessingDelayMinutes: 5, capabilityFactor: 0.7, movementFactor: 0.9, resourceFactor: 1 },
    { code: 'EQUIPMENT_UNSERVICEABLE' as const, orderProcessingDelayMinutes: 0, capabilityFactor: 0.5, movementFactor: 0.6, resourceFactor: 1 },
    { code: 'SUPPLIES_NOT_REPLENISHED' as const, orderProcessingDelayMinutes: 0, capabilityFactor: 0.9, movementFactor: 0.8, resourceFactor: 0.4 },
    { code: 'AREA_NOT_OCCUPIED' as const, orderProcessingDelayMinutes: 0, capabilityFactor: 0.8, movementFactor: 0.5, resourceFactor: 1 },
  ],
};

describe('явный этап боевой готовности', () => {
  it('SEALED не отменяет незавершённую готовность', () => {
    const result = assertReadyForTask({
      scenarioState: 'SEALED',
      readiness: 'PARTIAL',
      missing: ['SIGNAL_NOT_RECEIVED'],
      allowPartial: false,
    });
    expect(result).toMatchObject({ allowed: false, missing: ['SIGNAL_NOT_RECEIVED'] });
  });

  it('не начинает мероприятия до собственного срока этапа', () => {
    const next = advanceReadiness(stage([activity('signal')]), state(), {
      at: '2029-12-31T05:59:00.000Z',
      signalReceivedAt: null,
    });
    expect(next.status).toBe('NOT_STARTED');
    expect(next.history).toEqual([]);
  });

  it('учитывает доведение сигнала через связь, длительность, доклад и критерий', () => {
    const activities = [activity('signal'), activity('supplies', {
      kind: 'SUPPLIES',
      title: 'Пополнить запасы',
      dependsOn: ['signal'],
      requiresSignal: true,
      resources: [{ resourceId: 'fuel', unit: 'tonne', required: 10, available: 12 }],
    })];
    const next = advanceReadiness(stage(activities), state(), {
      at: '2030-01-01T07:00:00.000Z',
      signalReceivedAt: '2030-01-01T06:05:00.000Z',
      completions: [
        { activityId: 'signal', report: { id: 'report-1', authorId: 'hq-1', submittedAt: '2030-01-01T06:35:00.000Z', text: 'Сигнал доведён' } },
        { activityId: 'supplies', report: { id: 'report-2', authorId: 'hq-1', submittedAt: '2030-01-01T07:00:00.000Z', text: 'Запасы пополнены' } },
      ],
      criteria: { 'criterion-signal': true, 'criterion-supplies': true },
    });
    expect(next.status).toBe('READY');
    expect(next.completedActivityIds).toEqual(['signal', 'supplies']);
    expect(next.reports.map(report => report.id)).toEqual(['report-1', 'report-2']);
    expect(next.actualCompletedAt).toBe('2030-01-01T07:00:00.000Z');
    expect(next.limitations).toEqual([]);
  });

  it('не засчитывает мероприятие без зависимости, ресурса и подтверждённого критерия', () => {
    const activities = [activity('signal'), activity('deployment', {
      kind: 'DEPLOYMENT',
      dependsOn: ['signal'],
      requiresSignal: true,
      resources: [{ resourceId: 'fuel', unit: 'tonne', required: 10, available: 4 }],
    })];
    const next = advanceReadiness(stage(activities), state(), {
      at: '2030-01-01T07:00:00.000Z',
      signalReceivedAt: '2030-01-01T06:05:00.000Z',
      completions: [{ activityId: 'deployment' }],
      criteria: { 'criterion-deployment': null },
    });
    expect(next.status).not.toBe('READY');
    expect(next.completedActivityIds).toEqual([]);
    expect(next.limitations.map(item => item.code)).toEqual(expect.arrayContaining([
      'DEPENDENCY_NOT_COMPLETED',
      'RESOURCE_SHORTAGE',
      'REPORT_NOT_RECEIVED',
      'CRITERION_NOT_MET',
    ]));
  });

  const override = (
    decisionId: string,
    orderId: string,
    limitations: readonly ('SIGNAL_NOT_RECEIVED' | 'PERSONNEL_SHORTAGE' | 'EQUIPMENT_UNSERVICEABLE' | 'SUPPLIES_NOT_REPLENISHED' | 'AREA_NOT_OCCUPIED' | 'COMMUNICATIONS_UNAVAILABLE')[],
    authorized = true,
  ) => ({
    decisionId, orderId, limitations, authorized, actorId: 'chief', actorRole: 'LEADER', authorities: ['readiness.partial.override'],
    basis: 'Приказ', rationale: 'Продолжить с ограничениями', at: DUE,
  });

  it('разрешение руководителя оформляется отдельно и не стирает ограничения', () => {
    const partial: ReadinessState = {
      ...state([{ code: 'PERSONNEL_SHORTAGE', since: START, details: 'Недокомплект 10 человек' }]),
      status: 'PARTIAL',
    };
    const serverActor = { userId: 'chief', activeRole: 'LEADER', organizationId: 'org-1', authorities: ['readiness.partial.override'] };
    expect(() => authorizePartialReadiness(partial, override('decision-0', 'order-0', ['PERSONNEL_SHORTAGE'], false), serverActor)).toThrow('уполномочен');
    expect(() => authorizePartialReadiness(partial, override('decision-attacker', 'order-1', ['PERSONNEL_SHORTAGE']), {
      ...serverActor, userId: 'attacker', authorities: [],
    })).toThrow('уполномочен');
    const authorized = authorizePartialReadiness(partial, override('decision-1', 'order-1', ['PERSONNEL_SHORTAGE']), serverActor);
    expect(authorized.status).toBe('PARTIAL');
    expect(authorized.limitations).toEqual(partial.limitations);
    expect(authorized.authorizations).toHaveLength(1);
    const result = assertReadyForTask({
      scenarioState: 'SEALED', readiness: authorized, allowPartial: true, orderId: 'order-1',
      authorization: authorized.authorizations[0], profile: effects,
    });
    expect(result.allowed).toBe(true);
    expect(result.missing).toEqual(['PERSONNEL_SHORTAGE']);
    expect(result.effects.capabilityFactor).toBe(0.7);
    expect(result.explanation.join(' ')).toContain('decision-1');
  });

  it('парный сценарий SIM-24: незавершённая готовность меняет первый приказ', () => {
    const ready = assertReadyForTask({ scenarioState: 'SEALED', readiness: 'READY', missing: [], allowPartial: false, profile: effects });
    const partial = assertReadyForTask({
      scenarioState: 'SEALED', readiness: 'PARTIAL', missing: ['SIGNAL_NOT_RECEIVED'], allowPartial: true, orderId: 'order-1',
      authorization: override('d1', 'order-1', ['SIGNAL_NOT_RECEIVED']), profile: effects,
    });
    expect(ready.allowed).toBe(true);
    expect(partial.allowed).toBe(true);
    expect(partial.effects.orderProcessingDelayMinutes).toBeGreaterThan(ready.effects.orderProcessingDelayMinutes!);
    expect(partial.effects.movementFactor).toBeLessThan(ready.effects.movementFactor!);
    expect(partial.missing).toEqual(['SIGNAL_NOT_RECEIVED']);
  });

  it('не подставляет коэффициенты при неизвестном правиле профиля', () => {
    const result = assertReadyForTask({
      scenarioState: 'SEALED', readiness: 'PARTIAL', missing: ['COMMUNICATIONS_UNAVAILABLE'], allowPartial: true, orderId: 'order-1',
      authorization: override('d1', 'order-1', ['COMMUNICATIONS_UNAVAILABLE']), profile: effects,
    });
    expect(result.status).toBe('REQUIRES_REVIEW');
    expect(result.allowed).toBe(false);
    expect(result.effects.capabilityFactor).toBeNull();
  });

  it('AC-24: сохраняет разные последствия трёх сил после SEALED и разрешения', () => {
    const cases = [
      ['SIGNAL_NOT_RECEIVED'],
      ['PERSONNEL_SHORTAGE', 'EQUIPMENT_UNSERVICEABLE'],
      ['SUPPLIES_NOT_REPLENISHED', 'AREA_NOT_OCCUPIED'],
    ] as const;
    const results = cases.map((missing, index) => assertReadyForTask({
      scenarioState: 'SEALED', readiness: 'PARTIAL', missing, allowPartial: true, orderId: `order-${index}`,
      authorization: override(`ac24-${index}`, `order-${index}`, [...missing]), profile: effects,
    }));
    expect(results.every(result => result.allowed)).toBe(true);
    expect(results.map(result => result.missing)).toEqual(cases);
    expect(results[0].effects.orderProcessingDelayMinutes).toBe(20);
    expect(results[1].effects.capabilityFactor).toBe(0.35);
    expect(results[2].effects.resourceFactor).toBe(0.4);
    expect(results[2].effects.movementFactor).toBe(0.4);
  });
});
