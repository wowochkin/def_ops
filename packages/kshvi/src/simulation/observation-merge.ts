import type { Observation } from './observation';

function distanceMeters(left: Observation['reportedGeometry'], right: Observation['reportedGeometry']): number {
  return Math.hypot((left.lon - right.lon) * 111_320 * Math.cos((left.lat + right.lat) * Math.PI / 360), (left.lat - right.lat) * 110_540);
}

export function mergeObservations(observations: readonly Observation[], options: { id: string; ruleVersion: number }) {
  if (options.ruleVersion !== 1) throw new Error('Неподдерживаемая версия правила слияния наблюдений');
  if (observations.length === 0 || !options.id.trim()) throw new Error('Слияние требует наблюдения и новый идентификатор');
  if (new Set(observations.map(observation => observation.source.sideId)).size !== 1) throw new Error('Нельзя объединять наблюдения разных сторон без отдельного правила');
  if (new Set(observations.map(observation => observation.trueForceId)).size !== 1 || observations[0].trueForceId === null) {
    throw new Error('Нельзя объединять наблюдения разных объектов или с неизвестной объектной связью');
  }
  for (let left = 0; left < observations.length; left += 1) {
    for (let right = left + 1; right < observations.length; right += 1) {
      const allowed = observations[left].reportedAccuracyMeters + observations[right].reportedAccuracyMeters;
      if (distanceMeters(observations[left].reportedGeometry, observations[right].reportedGeometry) > allowed) {
        throw new Error('Противоречивые положения наблюдений требуют рассмотрения, а не слияния');
      }
    }
  }
  const originals = structuredClone(observations);
  const weighted = observations.map(observation => ({ observation, weight: observation.reliability / Math.max(1, observation.reportedAccuracyMeters) ** 2 }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const lon = weighted.reduce((sum, item) => sum + item.observation.reportedGeometry.lon * item.weight, 0) / totalWeight;
  const lat = weighted.reduce((sum, item) => sum + item.observation.reportedGeometry.lat * item.weight, 0) / totalWeight;
  const latest = [...observations].sort((a, b) => Date.parse(a.deliveredAt) - Date.parse(b.deliveredAt)).at(-1)!;
  const stale = observations.some(observation => observation.status === 'STALE');
  const merged: Observation = Object.freeze({
    id: options.id,
    trueForceId: observations[0].trueForceId,
    actualErrorMeters: null,
    source: { id: options.id, kind: 'MERGED', sideId: latest.source.sideId, profileVersion: 'weighted-centroid-v1' },
    observedAt: latest.observedAt,
    deliveredAt: latest.deliveredAt,
    validUntil: observations.map(observation => observation.validUntil).sort()[0],
    reportedGeometry: { lon, lat },
    reportedAttributes: structuredClone(latest.reportedAttributes),
    reportedAccuracyMeters: Math.max(...observations.map(observation => observation.reportedAccuracyMeters)),
    completeness: Math.min(...observations.map(observation => observation.completeness)),
    reliability: Math.min(...observations.map(observation => observation.reliability)),
    status: stale ? 'STALE' : 'CURRENT',
    staleSince: stale ? observations.find(observation => observation.staleSince)?.staleSince : undefined,
    environmentSnapshotId: latest.environmentSnapshotId,
    randomKeys: [],
    mergedFrom: observations.map(observation => observation.id),
    mergeRuleVersion: options.ruleVersion,
  });
  return { merged, originals };
}
