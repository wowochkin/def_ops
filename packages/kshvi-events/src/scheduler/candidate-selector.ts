import type { EventAmount } from '../model/event-effect';
import type { EventCategory, EventTemplate } from '../model/event-template';
import { attemptsPerOperationalHour, intensityFor, type AutonomyProfile } from '../profile/autonomy-profile';
import { guardCandidate } from './cascade-guard';
import {
  SCHEDULER_ALGORITHM_VERSION,
  finalizeCandidateTrace,
  type AutonomyEventOperation,
  type BudgetSnapshot,
  type CandidateTraceEntry,
  type CascadeCursor,
  type CreatedAutonomyEvent,
  type EventCandidateTrace,
  type OperationalInterval,
  type ResourceBalance,
  type SchedulerRejectionCode,
  type SchedulerRuntimeState,
  type SchedulerTarget,
} from './candidate-trace';
import { canonicalHash, canonicalJson, randomForKey, weightedChoice, type SchedulerRandomKey } from './weighted-choice';

export type SelectCandidateInput = Readonly<{
  templates: readonly EventTemplate[];
  category: EventCategory;
  profile: AutonomyProfile;
  state: SchedulerRuntimeState;
  target: SchedulerTarget;
  interval: OperationalInterval;
  attemptOrdinal: number;
  seed: string;
  branchId: string;
  snapshotHash: string;
  templateSetVersion: string;
  algorithmVersion?: number;
  expectedAttemptsPerHour?: number;
  intervalExpectedAttempts?: number;
  cascade?: CascadeCursor;
  parentTemplate?: EventTemplate;
}>;

export type SelectCandidateResult = Readonly<{
  trace: EventCandidateTrace;
  event: CreatedAutonomyEvent | null;
  state: SchedulerRuntimeState;
}>;

type EvaluatedCandidate = Readonly<{
  template: EventTemplate;
  parameters: Readonly<Record<string, number>>;
  effectiveWeight: number;
  rejectionReasons: readonly SchedulerRejectionCode[];
}>;

function targetIdentity(target: SchedulerTarget): string {
  return `${target.sideId}/${target.areaId}`;
}

function resourceIdentity(resource: Pick<ResourceBalance, 'resourceId' | 'ownerSideId' | 'unit'>): string {
  return `${resource.ownerSideId}/${resource.resourceId}/${resource.unit}`;
}

function resolveAmount(value: EventAmount, parameters: Readonly<Record<string, number>>): number {
  return typeof value === 'number' ? value : parameters[value.parameterId] ?? 0;
}

function budgetSnapshot(
  profile: AutonomyProfile,
  state: SchedulerRuntimeState,
  cascade: CascadeCursor,
): BudgetSnapshot {
  return {
    eventsPerIntervalRemaining: Math.max(0, profile.settings.maxEventsPerInterval - state.intervalEventCount),
    eventsPerStageRemaining: Math.max(0, profile.settings.maxEventsPerStage - state.stageEventCount),
    severityRemaining: Math.max(0, profile.settings.severityBudgetPerStage - state.stageSeverityCost),
    cascadeDepthRemaining: Math.max(0, profile.settings.maxCascadeDepth - cascade.depth),
    cascadeEventsRemaining: Math.max(0, profile.settings.maxCascadeEvents - cascade.events),
    resources: Object.fromEntries(state.resources.map(resource => [resourceIdentity(resource), resource.onHand])),
  };
}

function operation(
  branchId: string,
  eventId: string,
  index: number,
  kind: AutonomyEventOperation['kind'],
  payload: Readonly<Record<string, unknown>>,
): AutonomyEventOperation {
  const operationId = `${eventId}-operation-${index + 1}`;
  return {
    operationId,
    kind,
    idempotencyKey: `${branchId}:autonomy:${eventId}:${index + 1}:${kind}`,
    payload,
  };
}

function domainOperations(
  branchId: string,
  eventId: string,
  template: EventTemplate,
  target: SchedulerTarget,
  parameters: Readonly<Record<string, number>>,
  interval: OperationalInterval,
  stageId: string,
  cascade: CascadeCursor,
): AutonomyEventOperation[] {
  const operations: AutonomyEventOperation[] = [];
  const add = (kind: AutonomyEventOperation['kind'], payload: Readonly<Record<string, unknown>>) => {
    operations.push(operation(branchId, eventId, operations.length, kind, payload));
  };
  add('applyWorldEffects', {
    eventId,
    templateId: template.templateId,
    templateVersion: template.version,
    effects: template.effects,
    parameters,
    causeEventIds: cascade.causeEventIds,
    operationalSecond: interval.startSecond,
    stageId,
    target,
  });
  for (const observation of template.observations) {
    add('createObservation', {
      ...observation,
      sourceEventId: eventId,
      operationalSecond: interval.startSecond,
      stageId,
      areaId: target.areaId,
    });
  }
  template.reports.forEach((report, reportIndex) => {
    const documentId = `${eventId}-document-${reportIndex + 1}`;
    const hiddenInputId = `${eventId}-input-${reportIndex + 1}-control`;
    const participantInputId = `${eventId}-input-${reportIndex + 1}-participant`;
    const observation = template.observations.find(item => item.observationId === report.basedOnObservationId);
    const deliverySecond = interval.startSecond + (observation?.delaySeconds.max ?? 0);
    add('createDocumentRevision', {
      documentId,
      revision: 1,
      title: report.title,
      sourceEventId: eventId,
      basedOnObservationId: report.basedOnObservationId,
      recipientSideIds: report.recipientSideIds,
      operationalSecond: interval.startSecond,
      stageId,
    });
    const common = {
      content: report.title,
      sourceRole: 'SYSTEM_AUTONOMY',
      channelId: report.channelId,
      occurredAtSecond: interval.startSecond,
      plannedDeliverySecond: deliverySecond,
      availableAtSecond: deliverySecond,
      stageId,
      basisTemplateId: template.templateId,
      geometry: { areaId: target.areaId },
      cancellationRule: `COMPENSATE_SOURCE_EVENT:${eventId}`,
    };
    add('createInput', {
      ...common,
      inputId: hiddenInputId,
      participantCopyIds: [participantInputId],
      sourceEventId: eventId,
      recipientSideIds: [],
      visibility: 'CONTROL',
    });
    add('createInput', {
      ...common,
      inputId: participantInputId,
      sourceInputId: hiddenInputId,
      sourceEventId: eventId,
      recipientSideIds: report.recipientSideIds,
      visibility: 'PARTICIPANT',
    });
  });
  return operations;
}

function applyResources(
  resources: readonly ResourceBalance[],
  template: EventTemplate,
  parameters: Readonly<Record<string, number>>,
): ResourceBalance[] {
  const balances = new Map(resources.map(resource => [resourceIdentity(resource), { ...resource }]));
  for (const effect of template.effects) {
    if (effect.type === 'resource.adjust') {
      const key = resourceIdentity(effect);
      const current = balances.get(key);
      if (!current) continue;
      const delta = resolveAmount(effect.amount, parameters);
      balances.set(key, { ...current, onHand: effect.operation === 'CONSUME' ? current.onHand - delta : current.onHand + delta });
    }
    if (effect.type === 'resource.transfer') {
      const amount = resolveAmount(effect.amount, parameters);
      const fromKey = resourceIdentity({ resourceId: effect.resourceId, ownerSideId: effect.fromSideId, unit: effect.unit });
      const toKey = resourceIdentity({ resourceId: effect.resourceId, ownerSideId: effect.toSideId, unit: effect.unit });
      const from = balances.get(fromKey);
      if (from) balances.set(fromKey, { ...from, onHand: from.onHand - amount });
      const to = balances.get(toKey) ?? { resourceId: effect.resourceId, ownerSideId: effect.toSideId, unit: effect.unit, onHand: 0 };
      balances.set(toKey, { ...to, onHand: to.onHand + amount });
    }
  }
  return [...balances.values()];
}

function summarizeRejection(candidates: readonly CandidateTraceEntry[]): SchedulerRejectionCode {
  if (candidates.length === 0) return 'NO_CANDIDATES';
  if (candidates.some(candidate => candidate.rejectionReasons.includes('EVENT_INTERVAL_LIMIT'))) return 'EVENT_INTERVAL_LIMIT';
  if (candidates.some(candidate => candidate.rejectionReasons.includes('EVENT_STAGE_LIMIT'))) return 'EVENT_STAGE_LIMIT';
  return 'NO_ELIGIBLE_CANDIDATES';
}

export function selectCandidate(input: SelectCandidateInput): SelectCandidateResult {
  const algorithmVersion = input.algorithmVersion ?? SCHEDULER_ALGORITHM_VERSION;
  const cascade = input.cascade ?? { causeEventIds: [], depth: 0, events: 0 };
  const targetKey = targetIdentity(input.target);
  const baseKey = {
    algorithmVersion,
    seed: input.seed,
    branchId: input.branchId,
    snapshotHash: input.snapshotHash,
    templateSetVersion: input.templateSetVersion,
    intervalIndex: input.interval.index,
    category: input.category,
    targetKey,
  };
  const selectionDraw = randomForKey({ ...baseKey, purpose: 'category', ordinal: input.attemptOrdinal });
  const targetDraw = randomForKey({ ...baseKey, purpose: 'target', ordinal: input.attemptOrdinal });
  const approvalDraw = randomForKey({ ...baseKey, purpose: 'approval', ordinal: input.attemptOrdinal });
  const before = budgetSnapshot(input.profile, input.state, cascade);
  const lambda = input.expectedAttemptsPerHour ?? attemptsPerOperationalHour(input.profile, {
    category: input.category,
    stageId: input.state.stageId,
    sideId: input.target.sideId,
    areaId: input.target.areaId,
  });
  const expectedInInterval = input.intervalExpectedAttempts ?? lambda * (input.interval.endSecond - input.interval.startSecond) / 3600;

  const evaluated: EvaluatedCandidate[] = input.templates
    .filter(template => template.category === input.category)
    .sort((left, right) => left.templateId.localeCompare(right.templateId))
    .map(template => {
      const parameters = Object.fromEntries(template.parameters.map(parameter => {
        const parameterKey: SchedulerRandomKey = {
          ...baseKey,
          targetKey: `${targetKey}/template/${template.templateId}/parameter/${parameter.parameterId}`,
          purpose: 'target',
          ordinal: input.attemptOrdinal,
        };
        const draw = randomForKey(parameterKey);
        return [parameter.parameterId, parameter.range.min + (parameter.range.max - parameter.range.min) * draw.value];
      }));
      const effectiveWeight = template.baseWeight * intensityFor(input.profile, {
        category: input.category,
        stageId: input.state.stageId,
        sideId: input.target.sideId,
        areaId: input.target.areaId,
      });
      const guard = guardCandidate({
        template,
        parameters,
        target: input.target,
        state: input.state,
        profile: input.profile,
        operationalSecond: input.interval.startSecond,
        cascade,
        parentTemplate: input.parentTemplate,
      });
      return { template, parameters, effectiveWeight, rejectionReasons: guard.reasons };
    });

  const candidates: CandidateTraceEntry[] = evaluated.map(candidate => ({
    templateId: candidate.template.templateId,
    version: candidate.template.version,
    baseWeight: candidate.template.baseWeight,
    effectiveWeight: candidate.effectiveWeight,
    selectionWeight: candidate.rejectionReasons.length === 0 ? candidate.effectiveWeight : 0,
    rejectionReasons: candidate.rejectionReasons,
    parameters: candidate.parameters,
  }));
  const eligible = evaluated.filter(candidate => candidate.rejectionReasons.length === 0 && candidate.effectiveWeight > 0);
  const choice = weightedChoice(
    eligible.map(candidate => ({ id: candidate.template.templateId, value: candidate, weight: candidate.effectiveWeight })),
    selectionDraw.value,
  );
  const selected = choice?.item ?? null;
  let event: CreatedAutonomyEvent | null = null;
  let nextState = structuredClone(input.state) as SchedulerRuntimeState;

  if (selected) {
    const occurrenceKey = canonicalJson({ ...baseKey, ordinal: input.attemptOrdinal });
    const eventId = `autonomy-${canonicalHash({
      occurrenceKey,
      templateId: selected.template.templateId,
      templateVersion: selected.template.version,
      selectionDigest: selectionDraw.digest,
    }).slice(0, 32)}`;
    const proposed = domainOperations(
      input.branchId,
      eventId,
      selected.template,
      input.target,
      selected.parameters,
      input.interval,
      input.state.stageId,
      cascade,
    );
    const share = input.profile.settings.manualApprovalShare;
    const needsApproval = share === 1 || (share > 0 && approvalDraw.value < share);
    const operations = needsApproval
      ? [operation(input.branchId, eventId, 0, 'createApprovalRequest', {
          requestId: `${eventId}-approval`,
          reason: 'MANUAL_APPROVAL_PROFILE',
          learningQuestion: selected.template.learningQuestion,
          proposedOperations: proposed,
          operationalSecond: input.interval.startSecond,
          stageId: input.state.stageId,
        })]
      : proposed;
    event = {
      eventId,
      occurrenceKey,
      templateId: selected.template.templateId,
      templateVersion: selected.template.version,
      category: selected.template.category,
      operationalSecond: input.interval.startSecond,
      stageId: input.state.stageId,
      target: input.target,
      parameters: selected.parameters,
      effects: selected.template.effects,
      observations: selected.template.observations,
      reports: selected.template.reports,
      cascadeDepth: cascade.depth,
      causeEventIds: cascade.causeEventIds,
      status: needsApproval ? 'PENDING_APPROVAL' : 'READY',
      operations,
    };
    nextState = {
      ...nextState,
      intervalEventCount: nextState.intervalEventCount + 1,
      stageEventCount: nextState.stageEventCount + 1,
      stageSeverityCost: nextState.stageSeverityCost + selected.template.severity.cost,
      resources: needsApproval ? nextState.resources : applyResources(nextState.resources, selected.template, selected.parameters),
      occurrences: [...nextState.occurrences, {
        eventId,
        templateId: selected.template.templateId,
        category: selected.template.category,
        stageId: input.state.stageId,
        sideId: input.target.sideId,
        areaId: input.target.areaId,
        operationalSecond: input.interval.startSecond,
        mutuallyExclusiveGroupIds: selected.template.limits.mutuallyExclusiveGroupIds,
        cascadeDepth: cascade.depth,
        causeEventIds: cascade.causeEventIds,
      }],
    };
  }

  const after = selected ? budgetSnapshot(input.profile, nextState, cascade) : before;
  const baseTrace = {
    traceId: `trace-${canonicalHash({ key: selectionDraw.key, target: targetKey }).slice(0, 32)}`,
    algorithmVersion,
    branchId: input.branchId,
    snapshotHash: input.snapshotHash,
    templateSetVersion: input.templateSetVersion,
    interval: input.interval,
    category: input.category,
    attemptOrdinal: input.attemptOrdinal,
    expectedAttemptsPerHour: lambda,
    intervalExpectedAttempts: expectedInInterval,
    target: input.target,
    candidates,
    parameters: selected?.parameters ?? {},
    selectionKey: selectionDraw.key,
    selectionDigest: selectionDraw.digest,
    targetKey: targetDraw.key,
    targetDigest: targetDraw.digest,
    approvalKey: approvalDraw.key,
    approvalDigest: approvalDraw.digest,
    selectedTemplateId: selected?.template.templateId ?? null,
    rejection: selected ? null : summarizeRejection(candidates),
    budgetBefore: before,
    budgetAfter: after,
    createdEvents: event ? [event] : [],
  };
  return { trace: finalizeCandidateTrace(baseTrace), event, state: nextState };
}
