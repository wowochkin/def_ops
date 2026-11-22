import { hashCanonical } from '../scenario/initial-map-hash';
import type { ReplayArchive, ReplaySnapshot, ReplayState } from './types';

export function snapshotStateHash(state: ReplayState): string {
  return hashCanonical(state);
}

export function nearestSnapshot(archive: ReplayArchive, branchId: string, sequence: number): ReplaySnapshot {
  const snapshot = archive.snapshots
    .filter(candidate => candidate.branchId === branchId && candidate.sequence <= sequence)
    .sort((left, right) => right.sequence - left.sequence)[0];
  if (!snapshot) throw new Error('Для реплея отсутствует предшествующий снимок');
  return snapshot;
}

export function restoreSnapshot(snapshot: ReplaySnapshot): ReplayState {
  if (snapshot.stateHash && snapshotStateHash(snapshot.state) !== snapshot.stateHash) {
    throw new Error('Хеш снимка реплея не совпадает');
  }
  return structuredClone(snapshot.state);
}
