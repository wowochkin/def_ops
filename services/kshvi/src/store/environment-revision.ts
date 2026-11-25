import type { EnvironmentSnapshot, Bounds } from '../../../../packages/kshvi/src/environment/provider';
import { emptyPreparationDraft, validatePreparationDraft, type PreparationDraft } from '../../../../packages/kshvi/src/scenario/preparation-draft';
import type { InitialSituationMap, MapGeometry } from '../../../../packages/kshvi/src/scenario/initial-map';
import type { ReadinessArea, ReadinessConfirmation } from '../../../../packages/kshvi/src/scenario/sealing';
import type { ExerciseEvidenceProvider, ExerciseRevision } from './exercise-store';

export type ReplaceEnvironmentInput = Readonly<{ expectedRevision: number; snapshotId: string }>;
export type EnvironmentImpactInput = Readonly<{ expectedRevision: number; bounds: Bounds }>;
export type EnvironmentImpact = Readonly<{
  objects: readonly Readonly<{ id: string; kind: string; outside: boolean }>[];
  confirmations: readonly Readonly<{ id: string; area: ReadinessArea }>[];
  missingForceIds: readonly string[];
}>;

export function revisionEnvironmentId(revision: ExerciseRevision): string | null {
  const payload = revision.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return revision.sealedArtifact?.initialMap.environment.snapshotId ?? null;
  if (Object.hasOwn(payload, 'preparation')) return validatePreparationDraft(payload.preparation).environmentSnapshotId;
  return typeof payload.environmentSnapshotId === 'string' ? payload.environmentSnapshotId : revision.sealedArtifact?.initialMap.environment.snapshotId ?? null;
}

export function checkedEnvironmentBounds(bounds: Bounds): Bounds {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
    || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -90 || bounds[3] > 90
    || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) throw new Error('Укажите корректные границы области');
  return bounds;
}

type ChangeSource = Readonly<{ draft: PreparationDraft; map: InitialSituationMap | null; confirmations: readonly ReadinessConfirmation[] }>;

export async function environmentChangeSource(revision: ExerciseRevision, evidence?: ExerciseEvidenceProvider): Promise<ChangeSource> {
  const payload = revision.payload;
  const preparation = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.preparation : undefined;
  const draft = preparation === undefined ? emptyPreparationDraft(revision.createdAt) : validatePreparationDraft(preparation);
  const [map, confirmations] = await Promise.all([
    draft.initialMap ?? revision.sealedArtifact?.initialMap ?? evidence?.approvedMap?.(revision) ?? null,
    revision.sealedArtifact?.confirmations ?? evidence?.confirmations?.(revision) ?? [],
  ]);
  return { draft, map, confirmations };
}

function outside(geometry: MapGeometry, bounds: Bounds): boolean {
  const points = geometry.type === 'Point' ? [geometry.coordinates]
    : geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates.flat();
  return points.some(([lon, lat]) => lon < bounds[0] || lon > bounds[2] || lat < bounds[1] || lat > bounds[3]);
}

function forceOutside(value: unknown, bounds: Bounds): boolean {
  if (!value || typeof value !== 'object' || !('coordinates' in value) || !Array.isArray(value.coordinates)) return false;
  if (!('type' in value) || !['Point', 'LineString', 'Polygon'].includes(String(value.type))) return false;
  const { coordinates } = value;
  const points = value.type === 'Point' ? [coordinates] : value.type === 'Polygon' ? coordinates.flat() : coordinates;
  if (!points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) return false;
  return outside(value as MapGeometry, bounds);
}

export function inspectEnvironmentChange({ draft, map, confirmations }: ChangeSource, bounds: Bounds): EnvironmentImpact {
  const objects: { id: string; kind: string; outside: boolean }[] = [];
  const forceIds = new Set(draft.forces.map(force => force.id));
  const missingForceIds = new Set<string>();
  if (map) {
    objects.push({ id: map.id, kind: 'Исходная карта', outside: false });
    for (const marker of map.markers) {
      objects.push({ id: marker.id, kind: 'Объект исходной карты', outside: marker.geometry ? outside(marker.geometry, bounds) : false });
      if (marker.links.forceId && !forceIds.has(marker.links.forceId)) missingForceIds.add(marker.links.forceId);
    }
  }
  for (const force of draft.forces) {
    const geometry = force.position.geometry;
    objects.push({ id: force.id, kind: 'Сила', outside: (geometry.status === 'KNOWN' && forceOutside(geometry.value, bounds))
      || Boolean(map?.markers.some(marker => marker.links.forceId === force.id && marker.geometry && outside(marker.geometry, bounds))) });
  }
  const routes = new Set([...(draft.formation?.routes.map(route => route.id) ?? []), ...(draft.logistics?.routes.map(route => route.routeId) ?? [])]);
  for (const id of routes) {
    objects.push({ id, kind: 'Маршрут', outside: Boolean(map?.markers.some(marker => marker.kind === 'ROUTE'
      && marker.geometry && (marker.id === id || marker.routeId === id) && outside(marker.geometry, bounds))) });
  }
  if (draft.autonomy) objects.push({ id: draft.autonomy.profileId, kind: 'Профиль событий', outside: false });
  return { objects, confirmations: confirmations.map(({ id, area }) => ({ id, area })), missingForceIds: [...missingForceIds].sort() };
}

export function bindEnvironmentToDraft(draft: PreparationDraft, snapshot: EnvironmentSnapshot, sourceMap = draft.initialMap): PreparationDraft {
  if (!sourceMap) return { ...draft, environmentSnapshotId: snapshot.id };
  const { sha256: _sha, ...map } = sourceMap;
  return {
    ...draft, environmentSnapshotId: snapshot.id, initialMapStatus: 'DRAFT',
    initialMap: {
      ...map, state: 'DRAFT', revision: map.revision + 1, bounds: snapshot.region.bounds,
      environment: { snapshotId: snapshot.id, manifestSha256: snapshot.manifestSha256, bounds: snapshot.region.bounds },
      initialOperationalAt: snapshot.operationalTime?.operationalAt ?? map.initialOperationalAt,
      timeZone: snapshot.operationalTime?.timeZone ?? map.timeZone,
      weatherFrameRef: snapshot.weather.contentRef?.path ?? snapshot.weather.sourceId,
      terrainStateRef: snapshot.atlases.find(atlas => atlas.elevations.contentRef)?.elevations.contentRef?.path ?? 'UNKNOWN: высотный кадр не зафиксирован',
      attribution: [...snapshot.atlases.map(atlas => atlas.attribution), snapshot.weather.attribution],
    },
  };
}
