export const REPLAY_DOMAINS = [
  'Map', 'Weather', 'Resources', 'Tasks', 'Documents', 'Communications', 'Decisions', 'Assessments',
  'MoralePsych', 'Readiness', 'Equipment', 'ReadinessActivities', 'Formation', 'SupplyRequests',
  'SupplyMovements', 'RepairEvacuation', 'TerrainVersions', 'SchedulerAttempts', 'AgentCycles',
  'AgentInterceptions', 'Observations', 'EventFeed',
] as const;

export const REPLAY_FACT_TYPES = [
  'command.accepted', 'command.rejected', 'world.event', 'input', 'observation', 'document.revision',
  'view.confirmation', 'message.delivery', 'decision', 'calculation', 'random.key', 'manual.intervention',
  'time.change', 'admin.access', 'technical.failure', 'scheduler.attempt', 'agent.cycle', 'agent.interception',
] as const;

export type ReplayDomain = typeof REPLAY_DOMAINS[number];
export type ReplayFactType = typeof REPLAY_FACT_TYPES[number];
export type ReplayVersionRef = { id: string; revision: number; sha256: string };
export type ReplayDomains = Record<string, unknown>;

export type ReplayChange = { domain: ReplayDomain; value: unknown };
export type ReplaySavedTrace = {
  schedulerAttempts: readonly {
    candidates: readonly string[];
    selected: string;
    randomKey: ReplayRandomKey | null;
  }[];
  agentDecision?: {
    cycle: number;
    intercepted: boolean;
    selected: string;
    explanation: string;
  };
};
export type ReplayRandomKey = {
  seed: string;
  purpose: string;
  ordinal: number;
  algorithmVersion: number;
};
export type ReplayEvent = {
  eventId: string;
  branchId: string;
  sequence: number;
  type: string;
  operationalAt: string;
  wallClockAt: string;
  payload: Record<string, unknown>;
  causeIds?: readonly string[];
  changes?: readonly ReplayChange[];
  reducerVersion?: number;
  randomKey?: ReplayRandomKey | null;
  savedTrace?: ReplaySavedTrace;
};
export type ReplayState = {
  domains: ReplayDomains;
  appliedEventIds: readonly string[];
  eventCauses: Readonly<Record<string, readonly string[]>>;
};
export type ReplaySnapshot = {
  snapshotId: string;
  branchId: string;
  sequence: number;
  operationalAt: string;
  wallClockAt: string;
  reducerVersion: number;
  state: ReplayState;
  stateHash?: string;
};
export type ReplayControlPoint = { sequence: number; stateHash: string };
export type ReplayArchive = {
  archiveId: string;
  schemaVersion: number;
  branchId: string;
  versions: {
    model: ReplayVersionRef;
    environment: ReplayVersionRef;
    reducerVersion: number;
  };
  snapshots: ReplaySnapshot[];
  events: ReplayEvent[];
  controlPoints?: ReplayControlPoint[];
};
export type ReplayCursor = { branchId?: string; sequence: number };
export type ReplayClock = {
  operationalAt: string;
  wallClockAt: string;
  playbackSpeed: number;
};
export type ReplayPanel = {
  sequence: number;
  source: 'TRUTH' | 'PARTICIPANT';
  value: unknown;
};
export type ReplayCompatibility = 'REPRODUCIBLE' | 'INCOMPATIBLE_READ';
export type ReplayFrame = {
  archiveId: string;
  branchId: string;
  requestedSequence: number;
  sequence: number;
  snapshotId: string | null;
  appliedEventIds: readonly string[];
  state: ReplayState;
  stateHash: string | null;
  identityClaimed: boolean;
  compatibility: ReplayCompatibility;
  perspective: 'TRUTH';
  source: 'TRUTH';
  label: 'Истинное состояние';
  clock: ReplayClock;
  panels: Record<string, ReplayPanel>;
  events: readonly ReplayEvent[];
  traces: readonly ReplaySavedTrace[];
};
export type ReplayActor = { role: string; authorities: readonly string[] };
export type ReplayPerspective = 'PARTICIPANT' | 'TRUTH';
