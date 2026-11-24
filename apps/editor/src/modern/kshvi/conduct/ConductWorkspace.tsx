import { useEffect, useState } from 'react';
import { AnalystWorkspace } from './AnalystWorkspace';
import { LegacyConductWorkspace } from './LegacyConductWorkspace';
import { IntermediaryWorkspace } from './IntermediaryWorkspace';
import { LeaderWorkspace } from './LeaderWorkspace';
import { PlaygroupWorkspace } from './PlaygroupWorkspace';
import { ProjectorWorkspace } from './ProjectorWorkspace';
import { TechnicalAdminWorkspace } from './TechnicalAdminWorkspace';
import { TraineeWorkspace } from './TraineeWorkspace';
import { WorkspaceState } from './shared/WorkspaceState';
import type { ConductClient, ConductCommands, ConductProjection, WorkspaceStatus } from './shared/types';
import { overviewProjection } from './shared/overviewProjection';
import { AutonomyMonitor } from './AutonomyMonitor';
import { AgentAssignmentPanel } from './AgentAssignmentPanel';
import { AgentDecisionTraceView } from './AgentDecisionTraceView';
import { InterventionDialog } from './InterventionDialog';
import { DocumentEditor } from '../documents/DocumentEditor';
import { CommunicationPanel } from '../communications/CommunicationPanel';
import type { DocumentRevision } from '@def-ops/kshvi/browser';
import './conduct.css';

const draftRevision: DocumentRevision = {
  id: 'draft:r1', documentId: 'draft', revision: 1, state: 'DRAFT',
  requisites: {
    exerciseId: 'new', scenarioRevisionId: 'draft', instanceId: 'hq', authorId: '', category: 'OPERATIONAL', type: 'ORDER',
    title: 'Новый документ', number: '', operationalAt: 'не задано', place: '', validFrom: '', validUntil: '', stageId: '', sideId: '',
    visibility: { sideIds: [], instanceIds: [], roles: [] }, addressees: [], copies: [], sourceRole: 'COMMANDER', deliveryChannelId: '',
    basis: '', executorId: '', deadlineAt: '', linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: [], templateVersion: 'order:v1',
  },
  content: { body: '', units: { distance: 'm', duration: 'min' } },
  map: null, attachments: [], approvalRouteId: 'default', sha256: '', supersedes: null, supersedesRevision: null,
  supersedeReason: null, signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] },
};

export type ConductRole = 'OVERVIEW' | 'TRAINEE' | 'LEADER' | 'DIRECTOR' | 'PLAYGROUP' | 'INTERMEDIARY' | 'ANALYST' | 'TECH_ADMIN' | 'PROJECTOR';
export type ConductCommand = 'PAUSE' | 'RESUME' | 'JUMP' | 'PRIVATE_STOP' | 'GENERAL_STOP' | 'COMPLETE';

function errorStatus(cause: unknown): WorkspaceStatus {
  const status = typeof cause === 'object' && cause !== null && 'status' in cause ? Number((cause as { status?: unknown }).status) : 0;
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NO_DATA';
  if (status >= 500 || status === 0) return 'UNAVAILABLE';
  return 'PARTIAL_FAILURE';
}

export function ConductWorkspace({ role = 'OVERVIEW', client, context, canReadTruth = false, onExecute, onOrderCancel, onHandover, onAudit }: {
  role?: ConductRole | string;
  client?: ConductClient;
  context?: { instanceId: string; sideId: string; role: string; operationalAt?: string };
  canReadTruth?: boolean;
  onExecute?: (command: ConductCommand) => string | Promise<string>;
  onOrderCancel?: (input: { reason: string }) => void;
  onHandover?: () => void | Promise<void>;
  onAudit?: (entry: { reason: string; scope: 'RECOVERY'; contentGranted: false }) => void;
}) {
  const [projection, setProjection] = useState<ConductProjection | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus | 'READY'>('LOADING');
  const [reload, setReload] = useState(0);
  const handover = onHandover ? () => { void onHandover(); } : undefined;
  useEffect(() => {
    if (!client || !context || role === 'PROJECTOR') return;
    let current = true;
    setStatus('LOADING');
    void client.loadProjection(context).then(result => {
      if (!current) return;
      if (result.status === 'READY') { setProjection(result); setStatus('READY'); }
      else setStatus(result.status);
    }).catch(cause => { if (current) setStatus(errorStatus(cause)); });
    return () => { current = false; };
  }, [client, context?.instanceId, context?.sideId, context?.role, context?.operationalAt, reload, role]);

  if (client && context) {
    if (role === 'PROJECTOR') return <ProjectorWorkspace commands={client} />;
    if (status !== 'READY') return <main className="kshvi-conduct-workspace"><h1>Серверная проекция КШВИ</h1><WorkspaceState status={status} onAction={() => setReload(value => value + 1)} /></main>;
    if (!projection) return <WorkspaceState status="NO_DATA" onAction={() => setReload(value => value + 1)} />;
    if (role === 'TRAINEE') return <TraineeWorkspace projection={projection} commands={client} onHandover={onHandover} />;
    if (role === 'LEADER' || role === 'DIRECTOR') return <LeaderWorkspace projection={projection} commands={client} onHandover={onHandover} />;
    if (role === 'PLAYGROUP') return <PlaygroupWorkspace projection={projection} commands={client} onHandover={onHandover} />;
    if (role === 'INTERMEDIARY') return <IntermediaryWorkspace projection={projection} onHandover={onHandover} />;
    return <AnalystWorkspace projection={projection} commands={client} onHandover={onHandover} />;
  }
  const overviewCommands: ConductCommands = {
    saveDecision: async draft => draft,
    transitionDecision: async input => ({ ...input.draft, status: input.to }),
    cancelOrder: async ({ orderId }) => {
      onOrderCancel?.({ reason: `Отмена приказа ${orderId}` });
      return { id: orderId, status: 'CANCELLED_AFTER_RECEIPT', receivedAt: 'Не подтверждено сервером', actualCosts: { timeMinutes: 0, resources: {} }, position: { remainingMeters: 0, travelledMeters: 0 } };
    },
    previewInputs: async ({ objectIds }) => objectIds.map(objectId => ({ objectId, status: 'APPROVAL_REQUIRED', message: 'Сначала откройте официальный сеанс' })),
    applyInputs: async ({ objectIds }) => objectIds.map(objectId => ({ objectId, status: 'APPROVAL_REQUIRED', message: 'Сначала откройте официальный сеанс' })),
    executeCritical: async command => onExecute?.(command) ?? 'Команда не отправлялась: сначала откройте официальный сеанс',
    saveConclusion: async input => input.evidenceIds,
    loadPerspective: async () => ({ ...overviewProjection, canReadTruth }),
  };
  if (!role || role === 'OVERVIEW') return <section className="kshvi-conduct-workspace">
    <AutonomyMonitor attempts={[]} />
    <DocumentEditor revision={draftRevision} />
    <CommunicationPanel channels={[]} attempts={[]} />
    <AgentAssignmentPanel mode="DELEGATED" currentTask="Ожидание новых данных" authorities={['document.issue']} />
    <AgentDecisionTraceView selected="Решение ещё не принято" alternatives={[]} unknown={[]} />
    <InterventionDialog currentAction="Ожидание решения" onConfirm={() => undefined} />
  </section>;
  if (role === 'LEADER' || role === 'DIRECTOR') return <LeaderWorkspace projection={overviewProjection} commands={overviewCommands} onExecute={onExecute} onHandover={handover} />;
  if (role === 'PLAYGROUP') return <PlaygroupWorkspace projection={overviewProjection} commands={overviewCommands} onHandover={handover} />;
  if (role === 'INTERMEDIARY') return <IntermediaryWorkspace projection={overviewProjection} onHandover={handover} />;
  if (role === 'ANALYST') return <AnalystWorkspace projection={overviewProjection} commands={overviewCommands} onHandover={handover} />;
  if (role === 'TECH_ADMIN') return <TechnicalAdminWorkspace projection={overviewProjection} onTemporaryAccess={async entry => onAudit?.({ ...entry, contentGranted: false })} />;
  if (role === 'TRAINEE') return <TraineeWorkspace projection={overviewProjection} commands={overviewCommands} onHandover={handover} />;
  return <LegacyConductWorkspace />;
}
