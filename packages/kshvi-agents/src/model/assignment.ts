export type AgentMode = 'ADVISORY' | 'DELEGATED' | 'AUTONOMOUS';
export type AssignmentStatus = 'ACTIVE' | 'INTERCEPTED' | 'PAUSED';

export type SystemActor = Readonly<{
  kind: 'system';
  id: string;
  assignmentId: string;
}>;

export type IntermediaryBinding = Readonly<{
  instanceId: string;
  sectorIds: readonly string[];
}>;

export type AgentProjectionPolicy = Readonly<{
  projectionId: string;
  sideIds: readonly string[];
  sectorIds: readonly string[];
}>;

export type ModernDecisionProfile = Readonly<{
  profileId: string;
  version: string;
  era: 'modern';
  source: Readonly<{
    kind: 'SOURCE' | 'ASSUMPTION';
    reference: string;
  }>;
  maxOptions: number;
  riskLimit: number;
  severityLimit: number;
}>;

export type AgentSchedule = Readonly<{
  everyMs: number;
  timeBudgetMs: number;
  nextWakeAt?: string;
}>;

export type EscalationPolicy = Readonly<{
  recipients: readonly string[];
  requiredData: readonly string[];
}>;

export type ElectronicIntermediaryAssignment = Readonly<{
  assignmentId: string;
  exerciseId: string;
  actor: SystemActor;
  mode: AgentMode;
  status: AssignmentStatus;
  version: number;
  bindings: readonly IntermediaryBinding[];
  roles: readonly ('INTERMEDIARY' | 'PLAYGROUP' | 'LEADER')[];
  projection: AgentProjectionPolicy;
  allowedActions: readonly string[];
  modernProfile: ModernDecisionProfile;
  schedule: AgentSchedule;
  escalation: EscalationPolicy;
}>;

export type ElectronicIntermediaryAssignmentInput = Omit<ElectronicIntermediaryAssignment, 'actor' | 'mode' | 'status' | 'version'> & {
  mode?: AgentMode;
  status?: AssignmentStatus;
  version?: number;
};

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`Не задан ${name}`);
  return value;
}

export function createElectronicIntermediaryAssignment(
  input: ElectronicIntermediaryAssignmentInput,
): ElectronicIntermediaryAssignment {
  required(input.assignmentId, 'идентификатор назначения');
  required(input.exerciseId, 'идентификатор учения');
  if (input.bindings.length === 0) throw new Error('Назначению нужна хотя бы одна инстанция');
  if (input.schedule.everyMs <= 0 || input.schedule.timeBudgetMs <= 0) {
    throw new Error('Расписание и тайм-бюджет должны быть положительными');
  }
  if (input.modernProfile.era !== 'modern') throw new Error('Профиль посредника должен быть современным');
  return {
    ...input,
    actor: { kind: 'system', id: input.assignmentId, assignmentId: input.assignmentId },
    mode: input.mode ?? 'DELEGATED',
    status: input.status ?? 'ACTIVE',
    version: input.version ?? 1,
    bindings: input.bindings.map(binding => ({ ...binding, sectorIds: [...binding.sectorIds] })),
    roles: [...input.roles],
    projection: {
      ...input.projection,
      sideIds: [...input.projection.sideIds],
      sectorIds: [...input.projection.sectorIds],
    },
    allowedActions: [...input.allowedActions],
    escalation: {
      ...input.escalation,
      recipients: [...input.escalation.recipients],
      requiredData: [...input.escalation.requiredData],
    },
  };
}
