import { initialMapHash, validateInitialMap, type ApprovedInitialMap, type InitialSituationMap } from './initial-map';
import { hashCanonical } from './initial-map-hash';

export const READINESS_AREAS = [
  'CONCEPT', 'ENVIRONMENT_MAP', 'COMMAND_INTERMEDIARIES', 'EQUIPMENT', 'MORALE_READINESS', 'LOGISTICS_FORMATION',
  'AUTONOMY_AGENTS', 'SYMBOL_LIBRARY', 'MODEL_PROFILE', 'COMMUNICATIONS', 'DOCUMENTS', 'ASSESSMENT', 'TECHNICAL_READINESS',
] as const;
export type ReadinessArea = typeof READINESS_AREAS[number];

export const REHEARSAL_CHECKS = [
  'RECIPIENTS', 'CHANNELS', 'QUEUE', 'BRANCHES', 'VISIBILITY', 'DOCUMENTS', 'RECOVERY', 'PRINT_FALLBACK',
  'EVENT_STATISTICS', 'CASCADE_LIMITS', 'INTERMEDIARY_CYCLES', 'OPPONENT', 'MORALE_IMPACT', 'SUPPLY_ROUTES',
] as const;
export type RehearsalCheck = typeof REHEARSAL_CHECKS[number];

export type ScenarioLifecycleState = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SEALED' | 'ACTIVE' | 'PAUSED'
  | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED' | 'ABORTED';
export type InstanceLifecycleState = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABORTED' | 'ARCHIVED';

export type ReadinessConfirmation = Readonly<{
  id: string;
  area: ReadinessArea;
  userId: string;
  role: string;
  confirmedAt: string;
  subjectHash: string;
  dependsOn: readonly ReadinessArea[];
}>;
export type RehearsalReport = Readonly<{
  schemaVersion: 1;
  id: string;
  scenarioSha256: string;
  full: boolean;
  isolated: boolean;
  status: 'PASSED' | 'FAILED';
  eventLogId: string;
  officialEventLogId: string;
  checks: Readonly<Record<string, boolean>>;
}>;
export type SealValidationIssue = Readonly<{
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  area?: string;
  message?: string;
  waivable?: boolean;
}>;
export type SealWarningAcceptance = Readonly<{
  code: string;
  authorId: string;
  reason: string;
  expiresAt: string;
  scope: string;
}>;

export type SealScenarioInput = {
  id?: string;
  revision?: number;
  state: ScenarioLifecycleState | string;
  scenario?: unknown;
  issues?: SealValidationIssue[];
  requiredConfirmations: readonly string[];
  confirmations: ReadinessConfirmation[];
  confirmationSubjects?: Record<string, string>;
  warningAcceptances?: SealWarningAcceptance[];
  rehearsal?: RehearsalReport;
  initialMap?: ApprovedInitialMap;
  environmentSnapshot?: Readonly<{ manifestSha256: string; contentRef: string | null; autonomous: boolean }>;
  expectedEnvironmentSha256?: string;
  officialEventLogId?: string;
  hashes?: Partial<Record<'weather' | 'elevation' | 'symbols' | 'agents' | 'eventLibrary' | 'models' | 'roles' | 'communications' | 'documents' | 'rehearsal', string>>;
  sealedAt?: string;
};
export type SealedScenario = Readonly<{
  schemaVersion: 1;
  id: string;
  revision: number;
  state: 'SEALED';
  scenario: unknown;
  scenarioSha256: string;
  initialMap: ApprovedInitialMap;
  environmentSnapshot: Readonly<{ manifestSha256: string; contentRef: string | null; autonomous: boolean }>;
  hashes: Readonly<Record<string, string>>;
  confirmations: readonly ReadinessConfirmation[];
  rehearsal: RehearsalReport;
  rehearsalSha256: string;
  sealedAt: string;
}>;

export const SEALING_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'kshvi/sealed-scenario-v1.schema.json',
  type: 'object',
  required: ['schemaVersion', 'id', 'revision', 'state', 'scenarioSha256', 'hashes', 'rehearsal', 'confirmations', 'initialMap', 'environmentSnapshot'],
  properties: {
    schemaVersion: { const: 1 },
    state: { const: 'SEALED' },
    scenarioSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    hashes: { type: 'object', required: ['environment', 'initialMap', 'weather', 'elevation', 'symbols', 'agents', 'eventLibrary', 'models', 'roles', 'communications', 'documents', 'rehearsal'] },
    rehearsal: { type: 'object', required: ['scenarioSha256', 'full', 'isolated', 'status', 'checks'] },
    confirmations: { type: 'array', items: { type: 'object', required: ['area', 'userId', 'role', 'confirmedAt', 'subjectHash'] } },
  },
} as const;

export const SEALING_COMMAND_SCHEMAS = {
  seal: { type: 'object', required: ['expectedRevision', 'confirmations', 'rehearsal'], properties: { expectedRevision: { type: 'integer', minimum: 1 } } },
  start: { type: 'object', required: ['instanceId', 'idempotencyKey', 'seed'], properties: { instanceId: { type: 'string', minLength: 1 }, idempotencyKey: { type: 'string', minLength: 1 }, seed: { type: 'string', minLength: 1 } } },
  transition: { type: 'object', required: ['command', 'expectedRevision'], properties: { command: { enum: ['PAUSE', 'RESUME', 'COMPLETE', 'ABORT', 'ARCHIVE'] } } },
} as const;

const SHA256 = /^[0-9a-f]{64}$/;
const REQUIRED_HASHES = ['weather', 'elevation', 'symbols', 'agents', 'eventLibrary', 'models', 'roles', 'communications', 'documents', 'rehearsal'] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function validateWarnings(input: SealScenarioInput): void {
  for (const issue of input.issues ?? []) {
    if (issue.severity !== 'WARNING') continue;
    const nonWaivable = issue.waivable === false || issue.area === 'VISIBILITY' || /(?:VISIBILITY|SECRET|HASH|ENVIRONMENT|SNAPSHOT)/.test(issue.code);
    if (nonWaivable) throw new Error('NOT_WAIVABLE');
    const acceptance = input.warningAcceptances?.find(item => item.code === issue.code);
    if (!acceptance || !acceptance.authorId.trim() || !acceptance.reason.trim() || !acceptance.expiresAt.trim() || !acceptance.scope.trim()) {
      throw new Error('WARNING_ACCEPTANCE');
    }
    const expires = Date.parse(acceptance.expiresAt);
    const sealedAt = Date.parse(input.sealedAt ?? '');
    if (!Number.isFinite(expires) || !Number.isFinite(sealedAt) || expires <= sealedAt) throw new Error('WARNING_ACCEPTANCE_EXPIRED');
  }
}

function validateConfirmations(input: SealScenarioInput): void {
  for (const area of READINESS_AREAS) {
    const confirmation = input.confirmations.find(item => item.area === area);
    if (!confirmation) throw new Error(`CONFIRMATION_REQUIRED:${area}`);
    const subjectHash = input.confirmationSubjects?.[area];
    if (!confirmation.id.trim() || !confirmation.userId.trim() || !confirmation.role.trim() || !Number.isFinite(Date.parse(confirmation.confirmedAt))
      || !SHA256.test(confirmation.subjectHash) || confirmation.subjectHash !== subjectHash) {
      throw new Error(`PERSONAL_CONFIRMATION_INVALID:${area}`);
    }
  }
  const required = new Set<string>(READINESS_AREAS);
  for (const confirmation of input.confirmations) {
    if (!required.has(confirmation.area)) throw new Error(`UNEXPECTED_CONFIRMATION:${confirmation.area}`);
  }
}

function validateRehearsal(report: RehearsalReport | undefined, scenarioSha256: string, officialEventLogId: string | undefined): asserts report is RehearsalReport {
  if (!report?.full || !report.isolated) throw new Error('REHEARSAL_REQUIRED');
  if (!officialEventLogId || report.eventLogId === officialEventLogId || report.officialEventLogId !== officialEventLogId) throw new Error('REHEARSAL_ISOLATION_REQUIRED');
  if (report.scenarioSha256 !== scenarioSha256) throw new Error('REHEARSAL_SCENARIO_HASH');
  if (report.status !== 'PASSED' || REHEARSAL_CHECKS.some(check => report.checks[check] !== true)) throw new Error('REHEARSAL_CHECKS');
}

export function sealScenario(input: SealScenarioInput): SealedScenario {
  if (input.state !== 'APPROVED') throw new Error('APPROVED_REQUIRED');
  const errors = (input.issues ?? []).filter(issue => issue.severity === 'ERROR');
  if (errors.length) throw new Error(errors.map(issue => issue.code).join(', '));
  if (!input.sealedAt || !Number.isFinite(Date.parse(input.sealedAt))) throw new Error('SEALED_TIME_REQUIRED');
  validateWarnings(input);
  validateConfirmations(input);
  if (input.scenario === undefined || !input.id?.trim() || !Number.isSafeInteger(input.revision) || (input.revision ?? 0) < 1) throw new Error('SCENARIO_REQUIRED');
  const scenarioSha256 = hashCanonical(input.scenario);
  if (!input.initialMap || input.initialMap.state !== 'APPROVED') throw new Error('INITIAL_MAP_NOT_APPROVED');
  if (input.initialMap.sha256 !== initialMapHash(input.initialMap)) throw new Error('INITIAL_MAP_HASH_INVALID');
  const mapErrors = validateInitialMap(input.initialMap).filter(issue => issue.severity === 'ERROR');
  if (mapErrors.length) throw new Error(mapErrors.map(issue => issue.code).join(', '));
  if (!input.environmentSnapshot?.autonomous || !input.environmentSnapshot.contentRef) throw new Error('ENVIRONMENT_SNAPSHOT_REQUIRED');
  if (!SHA256.test(input.environmentSnapshot.manifestSha256) || input.environmentSnapshot.manifestSha256 !== input.expectedEnvironmentSha256) {
    throw new Error('ENVIRONMENT_HASH_INVALID');
  }
  validateRehearsal(input.rehearsal, scenarioSha256, input.officialEventLogId);
  const hashes: Record<string, string> = {
    environment: input.environmentSnapshot.manifestSha256,
    initialMap: input.initialMap.sha256,
  };
  for (const key of REQUIRED_HASHES) {
    const value = input.hashes?.[key];
    if (!value || !SHA256.test(value)) throw new Error(`HASH_REQUIRED:${key}`);
    hashes[key] = value;
  }
  return deepFreeze({
    schemaVersion: 1 as const,
    id: input.id,
    revision: input.revision!,
    state: 'SEALED' as const,
    scenario: clone(input.scenario),
    scenarioSha256,
    initialMap: input.initialMap,
    environmentSnapshot: clone(input.environmentSnapshot),
    hashes,
    confirmations: clone(input.confirmations),
    rehearsal: clone(input.rehearsal),
    rehearsalSha256: hashCanonical(input.rehearsal),
    sealedAt: input.sealedAt ?? '',
  });
}

export type RehearsalInput<T> = Readonly<{
  scenario: T;
  officialEventLogId: string;
  rehearsalId: string;
  eventLogId: string;
}>;
export type RehearsalRunResult = Readonly<{
  status: 'PASSED' | 'FAILED';
  eventLogId: string;
  checks: Readonly<Record<string, boolean>>;
}>;

export async function runRehearsal<T>(
  input: RehearsalInput<T>,
  runner: (isolated: { scenario: T; mode: 'REHEARSAL'; eventLogId: string }) => Promise<RehearsalRunResult>,
): Promise<RehearsalReport> {
  if (!input.officialEventLogId || !input.eventLogId || input.officialEventLogId === input.eventLogId) throw new Error('REHEARSAL_ISOLATION_REQUIRED');
  const isolated = { scenario: clone(input.scenario), mode: 'REHEARSAL' as const, eventLogId: input.eventLogId };
  const result = await runner(isolated);
  if (result.eventLogId !== input.eventLogId || result.eventLogId === input.officialEventLogId) throw new Error('REHEARSAL_ISOLATION_REQUIRED');
  return deepFreeze({
    schemaVersion: 1 as const,
    id: input.rehearsalId,
    scenarioSha256: hashCanonical(input.scenario),
    full: REHEARSAL_CHECKS.every(check => typeof result.checks[check] === 'boolean'),
    isolated: true,
    status: result.status,
    eventLogId: result.eventLogId,
    officialEventLogId: input.officialEventLogId,
    checks: clone(result.checks),
  });
}

export type InitialWorld = Readonly<{
  schemaVersion: 1;
  scenarioId: string;
  scenarioRevision: number;
  state: 'SEALED';
  scenarioSha256: string;
  initialMapSha256: string;
  environmentSnapshotSha256: string;
  initialMapLayers: InitialSituationMap['layers'];
  events: readonly never[];
}>;

function assertSealedIntegrity(sealed: Omit<SealedScenario, 'state'> & Readonly<{ state: string }>): void {
  if (hashCanonical(sealed.scenario) !== sealed.scenarioSha256) throw new Error('SCENARIO_HASH_INVALID');
  if (sealed.initialMap.sha256 !== initialMapHash(sealed.initialMap) || sealed.hashes.initialMap !== sealed.initialMap.sha256) {
    throw new Error('INITIAL_MAP_HASH_INVALID');
  }
  if (sealed.environmentSnapshot.manifestSha256 !== sealed.hashes.environment || !SHA256.test(sealed.hashes.environment)) {
    throw new Error('ENVIRONMENT_HASH_INVALID');
  }
  for (const key of REQUIRED_HASHES) if (!SHA256.test(sealed.hashes[key])) throw new Error(`HASH_REQUIRED:${key}`);
}

export function createInitialWorld(sealed: SealedScenario): InitialWorld {
  assertSealedIntegrity(sealed);
  return deepFreeze({
    schemaVersion: 1 as const,
    scenarioId: sealed.id,
    scenarioRevision: sealed.revision,
    state: 'SEALED' as const,
    scenarioSha256: sealed.scenarioSha256,
    initialMapSha256: sealed.initialMap.sha256,
    environmentSnapshotSha256: sealed.hashes.environment,
    initialMapLayers: clone(sealed.initialMap.layers),
    events: [],
  });
}

export type AutonomousArchive = Readonly<{
  schemaVersion: 1;
  sealedScenario: SealedScenario;
  initialWorld: InitialWorld;
  initialMap: ApprovedInitialMap;
  environmentSnapshot: SealedScenario['environmentSnapshot'];
  hashes: Readonly<Record<string, string>>;
  sha256: string;
}>;

export function createAutonomousArchive(sealed: SealedScenario): AutonomousArchive {
  const content = {
    schemaVersion: 1 as const,
    sealedScenario: clone(sealed),
    initialWorld: createInitialWorld(sealed),
    initialMap: clone(sealed.initialMap),
    environmentSnapshot: clone(sealed.environmentSnapshot),
    hashes: clone(sealed.hashes),
  };
  return deepFreeze({ ...content, sha256: hashCanonical(content) });
}

export type ReadinessInvalidation = Readonly<{
  validConfirmations: readonly ReadinessConfirmation[];
  staleConfirmationIds: readonly string[];
  checksToRerun: readonly ReadinessArea[];
  requiresFullRehearsal: true;
}>;

export function invalidateReadiness(confirmations: readonly ReadinessConfirmation[], change: Readonly<{ changedAreas: readonly ReadinessArea[] }>): ReadinessInvalidation {
  const changed = new Set(change.changedAreas);
  const stale = confirmations.filter(item => changed.has(item.area) || item.dependsOn.some(area => changed.has(area)));
  const staleIds = new Set(stale.map(item => item.id));
  const checks = new Set<ReadinessArea>(change.changedAreas);
  for (const item of stale) checks.add(item.area);
  return deepFreeze({
    validConfirmations: confirmations.filter(item => !staleIds.has(item.id)),
    staleConfirmationIds: stale.map(item => item.id),
    checksToRerun: [...checks],
    requiresFullRehearsal: true as const,
  });
}

export type RevisedScenario = Readonly<{
  id: string;
  revision: number;
  state: 'DRAFT';
  scenario: unknown;
  confirmations: readonly ReadinessConfirmation[];
  rehearsal: null;
  previousSealSha256: string;
}>;

export function reviseSealedScenario(sealed: SealedScenario, scenario: unknown, change: Readonly<{ changedAreas: readonly ReadinessArea[] }>): RevisedScenario {
  const invalidated = invalidateReadiness(sealed.confirmations, change);
  return deepFreeze({
    id: sealed.id,
    revision: sealed.revision + 1,
    state: 'DRAFT' as const,
    scenario: clone(scenario),
    confirmations: invalidated.validConfirmations,
    rehearsal: null,
    previousSealSha256: sealed.scenarioSha256,
  });
}

export type LifecycleCommand = 'SUBMIT' | 'APPROVE' | 'SEAL' | 'CANCEL' | 'PAUSE' | 'RESUME' | 'COMPLETE' | 'ABORT' | 'ARCHIVE';
export type LifecycleContext = Readonly<{
  serverCommand: boolean;
  role: string;
  sealedArtifact?: boolean;
  reason?: string;
}>;

export function transitionLifecycle(state: ScenarioLifecycleState, command: LifecycleCommand, context: LifecycleContext): ScenarioLifecycleState {
  if (!context.serverCommand) throw new Error('SERVER_COMMAND_REQUIRED');
  let next: ScenarioLifecycleState | null = null;
  if (command === 'SUBMIT' && state === 'DRAFT' && context.role === 'AUTHOR') next = 'IN_REVIEW';
  if (command === 'APPROVE' && state === 'IN_REVIEW' && context.role === 'APPROVER') next = 'APPROVED';
  if (command === 'SEAL' && state === 'APPROVED' && context.role === 'DIRECTOR' && context.sealedArtifact) next = 'SEALED';
  if (command === 'CANCEL' && ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED'].includes(state) && context.role === 'DIRECTOR') next = 'CANCELLED';
  if (command === 'PAUSE' && state === 'ACTIVE' && context.role === 'DIRECTOR') next = 'PAUSED';
  if (command === 'RESUME' && state === 'PAUSED' && context.role === 'DIRECTOR') next = 'ACTIVE';
  if (command === 'COMPLETE' && (state === 'ACTIVE' || state === 'PAUSED') && context.role === 'DIRECTOR') next = 'COMPLETED';
  if (command === 'ABORT' && (state === 'ACTIVE' || state === 'PAUSED') && context.role === 'DIRECTOR' && context.reason?.trim()) next = 'ABORTED';
  if (command === 'ARCHIVE' && (state === 'COMPLETED' || state === 'ABORTED') && context.role === 'ARCHIVIST') next = 'ARCHIVED';
  if (!next) throw new Error('TRANSITION_FORBIDDEN');
  return next;
}

export type ExerciseInstance = Readonly<{
  schemaVersion: 1;
  id: string;
  scenarioId: string;
  scenarioRevision: number;
  scenarioSha256: string;
  state: InstanceLifecycleState;
  seed: string;
  eventLogId: string;
  events: readonly unknown[];
  idempotencyKey: string;
  abnormalTermination: boolean;
  abortReason?: string;
}>;
export type StartInstanceCommand = Readonly<{
  instanceId: string;
  idempotencyKey: string;
  seed: string;
  actorRole: string;
  serverCommand: boolean;
}>;
export type InstanceRegistry = Readonly<{
  count: number;
  get(key: string): ExerciseInstance | undefined;
  put(key: string, instance: ExerciseInstance): void;
}>;

export function createInstanceRegistry(): InstanceRegistry {
  const instances = new Map<string, ExerciseInstance>();
  return {
    get count() { return instances.size; },
    get(key: string) { return instances.get(key); },
    put(key: string, instance: ExerciseInstance) { instances.set(key, instance); },
  };
}

export function startInstance(
  sealed: Omit<SealedScenario, 'state'> & Readonly<{ state: string }>,
  command: StartInstanceCommand,
  registry: InstanceRegistry,
): ExerciseInstance {
  if (!command.serverCommand) throw new Error('SERVER_COMMAND_REQUIRED');
  if (command.actorRole !== 'DIRECTOR') throw new Error('TRANSITION_FORBIDDEN');
  if (sealed.state !== 'SEALED') throw new Error('SEALED_REQUIRED');
  assertSealedIntegrity(sealed);
  if (!command.instanceId.trim() || !command.idempotencyKey.trim() || !command.seed.trim()) throw new Error('START_COMMAND_INVALID');
  const key = `${sealed.scenarioSha256}:${command.idempotencyKey}`;
  const existing = registry.get(key);
  if (existing) {
    if (existing.id !== command.instanceId || existing.seed !== command.seed) throw new Error('IDEMPOTENCY_CONFLICT');
    return existing;
  }
  const instance = deepFreeze({
    schemaVersion: 1 as const,
    id: command.instanceId,
    scenarioId: sealed.id,
    scenarioRevision: sealed.revision,
    scenarioSha256: sealed.scenarioSha256,
    state: 'ACTIVE' as const,
    seed: command.seed,
    eventLogId: `events-${command.instanceId}`,
    events: [],
    idempotencyKey: command.idempotencyKey,
    abnormalTermination: false,
  });
  registry.put(key, instance);
  return instance;
}

export function transitionInstance(instance: ExerciseInstance, command: Extract<LifecycleCommand, 'PAUSE' | 'RESUME' | 'COMPLETE' | 'ABORT' | 'ARCHIVE'>, context: LifecycleContext): ExerciseInstance {
  const state = transitionLifecycle(instance.state, command, context) as InstanceLifecycleState;
  return deepFreeze({
    ...instance,
    state,
    ...(command === 'ABORT' ? { abnormalTermination: true, abortReason: context.reason } : {}),
  });
}
