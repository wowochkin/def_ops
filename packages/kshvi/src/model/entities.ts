import type {
  DecisionSource,
  ExercisePurpose,
  ExerciseScale,
  InstanceKind,
  InstanceState,
  JsonValue,
  OperationalTime,
  Quantity,
  ScenarioState,
  SideMode,
  SimulationMethod,
  TimeRange,
  UUID,
  Unknown,
  VersionRef,
  WallClockAt,
} from './types';

export type EntityRef = Readonly<{ id: UUID }>;
export type ActorRef = Readonly<{ id: UUID; kind: 'HUMAN' | 'SYSTEM'; assignmentId?: UUID }>;
export type SourceRef = Readonly<{ sourceId: string; revision?: number; sha256?: string; note?: string }>;
export type Visibility = Readonly<{ sideIds: readonly UUID[]; nodeIds: readonly UUID[]; roles: readonly string[] }>;
export type Uncertainty = Readonly<{ status: 'UNKNOWN' | 'PARTIAL' | 'ESTIMATED'; reason: string; observedAt?: OperationalTime }>;

export interface Exercise extends EntityRef {
  title: string;
  purpose: ExercisePurpose;
  customPurpose?: string;
  scale: ExerciseScale;
  scaleProfile: VersionRef;
  method: SimulationMethod;
  ownerId: UUID;
  state: ScenarioState | 'ARCHIVED';
  currentScenarioVersion: VersionRef | null;
  instanceIds: readonly UUID[];
  trainedNodeIds: readonly UUID[];
  sideMode: SideMode;
}

export interface ScenarioVersion extends EntityRef {
  exerciseId: UUID;
  revision: number;
  sha256: string;
  intent: string;
  stages: readonly JsonValue[];
  objectives: readonly JsonValue[];
  commandTree: readonly UUID[];
  forceIds: readonly UUID[];
  documentIds: readonly UUID[];
  inputIds: readonly UUID[];
  playbook: VersionRef | null;
  eventLibrary: VersionRef;
  autonomyProfiles: readonly VersionRef[];
  assessmentCriteria: readonly VersionRef[];
  supersedes: VersionRef | null;
  state: ScenarioState;
}

export interface EnvironmentSnapshot extends EntityRef {
  region: JsonValue;
  atlases: readonly VersionRef[];
  layers: readonly VersionRef[];
  elevations: readonly VersionRef[];
  weather: VersionRef;
  algorithms: readonly VersionRef[];
  attribution: readonly SourceRef[];
  contentHashes: Readonly<Record<string, string>>;
  archiveContent: Readonly<Record<string, JsonValue>>;
  capturedAt: WallClockAt;
  sha256: string;
}

export interface Instance extends EntityRef {
  exerciseId: UUID;
  scenarioVersion: VersionRef;
  kind: InstanceKind;
  participantIds: readonly UUID[];
  roleAssignmentIds: readonly UUID[];
  state: InstanceState;
  wallClockAt: WallClockAt;
  operationalAt: OperationalTime;
  speed: number;
  initialSnapshotId: UUID;
  branchId: UUID;
}

export interface InitialSituationMap extends EntityRef {
  initialAt: OperationalTime;
  environment: VersionRef;
  truthLayers: readonly JsonValue[];
  privateLayers: Readonly<Record<string, readonly JsonValue[]>>;
  forceIds: readonly UUID[];
  operationalGraphics: readonly JsonValue[];
  objectIds: readonly UUID[];
  sources: readonly SourceRef[];
  uncertainties: readonly Uncertainty[];
  authors: readonly ActorRef[];
  validation: JsonValue;
  sha256: string;
}

export interface TerrainState extends EntityRef {
  version: VersionRef;
  effectiveAt: OperationalTime;
  raster: VersionRef | null;
  roads: readonly JsonValue[];
  forests: readonly JsonValue[];
  wetlands: readonly JsonValue[];
  rivers: readonly JsonValue[];
  bridges: readonly JsonValue[];
  crossings: readonly JsonValue[];
  causeIds: readonly UUID[];
  passability: JsonValue;
  capacity: JsonValue;
}

export interface CommandNode extends EntityRef {
  parentId: UUID | null;
  sideId: UUID;
  relation: 'COMMAND' | 'FUNCTIONAL' | 'INTERACTION';
  authorities: readonly string[];
  activePeriod: TimeRange;
  workstationIds: readonly UUID[];
  decisionSource: DecisionSource;
  intermediaryAssignmentIds: readonly UUID[];
}

export interface Force extends EntityRef {
  sideId: UUID;
  ownerNodeId: UUID;
  type: string;
  organizationalLevel: string;
  state: string;
  composition: readonly JsonValue[];
  position: Unknown<JsonValue>;
  route: Unknown<JsonValue>;
  task: Unknown<JsonValue>;
  capabilities: readonly string[];
  uncertainty: Uncertainty | null;
}

export interface ModernKnowledgeImport extends EntityRef {
  sourceRecord: VersionRef;
  scenarioCopyIds: readonly UUID[];
  fieldMapping: Readonly<Record<string, string>>;
  sources: readonly SourceRef[];
  unknownFields: readonly string[];
  reviewStatus: 'IMPORTED' | 'REVIEWED' | 'APPROVED' | 'REJECTED';
}

export interface EquipmentHolding extends EntityRef {
  forceId: UUID;
  equipmentType: string;
  characteristics: VersionRef;
  authorized: Quantity;
  actual: Quantity;
  state: string;
  crew: Quantity;
  resources: readonly JsonValue[];
  distribution: readonly JsonValue[];
  source: SourceRef;
  transitions: readonly JsonValue[];
}

export interface MoralePsychState extends EntityRef {
  forceId: UUID;
  components: Readonly<Record<string, Quantity>>;
  scale: VersionRef;
  measuredAt: OperationalTime;
  uncertainty: Uncertainty | null;
  influences: readonly JsonValue[];
  recovery: readonly JsonValue[];
  taskEffects: readonly JsonValue[];
  privateAssessment: JsonValue;
}

export interface ReadinessState extends EntityRef {
  subjectId: UUID;
  initialLevel: string;
  requiredLevel: string;
  measures: readonly JsonValue[];
  dependencies: readonly UUID[];
  actualDeadlines: readonly OperationalTime[];
  limitations: readonly string[];
  readiness: string;
}

export interface FormationPlan extends EntityRef {
  orderDocumentId: UUID;
  echelons: readonly JsonValue[];
  columns: readonly JsonValue[];
  reserves: readonly JsonValue[];
  areas: readonly JsonValue[];
  boundaries: readonly JsonValue[];
  routes: readonly JsonValue[];
  deadlines: readonly OperationalTime[];
  dependencies: readonly UUID[];
  commandNodeIds: readonly UUID[];
  capacityValidation: JsonValue;
  executionState: string;
}

export interface ResourceLedgerEntry extends EntityRef {
  resourceId: UUID;
  ownerId: UUID;
  quantity: Quantity;
  entryKind: string;
  basis: string;
  operationalAt: OperationalTime;
  causeIds: readonly UUID[];
  idempotencyKey: string;
}

export interface SupplyNode extends EntityRef {
  stocks: readonly ResourceLedgerEntry[];
  capacity: Quantity;
  processing: JsonValue;
  queue: readonly UUID[];
  routeIds: readonly UUID[];
  state: string;
  restoration: readonly JsonValue[];
  visibility: Visibility;
}

export interface SupplyMovement extends EntityRef {
  requestId: UUID;
  orderId: UUID;
  items: readonly ResourceLedgerEntry[];
  transportIds: readonly UUID[];
  loading: JsonValue;
  route: JsonValue;
  senderId: UUID;
  recipientId: UUID;
  transitions: readonly JsonValue[];
  remainingInTransit: readonly Quantity[];
  confirmation: JsonValue;
  deficit: readonly Quantity[];
}

export interface EventTemplate extends EntityRef {
  category: string;
  educationalQuestion: string;
  source: SourceRef;
  preconditions: readonly JsonValue[];
  parameters: readonly JsonValue[];
  weight: number;
  limits: JsonValue;
  cascade: JsonValue;
  effects: readonly JsonValue[];
  version: VersionRef;
}

export interface EventCandidateTrace extends EntityRef {
  interval: TimeRange;
  category: string;
  candidates: readonly JsonValue[];
  rejectionReasons: Readonly<Record<string, string>>;
  weights: Readonly<Record<string, number>>;
  parameters: JsonValue;
  randomKey: JsonValue;
  selectedTemplateId: UUID | null;
  budgets: JsonValue;
  createdEventIds: readonly UUID[];
}

export interface AutonomyProfile extends EntityRef {
  intensities: readonly JsonValue[];
  distributions: readonly JsonValue[];
  limits: JsonValue;
  severity: JsonValue;
  cascades: JsonValue;
  manualApprovalShare: Quantity;
  seed: string;
  version: VersionRef;
}

export interface ElectronicIntermediaryAssignment extends EntityRef {
  systemIdentity: ActorRef;
  nodeIds: readonly UUID[];
  area: JsonValue;
  mode: 'ADVISORY' | 'DELEGATED' | 'AUTONOMOUS';
  projection: VersionRef;
  authorities: readonly string[];
  decisionProfile: VersionRef;
  schedule: JsonValue;
  escalation: JsonValue;
  takeover: JsonValue;
  state: string;
}

export interface AgentDecisionTrace extends EntityRef {
  inputProjection: JsonValue;
  inputHash: string;
  orderId: UUID | null;
  options: readonly JsonValue[];
  scores: readonly JsonValue[];
  selectedOptionId: string | null;
  versions: readonly VersionRef[];
  randomKeys: readonly JsonValue[];
  isolatedForks: readonly JsonValue[];
  commands: readonly JsonValue[];
  explanation: string;
}

export interface Document extends EntityRef {
  type: string;
  requisites: JsonValue;
  content: JsonValue;
  addresseeIds: readonly UUID[];
  visibility: Visibility;
  route: JsonValue;
  revision: number;
  supersedes: VersionRef | null;
  signatures: readonly JsonValue[];
  issuance: JsonValue;
  sha256: string;
}

export interface Input extends EntityRef {
  kind: 'PLANNED' | 'REACTIVE' | 'ADAPTIVE' | 'PROBABILISTIC';
  sourceRole: string;
  schedule: JsonValue;
  trigger: JsonValue;
  addresseeIds: readonly UUID[];
  channelId: UUID;
  state: string;
  authority: JsonValue;
  approval: JsonValue;
}

export interface Channel extends EntityRef {
  nodeIds: readonly UUID[];
  route: JsonValue;
  direction: 'FORWARD' | 'BACKWARD' | 'BIDIRECTIONAL';
  capacity: Quantity;
  delay: Quantity;
  availability: Quantity;
  failureProfile: VersionRef;
  reserveChannelId: UUID | null;
  activePeriod: TimeRange;
}

export interface Message extends EntityRef {
  content: JsonValue;
  documentId: UUID | null;
  senderRole: string;
  addresseeIds: readonly UUID[];
  attempts: readonly JsonValue[];
  route: JsonValue;
  state: string;
  confirmations: readonly JsonValue[];
  domainKey: string;
}

export interface Decision extends EntityRef {
  nodeId: UUID;
  basis: string;
  options: readonly JsonValue[];
  objectives: readonly JsonValue[];
  tasks: readonly JsonValue[];
  resources: readonly JsonValue[];
  deadlines: readonly OperationalTime[];
  assumptions: readonly SourceRef[];
  revisions: readonly VersionRef[];
  documentIds: readonly UUID[];
  executionState: string;
}

export interface Calculation extends EntityRef {
  mode: 'MANUAL' | 'DETERMINISTIC' | 'STOCHASTIC' | 'HYBRID';
  inputHash: string;
  model: VersionRef;
  profiles: readonly VersionRef[];
  inputs: JsonValue;
  randomKeys: readonly JsonValue[];
  result: Unknown<JsonValue>;
  explanation: JsonValue;
  state: string;
  approval: JsonValue;
  appliedEventIds: readonly UUID[];
}

export interface DomainEvent<T = JsonValue> extends EntityRef {
  eventId: UUID;
  instanceId: UUID;
  branchId: UUID;
  sequence: number;
  type: string;
  schemaVersion: number;
  wallClockAt: WallClockAt;
  operationalAt: OperationalTime;
  actor: ActorRef;
  causeIds: readonly UUID[];
  payload: T;
  prevHash: string | null;
  hash: string;
}

export interface Snapshot extends EntityRef {
  branchId: UUID;
  sequence: number;
  stateHash: string;
  versions: readonly VersionRef[];
  environment: VersionRef;
  firstEventSequence: number;
  lastEventSequence: number;
  state: JsonValue;
}

export interface Assessment extends EntityRef {
  criterion: VersionRef;
  subjectId: UUID;
  role: string;
  factEventIds: readonly UUID[];
  automaticMetrics: readonly JsonValue[];
  manualGrade: Unknown<JsonValue>;
  comment: string;
  author: ActorRef;
  approval: JsonValue;
}

export interface ResearchRecord extends EntityRef {
  question: string;
  hypothesis: string;
  method: string;
  variables: readonly JsonValue[];
  responsibleIds: readonly UUID[];
  observations: readonly JsonValue[];
  results: readonly JsonValue[];
  limitations: readonly string[];
  conclusion: string;
}

export interface ExpositionProgram extends EntityRef {
  source: VersionRef;
  chapters: readonly JsonValue[];
  frames: readonly JsonValue[];
  camera: JsonValue;
  layers: readonly string[];
  explanations: readonly JsonValue[];
  audience: Visibility;
  projection: VersionRef;
  demonstrationBranchId: UUID;
}

export interface SymbolSet extends EntityRef {
  version: VersionRef;
  sourceDocuments: readonly SourceRef[];
  coverage: readonly JsonValue[];
  compositionRules: readonly JsonValue[];
  fileHashes: Readonly<Record<string, string>>;
  methodologicalApproval: JsonValue;
}

export interface SymbolDefinition extends EntityRef {
  code: string;
  russianName: string;
  category: string;
  vectorGeometry: JsonValue;
  modifiers: readonly JsonValue[];
  labels: readonly JsonValue[];
  scale: JsonValue;
  source: SourceRef;
  page: number | null;
  sourceNumber: string | null;
  status: 'IMPORTED' | 'MAPPED' | 'VERIFIED' | 'APPROVED' | 'DEPRECATED';
  version: VersionRef;
}

export interface Participant extends EntityRef {
  accountId: UUID;
  displayName: string;
  organizationId: UUID;
  state: 'ACTIVE' | 'BLOCKED' | 'ARCHIVED';
}

export interface RoleAssignment extends EntityRef {
  participantId: UUID;
  nodeId: UUID;
  role: string;
  activePeriod: TimeRange;
  authorities: readonly string[];
  substituteId: UUID | null;
}

export interface ApprovalRequest extends EntityRef {
  kind: 'INPUT' | 'TIME_JUMP' | 'CALCULATION' | 'CHANGE';
  diff: JsonValue;
  consequences: readonly JsonValue[];
  route: JsonValue;
  decision: JsonValue;
  rationale: string;
}

export const MODEL_ENTITY_NAMES = [
  'Exercise', 'ScenarioVersion', 'EnvironmentSnapshot', 'Instance', 'InitialSituationMap',
  'TerrainState', 'CommandNode', 'Force', 'ModernKnowledgeImport', 'EquipmentHolding',
  'MoralePsychState', 'ReadinessState', 'FormationPlan', 'ResourceLedgerEntry', 'SupplyNode',
  'SupplyMovement', 'EventTemplate', 'EventCandidateTrace', 'AutonomyProfile',
  'ElectronicIntermediaryAssignment', 'AgentDecisionTrace', 'Document', 'Input', 'Channel',
  'Message', 'Decision', 'Calculation', 'DomainEvent', 'Snapshot', 'Assessment', 'ResearchRecord',
  'ExpositionProgram', 'SymbolSet', 'SymbolDefinition', 'Participant', 'RoleAssignment', 'ApprovalRequest',
] as const;
