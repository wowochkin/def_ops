import { admitAttempts, routeMessage } from '../../../../packages/kshvi/src/communications/channel';
import { advanceMessage, createMessageAttempt } from '../../../../packages/kshvi/src/communications/message';
import { applyInfrastructureFailure, type CommunicationFailure } from '../../../../packages/kshvi/src/communications/failure-model';
import { applyBranchDecision, createBranch, type Branch, type BranchDecisionInput } from '../../../../packages/kshvi/src/replay/branch';
import { projectWorld } from '../../../../packages/kshvi/src/projections/project';
import { advanceApproval } from '../../../../packages/kshvi/src/documents/dual-chain';
import { issueCascade } from '../../../../packages/kshvi/src/documents/cascade';
import { exportDocumentSet, verifyExportSet } from '../../../../packages/kshvi/src/documents/export-set';
import type { DocumentRevision } from '../../../../packages/kshvi/src/documents/document';
import { appendToChain, verifyEventChain } from '../../../../packages/kshvi/src/events/hash-chain';
import { rehearseCatalog, type RehearseCatalogInput } from '../../../../packages/kshvi-events/src/rehearsal/rehearse';
import { createElectronicIntermediaryAssignment } from '../../../../packages/kshvi-agents/src/model/assignment';
import { authorizeAgentAction } from '../../../../packages/kshvi-agents/src/model/agent-mode';
import {
  applyMoraleToTask, decideSystemCommander, utilityMaximizingCommanderPort,
  type CommanderOption, type CommanderPersonality, type MoraleTaskInput,
} from '../../../../packages/kshvi/src/forces/morale-effects';
import type { MoraleProjection } from '../../../../packages/kshvi/src/forces/morale-projection';
import { routeCost, type RouteEdgeCost, type RoutePosition } from '../../../../packages/kshvi/src/terrain/route-graph';
import { appendResourceLedgerEntry, projectResourceLedger, type ResourceLedgerEntry } from '../../../../packages/kshvi/src/logistics/ledger';
import { resourceBalanceFromLedger } from '../../../../packages/kshvi/src/logistics/balance';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { REHEARSAL_CHECKS } from '../../../../packages/kshvi/src/scenario/sealing';

export type RehearsalProfile = Readonly<{
  communication: Readonly<{ route: Parameters<typeof routeMessage>[0]; failure: CommunicationFailure }>;
  branch: Readonly<{ official: Branch; decision: BranchDecisionInput }>;
  visibility: Readonly<{ world: Parameters<typeof projectWorld>[0]; actor: Parameters<typeof projectWorld>[1] }>;
  documents: Readonly<{
    revision: DocumentRevision;
    cascade: Omit<Parameters<typeof issueCascade>[0], 'revision'>;
    exportContext: Parameters<typeof exportDocumentSet>[1];
  }>;
  recovery: Readonly<{ event: Parameters<typeof appendToChain>[1] }>;
  scheduler: RehearseCatalogInput;
  intermediary: Readonly<{
    assignment: Parameters<typeof createElectronicIntermediaryAssignment>[0];
    action: Parameters<typeof authorizeAgentAction>[1];
    foreignAction: Parameters<typeof authorizeAgentAction>[1];
  }>;
  morale: Readonly<{
    projection: MoraleProjection;
    options: readonly CommanderOption[];
    commander: CommanderPersonality;
    task: MoraleTaskInput;
  }>;
  supply: Readonly<{ position: RoutePosition; edge: RouteEdgeCost; ledger: readonly ResourceLedgerEntry[] }>;
}>;
export type RehearsalCheck = typeof REHEARSAL_CHECKS[number];
export type RehearsalDomainEvent = Readonly<{
  eventId: string;
  eventLogId: string;
  sequence: number;
  check: RehearsalCheck;
  type: string;
  payload: Readonly<Record<string, unknown>>;
  sha256: string;
}>;
export type DomainRehearsalResult = Readonly<{
  checks: Readonly<Record<RehearsalCheck, boolean>>;
  events: readonly RehearsalDomainEvent[];
}>;

export async function executeDomainRehearsal(profile: RehearsalProfile, eventLogId: string): Promise<DomainRehearsalResult> {
  const events: RehearsalDomainEvent[] = [];
  const checks = {} as Record<RehearsalCheck, boolean>;
  const perform = async (check: RehearsalCheck, type: string, action: () => Promise<Readonly<{ passed: boolean; details: Record<string, unknown> }>>) => {
    let passed = false;
    let details: Record<string, unknown>;
    try { ({ passed, details } = await action()); } catch (error) {
      details = { error: error instanceof Error ? error.message : String(error) };
    }
    const payload = { ...details, passed };
    const sequence = events.length + 1;
    events.push({
      eventId: `${eventLogId}-${String(sequence).padStart(2, '0')}`, eventLogId, sequence, check, type, payload,
      sha256: hashCanonical({ eventLogId, sequence, check, type, payload }),
    });
    checks[check] = passed;
  };
  let catalog: ReturnType<typeof rehearseCatalog> | undefined;
  const catalogReport = () => catalog ??= rehearseCatalog(profile.scheduler);

  await perform('RECIPIENTS', 'communication.route.selected', async () => {
    const result = routeMessage(profile.communication.route);
    return { passed: Boolean(result.channelId) && profile.communication.route.message.recipientIds.length > 0, details: { channelId: result.channelId, recipients: profile.communication.route.message.recipientIds } };
  });
  await perform('CHANNELS', 'communication.reserve.selected', async () => {
    const changed = applyInfrastructureFailure({
      nodes: profile.communication.route.nodes,
      channels: profile.communication.route.channels,
      factor: profile.communication.failure,
    });
    const result = routeMessage({ ...profile.communication.route, channels: changed.channels, nodes: changed.nodes });
    return { passed: result.selectedReserve, details: { channelId: result.channelId, selectedReserve: result.selectedReserve } };
  });
  await perform('QUEUE', 'communication.queue.admitted', async () => {
    const input = profile.communication.route;
    const route = routeMessage(input);
    const low = advanceMessage(createMessageAttempt({ ...input.message, id: 'rehearsal-low', priority: 1 }, route, input.at), 'START', { at: input.at });
    const urgent = createMessageAttempt({ ...input.message, id: 'rehearsal-urgent', priority: 10 }, route, input.at);
    const busy = admitAttempts({ channel: input.channels[0], inTransit: [low], queued: [urgent], at: input.at });
    return {
      passed: busy.inTransit[0]?.messageId === low.messageId && busy.queued[0]?.messageId === urgent.messageId,
      details: { inTransit: busy.inTransit.map(item => item.messageId), queued: busy.queued.map(item => item.messageId) },
    };
  });
  await perform('BRANCHES', 'replay.branch.isolated', async () => {
    const before = profile.branch.official.hash;
    const branch = createBranch(profile.branch.official, { branchId: `research-${profile.branch.official.branchId}` });
    const changed = applyBranchDecision(branch, profile.branch.decision);
    return {
      passed: profile.branch.official.hash === before && changed.events.length === 1 && changed.events[0].branchId !== profile.branch.official.branchId,
      details: { officialHash: before, alternativeHash: changed.hash, alternativeEvents: changed.events.length },
    };
  });
  await perform('VISIBILITY', 'projection.participant.filtered', async () => {
    const projected = projectWorld(profile.visibility.world, profile.visibility.actor);
    const serialized = JSON.stringify(projected);
    return {
      passed: serialized.includes('own-blue') && !serialized.includes('secret-red') && !serialized.includes('"secret":true'),
      details: { ownVisible: serialized.includes('own-blue'), hiddenExcluded: !serialized.includes('secret-red') },
    };
  });
  await perform('DOCUMENTS', 'documents.dual-and-cascade.completed', async () => {
    let dual = advanceApproval({ command: 'PENDING', service: 'PENDING' }, { actor: 'commander', branch: 'command', decision: 'APPROVED', comment: 'Командная ветвь' });
    dual = advanceApproval(dual, { actor: 'service', branch: 'service', decision: 'APPROVED', comment: 'Функциональная ветвь' });
    const cascade = issueCascade({ ...profile.documents.cascade, revision: profile.documents.revision });
    return {
      passed: dual.state === 'APPROVED' && cascade.deliveries.length > 0 && cascade.source.sha256 === profile.documents.revision.sha256,
      details: { dualState: dual.state, deliveries: cascade.deliveries.length, sourceSha256: cascade.source.sha256 },
    };
  });
  await perform('RECOVERY', 'journal.hash-chain.verified', async () => {
    const first = appendToChain([], profile.recovery.event);
    const second = appendToChain([first], { ...profile.recovery.event, eventId: '00000000-0000-4000-8000-000000000002', sequence: 2 });
    const valid = verifyEventChain([first, second]);
    const tampered = verifyEventChain([first, { ...second, prevHash: '0'.repeat(64) }]);
    return { passed: valid.length === 0 && tampered.includes('PREV_HASH:2'), details: { validIssues: valid, tamperDetected: tampered } };
  });
  await perform('PRINT_FALLBACK', 'documents.export.verified', async () => {
    const exported = await exportDocumentSet(profile.documents.revision, profile.documents.exportContext);
    const verification = await verifyExportSet(exported);
    return { passed: verification.valid, details: { valid: verification.valid, issues: verification.issues } };
  });
  await perform('EVENT_STATISTICS', 'autonomy.statistics.calculated', async () => {
    const report = catalogReport();
    return {
      passed: report.runs.length > 0 && report.runs.every(run => run.controlHash.length > 0) && report.runs.some(run => run.eventCount > 0),
      details: { runs: report.runs.length, attempts: report.runs.map(run => run.attemptCount), events: report.runs.map(run => run.eventCount) },
    };
  });
  await perform('CASCADE_LIMITS', 'autonomy.cascade.limits.enforced', async () => {
    const report = catalogReport();
    const settings = profile.scheduler.profile.settings;
    return {
      passed: report.runs.every(run => run.maxCascadeDepth <= settings.maxCascadeDepth && run.maxCascadeEvents <= settings.maxCascadeEvents),
      details: { maxDepth: report.runs.map(run => run.maxCascadeDepth), maxEvents: report.runs.map(run => run.maxCascadeEvents), allowedDepth: settings.maxCascadeDepth, allowedEvents: settings.maxCascadeEvents },
    };
  });
  await perform('INTERMEDIARY_CYCLES', 'agent.intermediary.delegation.checked', async () => {
    const assignment = createElectronicIntermediaryAssignment(profile.intermediary.assignment);
    const allowed = authorizeAgentAction(assignment, profile.intermediary.action);
    const foreign = authorizeAgentAction(assignment, profile.intermediary.foreignAction);
    return {
      passed: allowed.allowed && !foreign.allowed,
      details: {
        allowed: allowed.allowed,
        execution: 'execution' in allowed ? allowed.execution : null,
        foreignReason: 'reason' in foreign ? foreign.reason : null,
      },
    };
  });
  await perform('OPPONENT', 'agent.opponent.decision.calculated', async () => {
    const decision = decideSystemCommander({
      projection: profile.morale.projection,
      options: profile.morale.options,
      commander: profile.morale.commander,
      port: utilityMaximizingCommanderPort,
    });
    return {
      passed: decision.status === 'DECIDED' && decision.selectedOptionId !== null && decision.evaluatedOptions.every(option => Number.isFinite(option.adjustedUtility)),
      details: { status: decision.status, selectedOptionId: decision.selectedOptionId, utilities: decision.evaluatedOptions.map(option => option.adjustedUtility) },
    };
  });
  await perform('MORALE_IMPACT', 'morale.task.effect.calculated', async () => {
    const result = applyMoraleToTask(profile.morale.task);
    return {
      passed: result.status === 'CALCULATED' && result.contributions.morale !== null && Number.isFinite(result.contributions.morale),
      details: { status: result.status, taskStatus: result.taskStatus, moraleContribution: result.contributions.morale, executionScore: result.executionScore },
    };
  });
  await perform('SUPPLY_ROUTES', 'logistics.route-and-balance.calculated', async () => {
    const route = routeCost(profile.supply.position, profile.supply.edge);
    let entries: readonly ResourceLedgerEntry[] = [];
    for (const item of profile.supply.ledger) entries = appendResourceLedgerEntry(entries, item).entries;
    const balance = resourceBalanceFromLedger(projectResourceLedger(entries), 'fuel');
    return {
      passed: route.status === 'OPEN' && balance.balanced,
      details: { routeStatus: route.status, durationMinutes: route.durationMinutes, balanced: balance.balanced, expected: balance.expected, actual: balance.actual },
    };
  });
  return { checks, events };
}
