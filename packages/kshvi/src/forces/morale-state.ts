import {
  MORALE_COMPONENT_NAMES,
  MORALE_SCALE_V1,
  type MoraleChanges,
  type MoraleComponentName,
  type MoraleComponentValue,
  type MoraleComponents,
  type MoraleContribution,
  type MoraleHistoryEntry,
  type MoraleImpact,
  type MoralePsychState,
  type MoraleRangeId,
  type MoraleRecoveryInput,
  type MoraleResourceConsumption,
  type MoraleSource,
} from './morale-model';
import { MORALE_PROFILE_V1, type MoraleProfile } from './morale-profile';

export type MoraleTransition = Readonly<{
  status: 'CALCULATED' | 'REQUIRES_REVIEW';
  state: MoralePsychState;
  appliedEventIds: readonly string[];
  duplicateEventIds: readonly string[];
  contributions: readonly MoraleContribution[];
  unknown: readonly MoraleComponentName[];
  recovery: Readonly<{
    eventId: string;
    status: 'APPLIED' | 'BLOCKED' | 'DUPLICATE';
    reasons: readonly string[];
  }> | null;
  resourceConsumptions: readonly MoraleResourceConsumption[];
}>;

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Некорректное время МПС');
  return parsed;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertSource(source: MoraleSource): void {
  if (!source.reference.trim() || !source.approvedBy.trim() || !source.applicability.trim()) {
    throw new Error('Для МПС нужны источник, утверждающий и область применимости');
  }
  if (source.kind === 'EDUCATIONAL_ASSUMPTION' && !source.assumptionId.trim()) {
    throw new Error('Нужен идентификатор учебного допущения МПС');
  }
  if (source.kind === 'APPROVED_REFERENCE' && source.assumptionId.trim()) {
    throw new Error('Источник МПС не должен одновременно быть учебным допущением');
  }
}

function assertComponents(components: MoraleComponents): void {
  for (const name of MORALE_COMPONENT_NAMES) {
    const component = components[name];
    if (!component) throw new Error(`Отсутствует компонент МПС: ${name}`);
    instant(component.observedAt);
    if (component.status === 'UNKNOWN') {
      if (!component.reason.trim()) throw new Error('Для UNKNOWN МПС нужна причина');
      continue;
    }
    if (!Number.isFinite(component.value) || component.value < 0 || component.value > 1) {
      throw new Error(`Компонент МПС ${name} вне версионной шкалы`);
    }
    assertSource(component.source);
  }
}

export function createMoralePsychState(input: {
  subject: Readonly<{ kind: 'SIMULATED_FORCE'; forceId: string }>;
  at: string;
  components: MoraleComponents;
}): MoralePsychState {
  if (input.subject.kind !== 'SIMULATED_FORCE' || !input.subject.forceId?.trim()) {
    throw new Error('МПС ведётся только для моделируемых сил, не для реальных участников');
  }
  instant(input.at);
  assertComponents(input.components);
  return {
    schemaVersion: 1,
    profileVersion: 1,
    subject: { kind: 'SIMULATED_FORCE', forceId: input.subject.forceId },
    scale: MORALE_SCALE_V1,
    components: { ...input.components },
    at: input.at,
    stateEnteredAt: input.at,
    appliedEventIds: [],
    history: [],
  };
}

function capacity(components: MoraleComponents, profile: MoraleProfile): number | null {
  const morale = components.morale;
  const cohesion = components.cohesion;
  const stress = components.stress;
  if (morale.status === 'UNKNOWN' || cohesion.status === 'UNKNOWN' || stress.status === 'UNKNOWN') return null;
  const weights = profile.componentWeights;
  return weights.morale * morale.value + weights.cohesion * cohesion.value + weights.stress * (1 - stress.value);
}

function rangeFor(components: MoraleComponents, profile: MoraleProfile): MoraleRangeId | null {
  const value = capacity(components, profile);
  if (value === null) return null;
  const range = MORALE_SCALE_V1.ranges.find(candidate =>
    value >= candidate.minimum && (value < candidate.maximum || (candidate.maximum === 1 && value <= 1)));
  return range?.id ?? null;
}

function changedEntries(changes: MoraleChanges): [MoraleComponentName, number][] {
  return MORALE_COMPONENT_NAMES.flatMap(name => {
    const value = changes[name];
    return value === undefined ? [] : [[name, value] as [MoraleComponentName, number]];
  });
}

/** Версионный Clamp_v: событие один раз, вклад и суммарный шаг ограничены. */
export function advanceMorale(input: {
  state: MoralePsychState;
  at: string;
  intervalMinutes: number;
  impacts?: readonly MoraleImpact[];
  recovery?: MoraleRecoveryInput;
}, profile: MoraleProfile = MORALE_PROFILE_V1): MoraleTransition {
  const { state } = input;
  if (profile.version !== state.profileVersion || profile.scale.version !== state.scale.version) {
    throw new Error('Версия профиля МПС не соответствует состоянию');
  }
  if (!Number.isFinite(input.intervalMinutes) || input.intervalMinutes < 0) {
    throw new Error('Интервал МПС должен быть неотрицательным конечным числом');
  }
  if (instant(input.at) < instant(state.at)) throw new Error('Переход МПС не может переписывать прошлое');
  assertComponents(state.components);

  const next: Record<MoraleComponentName, MoraleComponentValue> = { ...state.components };
  const totals: Partial<Record<MoraleComponentName, number>> = {};
  const changeSources: Partial<Record<MoraleComponentName, { observedAt: string; source: MoraleSource }>> = {};
  const contributions: MoraleContribution[] = [];
  const duplicateEventIds: string[] = [];
  const appliedEventIds: string[] = [];
  const resourceConsumptions: MoraleResourceConsumption[] = [];
  const seen = new Set(state.appliedEventIds);
  const unknown = new Set<MoraleComponentName>();

  const addChanges = (
    eventId: string,
    factor: 'MORALE_IMPACT' | 'RECOVERY',
    kind: string,
    changes: MoraleChanges,
    source: MoraleSource,
    observedAt: string,
  ): void => {
    assertSource(source);
    const actual: Partial<Record<MoraleComponentName, number>> = {};
    for (const [name, requested] of changedEntries(changes)) {
      if (!Number.isFinite(requested)) throw new Error('Вклад МПС должен быть конечным числом');
      const delta = clamp(requested, -profile.maxImpactPerComponentEvent, profile.maxImpactPerComponentEvent);
      actual[name] = delta;
      if (next[name].status === 'UNKNOWN') {
        unknown.add(name);
        continue;
      }
      totals[name] = (totals[name] ?? 0) + delta;
      changeSources[name] = { observedAt, source };
    }
    contributions.push({ eventId, factor, kind, changes: actual, source });
  };

  const impacts = [...(input.impacts ?? [])].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  for (const impact of impacts) {
    if (!impact.eventId.trim()) throw new Error('Воздействие МПС требует eventId');
    instant(impact.occurredAt);
    if (seen.has(impact.eventId)) {
      duplicateEventIds.push(impact.eventId);
      continue;
    }
    seen.add(impact.eventId);
    appliedEventIds.push(impact.eventId);
    addChanges(impact.eventId, 'MORALE_IMPACT', impact.kind, impact.changes, impact.source, impact.occurredAt);
  }

  let recovery: MoraleTransition['recovery'] = null;
  if (input.recovery) {
    const activity = input.recovery;
    const rule = profile.recoveryRules[activity.activity];
    if (seen.has(activity.eventId)) {
      duplicateEventIds.push(activity.eventId);
      recovery = { eventId: activity.eventId, status: 'DUPLICATE', reasons: ['Мероприятие уже учтено'] };
    } else {
      const reasons: string[] = [];
      if (!Number.isFinite(activity.durationMinutes) || activity.durationMinutes < rule.minimumMinutes) {
        reasons.push(`Требуется не менее ${rule.minimumMinutes} минут мероприятия`);
      }
      if (activity.durationMinutes > input.intervalMinutes) reasons.push('Длительность мероприятия превышает интервал');
      if (activity.availableResources.unit !== rule.resourceUnit || activity.availableResources.amount < rule.requiredResourceAmount) {
        reasons.push('Недостаточно ресурсов для восстановления МПС');
      }
      for (const [name] of changedEntries(rule.changes)) {
        if (next[name].status === 'UNKNOWN') reasons.push(`Нельзя рассчитать восстановление UNKNOWN: ${name}`);
      }
      if (reasons.length) {
        recovery = { eventId: activity.eventId, status: 'BLOCKED', reasons };
      } else {
        seen.add(activity.eventId);
        appliedEventIds.push(activity.eventId);
        addChanges(activity.eventId, 'RECOVERY', activity.activity, rule.changes, activity.source, input.at);
        resourceConsumptions.push({
          eventId: activity.eventId,
          resourceId: activity.availableResources.resourceId,
          amount: rule.requiredResourceAmount,
          unit: rule.resourceUnit,
        });
        recovery = { eventId: activity.eventId, status: 'APPLIED', reasons: [] };
      }
    }
  }

  const intervalChanges: Partial<Record<MoraleComponentName, number>> = {};
  for (const name of MORALE_COMPONENT_NAMES) {
    const total = totals[name];
    const current = next[name];
    if (total === undefined || current.status === 'UNKNOWN') continue;
    const delta = clamp(total, -profile.maxChangePerInterval, profile.maxChangePerInterval);
    const source = changeSources[name];
    if (!source) throw new Error('Не сохранён источник изменения МПС');
    const value = clamp(current.value + delta, profile.scale.minimum, profile.scale.maximum);
    intervalChanges[name] = delta;
    next[name] = {
      status: 'KNOWN',
      value,
      uncertainty: 'ESTIMATED',
      observedAt: source.observedAt,
      source: source.source,
    };
  }
  for (const name of MORALE_COMPONENT_NAMES) {
    if (next[name].status === 'UNKNOWN') unknown.add(name);
  }

  const historyEntry: MoraleHistoryEntry = {
    at: input.at,
    intervalMinutes: input.intervalMinutes,
    contributions,
    intervalChanges,
    duplicateEventIds,
    recoveryStatus: recovery?.status ?? 'NONE',
  };
  const nextState: MoralePsychState = {
    ...state,
    components: next,
    at: input.at,
    stateEnteredAt: rangeFor(state.components, profile) === rangeFor(next, profile) ? state.stateEnteredAt : input.at,
    appliedEventIds: [...state.appliedEventIds, ...appliedEventIds],
    history: [...state.history, historyEntry],
  };
  return {
    status: unknown.size || recovery?.status === 'BLOCKED' ? 'REQUIRES_REVIEW' : 'CALCULATED',
    state: nextState,
    appliedEventIds,
    duplicateEventIds,
    contributions,
    unknown: MORALE_COMPONENT_NAMES.filter(name => unknown.has(name)),
    recovery,
    resourceConsumptions,
  };
}
