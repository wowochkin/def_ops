import type { Observation } from './observation';

export function mergeObservations(observations: readonly Observation[], options: { id: string; ruleVersion: number }) {
  if (options.ruleVersion !== 1) throw new Error('Неподдерживаемая версия правила слияния наблюдений');
  if (observations.length === 0 || !options.id.trim()) throw new Error('Слияние требует наблюдения и новый идентификатор');
  const sideIds = new Set(observations.map(observation => observation.source.sideId));
  if (sideIds.size !== 1) throw new Error('Нельзя объединять наблюдения разных сторон без отдельного правила');
  const originals = structuredClone(observations);
  const weighted = observations.map(observation => ({
    observation,
    weight: observation.reliability / Math.max(1, observation.reportedAccuracyMeters) ** 2,
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const lon = weighted.reduce((sum, item) => sum + item.observation.reportedGeometry.lon * item.weight, 0) / totalWeight;
  const lat = weighted.reduce((sum, item) => sum + item.observation.reportedGeometry.lat * item.weight, 0) / totalWeight;
  const latest = [...observations].sort((a, b) => Date.parse(a.deliveredAt) - Date.parse(b.deliveredAt)).at(-1)!;
  const trueForceIds = new Set(observations.map(observation => observation.trueForceId));
  const distanceMeters = Math.hypot(
    (observations[0].reportedGeometry.lon - lon) * 111_320 * Math.cos(lat * Math.PI / 180),
    (observations[0].reportedGeometry.lat - lat) * 110_540,
  );
  const status = observations.every(observation => observation.status === 'STALE')
    ? 'STALE' as const
    : distanceMeters > observations[0].reportedAccuracyMeters * 2 ? 'CONTRADICTED' as const : 'CURRENT' as const;
  const merged: Observation = Object.freeze({
    id: options.id,
    trueForceId: trueForceIds.size === 1 ? observations[0].trueForceId : null,
    actualErrorMeters: null,
    source: { id: options.id, kind: 'MERGED', sideId: latest.source.sideId, profileVersion: 'weighted-centroid-v1' },
    observedAt: latest.observedAt,
    deliveredAt: latest.deliveredAt,
    validUntil: observations.map(observation => observation.validUntil).sort().at(-1)!,
    reportedGeometry: { lon, lat },
    reportedAttributes: structuredClone(latest.reportedAttributes),
    reportedAccuracyMeters: Math.max(...observations.map(observation => observation.reportedAccuracyMeters)),
    completeness: Math.max(...observations.map(observation => observation.completeness)),
    reliability: observations.reduce((sum, observation) => sum + observation.reliability, 0) / observations.length,
    status,
    staleSince: status === 'STALE' ? latest.staleSince : undefined,
    environmentSnapshotId: latest.environmentSnapshotId,
    randomKeys: [],
    mergedFrom: observations.map(observation => observation.id),
    mergeRuleVersion: options.ruleVersion,
  });
  return { merged, originals };
}
