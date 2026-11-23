import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { MoraleComponents, MoraleSource } from '../../../../packages/kshvi/src/forces/morale-model';
import { MORALE_PROFILE_V1 } from '../../../../packages/kshvi/src/forces/morale-profile';
import { advanceMorale, createMoralePsychState } from '../../../../packages/kshvi/src/forces/morale-state';
import { applyMoraleToTask, decideSystemCommander, moraleInputFromState, utilityMaximizingCommanderPort, type CommanderOption, type MoraleEffectInput } from '../../../../packages/kshvi/src/forces/morale-effects';
import { projectMorale } from '../../../../packages/kshvi/src/forces/morale-projection';
import { appendResourceLedgerEntry, type ResourceLedgerEntry } from '../../../../packages/kshvi/src/logistics/ledger';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

const START = '2030-01-01T09:00:00.000Z';
const DECISION_AT = '2030-01-01T09:30:00.000Z';
const source: MoraleSource = {
  kind: 'EDUCATIONAL_ASSUMPTION', reference: 'AC-21: синтетический пороговый прогон', assumptionId: 'AC21-MPS-01',
  approvedBy: 'Методист КШВИ', applicability: 'Только моделируемые силы; не оценка реальных участников',
};
function known(value: number) {
  return { status: 'KNOWN' as const, value, uncertainty: 'EXACT_SCENARIO_VALUE' as const, observedAt: START, source };
}
function stateWith(morale: number, cohesion: number, stress: number) {
  const components: MoraleComponents = {
    morale: known(morale), cohesion: known(cohesion), stress: known(stress), fatigue: known(0.2),
    commandTrust: known(morale), recoveryCapacity: known(morale),
  };
  return createMoralePsychState({ subject: { kind: 'SIMULATED_FORCE', forceId: 'force-1' }, at: START, components });
}
const commonTask = {
  readiness: 1, equipment: 1, resources: 1, fatigue: 0.2, randomKey: null,
  availableMinutes: 60, requiredTaskMinutes: 25, unrelatedResource: { resourceId: 'fuel', amount: 37, unit: 'tonne' },
} as const;
const options: readonly CommanderOption[] = [
  { optionId: 'continue', action: 'CONTINUE_TASK', baseUtility: 0.55, demand: 'HIGH', risk: 0.8, ordered: true },
  { optionId: 'consolidate', action: 'CONSOLIDATE', baseUtility: 0.5, demand: 'LOW', risk: 0.1, ordered: true },
];
const commander = { riskPropensity: 0.6, persistence: 0.8, lossTolerance: 0.5, obedience: 0.8, source };
function runEpisode(morale: number, cohesion: number, stress: number) {
  const transition = advanceMorale({
    state: stateWith(morale, cohesion, stress), at: DECISION_AT, intervalMinutes: 30,
    impacts: [{ eventId: 'command-continuity-1', kind: 'COMMAND_CONTINUITY', occurredAt: START, changes: { commandTrust: 0.02 }, source }],
  });
  const state = transition.state;
  const effect = applyMoraleToTask({ ...commonTask, morale: moraleInputFromState(state, DECISION_AT) });
  const projection = projectMorale({
    truth: state,
    assessment: {
      kind: 'INSTANCE_ASSESSMENT', forceId: 'force-1', instanceId: 'instance-1', assessedAt: START, availableAt: START,
      stateEnteredAt: START, components: state.components, source: { kind: 'REPORT', reportId: 'report-1' },
    },
    viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' }, at: DECISION_AT,
  });
  const decision = decideSystemCommander({ projection, options, commander, port: utilityMaximizingCommanderPort });
  return { transition, effect, decision };
}

it('AC-21: МПС меняет сроки, исполнение и выбор, а восстановление расходует ресурс один раз', { timeout: 30_000 }, async () => {
  const high = runEpisode(0.9, 0.9, 0.1);
  const low = runEpisode(0.1, 0.2, 0.9);
  const highInput: MoraleEffectInput = { status: 'KNOWN', morale: 0.9, cohesion: 0.9, stress: 0.1, durationMinutes: 30 };
  const lowInput: MoraleEffectInput = { status: 'KNOWN', morale: 0.1, cohesion: 0.2, stress: 0.9, durationMinutes: 30 };
  const highTask = { ...commonTask, seed: 'same-seed', branchId: 'same-branch', worldVersion: 'world-v1', decisionVersion: 'commander-v1', morale: highInput };
  const lowTask = { ...highTask, morale: lowInput };
  expect({ ...highTask, morale: null }).toEqual({ ...lowTask, morale: null });
  expect(low.effect.orderProcessingMinutes!).toBeGreaterThan(high.effect.orderProcessingMinutes!);
  expect(low.effect.orderDelayMinutes!).toBeGreaterThan(high.effect.orderDelayMinutes!);
  expect(low.effect.movementRateFactor!).toBeLessThan(high.effect.movementRateFactor!);
  expect(low.effect.reportDelayMinutes!).toBeGreaterThan(high.effect.reportDelayMinutes!);
  expect(high.effect.taskStatus).toBe('EXECUTED');
  expect(low.effect.taskStatus).toBe('INTERRUPTED');
  expect(high.decision.selectedOptionId).toBe('continue');
  expect(low.decision.selectedOptionId).toBe('consolidate');
  expect(high.effect.finalSituation.objectiveHeld).toBe(true);
  expect(low.effect.finalSituation.objectiveHeld).toBe(false);
  expect(high.effect.causalChain).toEqual(['MORALE_COMPONENTS', 'ORDER_PROCESSING', 'TASK_EXECUTION', 'COMMANDER_CHOICE', 'FINAL_SITUATION']);
  expect(applyMoraleToTask(highTask).finalSituation).toEqual(high.effect.finalSituation);
  expect(applyMoraleToTask(lowTask).finalSituation).toEqual(low.effect.finalSituation);
  expect(runEpisode(0.9, 0.9, 0.1)).toEqual(high);
  expect(runEpisode(0.1, 0.2, 0.9)).toEqual(low);

  const control = applyMoraleToTask({ ...highTask, unrelatedResource: { resourceId: 'fuel', amount: 38, unit: 'tonne' } });
  expect(control.executionScore).toBe(applyMoraleToTask(highTask).executionScore);
  expect(control.finalSituation.unrelatedResource.amount).toBe(38);
  expect(high.effect.contributions.resources).toBe(low.effect.contributions.resources);
  expect(high.effect.contributions.fatigue).toBe(low.effect.contributions.fatigue);
  expect(high.effect.finalSituation.unrelatedResource).toEqual(low.effect.finalSituation.unrelatedResource);

  const initial = stateWith(0.1, 0.2, 0.9);
  const timeOnly = advanceMorale({ state: initial, at: '2030-01-01T10:00:00.000Z', intervalMinutes: 60 });
  expect(timeOnly.state.components).toEqual(initial.components);
  expect(timeOnly.resourceConsumptions).toEqual([]);
  let entries: ResourceLedgerEntry[] = [{
    id: 'opening-recovery', operation: 'OPENING', resourceId: 'recovery-support', unit: 'support-unit', quantity: 2,
    nodeId: 'force-1', at: START, causeId: 'scenario-start', actorId: 'director',
  }];
  const resourceJournal = {
    consume(consumption: { eventId: string; resourceId: string; amount: number; unit: string; at: string }) {
      const result = appendResourceLedgerEntry(entries, {
        id: consumption.eventId, operation: 'CONSUME', resourceId: consumption.resourceId, unit: consumption.unit,
        quantity: consumption.amount, nodeId: 'force-1', at: consumption.at, causeId: consumption.eventId, actorId: 'morale-model',
      });
      entries = [...result.entries];
      return result;
    },
  };
  const recovery = {
    eventId: 'rest-ac21', activity: 'REST_AND_SLEEP' as const, durationMinutes: 60,
    availableResources: { resourceId: 'recovery-support', amount: 2, unit: 'support-unit' }, source,
  };
  const recovered = advanceMorale({ state: initial, at: '2030-01-01T10:00:00.000Z', intervalMinutes: 60, resourceJournal, recovery });
  expect(recovered.recovery?.status).toBe('APPLIED');
  expect(recovered.state.components.morale.value).toBeGreaterThan(0.1);
  expect(recovered.state.components.stress.value).toBeLessThan(0.9);
  expect(entries.map(entry => entry.id)).toEqual(['opening-recovery', 'rest-ac21']);
  const repeated = advanceMorale({ state: recovered.state, at: '2030-01-01T11:00:00.000Z', intervalMinutes: 60, resourceJournal, recovery });
  expect(repeated.recovery?.status).toBe('DUPLICATE');
  expect(repeated.resourceConsumptions).toEqual([]);
  expect(entries).toHaveLength(2);

  const unknownState = createMoralePsychState({
    subject: { kind: 'SIMULATED_FORCE', forceId: 'force-unknown' }, at: START,
    components: {
      morale: { status: 'UNKNOWN', reason: 'Нет сценарной оценки', observedAt: START },
      cohesion: known(0.5), stress: known(0.5), fatigue: known(0.2), commandTrust: known(0.5), recoveryCapacity: known(0.5),
    },
  });
  const unknown = applyMoraleToTask({ ...commonTask, morale: moraleInputFromState(unknownState, DECISION_AT) });
  expect(unknown).toMatchObject({ status: 'REQUIRES_REVIEW', orderProcessingMinutes: null, executionScore: null, taskStatus: 'REQUIRES_REVIEW' });
  expect(() => createMoralePsychState({ subject: { kind: 'REAL_PERSON', participantId: 'user-1' }, at: START, components: unknownState.components } as never)).toThrow('только для моделируемых сил');

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac21';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const journalPath = `${directory}/journal.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const initialRevision = { id: 'ac21-morale-threshold', revision: 1, sha256: hashCanonical({ profile: MORALE_PROFILE_V1, highTask, lowTask }) };
  const journal = { runId, commit, initialRevision, high, low, control, recovery: { recovered, repeated, entries }, unknown };
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    executedWithHighMorale: 1, interruptedWithLowMorale: 1, commanderChoiceChanges: 1,
    orderProcessingDifferenceMinutes: low.effect.orderProcessingMinutes! - high.effect.orderProcessingMinutes!,
    recoveryResourceEntries: entries.length - 1, duplicateRecoveryConsumptions: repeated.resourceConsumptions.length,
    unknownReviews: unknown.status === 'REQUIRES_REVIEW' ? 1 : 0,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-21 завершён\nrunId: ${runId}\ncommit: ${commit}\nПарный пороговый прогон изменил сроки, задачу, выбор командира и итоговую обстановку; восстановление потребовало времени и одной записи ресурса; повтор не списал ресурс; UNKNOWN оставлен на рассмотрении.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-21.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: journalSha256, eventCount: entries.length + high.transition.contributions.length + low.transition.contributions.length },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical(MORALE_PROFILE_V1), journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Пороговый эпизод синтетический и использует только учебные допущения профиля МПС; коэффициенты не являются психологической диагностикой людей и требуют методической оценки AC-30.'],
    artifacts: [journalPath, protocolPath, metricsPath],
  }, null, 2));
});
