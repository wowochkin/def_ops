import { REPLAY_DOMAINS, REPLAY_FACT_TYPES, type ReplayArchive, type ReplayCursor } from './types';

export type ReplaySemanticRestore = (input: { archive: ReplayArchive; cursor: ReplayCursor }) => {
  stateHash: string | null;
  identityClaimed: boolean;
};
export type ReplaySemanticFindings = { missing: readonly string[]; errors: readonly string[] };

export function journalCoverage(events: readonly Pick<ReplayArchive['events'][number], 'type'>[]): string[] {
  return REPLAY_FACT_TYPES.filter(required => !events.some(event => event.type === required));
}

export function verifyReplayJournalSemantics(replay: ReplayArchive, restore: ReplaySemanticRestore): ReplaySemanticFindings {
  const missing: string[] = [];
  const errors: string[] = [];
  for (const factType of journalCoverage(replay.events)) missing.push(`journal.facts:${factType}`);
  for (const domain of REPLAY_DOMAINS) {
    if (replay.snapshots.some(snapshot => !(domain in snapshot.state.domains))) missing.push(`replay.domain:${domain}`);
  }
  if (!replay.controlPoints?.length) missing.push('replay.control-points.empty');
  else {
    for (const point of replay.controlPoints) {
      try {
        const branchId = point.branchId ?? replay.branchId;
        const frame = restore({ archive: replay, cursor: { branchId, sequence: point.sequence } });
        if (!frame.identityClaimed || frame.stateHash !== point.stateHash) errors.push(`Контрольная точка не воспроизводится: ${branchId}/${point.sequence}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { missing, errors };
}
