/**
 * Театр как карта и как файлы: слои театра для просмотра (дороги, реки, мосты, районы, рубежи, контуры
 * местности), обрезка театра по области (с растром местности и дорог), выгрузка слоёв в GeoJSON и заготовка
 * рецепта для сборщика (tools/theatre/build_theatre.py) — чтобы собрать новый театр по выбранной области.
 */
import { createFeature, emptyDocument, type Feature, type Layer, type LngLat, type MapDocument, type SymbolFeature } from '@def-ops/core';
import { areaTitle } from './reports';
import type { TerrainGrid, TheatreData } from './types';

export type BBox = [number, number, number, number];

/** Слои театра: id, название, сколько объектов. */
export const THEATRE_LAYERS = [
  { id: 'terrain', title: 'Местность (растр)', geo: false },
  { id: 'terrainShapes', title: 'Местность: контуры', geo: true },
  { id: 'roads', title: 'Дороги и шоссе', geo: true },
  { id: 'rail', title: 'Железные дороги', geo: true },
  { id: 'rivers', title: 'Реки и каналы', geo: true },
  { id: 'bridges', title: 'Мосты и переправы', geo: true },
  { id: 'areas', title: 'Районы и пункты', geo: true },
  { id: 'lines', title: 'Рубежи и укреплённые полосы', geo: true },
] as const;
export type TheatreLayerId = (typeof THEATRE_LAYERS)[number]['id'];

const inBox = (b: BBox, p: LngLat) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
/** Линия задевает область: вершина внутри или отрезок пересекает её (проверка по рамке отрезка — с запасом). */
const touches = (b: BBox, l: LngLat[]) => l.some((p) => inBox(b, p)) || l.slice(1).some((p, i) => {
  const q = l[i];
  return Math.min(p[0], q[0]) <= b[2] && Math.max(p[0], q[0]) >= b[0] && Math.min(p[1], q[1]) <= b[3] && Math.max(p[1], q[1]) >= b[1];
});

export function layerCounts(T: TheatreData, b?: BBox): Record<TheatreLayerId, number> {
  const bb = b ?? T.bbox;
  return {
    terrain: T.terrainGrid ? 1 : 0,
    terrainShapes: T.terrain.filter((x) => touches(bb, x.ring)).length,
    roads: T.roads.filter((r) => r.kind !== 'rail' && touches(bb, r.line)).length,
    rail: T.roads.filter((r) => r.kind === 'rail' && touches(bb, r.line)).length,
    rivers: T.rivers.filter((r) => touches(bb, r.line)).length,
    bridges: T.bridges.filter((x) => inBox(bb, x.at)).length,
    areas: T.areas.filter((a) => touches(bb, a.ring)).length,
    lines: (T.lines ?? []).filter((l) => touches(bb, l.line)).length,
  };
}

function rleChars(rle: string, n: number): string[] {
  const out: string[] = [];
  let k = 0;
  for (const ch of rle) {
    if (ch >= '0' && ch <= '9') { k = k * 10 + (ch.charCodeAt(0) - 48); continue; }
    for (let i = 0; i < (k || 1); i++) out.push(ch);
    k = 0;
  }
  if (out.length !== n) throw new Error(`растр: ${out.length} клеток вместо ${n}`);
  return out;
}
function charsRle(a: string[]): string {
  let s = '';
  for (let i = 0; i < a.length;) { let j = i; while (j < a.length && a[j] === a[i]) j++; s += (j - i > 1 ? j - i : '') + a[i]; i = j; }
  return s;
}

/** Растр, обрезанный по области: целые клетки, границы — по краям клеток. */
export function cropGrid(g: TerrainGrid, b: BBox): TerrainGrid | null {
  const [w, s, e, n] = g.bbox, dx = (e - w) / g.cols, dy = (n - s) / g.rows;
  const c0 = Math.max(0, Math.floor((b[0] - w) / dx)), c1 = Math.min(g.cols, Math.ceil((b[2] - w) / dx));
  const r0 = Math.max(0, Math.floor((n - b[3]) / dy)), r1 = Math.min(g.rows, Math.ceil((n - b[1]) / dy));
  if (c1 <= c0 || r1 <= r0) return null;
  // растры бывают с разными кодами (местность — o/f/m/u/h/w, дороги — n/r/h): режем по буквам, не по классам
  const all = rleChars(g.rle, g.cols * g.rows), cols = c1 - c0, rows = r1 - r0;
  const out: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = c0; c < c1; c++) out.push(all[(r0 + r) * g.cols + c]);
  const r6 = (x: number) => +x.toFixed(6);
  return { bbox: [r6(w + c0 * dx), r6(n - r1 * dy), r6(w + c1 * dx), r6(n - r0 * dy)], cols, rows, rle: charsRle(out) };
}

/** Театр, обрезанный по области: объекты, задевающие её, и растры. */
export function cropTheatre(T: TheatreData, b: BBox, id = `${T.id}-crop`): TheatreData {
  const terrainGrid = T.terrainGrid ? cropGrid(T.terrainGrid, b) ?? undefined : undefined;
  const roadGrid = T.roadGrid ? cropGrid(T.roadGrid, b) ?? undefined : undefined;
  return {
    ...T, id, name: `${T.name} — фрагмент`, bbox: b,
    ...(terrainGrid ? { terrainGrid } : {}), ...(roadGrid ? { roadGrid } : {}),
    terrain: T.terrain.filter((x) => touches(b, x.ring)),
    roads: T.roads.filter((r) => touches(b, r.line)),
    rivers: T.rivers.filter((r) => touches(b, r.line)),
    bridges: T.bridges.filter((x) => inBox(b, x.at)),
    areas: T.areas.filter((a) => touches(b, a.ring)),
    lines: (T.lines ?? []).filter((l) => touches(b, l.line)),
  };
}

type GJ = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };
const fc = (features: GJ['features']): GJ => ({ type: 'FeatureCollection', features });
const ring = (r: LngLat[]) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

/** Слой театра в GeoJSON (объекты, задевающие область). */
export function layerGeoJSON(T: TheatreData, layer: TheatreLayerId, b?: BBox): GJ {
  const bb = b ?? T.bbox;
  switch (layer) {
    case 'terrainShapes': return fc(T.terrain.filter((x) => touches(bb, x.ring)).map((x) => ({ type: 'Feature', properties: { class: x.class }, geometry: { type: 'Polygon', coordinates: [ring(x.ring)] } })));
    case 'roads': case 'rail': return fc(T.roads.filter((r) => (layer === 'rail') === (r.kind === 'rail') && touches(bb, r.line)).map((r) => ({ type: 'Feature', properties: { kind: r.kind, name: r.name ?? null }, geometry: { type: 'LineString', coordinates: r.line } })));
    case 'rivers': return fc(T.rivers.filter((r) => touches(bb, r.line)).map((r) => ({ type: 'Feature', properties: { name: r.name, major: r.major }, geometry: { type: 'LineString', coordinates: r.line } })));
    case 'bridges': return fc(T.bridges.filter((x) => inBox(bb, x.at)).map((x) => ({ type: 'Feature', properties: { id: x.id, name: x.name ?? null, kind: x.kind ?? null, openFrom: x.openFrom ?? null, destroyedAt: x.destroyedAt ?? null, side: x.side ?? null }, geometry: { type: 'Point', coordinates: x.at } })));
    case 'areas': return fc(T.areas.filter((a) => touches(bb, a.ring)).map((a) => ({ type: 'Feature', properties: { id: a.id, name: a.name, title: areaTitle(a.name) }, geometry: { type: 'Polygon', coordinates: [ring(a.ring)] } })));
    case 'lines': return fc((T.lines ?? []).filter((l) => touches(bb, l.line)).map((l) => ({ type: 'Feature', properties: { id: l.id, name: l.name, fortification: l.fortification ?? null, side: l.side ?? null, depthKm: l.depthKm ?? null }, geometry: { type: 'LineString', coordinates: l.line } })));
    default: return fc([]);
  }
}

/**
 * Рецепт сборщика театра по области (как data/theatres/src/*.recipe.json) — готовый к сборке: местность и рельеф
 * по правилам встроенных театров, большие реки — по длине в охвате, районы — населённые пункты OpenStreetMap.
 * Исторический слой (рубежи, разрушенные мосты, переправы, автобаны 1945 г.) дописывается вручную.
 */
export function recipeFor(o: { id: string; name: string; bbox: BBox; cellKm: number; places?: ('city' | 'town' | 'village')[] }): Record<string, unknown> {
  const lat = (o.bbox[1] + o.bbox[3]) / 2;
  const dLat = +(o.cellKm / 111.32).toFixed(5), dLng = +(o.cellKm / (111.32 * Math.cos((lat * Math.PI) / 180))).toFixed(5);
  const spanKm = Math.max((o.bbox[2] - o.bbox[0]) * 111.32 * Math.cos((lat * Math.PI) / 180), (o.bbox[3] - o.bbox[1]) * 111.32);
  return {
    id: o.id, name: o.name, bbox: o.bbox.map((x) => +x.toFixed(4)), cellKm: o.cellKm, defaultTerrain: 'open',
    grid: { dLng, dLat },
    landcover: { source: 'esa-worldcover-2021', rules: { water: 0.5, urban: 0.35, marsh: 0.3, forest: 0.5 } },
    relief: { source: 'copernicus-dem-90', smoothPx: 5, hillsReliefM: 35, hillsSlope: 0.025 },
    rivers: { major: [], minor: [], autoMajorKm: Math.max(5, Math.round(spanKm / 6)) },
    roads: { highwayRefs: [], roadHighways: o.cellKm <= 0.5 ? ['trunk', 'primary', 'secondary'] : ['trunk', 'primary'], simplifyDeg: +(o.cellKm * 0.003).toFixed(4) },
    rail: { simplifyDeg: +(o.cellKm * 0.003).toFixed(4) },
    bridges: { dedupeKm: Math.max(0.2, o.cellKm / 2), rules: [], crossings: [] },
    areas: { explicit: [], fromOsm: { places: o.places ?? (o.cellKm <= 0.5 ? ['city', 'town', 'village', 'suburb'] : ['city', 'town']) } },
    lines: [],
    osmParts: spanKm > 250 ? 3 : spanKm > 120 ? 2 : 1,
    sources: [
      'Земной покров: ESA WorldCover 10 m 2021 v200 (CC BY 4.0), © ESA WorldCover project / Copernicus Sentinel data',
      'Рельеф: Copernicus DEM GLO-90 (© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, Copernicus programme)',
      'Реки, дороги, железные дороги, населённые пункты: © участники OpenStreetMap (ODbL), выборка через Overpass API',
    ],
    caveats: ['Земной покров и дорожная сеть современные; исторический слой (рубежи, переправы, разрушенные мосты, шоссе того времени) не задан — дополните рецепт.'],
  };
}

const TERR_PRESET: Record<string, string | null> = { forest: 'std.forest', marsh: 'std.swamp' };

/** Театр — документ карты: слои театра (растр местности добавляет просмотр — он рисуется в браузере). */
export function theatreToDocument(T: TheatreData): MapDocument {
  const [w, s, e, n] = T.bbox;
  const span = Math.max(e - w, (n - s) * 1.6, 0.05);
  const doc = emptyDocument([(w + e) / 2, (s + n) / 2], +(Math.log2((360 * 900) / (256 * span)) - 0.4).toFixed(1));
  doc.name = `Театр: ${T.name}`;
  const mk = (id: TheatreLayerId, name: string, visible = true, opacity = 1): Layer => ({ id: `th-${id}`, name, role: 'base', visible, locked: true, opacity, source: { system: 'theatre', ref: T.id, readOnly: true } });
  doc.layers = [mk('terrainShapes', 'Местность: контуры', false, 0.6), mk('areas', 'Районы и пункты', true, 0.7), mk('rail', 'Железные дороги'), mk('roads', 'Дороги и шоссе'), mk('rivers', 'Реки и каналы'), mk('lines', 'Рубежи'), mk('bridges', 'Мосты и переправы')];
  const F: Feature[] = [];
  for (const x of T.terrain) {
    const p = TERR_PRESET[x.class];
    const f = p ? createFeature('area', p, { points: x.ring, layerId: 'th-terrainShapes' }, 1) : createFeature('line', 'std.border', { points: [...x.ring, x.ring[0]], layerId: 'th-terrainShapes' }, 0.6, 'neutral');
    f.name = `Местность: ${({ forest: 'лес', marsh: 'болото', urban: 'город', hills: 'высоты', water: 'вода', open: 'открытая' } as Record<string, string>)[x.class] ?? x.class}`;
    F.push(f);
  }
  for (const a of T.areas) {
    const f = createFeature('line', 'std.border', { points: [...a.ring, a.ring[0]], layerId: 'th-areas' }, 0.5, 'neutral');
    f.name = `${areaTitle(a.name)} · ${a.id}`;
    F.push(f);
  }
  for (const r of T.roads) {
    const f = createFeature('line', r.kind === 'rail' ? 'inf.rail' : r.kind === 'highway' ? 'std.road' : 'std.dirtRoad', { points: r.line, layerId: r.kind === 'rail' ? 'th-rail' : 'th-roads' }, r.kind === 'highway' ? 1 : 0.7);
    f.name = r.name ? `${r.kind === 'rail' ? 'Ж/д' : r.kind === 'highway' ? 'Шоссе' : 'Дорога'}: ${r.name}` : r.kind === 'rail' ? 'Железная дорога' : r.kind === 'highway' ? 'Шоссе' : 'Дорога';
    F.push(f);
  }
  for (const r of T.rivers) {
    const f = createFeature('line', 'inf.river', { points: r.line, layerId: 'th-rivers' }, r.major ? 1.3 : 0.7);
    f.name = `${r.name}${r.major ? ' (большая река)' : ''}`;
    F.push(f);
  }
  for (const l of T.lines ?? []) {
    const f = createFeature('line', 'atlas.defense', { points: l.line, layerId: 'th-lines' }, 1.2, l.side ? 'enemy' : 'neutral');
    f.name = `${l.name}${l.fortification ? ` · укреплённость ${l.fortification}` : ''}`;
    F.push(f);
  }
  for (const b of T.bridges) {
    const f = createFeature('symbol', b.destroyedAt ? 'std.bridgeDestroyed' : b.openFrom ? 'std.pontoon' : 'std.bridge', { at: b.at, layerId: 'th-bridges' }, 0.6, 'neutral') as SymbolFeature;
    f.name = `${b.name ?? 'Мост'}${b.openFrom ? ` · наведён ${b.openFrom.slice(0, 10)}` : ''}${b.destroyedAt ? ` · разрушен ${b.destroyedAt.slice(0, 10)}` : ''}`;
    F.push(f);
  }
  doc.features = F;
  return doc;
}
