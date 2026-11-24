import type { EventAmount } from '../model/event-effect';
import type { EventPrecondition, EventTemplate } from '../model/event-template';
import { intensityFor, type AutonomyProfile } from '../profile/autonomy-profile';
import type {
  CascadeCursor,
  ResourceBalance,
  SchedulerRejectionCode,
  SchedulerRuntimeState,
  SchedulerTarget,
} from './candidate-trace';
import { canonicalJson } from './weighted-choice';

export type GuardCandidateInput = Readonly<{
  template: EventTemplate;
  parameters: Readonly<Record<string, number>>;
  target: SchedulerTarget;
  state: SchedulerRuntimeState;
  profile: AutonomyProfile;
  operationalSecond: number;
  cascade: CascadeCursor;
  parentTemplate?: EventTemplate;
}>;
export type GuardResult = Readonly<{ allowed: boolean; reasons: readonly SchedulerRejectionCode[] }>;

function unknownFact(value: unknown, exists: boolean): boolean {
  return !exists || value === undefined || value === null || (
    typeof value === 'object' && !Array.isArray(value) && (value as { status?: unknown }).status === 'UNKNOWN'
  );
}

function compare(actual: unknown, precondition: EventPrecondition): boolean {
  const expected = precondition.value;
  switch (precondition.operator) {
    case 'EQ': return canonicalJson(actual) === canonicalJson(expected);
    case 'NE': return canonicalJson(actual) !== canonicalJson(expected);
    case 'LT': return (typeof actual === 'number' && typeof expected === 'number') || (typeof actual === 'string' && typeof expected === 'string') ? actual < expected : false;
    case 'LE': return (typeof actual === 'number' && typeof expected === 'number') || (typeof actual === 'string' && typeof expected === 'string') ? actual <= expected : false;
    case 'GT': return (typeof actual === 'number' && typeof expected === 'number') || (typeof actual === 'string' && typeof expected === 'string') ? actual > expected : false;
    case 'GE': return (typeof actual === 'number' && typeof expected === 'number') || (typeof actual === 'string' && typeof expected === 'string') ? actual >= expected : false;
  }
}

function resourceKey(resource: Pick<ResourceBalance, 'resourceId' | 'ownerSideId' | 'unit'>): string {
  return `${resource.ownerSideId}/${resource.resourceId}/${resource.unit}`;
}

function amount(value: EventAmount, parameters: Readonly<Record<string, number>>): number {
  return typeof value === 'number' ? value : parameters[value.parameterId] ?? Number.NaN;
}

function protectedTrainingEffect(effect: EventTemplate['effects'][number]): boolean {
  const pattern = /(?:assessment|evaluation|score|training[._-]?goal|learning[._-]?(?:goal|objective)|^goal[._-]?)/i;
  if (pattern.test(effect.type)) return true;
  return effect.type === 'catalog.effect' && (pattern.test(effect.target.domain) || pattern.test(effect.target.ref));
}

export function guardCandidate(input: GuardCandidateInput): GuardResult {
  const { template, target, state, profile, parameters, cascade } = input;
  const reasons = new Set<SchedulerRejectionCode>();
  const settings = profile.settings;
  if (intensityFor(profile, { category: template.category, stageId: state.stageId, sideId: target.sideId, areaId: target.areaId }) === 0) {
    reasons.add('ZERO_INTENSITY');
  }
  if (state.intervalEventCount >= settings.maxEventsPerInterval) reasons.add('EVENT_INTERVAL_LIMIT');
  if (state.stageEventCount >= settings.maxEventsPerStage) reasons.add('EVENT_STAGE_LIMIT');
  if (template.severity.cost > settings.maxSeverityCost) reasons.add('SEVERITY_LIMIT');
  if (state.stageSeverityCost + template.severity.cost > settings.severityBudgetPerStage) reasons.add('SEVERITY_BUDGET_EXCEEDED');

  if (!template.applicability.stageIds.includes(state.stageId)) reasons.add('STAGE_NOT_APPLICABLE');
  if (!template.applicability.sideIds.includes(target.sideId)) reasons.add('SIDE_NOT_APPLICABLE');
  if (!template.applicability.scales.includes(state.scale)) reasons.add('SCALE_NOT_APPLICABLE');
  if (!template.applicability.geography.areaIds.includes(target.areaId)) reasons.add('AREA_NOT_APPLICABLE');
  const box = template.applicability.geography.boundingBox;
  if (target.latitude !== undefined && (target.latitude < box.minLatitude || target.latitude > box.maxLatitude)) reasons.add('OUTSIDE_BOUNDING_BOX');
  if (target.longitude !== undefined && (target.longitude < box.minLongitude || target.longitude > box.maxLongitude)) reasons.add('OUTSIDE_BOUNDING_BOX');
  if (template.applicability.geography.requiresEnvironmentCoverage && !state.environmentCoverageAreaIds.includes(target.areaId)) {
    reasons.add('ENVIRONMENT_COVERAGE_MISSING');
  }
  const minute = Math.floor(input.operationalSecond / 60);
  if (!template.applicability.operationalWindows.some(window => minute >= window.startMinute && minute < window.endMinute)) {
    reasons.add('OUTSIDE_OPERATIONAL_WINDOW');
  }

  for (const precondition of template.preconditions) {
    const exists = Object.prototype.hasOwnProperty.call(state.facts, precondition.fact);
    const actual = state.facts[precondition.fact];
    if (unknownFact(actual, exists)) {
      if (precondition.required) reasons.add('PRECONDITION_UNKNOWN');
    } else if (!compare(actual, precondition)) {
      reasons.add('PRECONDITION_FAILED');
    }
  }

  const sources = new Set(state.availableObservationSourceIds);
  const channels = new Set(state.availableChannelIds);
  for (const observation of template.observations) {
    if (observation.visibility !== 'PARTICIPANT') continue;
    if (!sources.has(observation.source.sourceId) || observation.source.kind === 'CONTROL') reasons.add('OBSERVATION_SOURCE_UNAVAILABLE');
    if (observation.channelId !== 'ANY_AVAILABLE' && !channels.has(observation.channelId)) reasons.add('OBSERVATION_CHANNEL_UNAVAILABLE');
    if (observation.channelId === 'ANY_AVAILABLE' && channels.size === 0) reasons.add('OBSERVATION_CHANNEL_UNAVAILABLE');
  }

  const occurrences = state.occurrences.filter(occurrence => occurrence.templateId === template.templateId);
  if (occurrences.length >= template.limits.maxOccurrences) reasons.add('MAX_OCCURRENCES');
  if (occurrences.filter(occurrence => occurrence.stageId === state.stageId).length >= template.limits.maxPerStage) reasons.add('MAX_PER_STAGE');
  if (template.limits.cooldownSeconds > 0 && occurrences.some(occurrence => (
    input.operationalSecond >= occurrence.operationalSecond
    && input.operationalSecond - occurrence.operationalSecond < template.limits.cooldownSeconds
  ))) reasons.add('COOLDOWN');
  const groups = new Set(template.limits.mutuallyExclusiveGroupIds);
  if (groups.size > 0 && state.occurrences.some(occurrence => (
    occurrence.stageId === state.stageId && occurrence.mutuallyExclusiveGroupIds.some(group => groups.has(group))
  ))) reasons.add('MUTUALLY_EXCLUDED');

  if (cascade.depth > 0) {
    if (cascade.causeEventIds.length === 0) reasons.add('CAUSALITY_REQUIRED');
    if (!input.parentTemplate || !input.parentTemplate.cascade.allowedTemplateIds.includes(template.templateId)) reasons.add('CASCADE_NOT_ALLOWED');
    const depthLimit = Math.min(settings.maxCascadeDepth, input.parentTemplate?.cascade.maxDepth ?? settings.maxCascadeDepth);
    const eventLimit = Math.min(settings.maxCascadeEvents, input.parentTemplate?.cascade.maxEvents ?? settings.maxCascadeEvents);
    if (cascade.depth > depthLimit) reasons.add('CASCADE_DEPTH_EXCEEDED');
    if (cascade.events >= eventLimit) reasons.add('CASCADE_BUDGET_EXCEEDED');
  }

  if (template.effects.some(protectedTrainingEffect)) reasons.add('PROTECTED_TRAINING_DATA');
  const required = new Map<string, number>();
  for (const effect of template.effects) {
    if (effect.type === 'resource.adjust' && effect.operation === 'CONSUME') {
      const key = resourceKey(effect);
      required.set(key, (required.get(key) ?? 0) + amount(effect.amount, parameters));
    }
    if (effect.type === 'resource.transfer') {
      const key = resourceKey({ resourceId: effect.resourceId, ownerSideId: effect.fromSideId, unit: effect.unit });
      required.set(key, (required.get(key) ?? 0) + amount(effect.amount, parameters));
    }
  }
  const balances = new Map(state.resources.map(resource => [resourceKey(resource), resource.onHand]));
  for (const [key, needed] of required) {
    if (!Number.isFinite(needed) || needed < 0 || (balances.get(key) ?? 0) < needed) reasons.add('RESOURCE_INSUFFICIENT');
  }

  return { allowed: reasons.size === 0, reasons: [...reasons] };
}
