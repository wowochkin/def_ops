import { AutonomyMonitor } from './AutonomyMonitor';
import { AgentAssignmentPanel } from './AgentAssignmentPanel';
import { AgentDecisionTraceView } from './AgentDecisionTraceView';
import { InterventionDialog } from './InterventionDialog';
import { DocumentEditor } from '../documents/DocumentEditor';
import { CommunicationPanel } from '../communications/CommunicationPanel';
import type { DocumentRevision } from '@def-ops/kshvi/browser';

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

/** Существующий состав KshviView: автономия, документы, связь и перехват управления. */
export function LegacyConductWorkspace() {
  return <section className="kshvi-conduct-workspace">
    <AutonomyMonitor attempts={[]} />
    <DocumentEditor revision={draftRevision} />
    <CommunicationPanel channels={[]} attempts={[]} />
    <AgentAssignmentPanel mode="DELEGATED" currentTask="Ожидание новых данных" authorities={['document.issue']} />
    <AgentDecisionTraceView selected="Решение ещё не принято" alternatives={[]} unknown={[]} />
    <InterventionDialog currentAction="Ожидание решения" onConfirm={() => undefined} />
  </section>;
}
