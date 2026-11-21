import { describe, expect, it } from 'vitest';
import {
  MORALE_SCALE_V1,
  type MoraleComponents,
  type MoralePsychState,
  type MoraleSource,
} from '../src/forces/morale-model';
import { MORALE_PROFILE_V1 } from '../src/forces/morale-profile';
import { advanceMorale, createMoralePsychState } from '../src/forces/morale-state';
import {
  applyMoraleToTask,
  decideSystemCommander,
  moraleInputFromState,
  utilityMaximizingCommanderPort,
  type CommanderOption,
} from '../src/forces/morale-effects';
import { projectMorale, type MoraleAssessment } from '../src/forces/morale-projection';

const START = '2026-11-21T09:00:00.000Z';
const LATER = '2026-11-21T09:30:00.000Z';

const source: MoraleSource = {
  kind: 'EDUCATIONAL_ASSUMPTION',
  reference: 'Контрольный сценарий MPS-01',
  assumptionId: 'MPS-TEST-01',
  approvedBy: 'Методист КШВИ',
  applicability: 'Только проверка переходов моделируемых сил; не оценка людей',
};

function known(value: number, observedAt = START) {
  return { status: 'KNOWN' as const, value, uncertainty: 'EXACT_SCENARIO_VALUE' as const, observedAt, source };
}

function components(morale: number, cohesion: number, stress: number): MoraleComponents {
  return {
    morale: known(morale),
    cohesion: known(cohesion),
    stress: known(stress),
    fatigue: known(0.2),
    commandTrust: known(morale),
    recoveryCapacity: known(0.8),
  };
}

function makeState(morale = 0.8, cohesion = 0.8, stress = 0.2): MoralePsychState {
  return createMoralePsychState({
    subject: { kind: 'SIMULATED_FORCE', forceId: 'force-1' },
    at: START,
    components: components(morale, cohesion, stress),
  });
}

const taskBase = {
  readiness: 1,
  equipment: 1,
  resources: 1,
  fatigue: 0.2,
  randomKey: null,
  availableMinutes: 60,
  requiredTaskMinutes: 25,
  unrelatedResource: { resourceId: 'fuel', amount: 37, unit: 'tonne' },
} as const;

const commanderOptions: readonly CommanderOption[] = [
  { optionId: 'continue', action: 'CONTINUE_TASK', baseUtility: 0.55, demand: 'HIGH', risk: 0.8, ordered: true },
  { optionId: 'consolidate', action: 'CONSOLIDATE', baseUtility: 0.5, demand: 'LOW', risk: 0.1, ordered: true },
];

const commander = {
  riskPropensity: 0.6,
  persistence: 0.8,
  lossTolerance: 0.5,
  obedience: 0.8,
  source,
};

describe('версионное состояние и ограниченные переходы МПС', () => {
  it('хранит шесть компонентов, шкалу, источник, момент и неопределённость', () => {
    const state = makeState();
    expect(state.schemaVersion).toBe(1);
    expect(state.scale).toEqual(MORALE_SCALE_V1);
    expect(state.scale.ranges.map(range => range.id)).toEqual(['CRITICAL', 'LOW', 'STABLE', 'HIGH']);
    expect(Object.keys(state.components)).toHaveLength(6);
    expect(state.components.morale).toMatchObject({ status: 'KNOWN', observedAt: START, source });
    expect(state.subject).toEqual({ kind: 'SIMULATED_FORCE', forceId: 'force-1' });
  });

  it('не диагностирует реальных участников', () => {
    expect(() => createMoralePsychState({
      subject: { kind: 'REAL_PERSON', participantId: 'user-1' },
      at: START,
      components: components(0.8, 0.8, 0.2),
    } as never)).toThrow('только для моделируемых сил');
  });

  it('требует источник или оформленное учебное допущение', () => {
    expect(() => createMoralePsychState({
      subject: { kind: 'SIMULATED_FORCE', forceId: 'force-1' },
      at: START,
      components: {
        ...components(0.8, 0.8, 0.2),
        morale: { ...known(0.8), source: { ...source, assumptionId: '' } },
      },
    })).toThrow('учебного допущения');
  });

  it('применяет воздействие один раз, ограничивает вклад и сохраняет объяснение', () => {
    const impact = {
      eventId: 'loss-1',
      kind: 'LOSSES' as const,
      occurredAt: START,
      changes: { morale: -1, stress: 1 },
      source,
    };
    const first = advanceMorale({
      state: makeState(),
      at: LATER,
      intervalMinutes: 30,
      impacts: [impact, impact],
    });
    const cap = MORALE_PROFILE_V1.maxImpactPerComponentEvent;
    expect(first.state.components.morale).toMatchObject({ value: 0.8 - cap });
    expect(first.state.components.stress).toMatchObject({ value: 0.2 + cap });
    expect(first.appliedEventIds).toEqual(['loss-1']);
    expect(first.duplicateEventIds).toEqual(['loss-1']);
    expect(first.contributions[0]).toMatchObject({ eventId: 'loss-1', factor: 'MORALE_IMPACT' });

    const repeated = advanceMorale({
      state: first.state,
      at: '2026-11-21T10:00:00.000Z',
      intervalMinutes: 30,
      impacts: [impact],
    });
    expect(repeated.state.components).toEqual(first.state.components);
    expect(repeated.duplicateEventIds).toEqual(['loss-1']);
    expect(repeated.resourceConsumptions).toEqual([]);
    expect(repeated.state.history).toHaveLength(2);
  });

  it('не заменяет UNKNOWN нормальным значением при воздействии и расчёте задачи', () => {
    const state = createMoralePsychState({
      subject: { kind: 'SIMULATED_FORCE', forceId: 'force-1' },
      at: START,
      components: {
        ...components(0.8, 0.8, 0.2),
        morale: { status: 'UNKNOWN', reason: 'Нет сценарной оценки', observedAt: START },
      },
    });
    const transitioned = advanceMorale({
      state,
      at: LATER,
      intervalMinutes: 30,
      impacts: [{ eventId: 'failure-1', kind: 'TASK_FAILED', occurredAt: START, changes: { morale: -0.1 }, source }],
    });
    expect(transitioned.status).toBe('REQUIRES_REVIEW');
    expect(transitioned.state.components.morale.status).toBe('UNKNOWN');
    expect(transitioned.state.components.morale.value).toBeUndefined();

    const result = applyMoraleToTask({
      ...taskBase,
      morale: moraleInputFromState(state, LATER),
    });
    expect(result.status).toBe('REQUIRES_REVIEW');
    expect(result.unknown).toContain('morale');
    expect(result.orderProcessingMinutes).toBeNull();
    expect(result.executionScore).toBeNull();
    expect(result.taskStatus).toBe('REQUIRES_REVIEW');
  });

  it('восстанавливает только после мероприятия, времени и ресурсов без повторного списания', () => {
    const initial = makeState(0.4, 0.5, 0.7);
    const timeOnly = advanceMorale({ state: initial, at: '2026-11-21T10:00:00.000Z', intervalMinutes: 60 });
    expect(timeOnly.state.components).toEqual(initial.components);
    expect(timeOnly.resourceConsumptions).toEqual([]);

    const tooShort = advanceMorale({
      state: initial,
      at: '2026-11-21T10:00:00.000Z',
      intervalMinutes: 60,
      recovery: {
        eventId: 'rest-1',
        activity: 'REST_AND_SLEEP',
        durationMinutes: 30,
        availableResources: { resourceId: 'recovery-support', amount: 1, unit: 'support-unit' },
        source,
      },
    });
    expect(tooShort.recovery?.status).toBe('BLOCKED');
    expect(tooShort.state.components).toEqual(initial.components);
    expect(tooShort.resourceConsumptions).toEqual([]);

    const recovered = advanceMorale({
      state: initial,
      at: '2026-11-21T10:00:00.000Z',
      intervalMinutes: 60,
      recovery: {
        eventId: 'rest-1',
        activity: 'REST_AND_SLEEP',
        durationMinutes: 60,
        availableResources: { resourceId: 'recovery-support', amount: 1, unit: 'support-unit' },
        source,
      },
    });
    expect(recovered.recovery?.status).toBe('APPLIED');
    expect(recovered.state.components.morale.value).toBeGreaterThan(0.4);
    expect(recovered.state.components.stress.value).toBeLessThan(0.7);
    expect(recovered.resourceConsumptions).toEqual([
      { eventId: 'rest-1', resourceId: 'recovery-support', amount: 1, unit: 'support-unit' },
    ]);

    const repeated = advanceMorale({
      state: recovered.state,
      at: '2026-11-21T11:00:00.000Z',
      intervalMinutes: 60,
      recovery: {
        eventId: 'rest-1',
        activity: 'REST_AND_SLEEP',
        durationMinutes: 60,
        availableResources: { resourceId: 'recovery-support', amount: 1, unit: 'support-unit' },
        source,
      },
    });
    expect(repeated.state.components).toEqual(recovered.state.components);
    expect(repeated.resourceConsumptions).toEqual([]);
  });
});

describe('приватная оценка и решение системного командира', () => {
  function assessmentFor(state: MoralePsychState, morale: number): MoraleAssessment {
    return {
      kind: 'INSTANCE_ASSESSMENT',
      forceId: state.subject.forceId,
      instanceId: 'instance-1',
      assessedAt: START,
      availableAt: START,
      stateEnteredAt: START,
      components: {
        ...components(morale, 0.8, 0.2),
        morale: { ...known(morale), uncertainty: 'ESTIMATED' as const },
      },
      source: { kind: 'REPORT', reportId: 'report-1' },
    };
  }

  it('отделяет истину от оценки, не раскрывает её при отсутствии донесения', () => {
    const truth = makeState(0.9, 0.9, 0.1);
    const assessment = assessmentFor(truth, 0.3);
    const projected = projectMorale({
      truth,
      assessment,
      viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' },
      at: LATER,
    });
    expect(projected.kind).toBe('INSTANCE_ASSESSMENT');
    expect(projected.components.morale).toMatchObject({ status: 'KNOWN', value: 0.3, uncertainty: 'ESTIMATED' });

    const missing = projectMorale({
      truth,
      assessment: null,
      viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' },
      at: LATER,
    });
    expect(missing.kind).toBe('UNKNOWN');
    expect(missing.components.morale.status).toBe('UNKNOWN');
    expect(JSON.stringify(missing)).not.toContain('0.9');

    const control = projectMorale({
      truth,
      assessment,
      viewer: { role: 'EXERCISE_CONTROL', instanceId: 'control' },
      at: LATER,
    });
    expect(control.components.morale).toMatchObject({ value: 0.9 });
  });

  it('меняет выбор через типизированный порт и не принимает истину или UNKNOWN как оценку', () => {
    const highTruth = makeState(0.9, 0.9, 0.1);
    const lowTruth = makeState(0.1, 0.2, 0.9);
    const highProjection = projectMorale({
      truth: highTruth,
      assessment: assessmentFor(highTruth, 0.9),
      viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' },
      at: LATER,
    });
    const lowProjection = projectMorale({
      truth: lowTruth,
      assessment: {
        ...assessmentFor(lowTruth, 0.1),
        components: components(0.1, 0.2, 0.9),
      },
      viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' },
      at: LATER,
    });
    const high = decideSystemCommander({ projection: highProjection, options: commanderOptions, commander, port: utilityMaximizingCommanderPort });
    const low = decideSystemCommander({ projection: lowProjection, options: commanderOptions, commander, port: utilityMaximizingCommanderPort });
    expect(high).toMatchObject({ status: 'DECIDED', selectedOptionId: 'continue' });
    expect(low).toMatchObject({ status: 'DECIDED', selectedOptionId: 'consolidate' });
    expect(high.evaluatedOptions.every(option => option.moraleContribution !== 0)).toBe(true);

    const truthProjection = projectMorale({
      truth: highTruth,
      assessment: null,
      viewer: { role: 'EXERCISE_CONTROL', instanceId: 'control' },
      at: LATER,
    });
    expect(decideSystemCommander({ projection: truthProjection, options: commanderOptions, commander, port: utilityMaximizingCommanderPort }))
      .toMatchObject({ status: 'REQUIRES_REVIEW', selectedOptionId: null });

    const missing = projectMorale({
      truth: highTruth,
      assessment: null,
      viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' },
      at: LATER,
    });
    expect(decideSystemCommander({ projection: missing, options: commanderOptions, commander, port: utilityMaximizingCommanderPort }))
      .toMatchObject({ status: 'REQUIRES_REVIEW', selectedOptionId: null });
  });
});
