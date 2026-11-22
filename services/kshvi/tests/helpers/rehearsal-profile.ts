import type { RehearsalProfile } from '../../src/store/domain-rehearsal';
import { computeDocumentSha256Sync, type DocumentRevision } from '../../../../packages/kshvi/src/documents/document';
import { transitionDocument } from '../../../../packages/kshvi/src/documents/document-lifecycle';
import { createMoralePsychState } from '../../../../packages/kshvi/src/forces/morale-state';
import { projectMorale } from '../../../../packages/kshvi/src/forces/morale-projection';
import { officialBranch } from '../../../../packages/kshvi/tests/fixtures/branch-fixture';
import { blueNorthTarget, makeProfile, makeState, makeTemplate } from '../../../../packages/kshvi-events/tests/fixtures/autonomy';

const at = '2030-01-01T06:00:00Z';
const hashA = 'a'.repeat(64);
const source = {
  kind: 'EDUCATIONAL_ASSUMPTION' as const, reference: 'Репетиционный профиль КШВИ', assumptionId: 'REHEARSAL-PROFILE-1',
  approvedBy: 'Методист КШВИ', applicability: 'Только моделируемые силы и изолированная репетиция',
};
const known = (value: number) => ({ status: 'KNOWN' as const, value, uncertainty: 'EXACT_SCENARIO_VALUE' as const, observedAt: at, source });

function revision(): DocumentRevision {
  const value: DocumentRevision = {
    id: 'rehearsal-order:r1', documentId: 'rehearsal-order', revision: 1, state: 'IN_REVIEW',
    requisites: {
      exerciseId: 'exercise-rehearsal', scenarioRevisionId: 'scenario-rehearsal', instanceId: 'hq', authorId: 'author', category: 'OPERATIONAL', type: 'COMBAT_ORDER',
      title: 'Репетиционный приказ', number: '1', operationalAt: '2030-01-01T06:00:00+03:00', place: 'КП',
      validFrom: '2030-01-01T00:00:00+03:00', validUntil: '2030-01-02T00:00:00+03:00', stageId: 'stage-1', sideId: 'blue',
      visibility: { sideIds: ['blue'], instanceIds: [], roles: [] }, addressees: [{ instanceId: 'middle', channelId: 'main' }],
      copies: [], sourceRole: 'COMMANDER', deliveryChannelId: 'main', basis: 'Репетиционный замысел', executorId: 'middle', deadlineAt: '2030-01-01T09:00:00+03:00',
      linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: ['task-1'], templateVersion: 'combat-order:v1',
    },
    content: { body: 'Выполнить репетиционную задачу', units: { distance: 'm' } },
    map: { environmentSnapshotId: 'env-rehearsal', legend: ['cp:v1'], attribution: ['Локальная топооснова'], visibility: { sideIds: ['blue'], instanceIds: [], roles: [] } },
    attachments: [], approvalRouteId: 'dual-rehearsal', sha256: hashA, supersedes: null, supersedesRevision: null, supersedeReason: null,
    signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] },
  };
  return { ...value, sha256: computeDocumentSha256Sync(value) };
}

function approvedRevision(): DocumentRevision {
  const approved = transitionDocument(revision(), 'APPROVE', { signature: { userId: 'designatedAuthority', role: 'COMMANDER', signedAt: '2030-01-01T05:50:00+03:00' } });
  return transitionDocument(approved, 'ISSUE', {
    issue: {
      recipient: { instanceId: 'middle', sideId: 'blue', roles: ['COMMANDER'] }, knownInstanceIds: ['hq', 'middle'],
      availableChannelIds: ['main'], senderHasAuthority: true, at: '2030-01-01T06:00:00+03:00',
    },
  });
}

function moraleProjection() {
  const state = createMoralePsychState({
    subject: { kind: 'SIMULATED_FORCE', forceId: 'force-rehearsal' }, at,
    components: {
      morale: known(0.9), cohesion: known(0.9), stress: known(0.1), fatigue: known(0.2), commandTrust: known(0.9), recoveryCapacity: known(0.8),
    },
  });
  const assessment = {
    kind: 'INSTANCE_ASSESSMENT' as const, forceId: state.subject.forceId, instanceId: 'instance-1', assessedAt: at, availableAt: at,
    stateEnteredAt: at, components: state.components, source: { kind: 'REPORT' as const, reportId: 'report-rehearsal' },
  };
  return projectMorale({ truth: state, assessment, viewer: { role: 'SYSTEM_COMMANDER', instanceId: 'instance-1' }, at: '2030-01-01T06:30:00Z' });
}

export function rehearsalProfile(): RehearsalProfile {
  const main = {
    id: 'main', version: 1, fromInstanceId: 'hq', toInstanceId: 'unit', nodeIds: ['node-main'], direction: 'SIMPLEX' as const,
    allowedMessageTypes: ['ORDER' as const, 'REPORT' as const], capacity: 1, bytesPerSecond: 1000, baseDelayMs: 1000,
    priorityPolicy: { allowQueuedPreemption: true }, availability: 'AVAILABLE' as const, encrypted: true,
    reserveChannelIds: ['reserve'], validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
  };
  const reserve = { ...main, id: 'reserve', nodeIds: ['node-reserve'], baseDelayMs: 3000, reserveChannelIds: [] };
  const message = {
    id: 'rehearsal-message', type: 'ORDER' as const, senderRole: 'COMMANDER' as const, fromInstanceId: 'hq', recipientIds: ['unit'], sizeBytes: 2000,
    priority: 5, domainKey: 'order-rehearsal', createdAt: at,
  };
  const failure = {
    id: 'rehearsal-node-failure', type: 'NODE_FAILURE' as const, basis: 'Репетиционный отказ узла', trainingQuestion: 'Как сохранить управление?',
    workaround: 'Перейти на резерв', scope: { nodeIds: ['node-main'], channelIds: [] }, at,
    expectedImpact: { documentIds: ['rehearsal-order'], deadlineIds: [], branchIds: [] },
  };
  return {
    communication: {
      route: { message, channels: [main, reserve], nodes: [{ id: 'node-main', status: 'AVAILABLE' as const }, { id: 'node-reserve', status: 'AVAILABLE' as const }], at },
      failure,
    },
    branch: {
      official: officialBranch(),
      decision: {
        eventId: 'rehearsal-alternative', type: 'decision', operationalAt: '2030-01-01T06:03:00Z', wallClockAt: '2030-01-01T06:03:00Z',
        payload: { text: 'Репетиционная альтернатива' }, changes: [{ domain: 'Resources' as const, value: { fuel: 10 } }],
      },
    },
    visibility: {
      world: { forces: [{ id: 'own-blue', side: 'blue', position: [1, 1] }, { id: 'secret-red', side: 'red', position: [2, 2] }], inputs: [], reference: { secret: true } },
      actor: { side: 'blue', role: 'TRAINEE', operationalAt: at, scope: 'own' as const },
    },
    documents: {
      revision: approvedRevision(),
      cascade: {
        originInstanceId: 'hq', issuedAt: '2030-01-01T06:00:00+03:00', availableChannelIds: ['main', 'reserve'],
        treeEdges: [{ from: 'hq', to: 'middle' }],
        legs: [{ id: 'leg-middle', from: 'hq', to: 'middle', channelId: 'main', delayMinutes: 5, relayId: 'hq-relay', processingDeadlineAt: '2030-01-01T06:20:00+03:00' }],
      },
      exportContext: { exerciseTitle: 'Репетиция', exerciseRevision: 1, exportedAt: at },
    },
    recovery: {
      event: {
        eventId: '00000000-0000-4000-8000-000000000001', organizationId: 'org-rehearsal', instanceId: 'instance-rehearsal', branchId: 'branch-rehearsal',
        sequence: 1, type: 'rehearsal.started.v1', schemaVersion: 1, wallClockAt: '2030-01-01T06:00:00.000Z',
        operationalAt: { normalizedAt: '2030-01-01T06:00:00.000Z', originalAt: '2030-01-01T06:00:00.000Z', zone: 'UTC', offset: '+00:00' }, actor: { id: 'system-rehearsal', kind: 'SYSTEM' as const },
        causeIds: [], versions: {}, reducerVersion: 1, payload: { purpose: 'domain rehearsal' },
      },
    },
    scheduler: {
      templates: [makeTemplate()], profile: makeProfile('HIGH'), seeds: ['rehearsal-seed'], fromSecond: 0, toSecond: 3600,
      state: makeState(), targets: [blueNorthTarget], branchId: 'rehearsal-scheduler', snapshotHash: hashA, templateSetVersion: 'rehearsal-catalog-v1',
    },
    intermediary: {
      assignment: {
        assignmentId: 'agent-rehearsal', exerciseId: 'exercise-rehearsal', bindings: [{ instanceId: 'higher', sectorIds: ['north'] }], roles: ['INTERMEDIARY'],
        projection: { projectionId: 'projection-rehearsal', sideIds: ['blue'], sectorIds: ['north'] }, allowedActions: ['issueDocument'],
        modernProfile: { profileId: 'modern-rehearsal', version: '1.0.0', era: 'modern', source: { kind: 'ASSUMPTION', reference: 'Репетиционный профиль' }, maxOptions: 3, riskLimit: 0.5, severityLimit: 3 },
        schedule: { everyMs: 1000, timeBudgetMs: 250 }, escalation: { recipients: ['leader'], requiredData: ['activeOrder'] },
      },
      action: { kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', risk: 0.2, severity: 2 },
      foreignAction: { kind: 'issueDocument', instanceId: 'foreign', sectorId: 'north', risk: 0.2, severity: 2 },
    },
    morale: {
      projection: moraleProjection(),
      options: [
        { optionId: 'continue', action: 'CONTINUE_TASK', baseUtility: 0.55, demand: 'HIGH', risk: 0.8, ordered: true },
        { optionId: 'consolidate', action: 'CONSOLIDATE', baseUtility: 0.5, demand: 'LOW', risk: 0.1, ordered: true },
      ],
      commander: { riskPropensity: 0.6, persistence: 0.8, lossTolerance: 0.5, obedience: 0.8, source },
      task: {
        readiness: 1, equipment: 1, resources: 1, fatigue: 0.2, randomKey: null, availableMinutes: 60, requiredTaskMinutes: 25,
        unrelatedResource: { resourceId: 'fuel', amount: 37, unit: 'tonne' },
        morale: { status: 'KNOWN', morale: 0.9, cohesion: 0.9, stress: 0.1, durationMinutes: 30 },
      },
    },
    supply: {
      position: { remainingMeters: 10_000, travelledMeters: 2_000 },
      edge: { speedKph: 20, closed: false, queueDelayMinutes: 5, reason: 'Репетиционная поставка' },
      ledger: [
        { resourceId: 'fuel', unit: 'tonne', nodeId: 'warehouse', at, actorId: 'logistics', id: 'opening', causeId: 'opening', operation: 'OPENING', quantity: 100 },
        { resourceId: 'fuel', unit: 'tonne', nodeId: 'warehouse', at, actorId: 'logistics', id: 'receipt', causeId: 'receipt', operation: 'RECEIPT', quantity: 20 },
      ],
    },
  };
}
