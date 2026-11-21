import { createHash } from 'node:crypto';
import { canonicalJson } from '../events/canonical';
import { ReplayReducerRegistry, type ReplayActor, type ReplayChange, type ReplayEvent, type ReplaySnapshot, type ReplayState, type ReplayVersionRef } from './replay-engine';

export type BranchVersions = {
  model: ReplayVersionRef;
  environment: ReplayVersionRef;
  reducerVersion: number;
};
export type Branch = {
  branchId: string;
  parentBranchId: string | null;
  kind: 'OFFICIAL' | 'ALTERNATIVE';
  snapshot: ReplaySnapshot;
  state: ReplayState;
  events: ReplayEvent[];
  documents: readonly unknown[];
  assessment: unknown;
  versions: BranchVersions;
  seed: string;
  rights: readonly string[];
  assumptions: readonly string[];
  hash: string;
};
export type BranchDecisionInput = {
  eventId: string;
  type: string;
  operationalAt: string;
  wallClockAt: string;
  payload: Record<string, unknown>;
  changes?: readonly ReplayChange[];
  causeIds?: readonly string[];
  randomKey?: ReplayEvent['randomKey'];
  savedTrace?: ReplayEvent['savedTrace'];
};
export type CreateBranchInput = {
  branchId: string;
  versionChanges?: Partial<BranchVersions>;
  assumption?: string;
};

function branchHash(branch: Branch): string {
  return createHash('sha256').update(canonicalJson({
    branchId: branch.branchId, state: branch.state, events: branch.events, versions: branch.versions,
  })).digest('hex');
}

export function createBranch(official: Branch, input: CreateBranchInput): Branch {
  if (!input.branchId.trim() || input.branchId === official.branchId) throw new Error('Альтернативной ветви нужен новый branchId');
  if (input.versionChanges && !input.assumption?.trim()) throw new Error('Замена версий требует явного нового допущения');
  const branch: Branch = {
    ...structuredClone(official),
    branchId: input.branchId,
    parentBranchId: official.branchId,
    kind: 'ALTERNATIVE',
    state: structuredClone(official.state),
    snapshot: structuredClone(official.snapshot),
    events: [],
    documents: structuredClone(official.documents),
    assessment: structuredClone(official.assessment),
    versions: { ...structuredClone(official.versions), ...structuredClone(input.versionChanges ?? {}) },
    seed: createHash('sha256').update(canonicalJson({ parentSeed: official.seed, branchId: input.branchId })).digest('hex'),
    assumptions: [...official.assumptions, ...(input.assumption ? [input.assumption] : [])],
    hash: '',
  };
  branch.hash = branchHash(branch);
  return branch;
}

export function applyBranchDecision(branch: Branch, decision: BranchDecisionInput, reducerRegistry = new ReplayReducerRegistry()): Branch {
  if (branch.kind !== 'ALTERNATIVE') throw new Error('Решение альтернативы нельзя применить к официальной линии');
  if (branch.events.some(event => event.eventId === decision.eventId)) throw new Error('Повторное решение ветви уже применено');
  const event: ReplayEvent = {
    ...structuredClone(decision), branchId: branch.branchId,
    sequence: branch.snapshot.sequence + branch.events.length + 1,
  };
  const reducer = reducerRegistry.find(event.reducerVersion ?? branch.versions.reducerVersion);
  if (!reducer) throw new Error('Неподдерживаемая версия reducer ветви');
  const next: Branch = {
    ...structuredClone(branch),
    state: reducer(structuredClone(branch.state), event),
    events: [...structuredClone(branch.events), event],
  };
  next.hash = branchHash(next);
  return next;
}

export function publishBranch(_branch: Branch): never {
  throw new Error('обычная публикация ветви запрещена; требуется новое решение руководителя');
}

export function adoptBranchDecision(official: Branch, branch: Branch, actor: ReplayActor, rationale: string): Branch {
  if (official.kind !== 'OFFICIAL' || branch.kind !== 'ALTERNATIVE') throw new Error('Некорректные линии для официального решения');
  if (actor.role !== 'LEADER' || !actor.authorities.includes('OFFICIAL_DECISION')) throw new Error('403: Требуется право нового официального решения');
  if (!rationale.trim()) throw new Error('Для официального решения нужно основание');
  const source = branch.events.at(-1);
  if (!source) throw new Error('В альтернативной ветви нет решения для переноса');
  const event: ReplayEvent = {
    ...structuredClone(source),
    eventId: `official-decision-${official.snapshot.sequence + official.events.length + 1}`,
    branchId: official.branchId,
    sequence: official.snapshot.sequence + official.events.length + 1,
    causeIds: [...(source.causeIds ?? []), source.eventId],
    payload: { ...structuredClone(source.payload), rationale, sourceBranchId: branch.branchId, adoptedBy: 'LEADER' },
  };
  const reducer = new ReplayReducerRegistry().find(official.versions.reducerVersion);
  if (!reducer) throw new Error('Неподдерживаемая версия reducer официальной линии');
  const next: Branch = {
    ...structuredClone(official),
    state: reducer(structuredClone(official.state), event),
    events: [...structuredClone(official.events), event],
  };
  next.hash = branchHash(next);
  return next;
}
