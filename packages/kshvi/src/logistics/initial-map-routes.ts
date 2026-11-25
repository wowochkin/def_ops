import type { InitialSituationMap, MapMarker, Position } from '../scenario/initial-map';
import type { RouteGraph, RouteGraphEdge } from '../terrain/route-graph';
import type { TerrainObject, TerrainState } from '../terrain/types';

function distanceMeters(a: Position, b: Position): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const deltaLat = toRad(b[1] - a[1]);
  const deltaLon = toRad(((b[0] - a[0] + 540) % 360) - 180);
  const lat1 = toRad(a[1]), lat2 = toRad(b[1]);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function status(marker: MapMarker): TerrainObject['status'] {
  return marker.passable === true ? 'OPEN' : marker.passable === false ? 'CLOSED' : 'UNKNOWN';
}

function baseObject(marker: MapMarker, kind: TerrainObject['kind'], operationalAt: string): TerrainObject {
  if (!marker.geometry) throw new Error(`Объект ${marker.id} не имеет геометрии`);
  return {
    id: marker.id, kind, geometry: marker.geometry, status: status(marker), dataAt: operationalAt,
    source: marker.sourceId, uncertainty: marker.uncertainty.note,
    crossingMinutes: marker.crossingMinutes ?? (kind === 'ROAD' ? 0 : null),
  };
}

/** Строит проверяемый граф только из реальной геометрии и атрибутов исходной карты. */
export function terrainRoutesFromInitialMap(map: InitialSituationMap): Readonly<{ state: TerrainState; graph: RouteGraph }> {
  const at = map.initialOperationalAt;
  const objects: Record<string, TerrainObject> = {};
  const nodes: string[] = [];
  const edges: RouteGraphEdge[] = [];
  const pushNode = (id: string) => { if (!nodes.includes(id)) nodes.push(id); };
  const routeMarkers = map.markers.filter(marker => marker.kind === 'ROUTE' && marker.geometry?.type === 'LineString');
  for (const marker of routeMarkers) {
    const coordinates = marker.geometry!.type === 'LineString' ? marker.geometry!.coordinates : [];
    if (coordinates.length < 2) continue;
    const from = `${marker.id}:from`, to = `${marker.id}:to`;
    pushNode(from); pushNode(to);
    const crossing = (marker.links.linkedMarkerIds ?? []).map(id => map.markers.find(item => item.id === id)).find(item => item?.kind === 'CROSSING');
    const terrainObjectId = crossing?.id ?? marker.id;
    if (crossing) {
      objects[crossing.id] = { ...baseObject(crossing, 'BRIDGE', at), capacityTonnes: crossing.crossingCapacityTonnes ?? null };
    } else {
      objects[marker.id] = {
        ...baseObject(marker, 'ROAD', at),
        speedKph: { WHEELED: marker.speedKph ?? null, TRACKED: marker.speedKph ?? null, COLUMN: marker.speedKph ?? null },
      };
    }
    let length = 0;
    for (let index = 1; index < coordinates.length; index += 1) length += distanceMeters(coordinates[index - 1]!, coordinates[index]!);
    edges.push({ id: marker.id, from, to, distanceMeters: length, terrainObjectId, baseSpeedKph: marker.speedKph ?? null });
  }
  const state: TerrainState = {
    schemaVersion: 1, operationalAt: at, revision: map.revision, status: 'READY', unknown: [],
    objects, initialObjects: structuredClone(objects), history: [], queues: {},
    algorithmVersions: { H_v: 1, G_v: 1 }, profileId: map.terrainStateRef, profileVersion: 1, weatherEffectProfileVersion: 1,
  };
  return { state, graph: { nodes, edges } };
}
