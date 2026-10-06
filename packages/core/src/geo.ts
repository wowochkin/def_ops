/**
 * Географическая привязка. Все объекты хранятся в WGS84 (долгота, широта).
 * Для отрисовки они переводятся в «мировые пиксели» Web Mercator на опорном
 * масштабе документа (refZoom, тайл 512 px — как в MapLibre), относительно
 * точки-начала документа. Размеры знаков задаются в пикселях на опорном
 * масштабе, поэтому при зуме карта ведёт себя как отпечатанный лист:
 * всё масштабируется согласованно, пропорции знаков сохраняются.
 */
import type { Vec2 } from './vec';

export type LngLat = [number, number];

export const TILE_SIZE = 512;
const MAX_LAT = 85.0511287798;

/** Нормированные координаты Меркатора [0..1]. */
export function mercator(ll: LngLat): Vec2 {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, ll[1]));
  const x = (ll[0] + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

export function inverseMercator(m: Vec2): LngLat {
  const lng = m[0] * 360 - 180;
  const n = Math.PI - 2 * Math.PI * m[1];
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lng, lat];
}

export interface Projection {
  /** WGS84 → мировые пиксели документа. */
  toWorld(ll: LngLat): Vec2;
  /** Мировые пиксели документа → WGS84. */
  toLngLat(p: Vec2): LngLat;
  refZoom: number;
  origin: LngLat;
}

export function makeProjection(origin: LngLat, refZoom: number): Projection {
  const size = TILE_SIZE * Math.pow(2, refZoom);
  const o = mercator(origin);
  return {
    refZoom,
    origin,
    toWorld(ll) {
      const m = mercator(ll);
      return [(m[0] - o[0]) * size, (m[1] - o[1]) * size];
    },
    toLngLat(p) {
      return inverseMercator([p[0] / size + o[0], p[1] / size + o[1]]);
    },
  };
}

/** Сколько метров на местности в одном мировом пикселе на заданной широте. */
export function metersPerWorldPixel(lat: number, refZoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * Math.pow(2, refZoom));
}
