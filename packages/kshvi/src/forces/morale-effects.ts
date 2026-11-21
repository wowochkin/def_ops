import type { MoraleComponentName, MoralePsychState, MoraleSource } from './morale-model';
import { MORALE_PROFILE_V1, type MoraleProfile } from './morale-profile';
import type { MoraleProjection } from './morale-projection';

export type MoraleEffectInput = Readonly<{
  status: 'KNOWN' | 'UNKNOWN';
  morale: number | null;
  cohesion: number | null;
  stress: number | null;
  durationMinutes: number;
  unknown?: readonly string[];
  reason?: string;
}>;

export type MoraleTaskInput = Readonly<{
  readiness: number;
  equipment: number;
  resources: number;
  fatigue: number;
  randomKey: null;
  availableMinutes: number;
  requiredTaskMinutes: number;
  unrelatedResource: Readonly<{ resourceId: string; amount: number; unit: string }>;
  morale: MoraleEffectInput;
}>;

export type MoraleTaskResult = Readonly<{
  status: 'CALCULATED' | 'REQUIRES_REVIEW';
  unknown: readonly string[];
  orderProcessingMinutes: number | null;
  orderDelayMinutes: number | null;
  readyToStart: boolean;
  executionScore: number | null;
  movementRateFactor: number | null;
  reportDelayMinutes: number | null;
  taskStatus: 'EXECUTED' | 'INTERRUPTED' | 'DELAYED' | 'REQUIRES_REVIEW';
  interruption: Readonly<{ threshold: number; eligible: boolean; reason: string }>;
  contributions: Readonly<{
    readiness: number;
    equipment: number;
    resources: number;
    fatigue: number;
    morale: number | null;
  }>;
  causalChain: readonly ['MORALE_COMPONENTS', 'ORDER_PROCESSING', 'TASK_EXECUTION', 'COMMANDER_CHOICE', 'FINAL_SITUATION'];
  finalSituation: Readonly<{
    status: 'CALCULATED' | 'REQUIRES_REVIEW';
    progress: number | null;
    objectiveHeld: boolean | null;
    unrelatedResource: Readonly<{ resourceId: string; amount: number; unit: string }>;
  }>;
}>;

const CAUSAL_CHAIN = [
  'MORALE_COMPONENTS',
  'ORDER_PROCESSING',
  'TASK_EXECUTION',
  'COMMANDER_CHOICE',
  'FINAL_SITUATION',
] as const;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function minutesBetween(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Некорректное время для расчёта МПС');
  return Math.max(0, (end - start) / 60_000);
}

export function moraleInputFromState(state: MoralePsychState, at: string): MoraleEffectInput {
  const morale = state.components.morale;
  const cohesion = state.components.cohesion;
  const stress = state.components.stress;
  const unknown = [
    morale.status === 'UNKNOWN' ? 'morale' : null,
    cohesion.status === 'UNKNOWN' ? 'cohesion' : null,
    stress.status === 'UNKNOWN' ? 'stress' : null,
  ].filter((name): name is MoraleComponentName => name !== null);
  return {
    status: unknown.length ? 'UNKNOWN' : 'KNOWN',
    morale: morale.status === 'KNOWN' ? morale.value : null,
    cohesion: cohesion.status === 'KNOWN' ? cohesion.value : null,
    stress: stress.status === 'KNOWN' ? stress.value : null,
    durationMinutes: minutesBetween(state.stateEnteredAt, at),
    unknown,
    reason: unknown.length ? 'Обязательные компоненты МПС неизвестны' : undefined,
  };
}

function moraleInputFromProjection(projection: MoraleProjection): MoraleEffectInput {
  if (projection.kind !== 'INSTANCE_ASSESSMENT') {
    return {
      status: 'UNKNOWN',
      morale: null,
      cohesion: null,
      stress: null,
      durationMinutes: 0,
      unknown: ['PRIVATE_ASSESSMENT'],
      reason: 'Системному командиру нужна собственная проекция оценки, а не истина',
    };
  }
  const morale = projection.components.morale;
  const cohesion = projection.components.cohesion;
  const stress = projection.components.stress;
  const unknown = [
    morale.status === 'UNKNOWN' ? 'morale' : null,
    cohesion.status === 'UNKNOWN' ? 'cohesion' : null,
    stress.status === 'UNKNOWN' ? 'stress' : null,
  ].filter((name): name is MoraleComponentName => name !== null);
  return {
    status: unknown.length ? 'UNKNOWN' : 'KNOWN',
    morale: morale.status === 'KNOWN' ? morale.value : null,
    cohesion: cohesion.status === 'KNOWN' ? cohesion.value : null,
    stress: stress.status === 'KNOWN' ? stress.value : null,
    durationMinutes: projection.stateEnteredAt ? minutesBetween(projection.stateEnteredAt, projection.at) : 0,
    unknown,
    reason: unknown.length ? 'Оценка инстанции неполна' : undefined,
  };
}

function validateUnitInput(value: number, title: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${title} должно быть на шкале от 0 до 1`);
}

function capacity(morale: number, cohesion: number, stress: number, profile: MoraleProfile): number {
  const weights = profile.componentWeights;
  return weights.morale * morale + weights.cohesion * cohesion + weights.stress * (1 - stress);
}

/**
 * F_v для задачи. Внешняя утомлённость учитывается один раз в базе;
 * коэффициент МПС использует только morale/cohesion/stress и не повторяет её.
 */
export function applyMoraleToTask(
  input: MoraleTaskInput,
  profile: MoraleProfile = MORALE_PROFILE_V1,
): MoraleTaskResult {
  validateUnitInput(input.readiness, 'Готовность');
  validateUnitInput(input.equipment, 'Техническая обеспеченность');
  validateUnitInput(input.resources, 'Ресурсная обеспеченность');
  validateUnitInput(input.fatigue, 'Внешняя утомлённость');
  if (!Number.isFinite(input.availableMinutes) || input.availableMinutes < 0
    || !Number.isFinite(input.requiredTaskMinutes) || input.requiredTaskMinutes <= 0) {
    throw new Error('Некорректная длительность задачи');
  }
  const unrelatedResource = { ...input.unrelatedResource };
  const baseContributions = {
    readiness: input.readiness,
    equipment: input.equipment,
    resources: input.resources,
    fatigue: -input.fatigue * profile.externalFatigueWeight,
  };
  const unknown = [...(input.morale.unknown ?? [])];
  for (const name of ['morale', 'cohesion', 'stress'] as const) {
    const value = input.morale[name];
    if (value === null || !Number.isFinite(value)) {
      if (!unknown.includes(name)) unknown.push(name);
    } else {
      validateUnitInput(value, `МПС ${name}`);
    }
  }
  if (input.morale.status === 'UNKNOWN' || unknown.length) {
    return {
      status: 'REQUIRES_REVIEW',
      unknown,
      orderProcessingMinutes: null,
      orderDelayMinutes: null,
      readyToStart: false,
      executionScore: null,
      movementRateFactor: null,
      reportDelayMinutes: null,
      taskStatus: 'REQUIRES_REVIEW',
      interruption: { threshold: profile.interruptionThreshold, eligible: false, reason: 'UNKNOWN_MORALE' },
      contributions: { ...baseContributions, morale: null },
      causalChain: CAUSAL_CHAIN,
      finalSituation: { status: 'REQUIRES_REVIEW', progress: null, objectiveHeld: null, unrelatedResource },
    };
  }

  const morale = input.morale.morale!;
  const cohesion = input.morale.cohesion!;
  const stress = input.morale.stress!;
  const capability = capacity(morale, cohesion, stress, profile);
  const orderProcessingMinutes = clamp(
    profile.baseOrderProcessingMinutes + profile.maxAdditionalOrderMinutes * (1 - capability),
    profile.minOrderProcessingMinutes,
    profile.maxOrderProcessingMinutes,
  );
  const orderDelayMinutes = orderProcessingMinutes - profile.baseOrderProcessingMinutes;
  const executionBase = input.readiness * input.equipment * input.resources
    * (1 - input.fatigue * profile.externalFatigueWeight);
  const moraleMultiplier = clamp(
    profile.executionMultiplierBase + profile.executionMultiplierMoraleWeight * capability,
    profile.minExecutionMultiplier,
    profile.maxExecutionMultiplier,
  );
  const executionScore = clamp(executionBase * moraleMultiplier);
  const availableForTask = Math.max(0, input.availableMinutes - orderProcessingMinutes);
  const timeProgress = clamp(availableForTask / input.requiredTaskMinutes);
  const progress = clamp(executionScore * timeProgress);
  const objectiveHeld = executionScore >= profile.interruptionThreshold
    && orderProcessingMinutes + input.requiredTaskMinutes <= input.availableMinutes;
  const eligible = Number.isFinite(input.morale.durationMinutes)
    && input.morale.durationMinutes >= profile.minimumStateMinutes;
  const taskStatus = objectiveHeld
    ? 'EXECUTED'
    : executionScore < profile.interruptionThreshold && eligible
      ? 'INTERRUPTED'
      : 'DELAYED';
  return {
    status: 'CALCULATED',
    unknown: [],
    orderProcessingMinutes,
    orderDelayMinutes,
    readyToStart: executionScore >= profile.startThreshold && orderProcessingMinutes < input.availableMinutes,
    executionScore,
    movementRateFactor: profile.movementFactorBase + profile.movementFactorMoraleWeight * capability,
    reportDelayMinutes: profile.baseReportDelayMinutes + profile.maxAdditionalReportDelayMinutes * (1 - capability),
    taskStatus,
    interruption: {
      threshold: profile.interruptionThreshold,
      eligible,
      reason: taskStatus === 'INTERRUPTED' ? 'MORALE_THRESHOLD_AND_MINIMUM_STATE_DURATION' : 'THRESHOLD_NOT_CROSSED',
    },
    contributions: {
      ...baseContributions,
      morale: executionBase * (moraleMultiplier - 1),
    },
    causalChain: CAUSAL_CHAIN,
    finalSituation: {
      status: 'CALCULATED',
      progress,
      objectiveHeld,
      unrelatedResource,
    },
  };
}

export type CommanderOption = Readonly<{
  optionId: string;
  action: 'CONTINUE_TASK' | 'CONSOLIDATE';
  baseUtility: number;
  demand: 'HIGH' | 'LOW';
  risk: number;
  ordered: boolean;
}>;

export type CommanderPersonality = Readonly<{
  riskPropensity: number;
  persistence: number;
  lossTolerance: number;
  obedience: number;
  source: MoraleSource;
}>;

export type EvaluatedCommanderOption = Readonly<{
  option: CommanderOption;
  adjustedUtility: number;
  moraleContribution: number;
  lossToleranceContribution: number;
}>;

export type SystemCommanderChoice = Readonly<{
  options: readonly EvaluatedCommanderOption[];
}>;

export type SystemCommanderSelection = Readonly<{ selectedOptionId: string | null }>;

/** Единственный путь выбора системного командира после расчёта вклада МПС. */
export interface SystemCommanderPort {
  choose(choice: SystemCommanderChoice): SystemCommanderSelection;
}

export const utilityMaximizingCommanderPort: SystemCommanderPort = Object.freeze({
  choose(choice: SystemCommanderChoice): SystemCommanderSelection {
    const best = [...choice.options].sort((left, right) =>
      right.adjustedUtility - left.adjustedUtility || left.option.optionId.localeCompare(right.option.optionId))[0];
    return { selectedOptionId: best?.option.optionId ?? null };
  },
});

export type SystemCommanderDecision = Readonly<{
  status: 'DECIDED' | 'REQUIRES_REVIEW';
  selectedOptionId: string | null;
  evaluatedOptions: readonly EvaluatedCommanderOption[];
  unknown: readonly string[];
  explanation: string;
}>;

export function decideSystemCommander(input: {
  projection: MoraleProjection;
  options: readonly CommanderOption[];
  commander: CommanderPersonality;
  port: SystemCommanderPort;
}, profile: MoraleProfile = MORALE_PROFILE_V1): SystemCommanderDecision {
  const morale = moraleInputFromProjection(input.projection);
  if (morale.status === 'UNKNOWN' || (morale.unknown?.length ?? 0) > 0) {
    return {
      status: 'REQUIRES_REVIEW',
      selectedOptionId: null,
      evaluatedOptions: [],
      unknown: morale.unknown ?? ['PRIVATE_ASSESSMENT'],
      explanation: morale.reason ?? 'Нет разрешённой оценки МПС',
    };
  }
  for (const [value, title] of [
    [input.commander.riskPropensity, 'Склонность к риску'],
    [input.commander.persistence, 'Настойчивость'],
    [input.commander.lossTolerance, 'Допустимость потерь'],
    [input.commander.obedience, 'Исполнительность'],
  ] as const) validateUnitInput(value, title);

  const effects = profile.commanderEffects;
  const capability = capacity(morale.morale!, morale.cohesion!, morale.stress!, profile);
  const supportDelta = capability - effects.capabilityMidpoint;
  const evaluatedOptions = input.options.map(option => {
    validateUnitInput(option.risk, 'Риск варианта');
    const direction = option.demand === 'HIGH' ? 1 : effects.lowDemandDirection;
    const personalityWeight = effects.baseWeight + input.commander.persistence * effects.persistenceWeight
      + input.commander.obedience * (option.ordered ? effects.obedienceWeight : 0)
      + input.commander.riskPropensity * option.risk * effects.riskWeight;
    const moraleContribution = direction * supportDelta * personalityWeight;
    const lossToleranceContribution = option.demand === 'HIGH'
      ? -(1 - input.commander.lossTolerance) * option.risk * (1 - capability) * effects.lossToleranceWeight
      : 0;
    return {
      option,
      moraleContribution,
      lossToleranceContribution,
      adjustedUtility: option.baseUtility + moraleContribution + lossToleranceContribution,
    };
  });
  const selection = input.port.choose({ options: evaluatedOptions });
  if (selection.selectedOptionId !== null
    && !input.options.some(option => option.optionId === selection.selectedOptionId)) {
    throw new Error('Порт системного командира выбрал неизвестный вариант');
  }
  return {
    status: selection.selectedOptionId === null ? 'REQUIRES_REVIEW' : 'DECIDED',
    selectedOptionId: selection.selectedOptionId,
    evaluatedOptions,
    unknown: selection.selectedOptionId === null ? ['NO_COMMANDER_OPTION'] : [],
    explanation: 'Вариант выбран портом по полезности с раздельными вкладами оценки МПС и характера командира',
  };
}
