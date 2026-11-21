import type { Observation } from './observation';

const publicFields = [
  'id', 'source', 'observedAt', 'deliveredAt', 'validUntil', 'reportedGeometry', 'reportedAttributes',
  'reportedAccuracyMeters', 'completeness', 'reliability', 'status', 'staleSince', 'environmentSnapshotId',
  'mergedFrom', 'mergeRuleVersion',
] as const;
type PublicObservationInput = Partial<Omit<Observation, 'trueForceId' | 'actualErrorMeters' | 'randomKeys'>> & {
  id: string;
  observedAt: string;
  trueForceId?: string | null;
  actualErrorMeters?: number | null;
  [restricted: string]: unknown;
};
export type ProjectedObservation = Readonly<Partial<Pick<Observation, typeof publicFields[number]>> & { id: string; observedAt: string }>;

export function projectObservation(observation: PublicObservationInput): ProjectedObservation {
  const projected: Record<string, unknown> = {};
  for (const field of publicFields) {
    if (field in observation && observation[field] !== undefined) projected[field] = structuredClone(observation[field]);
  }
  return Object.freeze(projected) as ProjectedObservation;
}

export function projectObservationChannels(observation: Observation) {
  return {
    api: projectObservation(observation),
    sse: projectObservation(observation),
    search: projectObservation(observation),
    replay: projectObservation(observation),
    agentInput: projectObservation(observation),
  };
}

export function markStale(observation: Observation, operationalAt: string): Observation {
  const at = Date.parse(operationalAt);
  if (!Number.isFinite(at)) throw new Error('Нужно оперативное время проверки актуальности');
  if (at <= Date.parse(observation.validUntil)) return structuredClone(observation);
  return Object.freeze({ ...observation, status: 'STALE' as const, staleSince: new Date(at).toISOString() });
}
