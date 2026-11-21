import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { appendToChain, verifyEventChain } from '../../../../packages/kshvi/src/events/hash-chain';
import type { ChainEvent } from '../../../../packages/kshvi/src/events/envelope';
import type { JsonValue } from '../../../../packages/kshvi/src/model/types';
import { validateExerciseAxes } from '../../../../packages/kshvi/src/model/profiles';
import { validateCommandTree } from '../../../../packages/kshvi/src/forces/command-tree';
import { createDecision, projectDecision, reviseDecision, transitionDecision, completeExercise, createDecisionCycle, recordDecisionElement, DECISION_CYCLE_ELEMENTS } from '../../../../packages/kshvi/src/decisions/decision-cycle';
import { advanceOrder, cancelOrder, issueOrder, type OrderExecution } from '../../../../packages/kshvi/src/decisions/order-execution';
import { assignStageCalculationProfile, evaluatePlaybook } from '../../../../packages/kshvi/src/decisions/playbook';
import { calculate, approveCalculation, applyCalculation, type CalculateOptions } from '../../../../packages/kshvi/src/simulation/calculation';
import { overrideCalculation } from '../../../../packages/kshvi/src/simulation/manual-override';
import { explainCalculation } from '../../../../packages/kshvi/src/simulation/explanation';
import { createObservation } from '../../../../packages/kshvi/src/simulation/observation';
import { projectObservation, projectObservationChannels } from '../../../../packages/kshvi/src/simulation/observation-projection';
import { projectWorld } from '../../../../packages/kshvi/src/projections/project';
import { orderActions } from '../../../../packages/kshvi/src/runtime/queue';
import { operationalAt } from '../../../../packages/kshvi/src/runtime/clock';
import { executeJump } from '../../../../packages/kshvi/src/runtime/jump';
import { proposeInput, applyDelegation } from '../../../../packages/kshvi/src/runtime/input';
import { evaluateTrigger, validateTriggerGraph } from '../../../../packages/kshvi/src/runtime/triggers';
import { applyWeatherEffects } from '../../../../packages/kshvi/src/environment/weather-effects';
import { emptyWorld } from '../../../../packages/kshvi/src/model/world';
import { reduceWorld } from '../../../../packages/kshvi/src/events/reducer';
import { InMemoryExerciseStore } from '../../src/store/exercise-store';
import { CommandService } from '../../src/instances/command-service';
import { SubscriptionService } from '../../src/http/subscription-service';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { withKshviDatabase } from '../helpers/database';
import type { KshviEventStore } from '../../src/store/event-store';

type OfficialInput = { instanceId: string; branchId: string; type: string; payload: JsonValue; idempotencyKey: string };
type OfficialEvent = ChainEvent & { instanceId: string; idempotent: boolean };
interface OfficialJournal {
  append(input: OfficialInput): Promise<OfficialEvent>;
  events(): readonly OfficialEvent[];
}

class MemoryOfficialJournal implements OfficialJournal {
  private readonly chains = new Map<string, ChainEvent[]>();
  private readonly commands = new Map<string, { request: string; event: OfficialEvent }>();
  private readonly all: OfficialEvent[] = [];

  async append(input: OfficialInput): Promise<OfficialEvent> {
    const commandKey = `${input.instanceId}/${input.idempotencyKey}`;
    const request = canonicalJson(input);
    const previous = this.commands.get(commandKey);
    if (previous) {
      if (previous.request !== request) throw new Error('Идемпотентный ключ уже использован с другим содержимым');
      return { ...previous.event, idempotent: true };
    }
    const chainKey = `${input.instanceId}/${input.branchId}`;
    const chain = this.chains.get(chainKey) ?? [];
    const eventId = `g2-${input.instanceId}-${chain.length + 1}`;
    const chained = appendToChain(chain, { eventId, sequence: chain.length + 1, type: input.type, payload: input.payload });
    const event: OfficialEvent = { ...chained, instanceId: input.instanceId, idempotent: false };
    this.chains.set(chainKey, [...chain, chained]);
    this.commands.set(commandKey, { request, event });
    this.all.push(event);
    return event;
  }

  events(): readonly OfficialEvent[] { return this.all; }
}

class PostgresOfficialJournal implements OfficialJournal {
  private readonly commands = new Map<string, number>();
  private readonly all: OfficialEvent[] = [];
  constructor(private readonly store: KshviEventStore) {}

  async append(input: OfficialInput): Promise<OfficialEvent> {
    const commandKey = `${input.instanceId}/${input.idempotencyKey}`;
    const aggregateRevision = this.commands.get(commandKey) ?? await this.store.aggregateRevision(input.instanceId, input.branchId);
    const result = await this.store.appendCommand({
      organizationId: 'org-g2', instanceId: input.instanceId, branchId: input.branchId,
      aggregateRevision, idempotencyKey: input.idempotencyKey, type: input.type, payload: input.payload,
    });
    this.commands.set(commandKey, aggregateRevision);
    const previous = this.all.filter(event => event.instanceId === input.instanceId).at(-1);
    const event: OfficialEvent = {
      eventId: result.eventId, sequence: result.sequence, type: input.type, payload: input.payload,
      prevHash: previous?.hash ?? null, hash: result.hash, instanceId: input.instanceId, idempotent: result.idempotent,
    };
    if (!result.idempotent) this.all.push(event);
    return event;
  }

  events(): readonly OfficialEvent[] { return this.all; }
}

const passport = {
  purpose: 'Сквозной учебный расчёт G2', limitations: ['Не определяет победителя', 'Только утверждённый эпизод'],
  source: { kind: 'ASSUMPTION' as const, note: 'Учебное допущение G2', applicability: 'Двусторонний сценарий G2' },
  knownErrors: ['Незаданные факторы не учитываются'], examples: [{ input: { onHand: 10, consumption: 14, supplied: 2 }, expected: { deficit: 2 } }],
  approvedBy: 'Методист G2', version: 1,
};
const episode = {
  state: { posture: 'DEFENCE' },
  forces: {
    blue: { components: [{ id: 'main', q: 10, r: 0.8, a: 1 }, { id: 'support', q: 4, r: 0.5, a: 1 }] },
    red: { components: [{ id: 'main', q: 3, r: 0.5, a: 1 }] },
  },
  task: { id: 'task-blue-1', status: 'IN_PROGRESS', progressPercent: 20 },
  resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 14, supplied: 2 }, elapsedMinutes: 30,
  position: { remainingMeters: 5000, travelledMeters: 0 }, uncertainty: { enemyComposition: 'UNKNOWN' },
  effects: { taskProgressDelta: 50, positionAdvanceMeters: 2500, stateChanges: { posture: 'MOVING' }, uncertaintyChanges: {} },
} as const;

function calculationOptions(id: string): CalculateOptions {
  return {
    id, mode: 'DETERMINISTIC', reason: 'Исполнение order-blue-1', createdAt: '2030-01-01T01:30:00Z',
    inputSnapshot: { worldRevision: 7, episodeId: 'episode-blue-1' }, inputs: { episode, weatherFactor: 0.8 }, requiredInputs: ['weatherFactor'],
    units: { fuel: 'L', position: 'm' }, modelVersion: 'aggregate-v1', profileVersions: { episode: 'g2-v1' }, modelPassport: passport,
  };
}
function decisionInput(sideId: 'blue' | 'red') {
  return {
    id: `decision-${sideId}-1`, sideId, authorId: `commander-${sideId}`, intent: `Скрытый замысел ${sideId}`,
    goals: [{ id: `goal-${sideId}`, rank: 1, title: 'Выполнить учебную задачу' }],
    tasks: [{ id: `task-${sideId}-1`, assigneeId: `node-${sideId}-1`, title: 'Исполнить приказ' }],
    resources: [{ resourceId: 'fuel', amount: 20, unit: 'L' }], deadlines: [{ taskId: `task-${sideId}-1`, operationalAt: '2030-01-01T02:00:00Z' }],
    coordination: [{ withNodeId: `node-${sideId}-2`, subject: 'Взаимодействие' }], reserves: [{ forceId: `reserve-${sideId}`, condition: 'По приказу' }],
    transitionConditions: [{ id: `condition-${sideId}`, expression: 'report.received' }], assumptions: [{ id: `assumption-${sideId}`, text: 'Учебное допущение G2' }],
  } as const;
}
function orderInput(id: string, sideId: 'blue' | 'red') {
  return {
    id, decisionId: `decision-${sideId}-1`, issuerNodeId: `node-${sideId}-command`, executorNodeId: `node-${sideId}-1`, sideId,
    issuedAt: '2030-01-01T01:00:00Z', taskId: `task-${sideId}-1`, plannedResources: { fuel: 5 },
  } as const;
}

async function runG2(journal: OfficialJournal, jumpId: string) {
  const checks: string[] = [];
  const append = (input: Omit<OfficialInput, 'instanceId' | 'branchId'> & { instanceId?: string; branchId?: string }) => journal.append({
    instanceId: input.instanceId ?? 'session-A', branchId: input.branchId ?? 'main', type: input.type, payload: input.payload, idempotencyKey: input.idempotencyKey,
  });

  // AC-01: сценарная редакция, среда, три ступени, два этапа и два независимых сеанса.
  const scenarioPayload = {
    sides: ['blue', 'red'], trainedLevels: 3, stages: ['stage-1', 'stage-2'], forces: ['blue-1', 'red-1'], resources: ['fuel'],
    intermediaries: ['edge-1', 'edge-2'], documents: ['order', 'report'], buildupPlan: 'plan-g2', reviewCriteria: ['criteria-1'], mapZoom: 8,
  };
  expect(validateExerciseAxes({ scale: 'operational', mapZoom: 8, trainedLevels: 3 })).toEqual([]);
  const tree = {
    nodes: [{ id: 'level-1', parentId: null, trained: true }, { id: 'level-2', parentId: 'level-1', trained: true }, { id: 'level-3', parentId: 'level-2', trained: true }],
    edges: [
      { from: 'level-1', to: 'level-2', active: true, playRole: { kind: 'GROUP' as const, assignmentId: 'intermediary-1' } },
      { from: 'level-2', to: 'level-3', active: true, playRole: { kind: 'GROUP' as const, assignmentId: 'intermediary-2' } },
    ],
  };
  expect(validateCommandTree(tree)).toEqual([]);
  const store = new InMemoryExerciseStore({ now: () => new Date('2030-01-01T00:00:00Z') });
  const actor = { organizationId: 'org-g2', userId: 'leader-g2' };
  let card = await store.create(actor, { title: 'G2', purpose: 'planned', scale: 'operational', payload: scenarioPayload });
  card = await store.createRevision(actor, card.id, { expectedRevision: 1, state: 'IN_REVIEW', readiness: 100, validation: 'OK' });
  card = await store.createRevision(actor, card.id, { expectedRevision: 2, state: 'APPROVED', readiness: 100, validation: 'OK' });
  card = await store.createRevision(actor, card.id, { expectedRevision: 3, state: 'SEALED', readiness: 100, validation: 'OK' });
  expect(card.state).toBe('SEALED');
  const firstSession = await store.createSession(actor, card.id, { revision: 4, optimisticWorld: { forged: true } });
  const secondSession = await store.createSession(actor, card.id, { revision: 4 });
  expect(firstSession.id).not.toBe(secondSession.id);
  expect(firstSession.scenarioRevisionId).toBe(secondSession.scenarioRevisionId);
  expect(firstSession.confirmedRevision).toBe(0);
  const scenarioHash = card.revisions.at(-1)!.sha256;
  const environmentHash = createHash('sha256').update(canonicalJson({ atlas: 'atlas-g2', elevations: 'height-g2', weather: 'weather-g2', revision: 1 })).digest('hex');
  await append({ instanceId: 'session-A', type: 'instance.started.v1', payload: { scenarioHash, environmentHash }, idempotencyKey: 'start-A' });
  await append({ instanceId: 'session-B', type: 'instance.started.v1', payload: { scenarioHash, environmentHash }, idempotencyKey: 'start-B' });
  checks.push('AC-01');

  // AC-11: независимые решения и девять элементов без жёсткого порядка.
  let blue = createDecision(decisionInput('blue'));
  const red = createDecision(decisionInput('red'));
  let cycle = createDecisionCycle();
  for (const element of [...DECISION_CYCLE_ELEMENTS].reverse()) cycle = recordDecisionElement(cycle, { element, at: '2030-01-01T01:00:00Z', data: { source: 'participant-projection' } });
  expect(cycle.entries).toHaveLength(9);
  const queue = orderActions([
    { id: 'red', operationalAt: '2030-01-01T01:10:00Z', priority: 1, dependencyOrder: 0, sequence: 2 },
    { id: 'blue', operationalAt: '2030-01-01T01:10:00Z', priority: 1, dependencyOrder: 0, sequence: 1 },
  ]);
  expect(queue.map(item => item.id)).toEqual(['blue', 'red']);
  expect(JSON.stringify(projectDecision(red, { sideId: 'blue', role: 'TRAINEE' }))).not.toContain('Скрытый замысел red');
  blue = transitionDecision(blue, 'ACCEPTED', '2030-01-01T01:10:00Z');
  const acceptedRed = transitionDecision(red, 'ACCEPTED', '2030-01-01T01:10:00Z');
  await append({ type: 'decision.accepted.v1', payload: { decisionId: blue.id, sideId: 'blue', cycleElements: cycle.entries.map(entry => entry.element) }, idempotencyKey: 'decision-blue' });
  await append({ type: 'decision.accepted.v1', payload: { decisionId: acceptedRed.id, sideId: 'red', cycleElements: ['TASK_CLARIFICATION'] }, idempotencyKey: 'decision-red' });
  const revised = reviseDecision(blue, { intent: 'Уточнённый замысел blue' }, '2030-01-01T01:12:00Z', () => 'decision-blue-2');
  expect(revised.supersedes).toBe(blue.id);
  expect(blue.intent).toBe('Скрытый замысел blue');

  let order: OrderExecution = issueOrder(orderInput('order-blue-1', 'blue'));
  expect(order.position).toBeNull();
  order = advanceOrder(order, { type: 'DELIVER', at: '2030-01-01T01:05:00Z' });
  await append({ type: 'order.delivered.v1', payload: { orderId: order.id, receivedAt: order.receivedAt }, idempotencyKey: 'delivery-blue-1' });
  expect(order.outcome).toBeNull();
  order = advanceOrder(order, { type: 'PROCESS', at: '2030-01-01T01:06:00Z' });
  order = advanceOrder(order, { type: 'PREPARE', at: '2030-01-01T01:07:00Z' });
  order = advanceOrder(order, { type: 'START_EXECUTION', at: '2030-01-01T01:10:00Z', position: { remainingMeters: 5000, travelledMeters: 0 } });
  await append({ type: 'order.execution.started.v1', payload: { orderId: order.id, position: order.position }, idempotencyKey: 'execution-start-blue-1' });
  order = advanceOrder(order, { type: 'RECORD_COST', at: '2030-01-01T01:20:00Z', timeMinutes: 10, resources: { fuel: 2 }, position: { remainingMeters: 4000, travelledMeters: 1000 } });
  await append({ type: 'order.cost.recorded.v1', payload: { orderId: order.id, actualCosts: order.actualCosts, position: order.position }, idempotencyKey: 'execution-cost-blue-1' });
  const cancelledBefore = cancelOrder(issueOrder(orderInput('order-blue-cancel-before', 'blue')), { at: '2030-01-01T01:03:00Z', reason: 'Отмена до получения' });
  expect(cancelledBefore.actualCosts.timeMinutes).toBe(0);
  const cancelledAfter = cancelOrder(order, { at: '2030-01-01T01:21:00Z', reason: 'Отмена после начала' });
  expect(cancelledAfter.actualCosts).toEqual({ timeMinutes: 10, resources: { fuel: 2 } });
  expect(cancelledAfter.position?.travelledMeters).toBe(1000);
  await append({ type: 'order.cancelled.v1', payload: { orderId: order.id, status: cancelledAfter.status, costs: cancelledAfter.actualCosts, position: cancelledAfter.position }, idempotencyKey: 'cancel-blue-after' });

  const calculated = calculate(calculationOptions('calculation-blue-1'));
  const approved = approveCalculation(calculated, { author: 'leader-g2', authorized: true });
  const aggregateResult = calculated.result as {
    resources: { fuel: { onHand: number; consumed: number; supplied: number; deficit: number } };
    position: { remainingMeters: number; travelledMeters: number }; task: { status: string };
  };
  expect(aggregateResult.resources.fuel.deficit).toBe(2);
  const resourceEvent = await append({ type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: episode.resource.consumption, supplied: aggregateResult.resources.fuel.supplied }, idempotencyKey: 'resource-blue-1' });
  let world = emptyWorld('scenario-g2');
  world.resources.fuel = { onHand: 10, consumed: 0, supplied: 0, deficit: 0 };
  world = reduceWorld(world, { eventId: resourceEvent.eventId, type: resourceEvent.type, payload: resourceEvent.payload, causeIds: [order.id] }, { reducerVersion: 1 });
  expect(world.resources.fuel).toEqual({ onHand: 0, consumed: 12, supplied: 2, deficit: 2 });
  const applied = applyCalculation(approved, { authorized: true, appliedEventIds: [resourceEvent.eventId] });
  await append({ type: 'calculation.applied.v1', payload: { calculationId: applied.id, state: applied.state, appliedEventIds: [...applied.appliedEventIds] }, idempotencyKey: 'apply-calculation-blue-1' });
  const manual = overrideCalculation(applied, { id: 'manual-blue-1', author: 'leader-g2', reason: 'Методическая корректировка G2', result: { delay: 15 }, createdAt: '2030-01-01T01:35:00Z' });
  expect(manual.originalResult).toEqual(applied.result);
  expect(applied.result).toEqual(calculated.result);
  expect(explainCalculation(calculated).randomKeys).toEqual([]);
  order = advanceOrder(order, { type: 'REPORT', at: '2030-01-01T01:40:00Z', outcome: 'PARTIALLY_COMPLETED', reason: 'Дефицит fuel: 2 Л', position: aggregateResult.position });
  await append({ type: 'order.reported.v1', payload: { orderId: order.id, outcome: order.outcome, reason: order.reason, actualCosts: order.actualCosts }, idempotencyKey: 'report-blue-1' });
  expect(order.outcome).toBe('PARTIALLY_COMPLETED');
  checks.push('AC-11');

  // AC-03: каждая внешняя перспектива получает только санитизированные наблюдения.
  const observation = createObservation({
    id: 'observation-g2', trueForceId: 'secret-red-force', trueGeometry: { lon: 37.6, lat: 55.7 }, trueAttributes: { type: 'motorized', secret: 'reference-value' }, observedAt: '2030-01-01T01:00:00Z',
    source: { id: 'sensor-g2', kind: 'UAV', sideId: 'blue', profileVersion: 'sensor-v1', errorMeters: { min: 20, max: 100 }, delaySeconds: { min: 10, max: 60 }, completeness: 0.8, reliability: 0.8, validitySeconds: 600, attributeKeys: ['type'] },
    environment: { snapshotId: environmentHash, errorMultiplier: 1, delayMultiplier: 1 },
    randomKey: { seed: 5n, exerciseId: 'g2', branchId: 'main', purpose: 'observation', ordinal: 0, algorithmVersion: 1 },
  });
  const safeObservation = projectObservation(observation);
  const projection = projectWorld({
    forces: [{ id: 'blue-force', side: 'blue', position: [1, 1] }, { id: 'secret-red-force', side: 'red', position: [2, 2] }],
    observations: [safeObservation], inputs: [{ id: 'future-input', availableAt: '2030-01-02T00:00:00Z', recipients: ['blue'] }], reference: { secret: 'reference-value' },
  }, { side: 'blue', role: 'TRAINEE', operationalAt: '2030-01-01T02:00:00Z', scope: 'own' });
  expect(JSON.stringify(projection)).not.toContain('secret-red-force');
  expect(JSON.stringify(projection)).not.toContain('reference-value');
  expect(JSON.stringify(projection)).not.toContain('future-input');
  for (const channel of Object.values(projectObservationChannels(observation))) {
    expect(JSON.stringify(channel)).not.toContain('secret-red-force');
    expect(JSON.stringify(channel)).not.toContain('actualErrorMeters');
  }
  const subscriptions = new SubscriptionService();
  const redEvent = { eventId: 'red-event', sequence: 1, type: 'decision.accepted.v1', payload: { side: 'red', intent: 'Скрытый замысел red' } };
  expect(subscriptions.payloadFor(redEvent, { side: 'blue', role: 'TRAINEE', operationalAt: '2030-01-01T02:00:00Z', scope: 'own' })).toEqual({ type: 'projection.refresh' });
  expect(subscriptions.seen('red-event', 1)).toBe(true);
  expect(subscriptions.seen('red-event', 1)).toBe(false);
  const sessionStore = new InMemorySessionStore();
  const sessions = new SessionManager({ store: sessionStore, now: () => new Date('2030-01-01T00:00:00Z') });
  await sessions.createAccount({ userId: 'trainee-g2', username: 'trainee-g2', password: 'g2-password', organizationId: 'org-g2', roles: [{ id: 'role-blue', role: 'TRAINEE', sideId: 'blue', authorities: [] }] });
  const login = await sessions.login('trainee-g2', 'g2-password');
  await sessions.selectRole(login.token, 'role-blue');
  await sessions.revoke(login.token);
  await expect(sessions.authenticate(login.token)).rejects.toThrow('401');
  checks.push('AC-03');

  // AC-04/06: доступный контур подтверждает редакции, самостоятельные плечи и идемпотентность; полные документы/каналы остаются ограничением ветки.
  const otherOrder = advanceOrder(issueOrder(orderInput('order-red-1', 'red')), { type: 'DELIVER', at: '2030-01-01T01:06:00Z' });
  expect(otherOrder.receivedAt).not.toBe(order.receivedAt);
  const duplicate = await append({ type: 'order.delivered.v1', payload: { orderId: order.id, receivedAt: order.receivedAt }, idempotencyKey: 'delivery-blue-1' });
  expect(duplicate.idempotent).toBe(true);
  const rejected = advanceOrder(issueOrder(orderInput('order-red-failed', 'red')), { type: 'REJECT', at: '2030-01-01T01:07:00Z', reason: 'Канал недоступен; донесение просрочено' });
  expect(rejected.outcome).toBe('REJECTED');
  expect(journal.events().filter(event => event.payload && JSON.stringify(event.payload).includes('order-red-failed'))).toHaveLength(0);
  checks.push('AC-04:partial', 'AC-06:partial');

  // AC-05: плановый, реактивный и делегированный ввод.
  expect(proposeInput({ kind: 'PLANNED', sourceRole: 'INTERMEDIARY', recipients: ['blue'], scheduledAt: '2030-01-01T02:00:00Z', actualAt: '2030-01-01T01:00:00Z', channelId: 'channel-1' }).deviation).toBe('EARLY');
  expect(evaluateTrigger({ left: 'REPORTED', operator: 'EQ', right: 'REPORTED' })).toBe('TRUE');
  expect(validateTriggerGraph([{ id: 'a', emits: ['b'] }, { id: 'b', emits: ['a'] }])).not.toEqual([]);
  expect(applyDelegation({ allowedSeverities: [1], allowedAreas: ['area-g2'], allowedStages: ['stage-2'], allowEffects: true }, { id: 'adaptive-1', kind: 'ADAPTIVE', severity: 1, areaId: 'area-g2', stageId: 'stage-2', effects: [] }).status).toBe('APPLIED');
  expect(applyDelegation({ allowedSeverities: [], allowedAreas: [], allowedStages: [], allowEffects: false }, { id: 'adaptive-2', kind: 'ADAPTIVE', severity: 9, areaId: 'outside', stageId: 'stage-9', effects: [] }).status).toBe('APPROVAL_REQUIRED');
  checks.push('AC-05');

  // AC-07: пауза, скорость, скачок со снимком и запрет обратного времени.
  const pausedClock = { anchorOperational: '2030-01-01T00:00:00Z', anchorWall: '2030-01-01T00:00:00Z', speed: 2, paused: true };
  expect(operationalAt(pausedClock, '2030-01-01T00:10:00Z')).toBe('2030-01-01T00:00:00.000Z');
  expect(operationalAt({ ...pausedClock, paused: false }, '2030-01-01T00:10:00Z')).toBe('2030-01-01T00:20:00.000Z');
  const jumpWorld = {
    position: aggregateResult.position, resources: world.resources, tasks: { 'task-blue-1': aggregateResult.task.status },
    messages: ['message-g2'], observations: [safeObservation], weather: { rainRateMmH: 2 }, seed: 'g2-seed', manual, leaderApproved: false,
  };
  const reports: string[] = [];
  const jumped = await executeJump({
    jumpId, targetOperationalAt: '2030-01-01T03:00:00Z', currentOperationalAt: '2030-01-01T02:00:00Z', world: jumpWorld,
    calculate: async current => ({ ...current, elapsedMinutes: 60 }),
    approve: async current => { current.leaderApproved = true; },
    snapshot: async current => ({ state: current, hash: createHash('sha256').update(canonicalJson(current)).digest('hex') }),
    report: async step => { reports.push(step); },
  });
  expect(jumped.world.position).toEqual(aggregateResult.position);
  expect(jumped.world.resources).toEqual(world.resources);
  expect(jumped.world.messages).toEqual(['message-g2']);
  expect(jumped.world.observations).toEqual([safeObservation]);
  expect(jumped.world.seed).toBe('g2-seed');
  expect(jumped.world.manual.supersedes).toBe(applied.id);
  expect(jumped.world.leaderApproved).toBe(true);
  expect(reports).toEqual(['boundary', 'stop', 'uncertainty', 'resume']);
  await append({ type: 'jump.applied.v1', payload: { jumpId, targetOperationalAt: '2030-01-01T03:00:00Z', snapshotHash: jumped.hash, manualSupersedes: jumped.world.manual.supersedes }, idempotencyKey: `jump-${jumpId}` });
  await expect(executeJump({ jumpId: `${jumpId}-reverse`, targetOperationalAt: '2030-01-01T01:00:00Z', currentOperationalAt: '2030-01-01T02:00:00Z', world: jumpWorld })).rejects.toThrow('назад');
  checks.push('AC-07');

  // AC-09: повтор после фиксации не создаёт второй эффект.
  const commands = new CommandService();
  const commandInput = { instanceId: 'session-A', branchId: 'main', expectedRevision: 0, idempotencyKey: 'disconnect-retry', type: 'order.reported.v1', actor: { userId: 'leader-g2', role: 'LEADER', organizationId: 'org-g2' } };
  const firstResult = await commands.execute(commandInput);
  const retryResult = await commands.execute(commandInput);
  expect(retryResult.eventId).toBe(firstResult.eventId);
  expect(retryResult.idempotent).toBe(true);
  checks.push('AC-09');

  // AC-15: обязательный погодный пробел не заменяется коэффициентом 1.
  const weather = applyWeatherEffects({ rainRateMmH: null }, { movementRequires: ['rainRateMmH'], rules: [] });
  expect(weather.status).toBe('REQUIRES_REVIEW');
  expect(weather.unknown).toEqual(['rainRateMmH']);
  const unknownCalculation = calculate({ ...calculationOptions('calculation-weather-unknown'), inputs: { episode, weatherFactor: null } });
  expect(unknownCalculation.state).toBe('REQUIRES_REVIEW');
  expect(unknownCalculation.unknown).toEqual(['weatherFactor']);
  checks.push('AC-15');

  // AC-18: плейбук, эскалация и явная модель нового этапа без автопобедителя.
  expect(evaluatePlaybook({ id: 'playbook-g2', version: 1, rules: [{ id: 'contact', when: 'contact', command: 'report', mandatory: true }] }, { kind: 'contact' })).toMatchObject({ kind: 'COMMAND', command: 'report' });
  expect(evaluatePlaybook({ rules: [] }, { kind: 'unknown' })).toEqual({ kind: 'ESCALATE', reason: 'NO_RULE' });
  const nextStage = assignStageCalculationProfile({ stageId: 'stage-1', calculationProfileId: 'aggregate-v1', state: jumped.world.position }, { stageId: 'stage-2', calculationProfileId: 'manual-v1' });
  expect(nextStage).toEqual({ stageId: 'stage-2', calculationProfileId: 'manual-v1', state: aggregateResult.position });
  const completed = completeExercise({ leaderApproved: true, stageConditionsMet: true, snapshot: jumped.world, unfinishedEvents: [{ id: 'delivery-pending', reason: 'Канал не восстановлен' }], reviewMaterials: [{ id: 'review-g2', title: 'Разбор G2' }] });
  expect(JSON.stringify(completed)).not.toContain('winner');
  await append({ type: 'exercise.completed.v1', payload: { status: completed.status, outcomeAuthority: completed.outcomeAuthority, unfinishedEventIds: completed.unfinishedEvents.map(event => event.id) }, idempotencyKey: 'complete-g2' });
  checks.push('AC-18');

  const byInstance = new Map<string, ChainEvent[]>();
  for (const event of journal.events()) byInstance.set(event.instanceId, [...byInstance.get(event.instanceId) ?? [], event]);
  for (const events of byInstance.values()) expect(verifyEventChain(events.map(event => ({
    eventId: event.eventId, sequence: event.sequence, type: event.type, payload: event.payload, prevHash: event.prevHash, hash: event.hash,
  })))).toEqual([]);
  expect(journal.events().filter(event => event.instanceId === 'session-A')).not.toEqual(journal.events().filter(event => event.instanceId === 'session-B'));
  return {
    schemaVersion: 1 as const,
    scenarioHash,
    environmentHash,
    checks,
    coverage: { 'AC-01': 'passed', 'AC-03': 'passed', 'AC-04': 'partial', 'AC-05': 'passed', 'AC-06': 'partial', 'AC-07': 'passed', 'AC-09': 'passed', 'AC-11': 'passed', 'AC-15': 'passed', 'AC-18': 'passed' },
    events: journal.events(),
  };
}

it('G2: полный связанный доменный цикл проходит без прямой записи исходов', async () => {
  const journal = new MemoryOfficialJournal();
  const result = await runG2(journal, 'g2-jump-memory');
  expect(result.checks).toEqual(expect.arrayContaining(['AC-01', 'AC-03', 'AC-05', 'AC-07', 'AC-09', 'AC-11', 'AC-15', 'AC-18']));
  expect(result.events.length).toBeGreaterThanOrEqual(12);
  // @ts-expect-error Приёмочный .mjs-модуль проверяется отдельным node:test без TS-деклараций.
  const { buildG2Evidence } = await import('../../../../scripts/kshvi-run-acceptance.mjs');
  const evidence = buildG2Evidence(result, { command: 'npx vitest run services/kshvi/tests/e2e/conduct-cycle.test.ts', infrastructure: { postgresql: 'not_run', cartography: 'not_run', gateway: 'not_run' } });
  expect(evidence.status).toBe('limited');
  expect(evidence.openErrors.length).toBeGreaterThan(0);
  if (process.env.KSHVI_G2_EVIDENCE === '1' && !process.env.TEST_DATABASE_URL) {
    writeFileSync(resolve('docs/release/kshvi/evidence/g2-journal.json'), `${JSON.stringify(result, null, 2)}\n`);
  }
});

const databaseIntegration = process.env.TEST_DATABASE_URL ? it : it.skip;
databaseIntegration('G2: тот же сценарий использует реальный PostgreSQL и идемпотентный appendCommand', async () => {
  await withKshviDatabase(async store => {
    const journal = new PostgresOfficialJournal(store);
    const result = await runG2(journal, 'g2-jump-postgresql');
    expect(result.events.length).toBeGreaterThanOrEqual(12);
    expect(await store.eventCount('session-A')).toBe(result.events.filter(event => event.instanceId === 'session-A').length);
    expect(await store.outboxCount('session-A')).toBe(await store.eventCount('session-A'));
    expect(await store.aggregateRevision('session-A', 'main')).toBeGreaterThan(0);
  });
});
