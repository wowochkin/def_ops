import type { EventCategory, EventObservation, EventReport, EventScale } from '../model/event-template';
import type { EventEffect, EventUnit } from '../model/event-effect';
import { canonicalHash } from './weighted-choice';

export const SCHEDULER_ALGORITHM_VERSION = 1;

export type SchedulerRejectionCode =
  | 'ZERO_INTENSITY'
  | 'NO_CANDIDATES'
  | 'NO_ELIGIBLE_CANDIDATES'
  | 'STAGE_NOT_APPLICABLE'
  | 'SIDE_NOT_APPLICABLE'
  | 'SCALE_NOT_APPLICABLE'
  | 'AREA_NOT_APPLICABLE'
  | 'OUTSIDE_BOUNDING_BOX'
  | 'ENVIRONMENT_COVERAGE_MISSING'
  | 'OUTSIDE_OPERATIONAL_WINDOW'
  | 'PRECONDITION_UNKNOWN'
  | 'PRECONDITION_FAILED'
  | 'OBSERVATION_SOURCE_UNAVAILABLE'
  | 'OBSERVATION_CHANNEL_UNAVAILABLE'
  | 'MUTUALLY_EXCLUDED'
  | 'MAX_OCCURRENCES'
  | 'MAX_PER_STAGE'
  | 'COOLDOWN'
  | 'SEVERITY_LIMIT'
  | 'SEVERITY_BUDGET_EXCEEDED'
  | 'CASCADE_DEPTH_EXCEEDED'
  | 'CASCADE_BUDGET_EXCEEDED'
  | 'CASCADE_NOT_ALLOWED'
  | 'CAUSALITY_REQUIRED'
  | 'RESOURCE_INSUFFICIENT'
  | 'PROTECTED_TRAINING_DATA'
  | 'EVENT_INTERVAL_LIMIT'
  | 'EVENT_STAGE_LIMIT';

export type OperationalInterval = Readonly<{ index: number; startSecond: number; endSecond: number }>;
export type SchedulerTarget = Readonly<{
  sideId: string;
  areaId: string;
  latitude?: number;
  longitude?: number;
  weight?: number;
}>;
export type ResourceBalance = Readonly<{ resourceId: string; ownerSideId: string; unit: EventUnit; onHand: number }>;
export type EventOccurrence = Readonly<{
  eventId: string;
  templateId: string;
  category: EventCategory;
  stageId: string;
  sideId: string;
  areaId: string;
  operationalSecond: number;
  mutuallyExclusiveGroupIds: readonly string[];
  cascadeDepth: number;
  causeEventIds: readonly string[];
}>;
export type SchedulerRuntimeState = Readonly<{
  stageId: string;
  scale: EventScale;
  operationalSecond: number;
  facts: Readonly<Record<string, unknown>>;
  resources: readonly ResourceBalance[];
  availableObservationSourceIds: readonly string[];
  availableChannelIds: readonly string[];
  environmentCoverageAreaIds: readonly string[];
  occurrences: readonly EventOccurrence[];
  intervalEventCount: number;
  stageEventCount: number;
  stageSeverityCost: number;
}>;
export type CascadeCursor = Readonly<{
  causeEventIds: readonly string[];
  depth: number;
  events: number;
}>;

export type BudgetSnapshot = Readonly<{
  eventsPerIntervalRemaining: number;
  eventsPerStageRemaining: number;
  severityRemaining: number;
  cascadeDepthRemaining: number;
  cascadeEventsRemaining: number;
  resources: Readonly<Record<string, number>>;
}>;

export type CandidateTraceEntry = Readonly<{
  templateId: string;
  version: number;
  baseWeight: number;
  effectiveWeight: number;
  selectionWeight: number;
  rejectionReasons: readonly SchedulerRejectionCode[];
  parameters: Readonly<Record<string, number>>;
}>;

export type AutonomyEventOperation = Readonly<{
  operationId: string;
  kind: 'applyWorldEffects' | 'createObservation' | 'createDocumentRevision' | 'createInput' | 'createApprovalRequest';
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type CreatedAutonomyEvent = Readonly<{
  eventId: string;
  occurrenceKey: string;
  templateId: string;
  templateVersion: number;
  category: EventCategory;
  operationalSecond: number;
  stageId: string;
  target: SchedulerTarget;
  parameters: Readonly<Record<string, number>>;
  effects: readonly EventEffect[];
  observations: readonly EventObservation[];
  reports: readonly EventReport[];
  cascadeDepth: number;
  causeEventIds: readonly string[];
  status: 'READY' | 'PENDING_APPROVAL';
  operations: readonly AutonomyEventOperation[];
}>;

export type EventCandidateTrace = Readonly<{
  traceId: string;
  algorithmVersion: number;
  branchId: string;
  snapshotHash: string;
  templateSetVersion: string;
  interval: OperationalInterval;
  category: EventCategory;
  attemptOrdinal: number;
  expectedAttemptsPerHour: number;
  intervalExpectedAttempts: number;
  target: SchedulerTarget | null;
  candidates: readonly CandidateTraceEntry[];
  parameters: Readonly<Record<string, number>>;
  selectionKey: string;
  selectionDigest: string;
  targetKey: string;
  targetDigest: string;
  approvalKey: string;
  approvalDigest: string;
  selectedTemplateId: string | null;
  rejection: SchedulerRejectionCode | null;
  budgetBefore: BudgetSnapshot;
  budgetAfter: BudgetSnapshot;
  createdEvents: readonly CreatedAutonomyEvent[];
  controlHash: string;
}>;

export type TraceRejection = Readonly<{
  code: SchedulerRejectionCode;
  category: EventCategory;
  targetKey: string;
  templateId?: string;
}>;
export type SchedulerIntervalTrace = Readonly<{
  interval: OperationalInterval;
  attempts: number;
  attemptsByCategory: Readonly<Partial<Record<EventCategory, number>>>;
  expectedAttempts: number;
  randomKeys: Readonly<{
    attempts: readonly string[];
    selection: readonly string[];
    target: readonly string[];
    approval: readonly string[];
  }>;
  rejection: SchedulerRejectionCode | null;
  rejections: readonly TraceRejection[];
  attemptTraceHashes: readonly string[];
  createdEventIds: readonly string[];
  controlHash: string;
}>;

export type NonProbabilisticEvent = Readonly<{
  eventId: string;
  kind: 'PLANNED' | 'REACTIVE';
  operationalSecond: number;
  payload?: Readonly<Record<string, unknown>>;
}>;

export type ScheduleIntervalResult = Readonly<{
  attempts: number;
  createdEvents: readonly CreatedAutonomyEvent[];
  traces: readonly EventCandidateTrace[];
  trace: SchedulerIntervalTrace;
  state: SchedulerRuntimeState;
  plannedReactiveEvents: readonly NonProbabilisticEvent[];
  replayed?: boolean;
}>;

export function finalizeCandidateTrace(trace: Omit<EventCandidateTrace, 'controlHash'>): EventCandidateTrace {
  return { ...trace, controlHash: canonicalHash(trace) };
}

export function finalizeIntervalTrace(trace: Omit<SchedulerIntervalTrace, 'controlHash'>): SchedulerIntervalTrace {
  return { ...trace, controlHash: canonicalHash(trace) };
}

export function replayIntervalResult(result: ScheduleIntervalResult): ScheduleIntervalResult {
  return { ...structuredClone(result), replayed: true };
}
