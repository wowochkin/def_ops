/**
 * Объекты OpenHistoricalMap → признаки слоёв векторной карты.
 *
 * Объекты всех участков собираются по id (тот же путь на стыке участков — один); признаки
 * строятся после загрузки всех участков: кольца мультиполигонов и линии границ — из путей,
 * пришедших в любом участке (отношения в ответе — только ссылки на членов). Отношение,
 * чьё кольцо не замкнулось (член за краем района), пропускается.
 *
 * Границы: один путь входит в отношения-границы разных лет (у театра — до ~40 отношений на путь).
 * Признак строится не на каждое отношение, а на путь и уровень (admin_level): промежутки
 * действия отношений сливаются (пересекающиеся и смежные — до суток; открытый конец поглощает
 * всё с его стороны), на каждый слитый промежуток — один признак с общими координатами пути.
 */
import type { Feature, LineString, Point, Polygon } from 'geojson';
import { countRu, ohmYear, pointInRing, ringClosed, stitchRings, type LngLat, type OverpassElement, type OverpassJson } from '@def-ops/core';

export type OhmLayer = 'roads' | 'rail' | 'water' | 'landuse' | 'buildings' | 'boundaries' | 'places' | 'pois';
export const OHM_LAYERS: OhmLayer[] = ['roads', 'rail', 'water', 'landuse', 'buildings', 'boundaries', 'places', 'pois'];

export interface OhmProps {
  layer: OhmLayer;
  class: string;
  /** Уровень, с которого признак попадает в тайлы. */
  minzoom: 0 | 8 | 10 | 13;
  /** `n1`, `w10`, `r100/0` (номер внешнего кольца), `w16/0` (граница по пути: номер слитого промежутка). */
  id: string;
  name?: string;
  /** Начало и конец, десятичный год (4 знака); нет — «всегда». */
  from?: number;
  to?: number;
  bridge?: 1;
  tunnel?: 1;
  admin_level?: number;
}
export type OhmFeature = Feature<Point | LineString | Polygon, OhmProps>;

type Tags = Record<string, string>;
type Cls = Pick<OhmProps, 'layer' | 'class' | 'minzoom'>;

/** Значение → уровень появления. */
const ROADS: Record<string, OhmProps['minzoom']> = {};
for (const [z, vs] of [
  [0, 'motorway trunk primary motorway_link trunk_link primary_link'],
  [8, 'secondary tertiary secondary_link tertiary_link'],
  [10, 'unclassified residential living_street road'],
  [13, 'service track path footway cycleway bridleway steps pedestrian'],
] as const) for (const v of vs.split(' ')) ROADS[v] = z;
const RAIL: Record<string, OhmProps['minzoom']> = { rail: 0, light_rail: 10, narrow_gauge: 10, subway: 10, tram: 10, funicular: 10, monorail: 10 };
const WATERWAYS: Record<string, OhmProps['minzoom']> = { river: 0, canal: 0, stream: 10, ditch: 10, drain: 10 };
const LANDUSE = new Set('forest farmland meadow grass residential industrial commercial retail cemetery allotments orchard vineyard military railway quarry farmyard'.split(' '));
const NATURAL = new Set(['wood', 'heath', 'scrub', 'grassland', 'wetland']);
const LEISURE = new Set(['park', 'garden']);
const PLACES: Record<string, OhmProps['minzoom']> = {
  city: 0, town: 0, village: 8, suburb: 10, hamlet: 10, quarter: 10, neighbourhood: 10, isolated_dwelling: 10, locality: 10,
};
const HISTORIC = new Set(['castle', 'monument', 'memorial', 'fort']);

const isWater = (t: Tags) => t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.water !== undefined;

/** Теги площади (замкнутый путь с ними — многоугольник, иначе — линия). */
export function isArea(tags: Tags): boolean {
  if (tags.area === 'no') return false;
  if (tags.building !== undefined && tags.building !== 'no') return true;
  return tags.landuse !== undefined || NATURAL.has(tags.natural) || isWater(tags) || tags.leisure !== undefined
    || tags.amenity === 'grave_yard' || (tags.area === 'yes' && tags.highway === undefined);
}

const boundaryClass = (t: Tags): Cls => {
  const lvl = Number(t.admin_level);
  return Number.isFinite(lvl) && lvl <= 4 ? { layer: 'boundaries', class: 'country', minzoom: 0 } : { layer: 'boundaries', class: 'admin', minzoom: 8 };
};

/** Слой, класс и уровень появления объекта по таблице слоёв; не подходит — null. */
export function classify(tags: Tags, geom: 'point' | 'line' | 'area'): Cls | null {
  if (geom === 'point') {
    if (Object.hasOwn(PLACES, tags.place)) return { layer: 'places', class: tags.place, minzoom: PLACES[tags.place] };
    if (tags.amenity === 'place_of_worship' || tags.amenity === 'townhall') return { layer: 'pois', class: tags.amenity, minzoom: 13 };
    if (tags.railway === 'station' || tags.railway === 'halt') return { layer: 'pois', class: 'station', minzoom: 13 };
    if (HISTORIC.has(tags.historic)) return { layer: 'pois', class: tags.historic, minzoom: 13 };
    return null;
  }
  if (geom === 'line') {
    if (Object.hasOwn(ROADS, tags.highway)) return { layer: 'roads', class: tags.highway, minzoom: ROADS[tags.highway] };
    if (Object.hasOwn(RAIL, tags.railway)) return { layer: 'rail', class: tags.railway, minzoom: RAIL[tags.railway] };
    if (Object.hasOwn(WATERWAYS, tags.waterway)) return { layer: 'water', class: tags.waterway, minzoom: WATERWAYS[tags.waterway] };
    if (tags.boundary === 'administrative') return boundaryClass(tags);
    return null;
  }
  if (tags.building !== undefined && tags.building !== 'no') return { layer: 'buildings', class: tags.building, minzoom: 13 };
  if (isWater(tags)) return { layer: 'water', class: 'water', minzoom: 0 };
  if (LANDUSE.has(tags.landuse)) return { layer: 'landuse', class: tags.landuse, minzoom: 8 };
  if (NATURAL.has(tags.natural)) return { layer: 'landuse', class: tags.natural, minzoom: 8 };
  if (LEISURE.has(tags.leisure)) return { layer: 'landuse', class: tags.leisure, minzoom: 8 };
  if (tags.amenity === 'grave_yard') return { layer: 'landuse', class: 'cemetery', minzoom: 8 };
  return null;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Общие свойства из тегов: имя, даты, мост и тоннель, уровень границы. */
function props(cls: Cls, id: string, t: Tags): OhmProps {
  const p: OhmProps = { ...cls, id };
  if (t.name) p.name = t.name;
  const from = ohmYear(t.start_date), to = ohmYear(t.end_date, true);
  if (from !== null) p.from = round4(from);
  if (to !== null) p.to = round4(to);
  if (t.bridge && t.bridge !== 'no') p.bridge = 1;
  if (t.tunnel && t.tunnel !== 'no') p.tunnel = 1;
  if (cls.layer === 'boundaries') {
    const lvl = Number(t.admin_level);
    if (t.admin_level !== undefined && Number.isFinite(lvl)) p.admin_level = lvl;
  }
  return p;
}

/** Промежуток действия границы (без даты — бесконечность) и имя (разные имена — без имени). */
interface Span { from: number; to: number; name?: string }
/** Смежные промежутки (зазор не больше суток) сливаются. */
const SPAN_GAP = 1.5 / 365;

/** Слить пересекающиеся и смежные промежутки; по возрастанию начала. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to + SPAN_GAP) {
      if (s.to > last.to) last.to = s.to;
      if (last.name !== s.name) last.name = undefined;
    } else out.push({ ...s });
  }
  return out;
}

const coords = (w: OverpassElement): LngLat[] => (w.geometry ?? []).filter(Boolean).map((g) => [g.lon, g.lat] as LngLat);
const byId = (a: OverpassElement, b: OverpassElement) => a.id - b.id;

/** Только нужные поля объекта: ответ Overpass несёт ещё `nodes` и `bounds` путей (память на театр). */
function slim(el: OverpassElement): OverpassElement {
  const out: OverpassElement = { type: el.type, id: el.id };
  if (el.tags) out.tags = el.tags;
  if (el.type === 'node') { out.lat = el.lat; out.lon = el.lon; }
  else if (el.type === 'way') { if (el.geometry) out.geometry = el.geometry; }
  else if (el.members) out.members = el.members;
  return out;
}

/** Объекты всех участков по id; признаки — после загрузки всех участков. */
export class OhmCollector {
  private nodes = new Map<number, OverpassElement>();
  private ways = new Map<number, OverpassElement>();
  private rels = new Map<number, OverpassElement>();

  /** Добавить ответ участка; возвращает число новых объектов (дубликаты на стыке не считаются). */
  add(json: OverpassJson): number {
    let n = 0;
    for (const el of json.elements ?? []) {
      const m = el.type === 'node' ? this.nodes : el.type === 'way' ? this.ways : el.type === 'relation' ? this.rels : null;
      if (!m || m.has(el.id)) continue;
      m.set(el.id, slim(el));
      n++;
    }
    return n;
  }

  get counts(): { nodes: number; ways: number; relations: number } {
    return { nodes: this.nodes.size, ways: this.ways.size, relations: this.rels.size };
  }

  features(): OhmFeature[] {
    const out: OhmFeature[] = [];
    /** Границы по пути и уровню: геометрия, класс, промежутки (с именем). */
    const bounds = new Map<string, { way: number; c: LngLat[]; cls: Cls; level?: number; spans: Span[] }>();
    const boundary = (wayId: number, c: LngLat[], cls: Cls, t: Tags) => {
      const p = props(cls, '', t);
      const k = `${wayId}|${p.admin_level ?? ''}`;
      let b = bounds.get(k);
      if (!b) bounds.set(k, b = { way: wayId, c, cls, level: p.admin_level, spans: [] });
      b.spans.push({ from: p.from ?? -Infinity, to: p.to ?? Infinity, name: p.name });
    };

    for (const n of [...this.nodes.values()].sort(byId)) {
      const t = n.tags ?? {};
      if (n.lat === undefined || n.lon === undefined) continue;
      const cls = classify(t, 'point');
      if (!cls || (cls.layer === 'pois' && !t.name)) continue;
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [n.lon, n.lat] }, properties: props(cls, `n${n.id}`, t) });
    }

    for (const w of [...this.ways.values()].sort(byId)) {
      const t = w.tags;
      if (!t) continue;
      const c = coords(w);
      if (c.length < 2) continue;
      const area = isArea(t) && ringClosed(c) ? classify(t, 'area') : null;
      if (area) {
        out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [c] }, properties: props(area, `w${w.id}`, t) });
        continue;
      }
      const line = classify(t, 'line');
      if (!line) continue;
      if (line.layer === 'boundaries') { boundary(w.id, c, line, t); continue; }
      out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: props(line, `w${w.id}`, t) });
    }

    for (const r of [...this.rels.values()].sort(byId)) {
      const t = r.tags ?? {};
      const members = (r.members ?? []).filter((m) => m.type === 'way');
      if (t.type === 'multipolygon') {
        const cls = classify(t, 'area');
        if (!cls) continue;
        const part = (inner: boolean) => members
          .filter((m) => (m.role === 'inner') === inner && (inner || m.role === 'outer' || m.role === ''))
          .map((m) => this.ways.get(m.ref)).filter((w): w is OverpassElement => !!w).map(coords);
        const outers = stitchRings(part(false));
        const holes: LngLat[][][] = outers.map(() => []);
        for (const h of stitchRings(part(true))) {
          const k = outers.findIndex((o) => pointInRing(h[0], o));
          if (k >= 0) holes[k].push(h);
        }
        outers.forEach((o, k) => out.push({
          type: 'Feature', geometry: { type: 'Polygon', coordinates: [o, ...holes[k]] }, properties: props(cls, `r${r.id}/${k}`, t),
        }));
      } else if (t.type === 'boundary' && t.boundary === 'administrative') {
        const cls = classify(t, 'line');
        if (!cls) continue;
        for (const m of members) {
          if (m.role !== 'outer' && m.role !== 'inner' && m.role !== '') continue;
          const w = this.ways.get(m.ref);
          const c = w ? coords(w) : [];
          if (c.length < 2) continue;
          boundary(m.ref, c, cls, t);
        }
      }
    }

    // границы: по пути (по id) и уровню — признак на слитый промежуток, координаты пути общие
    for (const b of [...bounds.values()].sort((x, y) => x.way - y.way || (x.level ?? -1) - (y.level ?? -1))) {
      const geometry: LineString = { type: 'LineString', coordinates: b.c };
      mergeSpans(b.spans).forEach((s, k) => {
        const p: OhmProps = { ...b.cls, id: `w${b.way}/${k}` };
        if (s.name) p.name = s.name;
        if (s.from !== -Infinity) p.from = s.from;
        if (s.to !== Infinity) p.to = s.to;
        if (b.level !== undefined) p.admin_level = b.level;
        out.push({ type: 'Feature', geometry, properties: p });
      });
    }
    return out;
  }
}

/** Описание векторной карты (карта и metadata MBTiles): «OpenHistoricalMap: 94 373 объекта, 285 участков». */
export const ohmDescription = (features: number, cells: number) =>
  `OpenHistoricalMap: ${countRu(features, 'объект', 'объекта', 'объектов')}, ${countRu(cells, 'участок', 'участка', 'участков')}`;
