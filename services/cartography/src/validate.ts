/**
 * Проверка входных данных сервиса картографии (до обращения к хранилищу).
 * Ошибки содержания — 422 с понятным сообщением, ошибки формы запроса — 400.
 */
import type { BBox, ControlPoint, LngLat, MapSource, RasterTileRequest, XyzDownloadRequest } from '@def-ops/core';
import { validBBox } from '@def-ops/core';
import { HttpError } from '@def-ops/service-kit';

export const MAX_ZOOM = 22;
export const WORLD: BBox = [-180, -85.0511, 180, 85.0511];
const FORMATS = ['png', 'jpg', 'webp'] as const;
/** Заголовки, которые можно передать источнику тайлов (User-Agent ставит сервис). */
export const ALLOWED_HEADERS = ['referer', 'accept', 'accept-language', 'origin'];
/** Потолок частоты запросов к источнику, запросов в секунду. */
export const MAX_RATE = 20;

const bad = (msg: string) => new HttpError(422, 'invalid', msg);

export const isUuid = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function asObject(b: unknown): Record<string, unknown> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'bad_body', 'Тело запроса: ожидается объект JSON');
  return b as Record<string, unknown>;
}

const str = (v: unknown, field: string, max: number, required = false): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`«${field}» — обязательное поле`);
    return undefined;
  }
  if (typeof v !== 'string') throw bad(`«${field}»: ожидается строка`);
  const t = v.trim();
  if (required && !t) throw bad(`«${field}» — обязательное поле`);
  if (t.length > max) throw bad(`«${field}»: не длиннее ${max} символов`);
  return t;
};

export function zoom(v: unknown, field: string): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_ZOOM) throw bad(`«${field}»: целое число от 0 до ${MAX_ZOOM}`);
  return v as number;
}

export function zoomRange(min: unknown, max: unknown, defMin: number, defMax: number): [number, number] {
  const a = min === undefined ? defMin : zoom(min, 'minzoom');
  const b = max === undefined ? defMax : zoom(max, 'maxzoom');
  if (a > b) throw bad('minzoom не может быть больше maxzoom');
  return [a, b];
}

export function bbox(v: unknown, field = 'bounds'): BBox {
  if (!validBBox(v)) throw bad(`«${field}»: ожидается [запад, юг, восток, север] в градусах (широта до ±85,06; запад < восток, юг < север)`);
  return [...v] as BBox;
}

const lngLat = (v: unknown, field: string): LngLat => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))
    || Math.abs(v[0]) > 180 || Math.abs(v[1]) > 90) throw bad(`«${field}»: ожидается [долгота, широта]`);
  return [v[0], v[1]];
};

/** Граница карты — кольцо из ≥3 различных точек; замыкающая точка необязательна. */
export function coverage(v: unknown): LngLat[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) throw bad('«coverage»: ожидается кольцо [[долгота, широта], …] или null');
  const ring = v.map((p, i) => lngLat(p, `coverage[${i}]`));
  const f = ring[0], l = ring[ring.length - 1];
  if (ring.length > 1 && f[0] === l[0] && f[1] === l[1]) ring.pop();
  if (ring.length < 3) throw bad('«coverage»: в контуре должно быть не меньше трёх точек');
  if (ring.length > 10000) throw bad('«coverage»: не больше 10 000 точек');
  return ring;
}

/** Метаданные новой карты (или итог изменения — base: текущая карта). */
export function buildMap(b: Record<string, unknown>, base: Omit<MapSource, 'name'> & { name?: string }): MapSource {
  const pick = <T>(k: string, f: (v: unknown) => T, def: T): T => (k in b ? f(b[k]) : def);
  const name = pick('name', (v) => str(v, 'name', 200, true)!, base.name as string);
  if (!name) throw bad('«name» — обязательное поле');
  const [minzoom, maxzoom] = zoomRange(b.minzoom ?? base.minzoom, b.maxzoom ?? base.maxzoom, 0, 18);
  const m: MapSource = {
    ...base,
    name,
    description: pick('description', (v) => str(v, 'description', 4000), base.description),
    attribution: pick('attribution', (v) => str(v, 'attribution', 1000), base.attribution),
    date: pick('date', (v) => (v === null ? null : str(v, 'date', 64) ?? null), base.date ?? null),
    format: pick('format', (v) => {
      if (!FORMATS.includes(v as never)) throw bad('«format»: png, jpg или webp');
      return v as MapSource['format'];
    }, base.format),
    tileSize: pick('tileSize', (v) => {
      if (v !== 256 && v !== 512) throw bad('«tileSize»: 256 или 512');
      return v as 256 | 512;
    }, base.tileSize),
    minzoom, maxzoom,
    bounds: pick('bounds', (v) => bbox(v), base.bounds),
    coverage: pick('coverage', coverage, base.coverage ?? null),
    opacity: pick('opacity', (v) => {
      if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw bad('«opacity»: число от 0 до 1');
      return v;
    }, base.opacity ?? 1),
  };
  for (const k of ['description', 'attribution'] as const) if (m[k] === undefined) delete m[k];
  return m;
}

/** Поля, которые можно менять в PATCH. */
export const PATCHABLE = ['name', 'description', 'attribution', 'date', 'coverage', 'opacity', 'bounds', 'minzoom', 'maxzoom'];

/** Шаблон адреса источника: http(s), с {z}/{x}/{y} (или {-y}) либо {quadkey}. */
export function tileTemplate(v: unknown, allowedHosts: string[] = []): string {
  if (typeof v !== 'string' || v.length > 2000) throw bad('«url»: ожидается шаблон адреса тайлов');
  let u: URL;
  try { u = new URL(v.replace(/\{[a-z-]+\}/g, '0')); } catch { throw bad('«url»: некорректный адрес'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('«url»: допустимы только http и https');
  const xyz = v.includes('{z}') && v.includes('{x}') && (v.includes('{y}') || v.includes('{-y}'));
  if (!xyz && !v.includes('{quadkey}')) throw bad('«url»: в шаблоне нужны {z}, {x}, {y} (или {-y}) либо {quadkey}');
  if (allowedHosts.length && !allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)))
    throw bad(`«url»: загрузка с ${u.hostname} не разрешена (XYZ_ALLOWED_HOSTS)`);
  return v;
}

export function xyzRequest(raw: unknown, allowedHosts: string[] = []): Required<Omit<XyzDownloadRequest, 'headers' | 'subdomains'>> & Pick<XyzDownloadRequest, 'headers' | 'subdomains'> {
  const b = asObject(raw);
  const url = tileTemplate(b.url, allowedHosts);
  const bounds = bbox(b.bounds);
  const [minzoom, maxzoom] = zoomRange(b.minzoom, b.maxzoom, 0, 0);
  if (b.minzoom === undefined || b.maxzoom === undefined) throw bad('Нужны minzoom и maxzoom');
  let subdomains: string[] | undefined;
  if (b.subdomains !== undefined) {
    if (!Array.isArray(b.subdomains) || !b.subdomains.length || !b.subdomains.every((s) => typeof s === 'string' && /^[a-z0-9-]{1,32}$/i.test(s)))
      throw bad('«subdomains»: непустой список поддоменов (латиница, цифры)');
    subdomains = b.subdomains as string[];
  }
  let headers: Record<string, string> | undefined;
  if (b.headers !== undefined) {
    const h = asObject(b.headers);
    headers = {};
    for (const [k, v] of Object.entries(h)) {
      if (!ALLOWED_HEADERS.includes(k.toLowerCase())) throw bad(`«headers»: заголовок ${k} передать нельзя (допустимы: Referer, Accept, Accept-Language, Origin)`);
      if (typeof v !== 'string' || v.length > 1000 || /[\r\n]/.test(v)) throw bad(`«headers»: некорректное значение ${k}`);
      headers[k] = v;
    }
  }
  const rate = b.rate === undefined ? 4 : b.rate;
  if (typeof rate !== 'number' || !(rate > 0 && rate <= MAX_RATE)) throw bad(`«rate»: от 0 до ${MAX_RATE} запросов в секунду`);
  return { url, bounds, minzoom, maxzoom, subdomains, headers, rate };
}

export function rasterRequest(raw: unknown): RasterTileRequest {
  const b = asObject(raw);
  const out: RasterTileRequest = {};
  if (b.kind !== undefined) {
    if (b.kind !== 'affine' && b.kind !== 'projective') throw bad('«kind»: affine или projective');
    out.kind = b.kind;
  }
  if (b.controlPoints !== undefined && b.corners !== undefined) throw bad('Задайте либо controlPoints, либо corners');
  if (b.controlPoints !== undefined) {
    if (!Array.isArray(b.controlPoints)) throw bad('«controlPoints»: ожидается список точек');
    out.controlPoints = b.controlPoints.map((p, i): ControlPoint => {
      const o = asObject(p);
      if (typeof o.px !== 'number' || typeof o.py !== 'number' || !Number.isFinite(o.px) || !Number.isFinite(o.py))
        throw bad(`controlPoints[${i}]: px и py — числа (пиксели изображения)`);
      return { px: o.px, py: o.py, lngLat: lngLat(o.lngLat, `controlPoints[${i}].lngLat`) };
    });
    const need = out.kind === 'projective' ? 4 : 3;
    if (out.controlPoints.length < need) throw bad(`Нужно не меньше ${need} опорных точек`);
  } else if (b.corners !== undefined) {
    if (!Array.isArray(b.corners) || b.corners.length !== 4) throw bad('«corners»: четыре угла — левый верхний, правый верхний, правый нижний, левый нижний');
    out.corners = b.corners.map((c, i) => lngLat(c, `corners[${i}]`)) as RasterTileRequest['corners'];
  } else throw bad('Нужна привязка: controlPoints (≥3 точки) или corners (4 угла)');
  if (b.minzoom !== undefined) out.minzoom = zoom(b.minzoom, 'minzoom');
  if (b.maxzoom !== undefined) out.maxzoom = zoom(b.maxzoom, 'maxzoom');
  if (out.minzoom !== undefined && out.maxzoom !== undefined && out.minzoom > out.maxzoom) throw bad('minzoom не может быть больше maxzoom');
  return out;
}

/** Целое из строки запроса. */
export function intParam(v: string | null, field: string, min: number, max: number, def?: number): number {
  if (v === null || v === '') {
    if (def === undefined) throw new HttpError(400, 'bad_request', `Не указан параметр ${field}`);
    return def;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'bad_request', `${field}: целое число от ${min} до ${max}`);
  return n;
}
