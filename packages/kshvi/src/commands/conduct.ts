import { createHash } from 'node:crypto';
import { canonicalJson } from '../events/canonical';
import type { ChainEventInput } from '../events/envelope';
import type { JsonValue } from '../model/types';
import { emptyWorld, withResourceAlias, type WorldState } from '../model/world';
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
import { computeDocumentSha256Sync, type DocumentRevision } from '../documents/document';
import { supersedeDocument, transitionDocument, type DocumentTransitionAction } from '../documents/document-lifecycle';
import { advanceCascadeDelivery, issueCascade, recordCascadeFact, type CascadeIssue, type CascadeLegInput } from '../documents/cascade';
import { advanceApproval, resolveDualConflict, type DualChainDecision, type DualChainState } from '../documents/dual-chain';
import type { DocumentIssueContext } from '../documents/document-validation';
import type { Channel, CommunicationMessage, CommunicationNode } from '../communications/channel';
import { routeMessage } from '../communications/channel';
import { createMessageAttempt, type MessageAttempt } from '../communications/message';
import type { EnvironmentSnapshot } from '../environment/provider';
import { validateWeatherScenario, type WeatherScenario } from '@def-ops/core';

export type ConductActor = Readonly<{ userId: string; role: string; organizationId: string; sideId?: string; assignedNodeIds?: readonly string[] }>;
export type ConductOperations = Readonly<{
  knownInstanceIds: readonly string[];
  availableChannelIds: readonly string[];
  channels: readonly Channel[];
  nodes: readonly CommunicationNode[];
  approvalAssignments?: Readonly<{ command: readonly string[]; service: readonly string[]; finalApproverId: string }>;
  treeEdges?: readonly Readonly<{ from: string; to: string }>[];
  cascadeLegs?: readonly CascadeLegInput[];
}>;
export type DocumentDraftInput = Omit<DocumentRevision, 'state' | 'sha256' | 'signatures' | 'delivery' | 'previousRevision'>;
export type ConductState = {
  scenarioId: string;
  revision: number;
  world: WorldState;
  decisions: Record<string, Decision>;
  orders: Record<string, OrderExecution>;
  calculations: Record<string, Calculation>;
  observations: Record<string, ProjectedObservation>;
  documents: Record<string, DocumentRevision>;
  documentRevisions: Record<string, Record<number, DocumentRevision>>;
  approvalChains: Record<string, DualChainState>;
  cascades: Record<string, CascadeIssue>;
  communications: Record<string, MessageAttempt>;
  jumpSnapshots: Record<string, { state: unknown; hash: string; reports: readonly string[] }>;
  completion: unknown | null;
  stage: { stageId: string; calculationProfileId: string; state: unknown } | null;
};
type EventScope = 'organizationId' | 'instanceId' | 'branchId' | 'schemaVersion' | 'wallClockAt' | 'operationalAt' | 'actor' | 'causeIds' | 'versions' | 'reducerVersion';
export type OfficialEventDraft = Omit<ChainEventInput, EventScope> & Partial<Pick<ChainEventInput, EventScope>>;
type CommandBase = Readonly<{ commandId: string; at: string }>;
export type ScheduledWeatherChange = Readonly<{
  changeId: string;
  effectiveAt: string;
  reason: string;
  authorId: string;
  supersedes: string;
  scenario: WeatherScenario;
}>;
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
  | (CommandBase & Readonly<{ type: 'document.create'; revision: DocumentDraftInput }>)
  | (CommandBase & Readonly<{ type: 'document.transition'; documentId: string; action: DocumentTransitionAction; recipient?: DocumentIssueContext['recipient'] }>)
  | (CommandBase & Readonly<{ type: 'document.edit'; documentId: string; changes: { requisites?: DocumentRevision['requisites']; content?: DocumentRevision['content']; map?: DocumentRevision['map']; attachments?: DocumentRevision['attachments'] } }>)
  | (CommandBase & Readonly<{ type: 'document.approval'; documentId: string; decision: DualChainDecision }>)
  | (CommandBase & Readonly<{ type: 'document.conflict.resolve'; documentId: string; decision: { decision: 'APPROVED' | 'CHANGES_REQUESTED'; comment: string } }>)
  | (CommandBase & Readonly<{ type: 'document.cascade.issue'; documentId: string }>)
  | (CommandBase & Readonly<{ type: 'document.cascade.advance'; documentId: string; deliveryId: string; action: 'BEGIN' | 'DELIVER' | 'FAIL' | 'CANCEL'; reason?: string }>)
  | (CommandBase & Readonly<{ type: 'document.cascade.fact'; documentId: string; deliveryId: string; factType: 'ACKNOWLEDGED' | 'EXECUTION_STARTED' }>)
  | (CommandBase & Readonly<{ type: 'document.revise'; documentId: string; reason: string; changes: { requisites?: DocumentRevision['requisites']; content?: DocumentRevision['content']; map?: DocumentRevision['map']; attachments?: DocumentRevision['attachments'] } }>)
  | (CommandBase & Readonly<{ type: 'communication.enqueue'; message: CommunicationMessage }>)
  | (CommandBase & Readonly<{ type: 'environment.bind'; snapshot: EnvironmentSnapshot }>)
  | (CommandBase & Readonly<{ type: 'weather.change'; changeId: string; effectiveAt: string; reason: string; supersedes: string; scenario: WeatherScenario }>)
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
  document?: DocumentRevision;
  communication?: MessageAttempt;
  completion?: unknown;
  playbook?: PlaybookResult;
}>;

export function emptyConductState(scenarioId: string): ConductState {
  return { scenarioId, revision: 0, world: emptyWorld(scenarioId), decisions: {}, orders: {}, calculations: {}, observations: {}, documents: {}, documentRevisions: {}, approvalChains: {}, cascades: {}, communications: {}, jumpSnapshots: {}, completion: null, stage: null };
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
function recordDocument(state: ConductState, revision: DocumentRevision): Partial<ConductState> {
  return {
    documents: { ...state.documents, [revision.documentId]: revision },
    documentRevisions: {
      ...state.documentRevisions,
      [revision.documentId]: { ...(state.documentRevisions[revision.documentId] ?? {}), [revision.revision]: revision },
    },
  };
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

export async function executeConductCommand(state: ConductState, command: ConductCommand, actor: ConductActor, operations?: ConductOperations): Promise<ConductExecution> {
  assertCommand(command);
  switch (command.type) {
    case 'decision.create': {
      assertDecisionActor(actor, command.decision);
      const decision = createDecision(command.decision);
      if (state.decisions[decision.id]) throw new Error('Решение с таким идентификатором уже существует');
      return { state: next(state, { decisions: { ...state.decisions, [decision.id]: decision } }), event: eventFor(state, command, 'decision.created.v1', decision.id, { revision: 1, sideId: decision.sideId }), revision: state.revision + 1, decision };
    }
    case 'decision.transition': {
      const decision = transitionDecision(required(state.decisions[command.decisionId], 'Решение не найдено'), command.to, command.at);
      return { state: next(state, { decisions: { ...state.decisions, [decision.id]: decision } }), event: eventFor(state, command, 'decision.status.changed.v1', decision.id, { status: decision.status, sideId: decision.sideId }), revision: state.revision + 1, decision };
    }
    case 'decision.revise': {
      const original = required(state.decisions[command.decisionId], 'Исходное решение не найдено');
      const decision = reviseDecision(original, command.changes, command.at, () => command.revisedId);
      return { state: next(state, { decisions: { ...state.decisions, [decision.id]: decision } }), event: eventFor(state, command, 'decision.revised.v1', decision.id, { supersedes: original.id, revision: decision.revision, sideId: decision.sideId }), revision: state.revision + 1, decision };
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
      return { state: next(state, { calculations: { ...state.calculations, [calculation.id]: calculation } }), event: eventFor(state, command, 'calculation.calculated.v1', calculation.id, { state: calculation.state, inputHash: calculation.inputHash, randomKeys: calculation.randomKeys, sideId: calculation.sideId, calculation }), revision: state.revision + 1, calculation };
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
      const initialWorld = state.world.resources[resourceId] || !inputResource ? state.world : withResourceAlias({
        ...state.world,
        state: {
          ...state.world.state,
          Resources: { ...state.world.state.Resources, [resourceId]: { onHand: inputResource.onHand, consumed: 0, supplied: 0, deficit: 0 } },
        },
      });
      const world = reduceWorld(initialWorld, { eventId: event.eventId, type: event.type, payload: event.payload, causeIds: [command.commandId] }, { reducerVersion: 1 });
      const nextWorld = withResourceAlias({ ...world, state: { ...world.state, ScenarioState: { ...(world.state.ScenarioState as Record<string, unknown>), episode: calculation.result } } });
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
    case 'document.create': {
      const input = command.revision;
      if (state.documents[input.documentId]) throw new Error('Документ с таким идентификатором уже существует');
      if (input.requisites.instanceId !== state.scenarioId) throw new Error('Документ относится к другой инстанции');
      if (actor.role !== 'LEADER' && actor.role !== 'DIRECTOR' && actor.sideId !== input.requisites.sideId) throw new Error('Документ другой стороны недоступен');
      const unsigned: DocumentRevision = {
        ...structuredClone(input), state: 'DRAFT', sha256: '', signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] },
      };
      const revision = { ...unsigned, sha256: computeDocumentSha256Sync(unsigned) };
      return {
        state: next(state, {
          ...recordDocument(state, revision),
          ...(operations?.approvalAssignments ? {
            approvalChains: {
              ...state.approvalChains,
              [revision.documentId]: { command: 'PENDING', service: 'PENDING', finalApprover: operations.approvalAssignments.finalApproverId },
            },
          } : {}),
        }),
        event: eventFor(state, command, 'document.created.v1', revision.documentId, { sideId: revision.requisites.sideId, revision: revision.revision, sha256: revision.sha256 }),
        revision: state.revision + 1, document: revision,
      };
    }
    case 'document.transition': {
      const original = required(state.documents[command.documentId], 'Документ не найден');
      const privileged = ['LEADER', 'DIRECTOR'].includes(actor.role);
      const ownAuthor = actor.role === 'AUTHOR' && actor.userId === original.requisites.authorId;
      if (!privileged && !ownAuthor) throw new Error('Переход документа недоступен этой роли');
      if (['APPROVE', 'ISSUE'].includes(command.action) && !privileged) throw new Error('Утверждение и выдача доступны только назначенной инстанции');
      if (actor.role !== 'DIRECTOR' && actor.sideId !== original.requisites.sideId) throw new Error('Документ другой стороны недоступен');
      if (command.action === 'APPROVE' && actor.userId === original.requisites.authorId) throw new Error('Автор не может утвердить собственный документ');
      const chain = state.approvalChains[command.documentId];
      if (command.action === 'APPROVE' && chain && chain.state !== 'APPROVED') throw new Error('Двойная вертикаль согласования ещё не завершена');
      let issue: DocumentIssueContext | undefined;
      if (command.action === 'ISSUE') {
        if (!operations) throw new Error('Серверный контекст инстанций и каналов не настроен');
        issue = {
          recipient: required(command.recipient, 'Для выдачи нужен адресат'), knownInstanceIds: operations.knownInstanceIds,
          availableChannelIds: operations.availableChannelIds, senderHasAuthority: true, at: command.at,
        };
      }
      const revision = transitionDocument(original, command.action, {
        ...(command.action === 'APPROVE' ? { signature: { userId: actor.userId, role: actor.role, signedAt: command.at } } : {}),
        ...(issue ? { issue } : {}),
      });
      const type = command.action === 'APPROVE' ? 'document.approved.v1' : command.action === 'ISSUE' ? 'document.issued.v1' : 'document.status.changed.v1';
      return {
        state: next(state, recordDocument(state, revision)),
        event: eventFor(state, command, type, revision.documentId, {
          sideId: revision.requisites.sideId, revision: revision.revision, sha256: revision.sha256,
          ...(command.action === 'ISSUE' ? { document: revision } : {}),
        }),
        revision: state.revision + 1, document: revision,
      };
    }
    case 'document.edit': {
      const original = required(state.documents[command.documentId], 'Документ не найден');
      if (!['DRAFT', 'IN_REVIEW'].includes(original.state)) throw new Error('Редактируется только невыданная редакция');
      if (!['LEADER', 'DIRECTOR'].includes(actor.role) && !(actor.role === 'AUTHOR' && actor.userId === original.requisites.authorId)) throw new Error('Редактирование доступно автору или назначенной инстанции');
      const unsigned: DocumentRevision = {
        ...original, ...structuredClone(command.changes), state: 'DRAFT', signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] }, returnComment: undefined,
      };
      const revision = { ...unsigned, sha256: computeDocumentSha256Sync(unsigned) };
      const chain = state.approvalChains[command.documentId];
      const approvalChains = chain
        ? { ...state.approvalChains, [command.documentId]: { command: 'PENDING' as const, service: 'PENDING' as const, finalApprover: chain.finalApprover } }
        : state.approvalChains;
      return {
        state: next(state, { ...recordDocument(state, revision), approvalChains }),
        event: eventFor(state, command, 'document.edited.v1', revision.documentId, { sideId: revision.requisites.sideId, revision: revision.revision, sha256: revision.sha256 }),
        revision: state.revision + 1, document: revision,
      };
    }
    case 'document.approval': {
      const original = required(state.documents[command.documentId], 'Документ не найден');
      if (original.state !== 'IN_REVIEW') throw new Error('Согласование ветвей возможно только для IN_REVIEW');
      const chain = required(state.approvalChains[command.documentId], 'Двойная вертикаль для документа не настроена');
      const assignments = required(operations?.approvalAssignments, 'Назначения ветвей согласования не настроены');
      const branch = required(command.decision.branch, 'Для решения нужно указать ветвь');
      if (!assignments[branch].includes(actor.userId)) throw new Error('Пользователь не назначен на эту ветвь согласования');
      const nextChain = advanceApproval(chain, { ...command.decision, actor: actor.userId });
      return {
        state: next(state, { approvalChains: { ...state.approvalChains, [command.documentId]: nextChain } }),
        event: eventFor(state, command, 'document.approval.chain.changed.v1', original.id, { sideId: original.requisites.sideId, chain: nextChain }),
        revision: state.revision + 1,
      };
    }
    case 'document.conflict.resolve': {
      const original = required(state.documents[command.documentId], 'Документ не найден');
      const chain = required(state.approvalChains[command.documentId], 'Двойная вертикаль для документа не настроена');
      const nextChain = resolveDualConflict(chain, { actor: actor.userId, decision: command.decision.decision, comment: command.decision.comment });
      return {
        state: next(state, { approvalChains: { ...state.approvalChains, [command.documentId]: nextChain } }),
        event: eventFor(state, command, 'document.conflict.resolved.v1', original.id, { sideId: original.requisites.sideId, chain: nextChain }),
        revision: state.revision + 1,
      };
    }
    case 'document.cascade.issue': {
      const original = required(state.documents[command.documentId], 'Документ не найден');
      if (!operations?.treeEdges || !operations.cascadeLegs) throw new Error('Серверный каскад документа не настроен');
      if (!['LEADER', 'DIRECTOR'].includes(actor.role)) throw new Error('Каскадная выдача недоступна этой роли');
      const cascade = issueCascade({
        revision: original, originInstanceId: state.scenarioId, issuedAt: command.at,
        availableChannelIds: operations.availableChannelIds, treeEdges: operations.treeEdges, legs: operations.cascadeLegs,
      });
      return {
        state: next(state, { cascades: { ...state.cascades, [command.documentId]: cascade } }),
        event: eventFor(state, command, 'document.cascade.issued.v1', original.id, { sideId: original.requisites.sideId, cascade }),
        revision: state.revision + 1,
      };
    }
    case 'document.cascade.advance': {
      const cascade = required(state.cascades[command.documentId], 'Каскад документа не найден');
      const delivery = required(cascade.deliveries.find(item => item.id === command.deliveryId), 'Плечо каскада не найдено');
      const advanced = advanceCascadeDelivery(delivery, command.action, { at: command.at, actorId: actor.userId, ...(command.reason ? { reason: command.reason } : {}) });
      const nextCascade = { ...cascade, deliveries: cascade.deliveries.map(item => item.id === advanced.id ? advanced : item) };
      return {
        state: next(state, { cascades: { ...state.cascades, [command.documentId]: nextCascade } }),
        event: eventFor(state, command, 'document.cascade.advanced.v1', advanced.id, { delivery: advanced }),
        revision: state.revision + 1,
      };
    }
    case 'document.cascade.fact': {
      const cascade = required(state.cascades[command.documentId], 'Каскад документа не найден');
      const delivery = required(cascade.deliveries.find(item => item.id === command.deliveryId), 'Плечо каскада не найдено');
      const advanced = recordCascadeFact(delivery, command.factType, { at: command.at, actorId: actor.userId });
      const nextCascade = { ...cascade, deliveries: cascade.deliveries.map(item => item.id === advanced.id ? advanced : item) };
      return {
        state: next(state, { cascades: { ...state.cascades, [command.documentId]: nextCascade } }),
        event: eventFor(state, command, 'document.cascade.fact.recorded.v1', advanced.id, { delivery: advanced }),
        revision: state.revision + 1,
      };
    }
    case 'document.revise': {
      const original = required(state.documents[command.documentId], 'Документ не найден');
      if (!['LEADER', 'DIRECTOR'].includes(actor.role)) throw new Error('Новая редакция доступна только назначенной инстанции');
      const candidate: DocumentRevision = {
        ...original, ...structuredClone(command.changes), id: `${original.documentId}:r${original.revision + 1}`, revision: original.revision + 1,
        state: 'DRAFT', signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] }, previousRevision: undefined,
      };
      const revision = supersedeDocument(original, { ...command.changes, reason: command.reason, sha256: computeDocumentSha256Sync(candidate) });
      const chain = state.approvalChains[command.documentId];
      const approvalChains = chain
        ? { ...state.approvalChains, [command.documentId]: { command: 'PENDING' as const, service: 'PENDING' as const, finalApprover: chain.finalApprover } }
        : state.approvalChains;
      return {
        state: next(state, { ...recordDocument(state, revision), approvalChains }),
        event: eventFor(state, command, 'document.revised.v1', revision.id, { sideId: revision.requisites.sideId, revision: revision.revision, supersedes: revision.supersedes, sha256: revision.sha256, document: revision }),
        revision: state.revision + 1, document: revision,
      };
    }
    case 'communication.enqueue': {
      if (!operations) throw new Error('Серверный контекст каналов связи не настроен');
      if (!actor.sideId) throw new Error('Сторона отправителя не назначена');
      if (command.message.fromInstanceId !== state.scenarioId) throw new Error('Отправитель сообщения не соответствует сеансу');
      if (command.message.recipientIds.some(id => !operations.knownInstanceIds.includes(id))) throw new Error('Получатель отсутствует в дереве инстанций');
      if (state.communications[command.message.id]) throw new Error('Сообщение с таким идентификатором уже существует');
      const route = routeMessage({ message: command.message, channels: operations.channels, nodes: operations.nodes, at: command.at });
      const attempt = createMessageAttempt(command.message, route, command.at);
      return {
        state: next(state, { communications: { ...state.communications, [attempt.messageId]: attempt } }),
        event: eventFor(state, command, 'communication.queued.v1', attempt.messageId, { sideId: actor.sideId, recipients: attempt.recipients, attempt }),
        revision: state.revision + 1, communication: attempt,
      };
    }
    case 'environment.bind': {
      if (!['LEADER', 'DIRECTOR'].includes(actor.role)) throw new Error('Привязка среды недоступна этой роли');
      const snapshot = command.snapshot;
      if (snapshot.autonomy !== 'COMPLETE' || snapshot.manifestSha256 !== snapshot.id || !/^[0-9a-f]{64}$/.test(snapshot.id)) {
        throw new Error('Автономный снимок среды не прошёл проверку целостности');
      }
      const current = state.world.state.Weather as { snapshot?: EnvironmentSnapshot };
      if (current.snapshot) throw new Error('Исходная среда уже привязана и не может быть заменена');
      const world = withResourceAlias({
        ...state.world,
        state: { ...state.world.state, Weather: { snapshot: structuredClone(snapshot), changes: [] } },
      });
      return {
        state: next(state, { world }),
        event: eventFor(state, command, 'environment.bound.v1', snapshot.id, { snapshotId: snapshot.id, manifestSha256: snapshot.manifestSha256, supersedes: null, recipients: ['blue', 'red'] }),
        revision: state.revision + 1,
      };
    }
    case 'weather.change': {
      if (!['LEADER', 'DIRECTOR'].includes(actor.role)) throw new Error('Плановое изменение погоды недоступно этой роли');
      const current = state.world.state.Weather as { snapshot?: EnvironmentSnapshot; changes?: readonly ScheduledWeatherChange[] };
      if (!current.snapshot) throw new Error('Сначала требуется серверная привязка исходной среды');
      if (!command.changeId.trim() || !command.reason.trim() || !Number.isFinite(Date.parse(command.effectiveAt))) throw new Error('Плановое изменение погоды требует идентификатор, основание и время');
      const previous = current.changes?.at(-1);
      const expectedSupersedes = previous?.changeId ?? current.snapshot.manifestSha256;
      if (command.supersedes !== expectedSupersedes) throw new Error(`supersedes должен ссылаться на ${expectedSupersedes}`);
      if (previous && Date.parse(command.effectiveAt) < Date.parse(previous.effectiveAt)) throw new Error('Плановые изменения погоды не переписывают прошлое');
      const change: ScheduledWeatherChange = {
        changeId: command.changeId, effectiveAt: command.effectiveAt, reason: command.reason, authorId: actor.userId,
        supersedes: command.supersedes, scenario: validateWeatherScenario(command.scenario),
      };
      const world = withResourceAlias({
        ...state.world,
        state: { ...state.world.state, Weather: { snapshot: current.snapshot, changes: [...(current.changes ?? []), change] } },
      });
      return {
        state: next(state, { world }),
        event: eventFor(state, command, 'weather.changed.v1', change.changeId, { ...change, recipients: ['blue', 'red'] }),
        revision: state.revision + 1,
      };
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
