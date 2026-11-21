import { randomUUID } from 'node:crypto';

export type DivergenceReport = Readonly<{
  id: string;
  createdAt: string;
  backupLastSequence: number;
  activeLastSequence: number;
  preservedSequence: number;
  laterEventCount: number;
  laterEvents: readonly { sequence: number; eventId: string; hash: string }[];
  status: 'PENDING' | 'RESOLVED';
  resolution?: 'KEEP_ACTIVE' | 'NEW_BRANCH';
  resolvedByRole?: 'DIRECTOR' | 'ADMIN';
  resolutionReason?: string;
}>;

export function createDivergenceReport(input: {
  backupLastSequence: number;
  activeLastSequence: number;
  laterEvents: readonly { sequence: number; eventId: string; hash: string }[];
}): DivergenceReport {
  if (input.backupLastSequence >= input.activeLastSequence) throw new Error('Расхождение с более поздним журналом отсутствует');
  return Object.freeze({
    id: randomUUID(), createdAt: new Date().toISOString(),
    backupLastSequence: input.backupLastSequence, activeLastSequence: input.activeLastSequence,
    preservedSequence: input.activeLastSequence, laterEventCount: input.laterEvents.length,
    laterEvents: input.laterEvents.map(event => ({ sequence: event.sequence, eventId: event.eventId, hash: event.hash })), status: 'PENDING',
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
