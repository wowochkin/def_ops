import { canonicalJson } from '../events/canonical';
import type { Branch } from './branch';

export type BranchDifferenceKind = 'MODEL_VERSION' | 'ENVIRONMENT_VERSION' | 'REDUCER_VERSION' | 'TIME' | 'TASKS' | 'RESOURCES' | 'DOCUMENTS' | 'OUTCOMES';
export type BranchDifference = { kind: BranchDifferenceKind; label: string; before?: unknown; after?: unknown };
export type BranchDiff = {
  differences: BranchDifference[];
  causalAttribution: 'NOT_CAUSALLY_COMPARABLE' | 'REQUIRES_RESEARCH_DESIGN';
};

function same(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

export function compareBranches(left: Branch, right: Branch): BranchDiff {
  const conditions: BranchDifference[] = [];
  if (!same(left.versions.model, right.versions.model)) conditions.push({ kind: 'MODEL_VERSION', label: `Модель: ${left.versions.model.revision} → ${right.versions.model.revision}`, before: left.versions.model, after: right.versions.model });
  if (!same(left.versions.environment, right.versions.environment)) conditions.push({ kind: 'ENVIRONMENT_VERSION', label: `Среда: ${left.versions.environment.revision} → ${right.versions.environment.revision}`, before: left.versions.environment, after: right.versions.environment });
  if (left.versions.reducerVersion !== right.versions.reducerVersion) conditions.push({ kind: 'REDUCER_VERSION', label: `Reducer: ${left.versions.reducerVersion} → ${right.versions.reducerVersion}` });
  const consequences: BranchDifference[] = [];
  const domains: readonly [BranchDifferenceKind, string][] = [
    ['TIME', 'Time'], ['TASKS', 'Tasks'], ['RESOURCES', 'Resources'], ['DOCUMENTS', 'Documents'], ['OUTCOMES', 'Decisions'],
  ];
  for (const [kind, domain] of domains) {
    const before = domain === 'Documents' ? left.documents : left.state.domains[domain];
    const after = domain === 'Documents' ? right.documents : right.state.domains[domain];
    if (!same(before, after)) consequences.push({ kind, label: `${domain}: состояние различается`, before, after });
  }
  return {
    differences: [...conditions, ...consequences],
    causalAttribution: conditions.length > 0 ? 'NOT_CAUSALLY_COMPARABLE' : 'REQUIRES_RESEARCH_DESIGN',
  };
}
