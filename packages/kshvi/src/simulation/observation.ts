import { deriveRandom, type RandomKey } from '../events/random';
import type { StoredRandomKey } from './stochastic';

export type ObservationGeometry = Readonly<{ lon: number; lat: number }>;
export type ObservationStatus = 'CURRENT' | 'STALE' | 'CONTRADICTED';
export type ObservationSource = Readonly<{
  id: string;
  kind: string;
  sideId: string;
  profileVersion: string;
  errorMeters: Readonly<{ min: number; max: number }>;
  delaySeconds: Readonly<{ min: number; max: number }>;
  completeness: number;
  reliability: number;
  validitySeconds: number;
  attributeKeys: readonly string[];
}>;
export type Observation = Readonly<{
  id: string;
  trueForceId: string | null;
  actualErrorMeters: number | null;
  source: Readonly<{ id: string; kind: string; sideId: string; profileVersion: string }>;
  observedAt: string;
  deliveredAt: string;
  validUntil: string;
  reportedGeometry: ObservationGeometry;
  reportedAttributes: Readonly<Record<string, unknown>>;
  reportedAccuracyMeters: number;
  completeness: number;
  reliability: number;
  status: ObservationStatus;
  staleSince?: string;
  environmentSnapshotId: string;
  randomKeys: readonly StoredRandomKey[];
  mergedFrom?: readonly string[];
  mergeRuleVersion?: number;
}>;
export type CreateObservationInput = Readonly<{
  id: string;
  trueForceId: string;
  trueGeometry: ObservationGeometry;
  trueAttributes: Readonly<Record<string, unknown>>;
  observedAt: string;
  source: ObservationSource;
  environment: Readonly<{ snapshotId: string; errorMultiplier: number; delayMultiplier: number }>;
  randomKey: RandomKey;
}>;

function unitInterval(value: number, name: string, zeroAllowed = true): void {
  if (!Number.isFinite(value) || value < (zeroAllowed ? 0 : Number.MIN_VALUE) || value > 1) throw new Error(`Некорректная ${name}`);
}
function positiveFinite(value: number, name: string, allowZero = false): void {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) throw new Error(`Некорректный параметр ${name}`);
}
function observationRandom(key: RandomKey, ordinalOffset: number): StoredRandomKey {
  const actualKey = { ...key, ordinal: key.ordinal + ordinalOffset };
  const random = deriveRandom(actualKey);
  return Object.freeze({ ...actualKey, seed: `${actualKey.seed}n`, digest: random.digest, value: random.value });
}

export function createObservation(input: CreateObservationInput): Observation {
  const observedMs = Date.parse(input.observedAt);
  if (!input.id.trim() || !input.trueForceId.trim() || !Number.isFinite(observedMs)) throw new Error('Наблюдение требует идентификаторы и время');
  const { source, environment } = input;
  if (!source.id.trim() || !source.profileVersion.trim()) throw new Error('Источник наблюдения требует версионный профиль');
  for (const [name, value] of Object.entries({ minError: source.errorMeters.min, maxError: source.errorMeters.max, minDelay: source.delaySeconds.min, maxDelay: source.delaySeconds.max, validity: source.validitySeconds })) positiveFinite(value, name, name !== 'validity');
  if (source.errorMeters.max < source.errorMeters.min || source.delaySeconds.max < source.delaySeconds.min) throw new Error('Диапазон профиля наблюдения перевёрнут');
  unitInterval(source.completeness, 'полнота наблюдения');
  unitInterval(source.reliability, 'достоверность наблюдения', false);
  positiveFinite(environment.errorMultiplier, 'среды: точность');
  positiveFinite(environment.delayMultiplier, 'среды: задержка');
  if (![input.trueGeometry.lon, input.trueGeometry.lat].every(Number.isFinite) || Math.abs(input.trueGeometry.lat) >= 90) throw new Error('Некорректная геометрия наблюдения');

  const errorRandom = observationRandom(input.randomKey, 0);
  const delayRandom = observationRandom(input.randomKey, 1);
  const angleRandom = observationRandom(input.randomKey, 2);
  const actualErrorMeters = (source.errorMeters.min + (source.errorMeters.max - source.errorMeters.min) * errorRandom.value) * environment.errorMultiplier;
  const delaySeconds = (source.delaySeconds.min + (source.delaySeconds.max - source.delaySeconds.min) * delayRandom.value) * environment.delayMultiplier;
  const angle = angleRandom.value * Math.PI * 2;
  const lat = input.trueGeometry.lat + Math.sin(angle) * actualErrorMeters / 110_540;
  const lon = input.trueGeometry.lon + Math.cos(angle) * actualErrorMeters / (111_320 * Math.cos(input.trueGeometry.lat * Math.PI / 180));
  const reportedAttributes = Object.fromEntries(source.attributeKeys.map(key => [key, structuredClone(input.trueAttributes[key])]).filter(([, value]) => value !== undefined));

  return Object.freeze({
    id: input.id,
    trueForceId: input.trueForceId,
    actualErrorMeters,
    source: Object.freeze({ id: source.id, kind: source.kind, sideId: source.sideId, profileVersion: source.profileVersion }),
    observedAt: new Date(observedMs).toISOString(),
    deliveredAt: new Date(observedMs + delaySeconds * 1000).toISOString(),
    validUntil: new Date(observedMs + source.validitySeconds * 1000).toISOString(),
    reportedGeometry: Object.freeze({ lon, lat }),
    reportedAttributes: Object.freeze(reportedAttributes),
    reportedAccuracyMeters: source.errorMeters.max * environment.errorMultiplier,
    completeness: source.completeness,
    reliability: source.reliability,
    status: 'CURRENT' as const,
    environmentSnapshotId: environment.snapshotId,
    randomKeys: Object.freeze([errorRandom, delayRandom, angleRandom]),
  });
}
