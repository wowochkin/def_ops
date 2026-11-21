export type ReadinessStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'PARTIAL' | 'FAILED';

export type ReadinessLimitationCode =
  | 'SIGNAL_NOT_RECEIVED'
  | 'PERSONNEL_SHORTAGE'
  | 'EQUIPMENT_UNSERVICEABLE'
  | 'SUPPLIES_NOT_REPLENISHED'
  | 'AREA_NOT_OCCUPIED'
  | 'COMMUNICATIONS_UNAVAILABLE'
  | 'DEPENDENCY_NOT_COMPLETED'
  | 'RESOURCE_SHORTAGE'
  | 'RESOURCE_UNKNOWN'
  | 'REPORT_NOT_RECEIVED'
  | 'CRITERION_NOT_MET'
  | 'PRECONDITION_NOT_MET'
  | 'PRECONDITION_UNKNOWN'
  | 'ACTIVITY_NOT_DUE'
  | 'DEADLINE_MISSED'
  | 'LEVEL_UNKNOWN'
  | 'ACTIVITY_FAILED'
  | 'UNKNOWN_ACTIVITY';

export type ReadinessLimitation = Readonly<{
  code: ReadinessLimitationCode;
  activityId?: string;
  since: string;
  details: string;
}>;

export type ReadinessAuthorization = Readonly<{
  decisionId: string;
  actorId: string;
  authorized: boolean;
  basis: string;
  rationale: string;
  at: string;
}>;

export type ReadinessActivityRecord = Readonly<{
  activityId: string;
  status: 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt: string;
  reportId: string | null;
}>;

export type ReadinessReport = Readonly<{
  id: string;
  activityId?: string;
  authorId: string;
  submittedAt: string;
  text: string;
}>;

export type ReadinessHistoryEntry = Readonly<{
  id: string;
  at: string;
  kind: 'SIGNAL_RECEIVED' | 'ACTIVITY_COMPLETED' | 'ACTIVITY_FAILED' | 'PARTIAL_AUTHORIZED';
  causeId: string;
  details: string;
}>;

export type ReadinessState = Readonly<{
  subjectId: string;
  subjectKind: 'FORCE' | 'COMMAND_POST';
  initialLevel: number | null;
  requiredLevel: number | null;
  status: ReadinessStatus;
  actualStartedAt?: string;
  actualCompletedAt?: string;
  signalReceipt?: Readonly<{ signalId: string; receivedAt: string }>;
  completedActivityIds: readonly string[];
  activityRecords: readonly ReadinessActivityRecord[];
  reports: readonly ReadinessReport[];
  criterionResults: Readonly<Record<string, boolean | null>>;
  limitations: readonly ReadinessLimitation[];
  authorizations: readonly ReadinessAuthorization[];
  history: readonly ReadinessHistoryEntry[];
}>;

export type ReadinessEffectRule = Readonly<{
  code: ReadinessLimitationCode;
  orderProcessingDelayMinutes: number;
  capabilityFactor: number;
  movementFactor: number;
  resourceFactor: number;
}>;

export type ReadinessEffectProfile = Readonly<{
  id: string;
  version: number;
  status: 'APPROVED' | 'DRAFT';
  approvedBy?: string;
  rules: readonly ReadinessEffectRule[];
}>;

export type ReadinessTaskEffects = Readonly<{
  orderProcessingDelayMinutes: number | null;
  capabilityFactor: number | null;
  movementFactor: number | null;
  resourceFactor: number | null;
}>;

export type ReadinessTaskCheck = Readonly<{
  allowed: boolean;
  status: 'ALLOWED' | 'BLOCKED' | 'REQUIRES_REVIEW';
  missing: readonly ReadinessLimitationCode[];
  limitations: readonly ReadinessLimitation[];
  effects: ReadinessTaskEffects;
  unknown: readonly string[];
  explanation: readonly string[];
}>;

const unrestricted: ReadinessTaskEffects = {
  orderProcessingDelayMinutes: 0,
  capabilityFactor: 1,
  movementFactor: 1,
  resourceFactor: 1,
};
const unknownEffects: ReadinessTaskEffects = {
  orderProcessingDelayMinutes: null,
  capabilityFactor: null,
  movementFactor: null,
  resourceFactor: null,
};

function round(value: number): number {
  return Number(value.toFixed(12));
}

function calculateEffects(
  missing: readonly ReadinessLimitationCode[],
  profile: ReadinessEffectProfile | undefined,
): Pick<ReadinessTaskCheck, 'effects' | 'unknown' | 'status'> {
  if (!missing.length) return { effects: unrestricted, unknown: [], status: 'ALLOWED' };
  if (!profile || profile.status !== 'APPROVED' || !profile.approvedBy?.trim() || !Number.isSafeInteger(profile.version) || profile.version < 1) {
    return { effects: unknownEffects, unknown: ['profile:notApproved'], status: 'REQUIRES_REVIEW' };
  }
  const unknown: string[] = [];
  let delay = 0;
  let capability = 1;
  let movement = 1;
  let resource = 1;
  for (const code of missing) {
    const rule = profile.rules.find(item => item.code === code);
    if (!rule) {
      unknown.push(`rule:${code}`);
      continue;
    }
    if (![rule.orderProcessingDelayMinutes, rule.capabilityFactor, rule.movementFactor, rule.resourceFactor].every(Number.isFinite)
      || rule.orderProcessingDelayMinutes < 0
      || [rule.capabilityFactor, rule.movementFactor, rule.resourceFactor].some(value => value <= 0)) {
      unknown.push(`rule:${code}:invalid`);
      continue;
    }
    delay += rule.orderProcessingDelayMinutes;
    capability *= rule.capabilityFactor;
    movement *= rule.movementFactor;
    resource *= rule.resourceFactor;
  }
  if (unknown.length) return { effects: unknownEffects, unknown, status: 'REQUIRES_REVIEW' };
  return {
    effects: {
      orderProcessingDelayMinutes: round(delay),
      capabilityFactor: round(capability),
      movementFactor: round(movement),
      resourceFactor: round(resource),
    },
    unknown: [],
    status: 'ALLOWED',
  };
}

/** Проверяет фактическую готовность; организационный SEALED намеренно не повышает её. */
export function assertReadyForTask(input: Readonly<{
  scenarioState: string;
  readiness: ReadinessStatus | ReadinessState;
  missing?: readonly ReadinessLimitationCode[];
  allowPartial: boolean;
  authorization?: ReadinessAuthorization;
  profile?: ReadinessEffectProfile;
}>): ReadinessTaskCheck {
  const rich = typeof input.readiness === 'object' ? input.readiness : null;
  const readiness = rich?.status ?? input.readiness as ReadinessStatus;
  const limitations = rich?.limitations ?? (input.missing ?? []).map(code => ({
    code,
    since: input.authorization?.at ?? '',
    details: 'Незавершённое мероприятие боевой готовности',
  }));
  const missing = [...new Set(input.missing ?? limitations.map(item => item.code))];
  const authorization = input.authorization ?? rich?.authorizations.at(-1);
  const recordedAuthorization = !rich || !!authorization && rich.authorizations.some(item => JSON.stringify(item) === JSON.stringify(authorization));
  const validAuthorization = recordedAuthorization && authorization?.authorized === true
    && authorization.decisionId.trim().length > 0
    && authorization.actorId.trim().length > 0
    && authorization.basis.trim().length > 0
    && authorization.rationale.trim().length > 0;
  const calculated = calculateEffects(missing, input.profile);
  const explanation: string[] = [];
  if (input.scenarioState === 'SEALED' && readiness !== 'READY') explanation.push('SEALED фиксирует сценарий, но не завершает боевую готовность сил');
  if (authorization && validAuthorization) explanation.push(`Разрешение ${authorization.decisionId}: ${authorization.basis}; ограничения сохранены`);

  if (calculated.status === 'REQUIRES_REVIEW' && (readiness === 'READY' || input.allowPartial && validAuthorization)) {
    return { allowed: false, status: 'REQUIRES_REVIEW', missing, limitations, effects: calculated.effects, unknown: calculated.unknown, explanation };
  }
  if (readiness === 'READY' && missing.length === 0) {
    return { allowed: true, status: 'ALLOWED', missing, limitations, effects: unrestricted, unknown: [], explanation };
  }
  const transitionAllowed = readiness === 'PARTIAL' && input.allowPartial && validAuthorization;
  if (!transitionAllowed) {
    return {
      allowed: false,
      status: 'BLOCKED',
      missing,
      limitations,
      effects: missing.length ? calculated.effects : unrestricted,
      unknown: calculated.unknown,
      explanation: [...explanation, 'Нужна завершённая готовность или отдельное решение уполномоченного руководителя'],
    };
  }
  return {
    allowed: true,
    status: 'ALLOWED',
    missing,
    limitations,
    effects: calculated.effects,
    unknown: calculated.unknown,
    explanation: [...explanation, 'Переход разрешён как PARTIAL; последствия применяются к первому приказу'],
  };
}
