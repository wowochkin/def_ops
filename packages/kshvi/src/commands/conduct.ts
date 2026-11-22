import { createHash } from 'node:crypto';
import { canonicalJson } from '../events/canonical';
import type { ChainEventInput } from '../events/envelope';
import type { JsonValue } from '../model/types';
import { emptyWorld, type WorldState } from '../model/world';
import { newUUID } from '../model/uuid';
import { reduceWorld } from '../events/reducer';
import { createDecision, reviseDecision, transitionDecision, type Decision, type DecisionInput } from '../decisions/decision';
import { completeExercise } from '../decisions/decision-cycle';
import { advanceOrder, cancelOrder, issueOrder, type IssueOrderInput, type OrderAction, type OrderExecution } from '../decisions/order-execution';
import { assignStageCalculationProfile, evaluatePlaybook, type Playbook, type PlaybookCondition, type PlaybookResult } from '../decisions/playbook';
import { calculate, approveCalculation, applyCalculation, replayCalculation, type CalculateOptions, type Calculation, type CalculationMode } from '../simulation/calculation';
import { overrideCalculation } from '../simulation/manual-override';
import { createObservation, type CreateObservationInput } from '../simulation/observation';
import { projectObservation, type ProjectedObservation } from '../simulation/observation-projection';
import { executeJump } from '../runtime/jump';

export type ConductActor = Readonly<{ userId: string; role: string; organizationId: string; sideId?: string; assignedNodeIds?: readonly string[] }>;
export type ConductState = {
  scenarioId: string;
  revision: number;
  world: WorldState;
  decisions: Record<string, Decision>;
  orders: Record<string, OrderExecution>;
  calculations: Record<string, Calculation>;
  observations: Record<string, ProjectedObservation>;
  jumpSnapshots: Record<string, { state: unknown; hash: string; reports: readonly string[] }>;
  completion: unknown | null;
  stage: { stageId: string; calculationProfileId: string; state: unknown } | null;
};
export type OfficialEventDraft = ChainEventInput;
type CommandBase = Readonly<{ commandId: string; at: string }>;
export type ConductCommand =
  | (CommandBase & Readonly<{ type: 'decision.create'; decision: DecisionInput }>)
  | (CommandBase & Readonly<{ type: 'decision.transition'; decisionId: string; to: Decision['status'] }>)
  | (CommandBase & Readonly<{ type: 'decision.revise'; decisionId: string; revisedId: string; changes: Parameters<typeof reviseDecision>[1] }>)
  | (CommandBase & Readonly<{ type: 'order.issue'; order: IssueOrderInput }>)
  | (CommandBase & Readonly<{ type: 'order.advance'; orderId: string; action: OrderAction }>)
  | (CommandBase & Readonly<{ type: 'order.cancel'; orderId: string; reason: string }>)
  | (CommandBase & Readonly<{ type: 'calculation.create'; calculationId: string; mode: CalculationMode; input: Omit<CalculateOptions, 'id' | 'mode' | 'createdAt'> }>)
  | (CommandBase & Readonly<{ type: 'calculation.approve'; calculationId: string; reviewedParameters?: Readonly<Record<string, unknown>> }>)
  | (CommandBase & Readonly<{ type: 'calculation.apply'; calculationId: string }>)
  | (CommandBase & Readonly<{ type: 'calculation.override'; calculationId: string; manualId: string; reason: string; result: unknown }>)
  | (CommandBase & Readonly<{ type: 'calculation.replay'; calculationId: string }>)
  | (CommandBase & Readonly<{ type: 'observation.record'; input: CreateObservationInput }>)
  | (CommandBase & Readonly<{ type: 'time.jump'; jumpId: string; targetOperationalAt: string; currentOperationalAt: string; elapsedMinutes: number }>)
  | (CommandBase & Readonly<{ type: 'stage.assign'; currentStageId: string; currentProfileId: string; nextStageId: string; nextProfileId?: string }>)
  | (CommandBase & Readonly<{ type: 'playbook.evaluate'; playbook: Playbook; condition: PlaybookCondition }>)
  | (CommandBase & Readonly<{ type: 'exercise.complete'; leaderApproved: boolean; stageConditionsMet: boolean; unfinishedEvents: readonly { id: string; reason: string }[]; reviewMaterials: readonly { id: string; title: string }[] }>);
export type ConductExecution = Readonly<{
  state: ConductState;
  event: OfficialEventDraft;
  revision: number;
  decision?: Decision;
  order?: OrderExecution;
  calculation?: Calculation;
  completion?: unknown;
  playbook?: PlaybookResult;
}>;

export function emptyConductState(scenarioId: string): ConductState {
  return { scenarioId, revision: 0, world: emptyWorld(scenarioId), decisions: {}, orders: {}, calculations: {}, observations: {}, jumpSnapshots: {}, completion: null, stage: null };
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
function assertCommand(command: CommandBase): void {
  if (!command.commandId.trim() || !Number.isFinite(Date.parse(command.at))) throw new Error('Официальная команда требует commandId и корректное время');
}
function eventFor(state: ConductState, command: CommandBase & { type: string }, type: string, causedBy: string, details: Record<string, unknown> = {}): OfficialEventDraft {
  return {
    eventId: newUUID(),
    sequence: state.revision + 1,
    type,
    payload: json({ commandId: command.commandId, commandType: command.type, at: command.at, causedBy, ...details }),
  };
}
function next(state: ConductState, changes: Partial<ConductState> = {}): ConductState {
  return { ...state, ...changes, revision: state.revision + 1 };
}
function required<V>(value: V | undefined, message: string): V {
  if (value === undefined) throw new Error(message);
  return value;
}
function assertDecisionActor(actor: ConductActor, decision: DecisionInput): void {
  if (actor.role === 'LEADER') return;
  if (actor.sideId !== decision.sideId) throw new Error('403: Решение другой стороны недоступно');
  const assigned = actor.assignedNodeIds ?? [];
  if (decision.tasks.some(task => !assigned.includes(task.assigneeId))) throw new Error('403: Задача вне назначенных инстанций');
}

export async function executeConductCommand(state: ConductState, command: ConductCommand, actor: ConductActor): Promise<ConductExecution> {
  assertCommand(command);
  switch (command.type) {
    case 'decision.create': {
      assertDecisionActor(actor, command.decision);
      const decision = createDecision(command.decision);
      if (state.decisions[decision.id]) throw new Error('Решение с таким идентификатором уже существует');
      return { state: next(state, { decisions: { ...state.decisions, [decision.id]: decision } }), event: eventFor(state, command, 'decision.created.v1', decision.id, { revision: 1 }), revision: state.revision + 1, decision };
    }
    case 'decision.transition': {
      const decision = transitionDecision(required(state.decisions[command.decisionId], 'Решение не найдено'), command.to, command.at);
      return { state: next(state, { decisions: { ...state.decisions, [decision.id]: decision } }), event: eventFor(state, command, 'decision.status.changed.v1', decision.id, { status: decision.status }), revision: state.revision + 1, decision };
    }
    case 'decision.revise': {
      const original = required(state.decisions[command.decisionId], 'Исходное решение не найдено');
      const decision = reviseDecision(original, command.changes, command.at, () => command.revisedId);
      return { state: next(state, { decisions: { ...state.decisions, [decision.id]: decision } }), event: eventFor(state, command, 'decision.revised.v1', decision.id, { supersedes: original.id, revision: decision.revision }), revision: state.revision + 1, decision };
    }
    case 'order.issue': {
      const decision = required(state.decisions[command.order.decisionId], 'Приказ должен ссылаться на решение');
      if (decision.status === 'DRAFT') throw new Error('Приказ нельзя выдать до принятия решения');
      if (Date.parse(command.order.issuedAt) < Date.parse(decision.statusHistory.at(-1)!.at)) throw new Error('Приказ не может предшествовать решению');
      const order = issueOrder(command.order);
      if (state.orders[order.id]) throw new Error('Приказ с таким идентификатором уже существует');
      return { state: next(state, { orders: { ...state.orders, [order.id]: order } }), event: eventFor(state, command, 'order.issued.v1', order.id, { decisionId: decision.id, issuedAt: order.issuedAt }), revision: state.revision + 1, order };
    }
    case 'order.advance': {
      const order = advanceOrder(required(state.orders[command.orderId], 'Приказ не найден'), command.action);
      return { state: next(state, { orders: { ...state.orders, [order.id]: order } }), event: eventFor(state, command, 'order.advanced.v1', order.id, { status: order.status, outcome: order.outcome, actualCosts: order.actualCosts, position: order.position }), revision: state.revision + 1, order };
    }
    case 'order.cancel': {
      const order = cancelOrder(required(state.orders[command.orderId], 'Приказ не найден'), { at: command.at, reason: command.reason });
      return { state: next(state, { orders: { ...state.orders, [order.id]: order } }), event: eventFor(state, command, 'order.cancelled.v1', order.id, { status: order.status, actualCosts: order.actualCosts, position: order.position }), revision: state.revision + 1, order };
    }
    case 'calculation.create': {
      if (state.calculations[command.calculationId]) throw new Error('Расчёт с таким идентификатором уже существует');
      const calculation = calculate({ ...command.input, id: command.calculationId, mode: command.mode, createdAt: command.at });
      return { state: next(state, { calculations: { ...state.calculations, [calculation.id]: calculation } }), event: eventFor(state, command, 'calculation.calculated.v1', calculation.id, { state: calculation.state, inputHash: calculation.inputHash, randomKeys: calculation.randomKeys }), revision: state.revision + 1, calculation };
    }
    case 'calculation.approve': {
      const calculation = approveCalculation(required(state.calculations[command.calculationId], 'Расчёт не найден'), { author: actor.userId, authorized: actor.role === 'LEADER', reviewedParameters: command.reviewedParameters });
      return { state: next(state, { calculations: { ...state.calculations, [calculation.id]: calculation } }), event: eventFor(state, command, 'calculation.approved.v1', calculation.id, { approvedBy: calculation.approvedBy, recomputedFrom: calculation.recomputedFrom ?? null }), revision: state.revision + 1, calculation };
    }
    case 'calculation.apply': {
      const approved = required(state.calculations[command.calculationId], 'Расчёт не найден');
      const result = approved.result as { resources?: Record<string, { consumed: number; deficit: number; supplied: number }> };
      const entry = Object.entries(result.resources ?? {})[0];
      if (!entry) throw new Error('Расчёт не создаёт типизированных событий применения');
      const [resourceId, resource] = entry;
      const event = eventFor(state, command, 'resource.consumed.v1', approved.id, { calculationId: approved.id, resourceId, amount: resource.consumed + resource.deficit, supplied: resource.supplied });
      const calculation = applyCalculation(approved, { authorized: actor.role === 'LEADER' || actor.role === 'MODEL_RULE', appliedEventIds: [event.eventId] });
      const inputResource = (approved.inputs.episode as { resource?: { onHand: number } } | undefined)?.resource;
      const initialWorld = state.world.resources[resourceId] || !inputResource ? state.world : {
        ...state.world,
        resources: { ...state.world.resources, [resourceId]: { onHand: inputResource.onHand, consumed: 0, supplied: 0, deficit: 0 } },
      };
      const world = reduceWorld(initialWorld, { eventId: event.eventId, type: event.type, payload: event.payload, causeIds: [command.commandId] }, { reducerVersion: 1 });
      const nextWorld = { ...world, state: { ...world.state, ScenarioState: { ...(world.state.ScenarioState as Record<string, unknown>), episode: calculation.result } } };
      return { state: next(state, { world: nextWorld, calculations: { ...state.calculations, [calculation.id]: calculation } }), event, revision: state.revision + 1, calculation };
    }
    case 'calculation.override': {
      const original = required(state.calculations[command.calculationId], 'Исходный расчёт не найден');
      const overridden = overrideCalculation(original, { id: command.manualId, author: actor.userId, reason: command.reason, result: command.result, createdAt: command.at });
      const manual = { ...overridden, sideId: original.sideId, nodeId: original.nodeId, requiredInputs: original.requiredInputs, stochasticOutcomes: original.stochasticOutcomes } as Calculation;
      const superseded = { ...original, state: 'SUPERSEDED' as const };
      return { state: next(state, { calculations: { ...state.calculations, [original.id]: superseded, [manual.id]: manual } }), event: eventFor(state, command, 'calculation.manual.created.v1', manual.id, { supersedes: original.id, evaluationEffect: 'UNCHANGED' }), revision: state.revision + 1, calculation: manual };
    }
    case 'calculation.replay': {
      const original = required(state.calculations[command.calculationId], 'Расчёт не найден');
      const calculation = replayCalculation(original);
      return { state: next(state), event: eventFor(state, command, 'calculation.replayed.v1', original.id, { randomKeys: calculation.randomKeys, selectedOutcomeId: calculation.intermediateResults.selectedOutcomeId }), revision: state.revision + 1, calculation };
    }
    case 'observation.record': {
      const observation = createObservation(command.input);
      const projected = projectObservation(observation);
      return { state: next(state, { observations: { ...state.observations, [projected.id]: projected } }), event: eventFor(state, command, 'observation.reported.v1', observation.id, { observation: projected }), revision: state.revision + 1 };
    }
    case 'time.jump': {
      const scenarioState = state.world.state.ScenarioState as Record<string, unknown>;
      const episode = scenarioState.episode as Record<string, unknown> | undefined;
      const manual = Object.values(state.calculations).find(calculation => calculation.supersedes);
      const jumpWorld = {
        ...(episode ?? {}), resources: state.world.resources, observations: Object.values(state.observations), seed: state.scenarioId,
        ...(manual ? { manual } : {}), leaderApproved: false,
      };
      const reports: string[] = [];
      const jumped = await executeJump({
        jumpId: command.jumpId, targetOperationalAt: command.targetOperationalAt, currentOperationalAt: command.currentOperationalAt, world: jumpWorld,
        calculate: async current => ({ ...current, elapsedMinutes: command.elapsedMinutes }),
        approve: async current => { current.leaderApproved = true; },
        snapshot: async current => ({ state: current, hash: createHash('sha256').update(canonicalJson(current)).digest('hex') }),
        report: async step => { reports.push(step); },
      });
      const snapshot = { state: jumped.world, hash: jumped.hash, reports };
      const world = { ...state.world, state: { ...state.world.state, Time: { operationalAt: command.targetOperationalAt, wallClockAt: command.at }, ScenarioState: { ...(state.world.state.ScenarioState as Record<string, unknown>), episode: jumped.world } } };
      return { state: next(state, { world, jumpSnapshots: { ...state.jumpSnapshots, [command.jumpId]: snapshot } }), event: eventFor(state, command, 'time.jump.applied.v1', command.jumpId, { snapshotHash: jumped.hash, reports }), revision: state.revision + 1 };
    }
    case 'stage.assign': {
      const stage = assignStageCalculationProfile(
        { stageId: command.currentStageId, calculationProfileId: command.currentProfileId, state: state.world.state },
        { stageId: command.nextStageId, calculationProfileId: command.nextProfileId },
      );
      return { state: next(state, { stage }), event: eventFor(state, command, 'stage.calculation.assigned.v1', stage.stageId, { calculationProfileId: stage.calculationProfileId }), revision: state.revision + 1 };
    }
    case 'playbook.evaluate': {
      const playbook = evaluatePlaybook(command.playbook, command.condition);
      const type = playbook.kind === 'ESCALATE' ? 'playbook.escalated.v1' : 'playbook.command.v1';
      return { state: next(state), event: eventFor(state, command, type, command.playbook.id ?? 'playbook', { result: playbook }), revision: state.revision + 1, playbook };
    }
    case 'exercise.complete': {
      const latest = Object.values(state.jumpSnapshots).at(-1);
      const completion = completeExercise({
        leaderApproved: command.leaderApproved, stageConditionsMet: command.stageConditionsMet,
        snapshot: latest?.state ?? state.world, unfinishedEvents: command.unfinishedEvents, reviewMaterials: command.reviewMaterials,
      });
      return { state: next(state, { completion }), event: eventFor(state, command, 'exercise.completed.v1', state.scenarioId, { status: completion.status, outcomeAuthority: completion.outcomeAuthority, unfinishedEventIds: completion.unfinishedEvents.map(item => item.id), snapshotHash: createHash('sha256').update(canonicalJson(completion.snapshot)).digest('hex') }), revision: state.revision + 1, completion };
    }
    default: throw new Error('Неизвестная официальная команда');
  }
}
