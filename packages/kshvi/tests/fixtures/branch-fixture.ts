import { createHash } from 'node:crypto';
import { canonicalJson } from '../../src/events/canonical';
import type { Branch } from '../../src/replay/branch';
import { makeReplayArchive } from './replay-archive';

export function officialBranch(): Branch {
  const archive = makeReplayArchive();
  const state = archive.snapshots[1].state;
  return {
    branchId: 'official', organizationId: 'org-1', ownerId: 'leader-1', parentBranchId: null, kind: 'OFFICIAL', snapshot: archive.snapshots[1],
    state, events: [], documents: [{ id: 'signed-order', signed: true, text: 'Исходный приказ' }],
    assessment: { grade: 'Утверждено руководителем' }, versions: archive.versions,
    seed: 'official-seed', rights: ['OFFICIAL_READ'], assumptions: [],
    hash: createHash('sha256').update(canonicalJson(state)).digest('hex'),
  };
}
