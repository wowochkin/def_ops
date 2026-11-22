import type { Observation } from './observation';

const publicFields = [
  'id', 'source', 'observedAt', 'deliveredAt', 'validUntil', 'reportedGeometry', 'reportedAttributes',
  'reportedAccuracyMeters', 'completeness', 'reliability', 'status', 'staleSince', 'environmentSnapshotId', 'mergedFrom', 'mergeRuleVersion',
] as const;
const restrictedKeys = new Set([
  'trueforceid', 'truegeometry', 'actualerrormeters', 'actualerror', 'reference', 'benchmark', 'truth', 'randomkeys', 'randomkey', 'rng', 'secret', 'standard',
]);
type PublicObservationInput = Partial<Omit<Observation, 'trueForceId' | 'actualErrorMeters' | 'randomKeys' | 'source' | 'reportedAttributes'>> & {
  id: string;
  observedAt: string;
  source?: unknown;
  reportedAttributes?: unknown;
  trueForceId?: string | null;
  actualErrorMeters?: number | null;
  [restricted: string]: unknown;
};
export type ProjectedObservation = Readonly<Partial<Pick<Observation, typeof publicFields[number]>> & { id: string; observedAt: string }>;

function restricted(key: string): boolean {
  return restrictedKeys.has(key.replace(/[^a-z]/gi, '').toLowerCase());
}
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new Error('Слишком глубокая структура наблюдения для безопасной проекции');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !restricted(key)).map(([key, child]) => [key, sanitize(child, depth + 1)]));
  }
  return undefined;
}
function sanitizeSource(source: unknown): unknown {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const input = source as Record<string, unknown>;
  return Object.fromEntries(['id', 'kind', 'sideId', 'profileVersion'].filter(key => typeof input[key] === 'string').map(key => [key, input[key]]));
}

export function projectObservation(observation: PublicObservationInput): ProjectedObservation {
  const projected: Record<string, unknown> = {};
  for (const field of publicFields) {
    if (!(field in observation) || observation[field] === undefined) continue;
    if (field === 'source') projected[field] = sanitizeSource(observation[field]);
    else if (field === 'reportedGeometry') {
      const geometry = observation[field] as { lon?: unknown; lat?: unknown };
      projected[field] = { lon: geometry.lon, lat: geometry.lat };
    } else projected[field] = sanitize(observation[field]);
  }
  return Object.freeze(projected) as ProjectedObservation;
}

export function projectObservationChannels(observation: Observation) {
  return {
    api: projectObservation(observation), sse: projectObservation(observation), search: projectObservation(observation),
    replay: projectObservation(observation), agentInput: projectObservation(observation),
  };
}

export function markStale(observation: Observation, operationalAt: string): Observation {
  const at = Date.parse(operationalAt);
  if (!Number.isFinite(at)) throw new Error('Нужно оперативное время проверки актуальности');
  if (at <= Date.parse(observation.validUntil)) return structuredClone(observation);
  return Object.freeze({ ...observation, status: 'STALE' as const, staleSince: new Date(at).toISOString() });
}
