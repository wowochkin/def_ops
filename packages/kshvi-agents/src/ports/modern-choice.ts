export const CONTROL_SOURCES = ['HUMAN', 'SCRIPT', 'PLAYBOOK', 'AGENT', 'HYBRID'] as const;
export type ControlSource = typeof CONTROL_SOURCES[number];

export interface ProfileSource {
  era: string;
  kind: 'SOURCE' | 'ASSUMPTION';
  reference: string;
  version: string;
}

export interface ModernAgentProfile {
  id: string;
  version: string;
  source: ProfileSource;
  risk: number;
  persistence: number;
  ambition: number;
  lossTolerance: number;
  obedience: number;
  motives: {
    task: number; rival: number; preserve: number; noEncircle: number; destroy: number; hold: number; save: number;
  };
  weights: { uncertainty: number; losses: number; persistence: number; obedience: number };
  searchDepth: number;
  optionCount: number;
  horizonTicks: number;
  reviewCycleTicks: number;
  initiative: number;
  onInsufficientData: 'CONTINUE_ORDER' | 'HOLD' | 'ESCALATE';
  minAdvanceConfidence: number;
  maxAdvanceStress: number;
  maxAdvanceThreat: number;
  minSupplyFraction: number;
  minMovementFactor: number;
  communicationDelayTicks: number;
}

export interface OwnOrder { id: string; kind: string; issuedTick: number }
export interface Observation {
  id: string;
  observedTick: number;
  strength: number | null;
  confidence: number | null;
  source?: string;
  uncertainty?: number | null;
}
export interface ModernReport { id: string; sender: string; recipient?: string; tick: number; text: string }
export interface OwnForce {
  id: string;
  hqId: string;
  mps: { confidence: number | null; stress: number | null };
  operationalEquipment: number | null;
  totalEquipment: number | null;
}
export interface AgentProjection {
  instanceId: string;
  revision: number;
  agentId: string;
  tick: number;
  ownOrders: readonly OwnOrder[];
  observations: readonly Observation[];
  reports: readonly ModernReport[];
  ownForces: readonly OwnForce[];
  resources: { supplyFraction: number | null };
  terrain: { routeOpen: boolean | null };
  weather: { movementFactor: number | null };
}

export interface ModernChoice {
  id: string;
  kind: 'CONTINUE_ORDER' | 'HOLD' | 'DEFEND' | 'ADVANCE' | 'WITHDRAW' | 'REQUEST_SUPPORT' | 'ESCALATE';
  label: string;
  commandType: string | null;
  contrib?: number[];
  uncertainty?: number;
  losses?: number;
}

export interface AgentEvaluationRequest {
  profile: ModernAgentProfile;
  seed: bigint;
  projection: AgentProjection;
}

export function assertModernAgentProfile(value: unknown): ModernAgentProfile {
  if (!value || typeof value !== 'object') throw new Error('Современный профиль не задан');
  const profile = value as ModernAgentProfile;
  if (profile.source?.era !== 'modern' || !['SOURCE', 'ASSUMPTION'].includes(profile.source.kind)) {
    throw new Error('Нужен современный источник или учебное допущение');
  }
  if (!profile.source.reference?.trim() || !profile.source.version?.trim() || !profile.version) {
    throw new Error('Современный профиль должен иметь версионный источник');
  }
  if (!Number.isInteger(profile.searchDepth) || profile.searchDepth < 1) throw new Error('глубина поиска должна быть положительной');
  if (!Number.isInteger(profile.optionCount) || profile.optionCount < 2) throw new Error('Число вариантов должно быть не меньше двух');
  if (!Number.isInteger(profile.horizonTicks) || profile.horizonTicks < 1) throw new Error('Горизонт должен быть положительным');
  if (!Number.isInteger(profile.reviewCycleTicks) || profile.reviewCycleTicks < 1) throw new Error('Цикл пересмотра должен быть положительным');
  if (!Number.isFinite(profile.initiative) || profile.initiative < 0 || profile.initiative > 1) {
    throw new Error('Инициатива должна быть в диапазоне от нуля до одного');
  }
  if (!['CONTINUE_ORDER', 'HOLD', 'ESCALATE'].includes(profile.onInsufficientData)) {
    throw new Error('Не задано безопасное поведение при недостатке данных');
  }
  return profile;
}

export function defaultControlAssignments(input: {
  trainedLevels: number;
  opponentId: string;
  supportingIds?: readonly string[];
}): readonly { instanceId: string; role: 'OPPONENT' | 'SUPPORTING'; source: ControlSource }[] {
  if (input.trainedLevels !== 1) return [];
  return [
    { instanceId: input.opponentId, role: 'OPPONENT' as const, source: 'AGENT' as const },
    ...(input.supportingIds ?? []).map(instanceId => ({ instanceId, role: 'SUPPORTING' as const, source: 'AGENT' as const })),
  ];
}

export function createEvaluationRequest(input: AgentEvaluationRequest): AgentEvaluationRequest {
  const profile = assertModernAgentProfile(input.profile);
  if (typeof input.seed !== 'bigint' || input.seed < 0n) throw new Error('Зерно должно быть неотрицательным bigint');
  return { profile, seed: input.seed, projection: sanitizeProjection(input.projection) };
}

/** Серверная граница: перечисление полей вместо фильтрации заранее известных «плохих» ключей. */
export function sanitizeProjection(projection: AgentProjection): AgentProjection {
  return {
    instanceId: projection.instanceId,
    revision: projection.revision,
    agentId: projection.agentId,
    tick: projection.tick,
    ownOrders: projection.ownOrders.map(order => ({ id: order.id, kind: order.kind, issuedTick: order.issuedTick })),
    observations: projection.observations.map(observation => ({
      id: observation.id, observedTick: observation.observedTick,
      strength: observation.strength, confidence: observation.confidence,
      ...(observation.source === undefined ? {} : { source: observation.source }),
      ...(observation.uncertainty === undefined ? {} : { uncertainty: observation.uncertainty }),
    })),
    reports: projection.reports.map(report => ({
      id: report.id, sender: report.sender, tick: report.tick, text: report.text,
      ...(report.recipient === undefined ? {} : { recipient: report.recipient }),
    })),
    ownForces: projection.ownForces.map(force => ({
      id: force.id, hqId: force.hqId,
      mps: { confidence: force.mps.confidence, stress: force.mps.stress },
      operationalEquipment: force.operationalEquipment, totalEquipment: force.totalEquipment,
    })),
    resources: { supplyFraction: projection.resources.supplyFraction },
    terrain: { routeOpen: projection.terrain.routeOpen },
    weather: { movementFactor: projection.weather.movementFactor },
  };
}

export type AgentDataRequest = {
  requesterId: string;
  kind: 'OWN_ORDERS' | 'OWN_OBSERVATIONS' | 'OWN_REPORTS' | 'OWN_RESOURCES' |
    'TRAINEE_DRAFTS' | 'FUTURE_INPUTS' | 'OFFICIAL_BENCHMARK' | 'HIDDEN_TRUTH';
};

export function assertAgentDataRequest(request: AgentDataRequest): { allowed: true } {
  const allowedKinds: readonly AgentDataRequest['kind'][] = ['OWN_ORDERS', 'OWN_OBSERVATIONS', 'OWN_REPORTS', 'OWN_RESOURCES'];
  if (!request.requesterId || !allowedKinds.includes(request.kind)) {
    throw new Error('Запрошенные данные агенту недоступны');
  }
  return { allowed: true };
}
