import { randomUUID } from 'node:crypto';

export type DivergenceDifference = Readonly<{
  code: 'ACTIVE_SEQUENCE_AHEAD' | 'EVENT_MISSING' | 'EVENT_ID_MISMATCH' | 'HASH_MISMATCH' | 'BRANCH_MISMATCH';
  sequence: number;
  backupEventId?: string;
  activeEventId?: string;
  backupHash?: string;
  activeHash?: string;
  backupBranchId?: string;
  activeBranchId?: string;
}>;
export type DivergenceReport = Readonly<{
  id: string;
  createdAt: string;
  backupLastSequence: number;
  activeLastSequence: number;
  preservedSequence: number;
  laterEventCount: number;
  laterEvents: readonly { sequence: number; eventId: string; hash: string; branchId?: string }[];
  differences: readonly DivergenceDifference[];
  status: 'PENDING' | 'RESOLVED';
  resolution?: 'KEEP_ACTIVE' | 'NEW_BRANCH';
  resolvedByRole?: 'DIRECTOR' | 'ADMIN';
  resolutionReason?: string;
}>;

export function createDivergenceReport(input: {
  backupLastSequence: number;
  activeLastSequence: number;
  laterEvents: readonly { sequence: number; eventId: string; hash: string; branchId?: string }[];
  differences?: readonly DivergenceDifference[];
}): DivergenceReport {
  const differences = [...(input.differences ?? [])];
  if (input.backupLastSequence < input.activeLastSequence && !differences.some(item => item.code === 'ACTIVE_SEQUENCE_AHEAD')) {
    differences.push({ code: 'ACTIVE_SEQUENCE_AHEAD', sequence: input.activeLastSequence });
  }
  if (!differences.length) throw new Error('Расхождение журналов отсутствует');
  return Object.freeze({
    id: randomUUID(), createdAt: new Date().toISOString(),
    backupLastSequence: input.backupLastSequence, activeLastSequence: input.activeLastSequence,
    preservedSequence: input.activeLastSequence, laterEventCount: input.laterEvents.length,
    laterEvents: input.laterEvents.map(event => ({ sequence: event.sequence, eventId: event.eventId, hash: event.hash, ...(event.branchId ? { branchId: event.branchId } : {}) })),
    differences, status: 'PENDING',
  });
}

export function resolveDivergence(report: DivergenceReport, input: {
  decision: 'KEEP_ACTIVE' | 'NEW_BRANCH' | 'OVERWRITE_ACTIVE';
  actorRole: 'DIRECTOR' | 'ADMIN';
  reason: string;
}): DivergenceReport {
  if (input.decision === 'OVERWRITE_ACTIVE') throw new Error('Старой копией нельзя перезаписывать поздние события');
  if (input.reason.trim().length < 5) throw new Error('Укажите основание решения по расхождению');
  return { ...report, status: 'RESOLVED', resolution: input.decision, resolvedByRole: input.actorRole, resolutionReason: input.reason.trim() };
}
