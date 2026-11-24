import type { OrderPanelModel } from '../OrdersPanel';

export type WorkspaceStatus = 'LOADING' | 'EMPTY' | 'FORBIDDEN' | 'NO_DATA' | 'STALE' | 'PARTIAL_FAILURE' | 'UNAVAILABLE';
export type ProjectionStatus = 'READY' | WorkspaceStatus;
export type DecisionStatus = 'DRAFT' | 'ACCEPTED' | 'DELIVERED' | 'EXECUTING' | 'COMPLETED';
export type ConductEvent = {
  id: string;
  title: string;
  operationalAt: string;
  geometry: string;
  document: string;
  calculation: string;
  state: string;
  nodeId?: string;
  cause?: string;
};
export type DecisionEditorDraft = {
  id: string;
  status: DecisionStatus;
  intent: string;
  completedElements: readonly string[];
  goals: string;
  tasks: string;
  resources: string;
  deadlines: string;
  coordination: string;
  reserves: string;
  transitionConditions: string;
  assumptions: string;
};
export type ForceStateModel = {
  equipment: { fact: number; staff: number; serviceable: number | null; reserve: number | null };
  mps: { moral: number | null; psychological: number | null; reported: boolean; history: readonly string[] };
  readiness: readonly string[];
  formation: readonly string[];
  logistics: { summary: string; deficit: number | null; calculationFactor: string };
};
export type MassOperationResult = { objectId: string; status: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'APPLIED' | 'REJECTED'; message: string };
export type ConductProjection = {
  instanceId: string;
  sideId: string;
  role: string;
  status: ProjectionStatus;
  officialOperationalAt: string;
  wallClockAt: string;
  speed: string;
  connection: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED';
  lastServerSyncAt: string;
  live: { geometry: string; document: string; calculation: string; state: string };
  events: readonly ConductEvent[];
  decision: DecisionEditorDraft;
  order: OrderPanelModel | null;
  assignedNodeIds: readonly string[];
  force: ForceStateModel;
  massOperation: { objects: readonly { id: string }[] };
  canReadTruth: boolean;
  projectorTitle?: string;
  leader?: { stage: string; trainingQuestions: string; deviations: string; approvalQueue: string; stateSummary: string; goalSummary: string };
  playgroup?: { queue: string; buildup: string; tree: string; causal: string };
};
export type ConductNotification = {
  id: string;
  groupId: string;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL';
  recipient: string;
  dueAt: string;
  text: string;
  acknowledged: boolean;
};
export type ConductCommands = {
  saveDecision(draft: DecisionEditorDraft): Promise<DecisionEditorDraft>;
  transitionDecision(input: { decisionId: string; from: DecisionStatus; to: DecisionStatus; draft: DecisionEditorDraft }): Promise<DecisionEditorDraft>;
  cancelOrder(input: { orderId: string; reason: string }): Promise<OrderPanelModel>;
  previewInputs(input: { objectIds: readonly string[]; reason: string }): Promise<readonly MassOperationResult[]>;
  applyInputs(input: { objectIds: readonly string[]; reason: string }): Promise<readonly MassOperationResult[]>;
  executeCritical(command: 'PAUSE' | 'JUMP' | 'PRIVATE_STOP' | 'GENERAL_STOP' | 'COMPLETE'): Promise<string>;
  saveConclusion(input: { text: string; evidenceIds: readonly string[] }): Promise<readonly string[]>;
  loadPerspective(perspective: 'PARTICIPANT' | 'TRUTH'): Promise<ConductProjection>;
};
export type Audience = 'GENERAL_SERVICE' | 'SIDE' | 'TRAINEE' | 'PUBLIC_FINAL';
export type ConductClient = ConductCommands & {
  loadProjection(context: { instanceId: string; sideId: string; role: string; operationalAt?: string }): Promise<ConductProjection>;
  checkAudience(audience: Audience): Promise<{ allowed: boolean; reason: string }>;
  loadAudienceProjection(audience: Audience): Promise<ConductProjection>;
};
