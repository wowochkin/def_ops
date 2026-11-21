import { describe, expect, it } from 'vitest';
import type { MoraleComponents, MoraleSource } from '../src/forces/morale-model';
import { advanceMorale, createMoralePsychState } from '../src/forces/morale-state';
import {
  applyMoraleToTask,
  decideSystemCommander,
  moraleInputFromState,
  utilityMaximizingCommanderPort,
  type CommanderOption,
  type MoraleEffectInput,
} from '../src/forces/morale-effects';
import { projectMorale } from '../src/forces/morale-projection';

const START = '2026-11-21T09:00:00.000Z';
const DECISION_AT = '2026-11-21T09:30:00.000Z';

const source: MoraleSource = {
  kind: 'EDUCATIONAL_ASSUMPTION',
  reference: 'Пороговый парный прогон MPS-08/SIM-24',
  assumptionId: 'MPS-SENSITIVITY-01',
  approvedBy: 'Методист КШВИ',
  applicability: 'Только синтетическая проверка чувствительности моделируемых сил',
};

function known(value: number) {
  return { status: 'KNOWN' as const, value, uncertainty: 'EXACT_SCENARIO_VALUE' as const, observedAt: START, source };
}

function stateWith(morale: number, cohesion: number, stress: number) {
  const values: MoraleComponents = {
    morale: known(morale),
    cohesion: known(cohesion),
    stress: known(stress),
    fatigue: known(0.2),
    commandTrust: known(morale),
    recoveryCapacity: known(morale),
  };
  return createMoralePsychState({
    subject: { kind: 'SIMULATED_FORCE', forceId: 'force-1' },
    at: START,
    components: values,
  });
}

const commonTask = {
  readiness: 1,
  equipment: 1,
  resources: 1,
  fatigue: 0.2,
  randomKey: null,
  availableMinutes: 60,
  requiredTaskMinutes: 25,
  unrelatedResource: { resourceId: 'fuel', amount: 37, unit: 'tonne' },
} as const;

const options: readonly CommanderOption[] = [
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

function runEpisode(morale: number, cohesion: number, stress: number) {
  const initial = stateWith(morale, cohesion, stress);
  const transition = advanceMorale({
    state: initial,
    at: DECISION_AT,
    intervalMinutes: 30,
    impacts: [{
      eventId: 'command-continuity-1',
      kind: 'COMMAND_CONTINUITY',
      occurredAt: START,
      changes: { commandTrust: 0.02 },
      source,
    }],
  });
  const state = transition.state;
  const moraleInput = moraleInputFromState(state, DECISION_AT);
  const effect = applyMoraleToTask({ ...commonTask, morale: moraleInput });
  const projection = projectMorale({
    truth: state,
    assessment: {
      kind: 'INSTANCE_ASSESSMENT',
      forceId: 'force-1',
      instanceId: 'instance-1',
      assessedAt: START,
      availableAt: START,
      stateEnteredAt: START,
      components: state.components,
      source: { kind: 'REPORT', reportId: 'report-1' },
    },
    viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' },
    at: DECISION_AT,
  });
  const decision = decideSystemCommander({
    projection,
    options,
    commander,
    port: utilityMaximizingCommanderPort,
  });
  return { transition, effect, decision };
}

describe('парная чувствительность MPS-08 и SIM-24', () => {
  it('при единственном различии МПС пересекает порог и меняет приказ, выбор и итоговую обстановку', () => {
    const highInput: MoraleEffectInput = { status: 'KNOWN', morale: 0.9, cohesion: 0.9, stress: 0.1, durationMinutes: 30 };
    const lowInput: MoraleEffectInput = { status: 'KNOWN', morale: 0.1, cohesion: 0.2, stress: 0.9, durationMinutes: 30 };
    const highTask = {
      ...commonTask,
      seed: 'same-seed',
      branchId: 'same-branch',
      worldVersion: 'world-v1',
      decisionVersion: 'commander-v1',
      morale: highInput,
    };
    const lowTask = { ...highTask, morale: lowInput };
    expect({ ...highTask, morale: null }).toEqual({ ...lowTask, morale: null });

    const high = runEpisode(0.9, 0.9, 0.1);
    const low = runEpisode(0.1, 0.2, 0.9);
    const directHigh = applyMoraleToTask(highTask);
    const directLow = applyMoraleToTask(lowTask);

    expect(low.effect.orderProcessingMinutes!).toBeGreaterThan(high.effect.orderProcessingMinutes!);
    expect(low.effect.orderDelayMinutes!).toBeGreaterThan(high.effect.orderDelayMinutes!);
    expect(low.effect.movementRateFactor!).toBeLessThan(high.effect.movementRateFactor!);
    expect(low.effect.reportDelayMinutes!).toBeGreaterThan(high.effect.reportDelayMinutes!);
    expect(low.effect.executionScore!).toBeLessThan(low.effect.interruption.threshold);
    expect(high.effect.executionScore!).toBeGreaterThanOrEqual(high.effect.interruption.threshold);
    expect(high.effect.taskStatus).toBe('EXECUTED');
    expect(low.effect.taskStatus).toBe('INTERRUPTED');
    expect(high.decision.selectedOptionId).toBe('continue');
    expect(low.decision.selectedOptionId).toBe('consolidate');
    expect(high.effect.finalSituation.objectiveHeld).toBe(true);
    expect(low.effect.finalSituation.objectiveHeld).toBe(false);
    expect(low.effect.finalSituation.progress!).toBeLessThan(high.effect.finalSituation.progress!);
    expect(low.effect.finalSituation.unrelatedResource).toEqual(commonTask.unrelatedResource);
    expect(high.effect.finalSituation.unrelatedResource).toEqual(commonTask.unrelatedResource);
    expect(high.effect.contributions.resources).toBe(low.effect.contributions.resources);
    expect(high.effect.contributions.fatigue).toBe(low.effect.contributions.fatigue);
    expect(high.effect.causalChain).toEqual([
      'MORALE_COMPONENTS',
      'ORDER_PROCESSING',
      'TASK_EXECUTION',
      'COMMANDER_CHOICE',
      'FINAL_SITUATION',
    ]);
    expect(directHigh.finalSituation).toEqual(high.effect.finalSituation);
    expect(directLow.finalSituation).toEqual(low.effect.finalSituation);
  });

  it('улучшение только МПС не ухудшает монотонные показатели и не меняет несвязанный ресурс', () => {
    const low = applyMoraleToTask({
      ...commonTask,
      morale: { status: 'KNOWN', morale: 0.2, cohesion: 0.2, stress: 0.8, durationMinutes: 30 },
    });
    const middle = applyMoraleToTask({
      ...commonTask,
      morale: { status: 'KNOWN', morale: 0.5, cohesion: 0.5, stress: 0.5, durationMinutes: 30 },
    });
    const high = applyMoraleToTask({
      ...commonTask,
      morale: { status: 'KNOWN', morale: 0.9, cohesion: 0.9, stress: 0.1, durationMinutes: 30 },
    });
    expect(middle.executionScore!).toBeGreaterThanOrEqual(low.executionScore!);
    expect(high.executionScore!).toBeGreaterThanOrEqual(middle.executionScore!);
    expect(middle.orderProcessingMinutes!).toBeLessThanOrEqual(low.orderProcessingMinutes!);
    expect(high.orderProcessingMinutes!).toBeLessThanOrEqual(middle.orderProcessingMinutes!);
    expect(new Set([low, middle, high].map(result => result.contributions.fatigue))).toEqual(new Set([low.contributions.fatigue]));
    expect(new Set([low, middle, high].map(result => result.finalSituation.unrelatedResource.amount))).toEqual(new Set([37]));
  });

  it('повторный replay воспроизводит переход, выбор порта и обстановку без нового случайного выбора', () => {
    const firstHigh = runEpisode(0.9, 0.9, 0.1);
    const replayHigh = runEpisode(0.9, 0.9, 0.1);
    const firstLow = runEpisode(0.1, 0.2, 0.9);
    const replayLow = runEpisode(0.1, 0.2, 0.9);
    expect(replayHigh).toEqual(firstHigh);
    expect(replayLow).toEqual(firstLow);
    expect(JSON.stringify(replayHigh)).toBe(JSON.stringify(firstHigh));
    expect(JSON.stringify(replayLow)).toBe(JSON.stringify(firstLow));
  });
});
