import { describe, expect, it } from 'vitest';
import { createDecision, projectDecision } from '../src/decisions/decision';
import { advanceOrder, issueOrder, type OrderExecution } from '../src/decisions/order-execution';
import * as calculationModule from '../src/simulation/calculation';
import { explainCalculation } from '../src/simulation/explanation';
import { createObservation, type CreateObservationInput, type Observation } from '../src/simulation/observation';
import { mergeObservations } from '../src/simulation/observation-merge';
import { markStale, projectObservation } from '../src/simulation/observation-projection';

const createdAt = '2030-01-01T01:00:00Z';
const decisionInput = {
  id: 'decision-scope', sideId: 'blue', authorId: 'author-blue', createdAt, intent: 'Служебный замысел всей стороны',
  goals: [{ id: 'goal-secret', rank: 1, title: 'Скрытая цель' }],
  tasks: [{ id: 'task-own', assigneeId: 'node-own', title: 'Своя задача' }, { id: 'task-other', assigneeId: 'node-other', title: 'Чужая задача' }],
  resources: [{ resourceId: 'fuel', amount: 10, unit: 'L' }],
  deadlines: [{ taskId: 'task-own', operationalAt: '2030-01-01T02:00:00Z' }, { taskId: 'task-other', operationalAt: '2030-01-01T03:00:00Z' }],
  coordination: [{ withNodeId: 'node-other', subject: 'Чужое взаимодействие' }], reserves: [{ forceId: 'reserve-secret', condition: 'Скрытый резерв' }],
  transitionConditions: [{ id: 'condition-secret', expression: 'secret.condition' }], assumptions: [{ id: 'assumption-secret', text: 'Скрытое допущение' }],
} as const;

describe('Critical 4: проекция по назначенным инстанциям', () => {
  it('ограничивает обучаемого назначенными задачами даже внутри его стороны', () => {
    const projection = projectDecision(createDecision(decisionInput), { sideId: 'blue', role: 'TRAINEE', assignedNodeIds: ['node-own'] });
    expect(projection.tasks).toEqual([{ id: 'task-own', assigneeId: 'node-own', title: 'Своя задача' }]);
    expect(projection.deadlines).toEqual([{ taskId: 'task-own', operationalAt: '2030-01-01T02:00:00Z' }]);
    expect(JSON.stringify(projection)).not.toContain('task-other');
    expect(JSON.stringify(projection)).not.toContain('Служебный замысел всей стороны');
    expect(JSON.stringify(projection)).not.toContain('reserve-secret');
    expect(JSON.stringify(projection)).not.toContain('assumption-secret');
    expect(projection.visibility).toBe('ASSIGNED');
  });

  it('требует назначение для обучаемого и посредника, а не только для чужой стороны', () => {
    const decision = createDecision(decisionInput);
    expect(() => projectDecision(decision, { sideId: 'blue', role: 'TRAINEE' })).toThrow('403');
    expect(() => projectDecision(decision, { sideId: 'blue', role: 'INTERMEDIARY', assignedNodeIds: ['node-unassigned'] })).toThrow('403');
    expect(projectDecision(decision, { sideId: 'blue', role: 'INTERMEDIARY', assignedNodeIds: ['node-own'] }).tasks).toHaveLength(1);
  });
});

describe('Minor 3: время первой версии решения', () => {
  it('фиксирует createdAt в первой записи истории', () => {
    const decision = createDecision(decisionInput);
    expect(decision.createdAt).toBe(createdAt);
    expect(decision.statusHistory[0]).toEqual({ status: 'DRAFT', at: createdAt });
  });
});

function executingOrder(): OrderExecution {
  let order = issueOrder({ id: 'order-monotonic', decisionId: 'decision-scope', issuerNodeId: 'node-command', executorNodeId: 'node-own', sideId: 'blue', issuedAt: '2030-01-01T01:00:00Z', taskId: 'task-own', plannedResources: {} });
  order = advanceOrder(order, { type: 'DELIVER', at: '2030-01-01T01:05:00Z' });
  order = advanceOrder(order, { type: 'PROCESS', at: '2030-01-01T01:06:00Z' });
  order = advanceOrder(order, { type: 'PREPARE', at: '2030-01-01T01:07:00Z' });
  return advanceOrder(order, { type: 'START_EXECUTION', at: '2030-01-01T01:10:00Z', position: { remainingMeters: 5000, travelledMeters: 0 } });
}

describe('Important 3: монотонность исполнения', () => {
  it('запрещает уменьшение пройденного пути и увеличение остатка', () => {
    const order = executingOrder();
    expect(() => advanceOrder(order, { type: 'RECORD_COST', at: '2030-01-01T01:20:00Z', timeMinutes: 10, resources: {}, position: { remainingMeters: 6000, travelledMeters: 1000 } })).toThrow('монотон');
    expect(() => advanceOrder(order, { type: 'RECORD_COST', at: '2030-01-01T01:20:00Z', timeMinutes: 10, resources: {}, position: { remainingMeters: 6000, travelledMeters: -1000 } })).toThrow('неотрицатель');
    const progressed = advanceOrder(order, { type: 'RECORD_COST', at: '2030-01-01T01:20:00Z', timeMinutes: 10, resources: {}, position: { remainingMeters: 4000, travelledMeters: 1000 } });
    expect(() => advanceOrder(progressed, { type: 'RECORD_COST', at: '2030-01-01T01:30:00Z', timeMinutes: 10, resources: {}, position: { remainingMeters: 4500, travelledMeters: 500 } })).toThrow('монотон');
  });

  it('запрещает перемещение с нулевой длительностью и действия задним числом', () => {
    const order = executingOrder();
    expect(() => advanceOrder(order, { type: 'RECORD_COST', at: '2030-01-01T01:10:00Z', timeMinutes: 0, resources: {}, position: { remainingMeters: 1000, travelledMeters: 4000 } })).toThrow('времен');
    expect(() => advanceOrder(order, { type: 'RECORD_COST', at: '2030-01-01T01:05:00Z', timeMinutes: 5, resources: {} })).toThrow('хронолог');
  });
});

const episode = {
  state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 },
  resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 2, supplied: 0 }, elapsedMinutes: 10,
  position: { remainingMeters: 5000, travelledMeters: 0 }, uncertainty: {},
  effects: { taskProgressDelta: 20, positionAdvanceMeters: 2500, stateChanges: {}, uncertaintyChanges: {} },
} as const;
const passport = {
  purpose: 'Регрессии ревизии', limitations: ['Только учебный контур'], source: { kind: 'ASSUMPTION' as const, note: 'Учебное допущение', applicability: 'Тесты' },
  knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1,
};
function options(mode: calculationModule.CalculationMode): calculationModule.CalculateOptions {
  return {
    id: `review-${mode}`, mode, reason: 'Регрессия', createdAt, inputSnapshot: { revision: 1 }, inputs: { episode }, requiredInputs: [], units: {}, modelVersion: 'aggregate-v1', profileVersions: {}, modelPassport: passport,
    ...(mode === 'HYBRID' ? { hybridReviewParameters: ['episode'] } : {}),
    ...(mode === 'STOCHASTIC' ? { stochastic: {
      key: { seed: 17n, exerciseId: 'e', branchId: 'b', purpose: 'review-replay', ordinal: 0, algorithmVersion: 1 },
      outcomes: [{ id: 'a', weight: 1, effects: episode.effects }, { id: 'b', weight: 1, effects: { ...episode.effects, positionAdvanceMeters: 100 } }],
    } } : {}),
  };
}

describe('Important 2: пересчёт гибрида', () => {
  it('пересчитывает результат с рассмотренными входами и связывает его с исходным хешем', () => {
    const original = calculationModule.calculate(options('HYBRID'));
    const reviewedEpisode = { ...episode, effects: { ...episode.effects, positionAdvanceMeters: 4000 } };
    const approved = calculationModule.approveCalculation(original, { author: 'leader', authorized: true, reviewedParameters: { episode: reviewedEpisode } });
    const result = approved.result as { position: { travelledMeters: number } };
    expect(result.position.travelledMeters).toBe(4000);
    expect((original.result as { position: { travelledMeters: number } }).position.travelledMeters).toBe(2500);
    expect(approved.hybridReview?.reviewedParameters).toEqual({ episode: reviewedEpisode });
    expect(approved.hybridReview?.effectiveInputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approved.recomputedFrom).toEqual({ calculationId: original.id, inputHash: original.inputHash });
  });
});

describe('Important 9: replay только по сохранённым ключам', () => {
  it('восстанавливает stochastic-расчёт без повторной передачи исходного ключа', () => {
    const first = calculationModule.calculate(options('STOCHASTIC'));
    const replay = calculationModule.replayCalculation(first);
    expect(replay).toEqual(first);
    expect(replay.randomKeys).toEqual(first.randomKeys);
    const tampered = { ...first, randomKeys: [{ ...first.randomKeys[0], digest: '0'.repeat(64) }] };
    expect(() => calculationModule.replayCalculation(tampered)).toThrow('ключ');
  });
});

const observationInput: CreateObservationInput = {
  id: 'observation-review', trueForceId: 'force-a', trueGeometry: { lon: 37.6, lat: 55.7 }, trueAttributes: { type: 'unit' }, observedAt: '2030-01-01T00:00:00Z',
  source: { id: 'sensor', kind: 'UAV', sideId: 'blue', profileVersion: 'v1', errorMeters: { min: 10, max: 20 }, delaySeconds: { min: 1, max: 2 }, completeness: 0.8, reliability: 0.8, validitySeconds: 60, attributeKeys: ['type'] },
  environment: { snapshotId: 'env', errorMultiplier: 1, delayMultiplier: 1 }, randomKey: { seed: 3n, exerciseId: 'e', branchId: 'b', purpose: 'observation', ordinal: 0, algorithmVersion: 1 },
};

describe('Important 4: безопасное слияние', () => {
  it('не создаёт объединённый объект из разных trueForceId', () => {
    const first = createObservation(observationInput);
    const second = createObservation({ ...observationInput, id: 'observation-b', trueForceId: 'force-b' });
    expect(() => mergeObservations([first, second], { id: 'merged-fictitious', ruleVersion: 1 })).toThrow('разных объектов');
  });

  it('сохраняет самый ранний срок и минимальные полноту/достоверность при любом устаревшем входе', () => {
    const stale = markStale(createObservation(observationInput), '2030-01-01T00:02:00Z');
    const current = createObservation({ ...observationInput, id: 'observation-current', observedAt: '2030-01-01T00:01:00Z', source: { ...observationInput.source, completeness: 0.95, reliability: 0.95, validitySeconds: 600 } });
    const merged = mergeObservations([stale, current], { id: 'merged-conservative', ruleVersion: 1 }).merged;
    expect(merged.status).toBe('STALE');
    expect(merged.validUntil).toBe(stale.validUntil);
    expect(merged.completeness).toBe(0.8);
    expect(merged.reliability).toBe(0.8);
  });

  it('отклоняет противоречивую геометрию независимо от порядка докладов', () => {
    const first = createObservation(observationInput);
    const second: Observation = { ...createObservation({ ...observationInput, id: 'observation-far' }), reportedGeometry: { lon: 38.6, lat: 55.7 } };
    expect(() => mergeObservations([first, second], { id: 'merged-contradiction', ruleVersion: 1 })).toThrow('Противореч');
    expect(() => mergeObservations([second, first], { id: 'merged-contradiction-reverse', ruleVersion: 1 })).toThrow('Противореч');
  });
});

describe('Important 10: глубокая санитизация', () => {
  it('удаляет служебные ключи из source, вложенных атрибутов и массивов', () => {
    const projected = projectObservation({
      id: 'o1', observedAt: 't1',
      source: { id: 'sensor', kind: 'UAV', sideId: 'blue', profileVersion: 'v1', nested: { trueForceId: 'secret', actualErrorMeters: 3 } },
      reportedAttributes: { safe: 'ok', nested: { actualErrorMeters: 5, value: 1 }, list: [{ trueForceId: 'secret', value: 2 }], reference: { hidden: true } },
    });
    expect(projected.source).toEqual({ id: 'sensor', kind: 'UAV', sideId: 'blue', profileVersion: 'v1' });
    expect(projected.reportedAttributes).toEqual({ safe: 'ok', nested: { value: 1 }, list: [{ value: 2 }] });
    expect(JSON.stringify(projected)).not.toContain('trueForceId');
    expect(JSON.stringify(projected)).not.toContain('actualErrorMeters');
    expect(JSON.stringify(projected)).not.toContain('reference');
  });
});

describe('Minor 2: объяснение по фактическим факторам', () => {
  it('не добавляет дефицит и потенциалы к ручному результату', () => {
    const calculation = calculationModule.calculate({ ...options('MANUAL'), manual: { author: 'leader', reason: 'Ручное решение', result: { delay: 10 } } });
    expect(explainCalculation(calculation).factors).toEqual([]);
  });
});
