/**
 * Обмен с внешними системами в GeoJSON (RFC 7946).
 *
 * Экспорт без потерь: геометрия — стандартная (LineString / Polygon / Point),
 * всё оформление знака — в properties.defops, поэтому любая ГИС покажет
 * геометрию, а наша платформа восстановит знак полностью.
 * Импорт принимает и «свой» GeoJSON, и чужой (без properties.defops) —
 * тогда знак строится из заданных пресетов.
 */
import type { LngLat } from './geo';
import type { Feature, Layer, MapDocument } from './model';
import { newId } from './model';
import { createContext } from './render/index';
import { arrowAxisPoints } from './render/arrow';
import { createFeature } from './factory';
import { pickLayer } from './layers';
import type { PresetKind } from './presets';

type Position = [number, number];
export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface GeoJSONFeature {
  type: 'Feature';
  id?: string | number;
  geometry: GeoJSONGeometry | null;
  properties: Record<string, unknown> | null;
}

export interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
  /** Внешний член коллекции: описание слоёв документа. */
  layers?: Layer[];
  name?: string;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const pos = (p: LngLat): Position => [r6(p[0]), r6(p[1])];

/** Экспорт документа (или выбранных слоёв) в GeoJSON. */
export function toGeoJSON(doc: MapDocument, opts: { layers?: string[]; includeHidden?: boolean } = {}): GeoJSONCollection {
  const ctx = createContext(doc);
  const only = opts.layers ? new Set(opts.layers) : null;
  const layerById = new Map(doc.layers.map((l) => [l.id, l]));
  const out: GeoJSONFeature[] = [];
  for (const f of doc.features) {
    const layer = layerById.get(f.layerId);
    if (only && !only.has(f.layerId)) continue;
    if (!only && !opts.includeHidden && (f.hidden || (layer && !layer.visible))) continue;
    let geometry: GeoJSONGeometry;
    if (f.kind === 'symbol' || f.kind === 'label') geometry = { type: 'Point', coordinates: pos(f.at) };
    else if (f.kind === 'area') geometry = { type: 'Polygon', coordinates: [[...f.points, f.points[0]].map(pos)] };
    else if (f.kind === 'arrow') {
      // хвост привязанной стрелки — в фактической точке на линии фронта
      const pts = arrowAxisPoints(f, ctx).pts.map((p) => ctx.proj.toLngLat(p));
      geometry = { type: 'LineString', coordinates: pts.map(pos) };
    } else geometry = { type: 'LineString', coordinates: (f.closed ? [...f.points, f.points[0]] : f.points).map(pos) };
    const { id, kind, layerId, name, ...rest } = f as Feature & Record<string, unknown>;
    delete (rest as Record<string, unknown>).points;
    delete (rest as Record<string, unknown>).at;
    out.push({
      type: 'Feature',
      id,
      geometry,
      properties: {
        kind, layerId, layer: layer?.name ?? null, name: name ?? null,
        text: f.kind === 'label' ? f.text : null,
        defops: { ...rest, points: 'points' in f ? f.points : undefined, at: 'at' in f ? f.at : undefined },
      },
    });
  }
  return {
    type: 'FeatureCollection',
    name: doc.name,
    layers: doc.layers.filter((l) => !only || only.has(l.id)),
    features: out,
  };
}

export interface ImportOptions {
  /** Слой для объектов без указания слоя (по умолчанию — по смыслу пресета). */
  layerId?: string;
  /** Пресеты для «чужой» геометрии. */
  presets?: { line?: string; area?: string; point?: string; label?: string };
  /** Масштаб знаков (см. createFeature). */
  scale?: number;
}

/** Импорт GeoJSON в документ. Возвращает новый документ и список id добавленных объектов. */
export function fromGeoJSON(doc: MapDocument, fc: GeoJSONCollection, opts: ImportOptions = {}): { doc: MapDocument; added: string[] } {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('Ожидается GeoJSON FeatureCollection');
  const next: MapDocument = { ...doc, layers: doc.layers.slice(), features: doc.features.slice() };
  // слои из коллекции, которых ещё нет в документе
  for (const l of fc.layers ?? []) if (!next.layers.some((x) => x.id === l.id)) next.layers.push({ ...l });
  const existing = new Set(next.features.map((f) => f.id));
  const idMap = new Map<string, string>();
  const added: string[] = [];
  const pre = { line: 'atlas.defense', area: 'atlas.encircled', point: 'atlas.town', label: 'atlas.city', ...opts.presets };

  const push = (f: Feature) => { next.features.push(f); added.push(f.id); existing.add(f.id); };

  for (const g of fc.features) {
    if (!g?.geometry) continue;
    const props = g.properties ?? {};
    const own = props.defops as Record<string, unknown> | undefined;
    if (own && typeof props.kind === 'string') {
      // свой формат — восстанавливаем объект целиком
      let id = String(g.id ?? newId('f'));
      if (existing.has(id)) { const nid = newId(String(props.kind)[0]); idMap.set(id, nid); id = nid; }
      const layerId = typeof props.layerId === 'string' && next.layers.some((l) => l.id === props.layerId) ? props.layerId : '';
      const f = { ...own, id, kind: props.kind, name: props.name ?? undefined, layerId } as unknown as Feature;
      if (f.kind === 'label' && typeof props.text === 'string') f.text = props.text;
      if (!f.layerId) f.layerId = opts.layerId ?? pickLayer(next, f.kind, f.preset);
      push(f);
      continue;
    }
    // чужой GeoJSON: геометрия → знак из пресета
    const name = typeof props.name === 'string' ? props.name : undefined;
    const geoms: GeoJSONGeometry[] =
      g.geometry.type === 'MultiLineString' ? g.geometry.coordinates.map((c) => ({ type: 'LineString', coordinates: c }) as GeoJSONGeometry)
      : g.geometry.type === 'MultiPolygon' ? g.geometry.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }) as GeoJSONGeometry)
      : [g.geometry];
    for (const geom of geoms) {
      let kind: PresetKind, preset: string, gm: Parameters<typeof createFeature>[2];
      if (geom.type === 'Point') {
        kind = name ? 'label' : 'symbol'; preset = name ? pre.label : pre.point;
        gm = { at: geom.coordinates as LngLat, text: name };
      } else if (geom.type === 'LineString') {
        kind = 'line'; preset = pre.line; gm = { points: geom.coordinates as LngLat[] };
      } else if (geom.type === 'Polygon') {
        kind = 'area'; preset = pre.area;
        const ring = geom.coordinates[0].slice();
        if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
        gm = { points: ring as LngLat[] };
      } else continue;
      const f = createFeature(kind, preset, { ...gm, layerId: opts.layerId ?? pickLayer(next, kind, preset) }, opts.scale ?? 1);
      if (name) f.name = name;
      push(f);
    }
  }
  // привязки стрелок к переименованным объектам
  if (idMap.size) {
    next.features = next.features.map((f) =>
      f.kind === 'arrow' && f.anchor && idMap.has(f.anchor.featureId) && added.includes(f.id)
        ? { ...f, anchor: { ...f.anchor, featureId: idMap.get(f.anchor.featureId)! } } : f);
  }
  return { doc: next, added };
}
