/**
 * Картография: масштаб, тайловая сетка (XYZ, Web Mercator), привязка растров
 * по опорным точкам. Общий контракт для сервиса картографии и редактора.
 */
import type { LngLat } from './geo';
import { inverseMercator, mercator } from './geo';

/* ================================ масштаб ================================ */

const EARTH_CIRCUMFERENCE = 40075016.686;
/** Размер пикселя экрана, принятый для численного масштаба (OGC: 0,28 мм). */
export const SCREEN_PIXEL_M = 0.00028;

/** Метров на местности в одном пикселе экрана при тайле tileSize px на уровне zoom. */
export function metersPerPixel(lat: number, zoom: number, tileSize = 512): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (tileSize * Math.pow(2, zoom));
}

/** Численный масштаб «1 : N» на экране (по пикселю 0,28 мм). */
export function scaleDenominator(lat: number, zoom: number, tileSize = 512, pixelM = SCREEN_PIXEL_M): number {
  return metersPerPixel(lat, zoom, tileSize) / pixelM;
}

/** Уровень масштабирования, при котором на экране получится масштаб 1 : denominator. */
export function zoomForScale(lat: number, denominator: number, tileSize = 512, pixelM = SCREEN_PIXEL_M): number {
  return Math.log2((EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (tileSize * denominator * pixelM));
}

/** Стандартный ряд масштабов топографических карт. */
export const STANDARD_SCALES = [10_000, 25_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];

/** Ближайший стандартный масштаб — подпись «1:50 000». */
export function nearestStandardScale(denominator: number): number {
  return STANDARD_SCALES.reduce((a, b) => (Math.abs(Math.log(b / denominator)) < Math.abs(Math.log(a / denominator)) ? b : a));
}

export function formatScale(denominator: number): string {
  const n = denominator >= 1000 ? Math.round(denominator / 100) * 100 : Math.round(denominator);
  return `1:${n.toLocaleString('ru-RU').replace(/ /g, ' ')}`;
}

/**
 * Линейка масштаба: «круглая» длина на местности, которая займёт не больше maxPx
 * пикселей, и её деления. Длина — 1, 2 или 5 × 10ⁿ метров.
 */
export function scaleBar(lat: number, zoom: number, maxPx = 120, tileSize = 512): { meters: number; px: number; label: string; ticks: number[] } {
  const mpp = metersPerPixel(lat, zoom, tileSize);
  const maxM = mpp * maxPx;
  const p = Math.pow(10, Math.floor(Math.log10(maxM)));
  const meters = [5, 2, 1].map((k) => k * p).find((m) => m <= maxM) ?? p;
  const px = meters / mpp;
  const parts = meters / p === 2 ? 4 : meters / p === 5 ? 5 : 2;
  const ticks = Array.from({ length: parts + 1 }, (_, i) => (px * i) / parts);
  return { meters, px, label: meters >= 1000 ? `${(meters / 1000).toLocaleString('ru-RU')} км` : `${meters} м`, ticks };
}

/* ============================== тайловая сетка ============================== */

export type BBox = [number, number, number, number]; // запад, юг, восток, север

/** Тайл XYZ, содержащий точку. */
export function tileOf(ll: LngLat, z: number): [number, number] {
  const m = mercator(ll);
  const n = 1 << z;
  return [Math.min(n - 1, Math.max(0, Math.floor(m[0] * n))), Math.min(n - 1, Math.max(0, Math.floor(m[1] * n)))];
}

/** Границы тайла XYZ в градусах. */
export function tileBBox(x: number, y: number, z: number): BBox {
  const n = 1 << z;
  const nw = inverseMercator([x / n, y / n]);
  const se = inverseMercator([(x + 1) / n, (y + 1) / n]);
  return [nw[0], se[1], se[0], nw[1]];
}

/** Диапазон тайлов, покрывающих прямоугольник на уровне z. */
export function tileRange(b: BBox, z: number): { x0: number; y0: number; x1: number; y1: number; count: number } {
  const [x0, y0] = tileOf([b[0], b[3]], z);
  const [x1, y1] = tileOf([b[2], b[1]], z);
  return { x0, y0, x1, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** Число тайлов для прямоугольника и диапазона уровней. */
export function tileCount(b: BBox, minzoom: number, maxzoom: number): number {
  let c = 0;
  for (let z = minzoom; z <= maxzoom; z++) c += tileRange(b, z).count;
  return c;
}

export function validBBox(b: unknown): b is BBox {
  return Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && Number.isFinite(v))
    && b[0] >= -180 && b[2] <= 180 && b[1] >= -85.06 && b[3] <= 85.06 && b[0] < b[2] && b[1] < b[3];
}

/** Подстановка адреса тайла в шаблон: {z} {x} {y} {-y} (TMS) {s} (поддомен) {quadkey}. */
export function tileUrl(template: string, z: number, x: number, y: number, subdomains = ['a', 'b', 'c']): string {
  const quad = () => { let q = ''; for (let i = z; i > 0; i--) { const m = 1 << (i - 1); q += String((x & m ? 1 : 0) + (y & m ? 2 : 0)); } return q; };
  return template
    .replace(/\{z\}/g, String(z)).replace(/\{x\}/g, String(x)).replace(/\{y\}/g, String(y))
    .replace(/\{-y\}/g, String((1 << z) - 1 - y))
    .replace(/\{s\}/g, subdomains[(x + y) % subdomains.length])
    .replace(/\{quadkey\}/g, quad());
}

/* ============================ привязка по точкам ============================ */

/**
 * Опорная точка привязки: пиксель изображения (px, py) ↔ координата на местности.
 * Не меньше трёх точек для аффинного преобразования, не меньше четырёх — для проективного.
 */
export interface ControlPoint {
  px: number;
  py: number;
  lngLat: LngLat;
}

/** Преобразование пикселей изображения в нормированные координаты Меркатора (и обратно). */
export interface Georef {
  kind: 'affine' | 'projective';
  /** Прямое: пиксель → Меркатор [0..1]. Матрица 3×3 по строкам. */
  forward: number[];
  /** Обратное: Меркатор → пиксель. */
  inverse: number[];
  /** Средняя квадратическая невязка по опорным точкам, в метрах на местности. */
  rmsMeters: number;
  /** Невязка каждой точки, м. */
  residuals: number[];
}

const apply = (m: number[], x: number, y: number): [number, number] => {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};
export { apply as applyMatrix };

/** Решение СЛАУ методом Гаусса с выбором главного элемента. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) throw new Error('Точки привязки вырождены (лежат на одной прямой или совпадают)');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Наименьшие квадраты: (AᵀA) x = Aᵀb. */
function leastSquares(rows: number[][], rhs: number[]): number[] {
  const n = rows[0].length;
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  const Atb = new Array(n).fill(0);
  rows.forEach((r, i) => {
    for (let a = 0; a < n; a++) {
      Atb[a] += r[a] * rhs[i];
      for (let b = 0; b < n; b++) AtA[a][b] += r[a] * r[b];
    }
  });
  return solve(AtA, Atb);
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-30) throw new Error('Преобразование необратимо');
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

/**
 * Привязка растра по опорным точкам (в нормированных координатах Меркатора).
 * kind: affine — сдвиг, поворот, масштаб, перекос (≥3 точки); projective —
 * дополнительно перспектива (≥4 точки; для сканов, снятых под углом).
 * Если точек больше минимума — уравнивание по методу наименьших квадратов.
 */
export function fitGeoref(points: ControlPoint[], kind: 'affine' | 'projective' = points.length >= 4 ? 'projective' : 'affine'): Georef {
  const need = kind === 'affine' ? 3 : 4;
  if (points.length < need) throw new Error(`Нужно не меньше ${need} опорных точек`);
  // нормируем пиксели для устойчивости
  const sx = Math.max(...points.map((p) => Math.abs(p.px)), 1), sy = Math.max(...points.map((p) => Math.abs(p.py)), 1);
  const N = [1 / sx, 0, 0, 0, 1 / sy, 0, 0, 0, 1];
  const merc = points.map((p) => mercator(p.lngLat));
  // смещаем Меркатор к первой точке, чтобы не терять точность на малых разностях
  const [ox, oy] = merc[0];
  let F: number[];
  if (kind === 'affine') {
    const rows: number[][] = [], rhsX: number[] = [], rhsY: number[] = [];
    points.forEach((p, i) => { rows.push([p.px / sx, p.py / sy, 1]); rhsX.push(merc[i][0] - ox); rhsY.push(merc[i][1] - oy); });
    const a = leastSquares(rows, rhsX), b = leastSquares(rows, rhsY);
    F = [a[0], a[1], a[2], b[0], b[1], b[2], 0, 0, 1];
  } else {
    const rows: number[][] = [], rhs: number[] = [];
    points.forEach((p, i) => {
      const x = p.px / sx, y = p.py / sy, X = merc[i][0] - ox, Y = merc[i][1] - oy;
      rows.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); rhs.push(X);
      rows.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); rhs.push(Y);
    });
    const h = leastSquares(rows, rhs);
    F = [...h, 1];
  }
  // учитываем нормировку пикселей и сдвиг Меркатора: M = T(ox,oy) · F · N
  const mul = (A: number[], B: number[]) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
  const forward = mul([1, 0, ox, 0, 1, oy, 0, 0, 1], mul(F, N));
  const inverse = invert3(forward);
  const residuals = points.map((p, i) => {
    const [mx, my] = apply(forward, p.px, p.py);
    const lat = p.lngLat[1];
    return Math.hypot(mx - merc[i][0], my - merc[i][1]) * EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);
  });
  const rmsMeters = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  return { kind, forward, inverse, rmsMeters, residuals };
}

/** Пиксель изображения → координата на местности. */
export function pixelToLngLat(g: Georef, px: number, py: number): LngLat {
  return inverseMercator(apply(g.forward, px, py));
}

/** Координата на местности → пиксель изображения. */
export function lngLatToPixel(g: Georef, ll: LngLat): [number, number] {
  const m = mercator(ll);
  return apply(g.inverse, m[0], m[1]);
}

/** Привязка по четырём углам изображения (как у подложки-скана в редакторе). */
export function georefFromCorners(width: number, height: number, corners: [LngLat, LngLat, LngLat, LngLat]): Georef {
  return fitGeoref([
    { px: 0, py: 0, lngLat: corners[0] }, { px: width, py: 0, lngLat: corners[1] },
    { px: width, py: height, lngLat: corners[2] }, { px: 0, py: height, lngLat: corners[3] },
  ], 'projective');
}

/** Охват привязанного изображения на местности. */
export function georefBBox(g: Georef, width: number, height: number): BBox {
  const pts = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => pixelToLngLat(g, x, y));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/** Точка внутри многоугольника (контур — кольцо координат). */
export function pointInRing(ll: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > ll[1]) !== (yj > ll[1]) && ll[0] < ((xj - xi) * (ll[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ========================= контракт сервиса картографии ========================= */

/**
 * Карта-подложка в локальном хранилище (офлайн): тайловая пирамида XYZ на диске
 * сервиса картографии. Источник — загрузка тайлов из внешнего сервиса (пока он
 * доступен), привязанный скан/растр или другой архив карт (пакет).
 */
export interface MapSource {
  id: string;
  name: string;
  /** Описание: издание, год, масштаб оригинала. */
  description?: string;
  /** Откуда карта (сайт, архив, издание) — для ссылки в подписи. */
  attribution?: string;
  /** Дата состояния местности на карте (год издания / съёмки), если известна. */
  date?: string | null;
  kind: 'xyz' | 'raster' | 'package';
  format: 'png' | 'jpg' | 'webp';
  tileSize: 256 | 512;
  minzoom: number;
  maxzoom: number;
  /** Охват тайлов. */
  bounds: BBox;
  /**
   * Граница карты (контур, кольцо [lng, lat]): за ней тайлы прозрачны. Позволяет
   * обрезать поля и легенду скана или ограничить подложку районом. null — весь охват.
   */
  coverage?: LngLat[] | null;
  /** Непрозрачность по умолчанию при показе. */
  opacity?: number;
  /** Для загрузки XYZ: шаблон адреса источника (не нужен для показа). */
  sourceUrl?: string | null;
  /** Для растра: привязка (опорные точки) — чтобы перепривязать. */
  controlPoints?: ControlPoint[] | null;
  /** Для растра: итог привязки — вид преобразования, размер скана, невязки (м). */
  georef?: GeorefSummary | null;
  stats?: { tiles: number; bytes: number };
  createdAt?: string;
  updatedAt?: string;
}

/** Итог привязки растра (хранится у карты, чтобы оценить точность и перепривязать). */
export interface GeorefSummary {
  kind: Georef['kind'];
  /** Размер изображения, px. */
  width: number;
  height: number;
  /** Средняя квадратическая невязка, м. */
  rmsMeters: number;
  /** Невязка каждой опорной точки, м (в порядке controlPoints). */
  residuals: number[];
  /** Уровень, на котором пиксель скана ≈ пикселю тайла. */
  nativeZoom: number;
}

/** Задание сервиса картографии (загрузка тайлов, нарезка растра, импорт пакета). */
export interface MapJob {
  id: string;
  mapId: string;
  type: 'xyz-download' | 'raster-tile' | 'package-import';
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  /** Сделано / всего (тайлов). */
  done: number;
  total: number;
  /** Пропущено (уже есть / нет на источнике). */
  skipped: number;
  errors: number;
  message?: string;
  /** Итог задания (для нарезки растра — невязки привязки). */
  result?: { georef?: GeorefSummary; [k: string]: unknown };
  createdAt: string;
  updatedAt: string;
}

/** Запрос на загрузку тайлов внешнего сервиса в локальное хранилище. */
export interface XyzDownloadRequest {
  /** Шаблон адреса: {z} {x} {y} {-y} {s} {quadkey}. */
  url: string;
  bounds: BBox;
  minzoom: number;
  maxzoom: number;
  subdomains?: string[];
  /** Заголовки запросов (Referer, User-Agent), если источник их требует. */
  headers?: Record<string, string>;
  /** Не больше запросов в секунду (вежливость к источнику). По умолчанию 4. */
  rate?: number;
}

/** Нарезка привязанного растра: изображение передаётся отдельно (тело запроса). */
export interface RasterTileRequest {
  /** Опорные точки (≥3) — или углы изображения. */
  controlPoints?: ControlPoint[];
  corners?: [LngLat, LngLat, LngLat, LngLat];
  kind?: 'affine' | 'projective';
  minzoom?: number;
  /** По умолчанию — уровень, на котором пиксель скана ≈ пикселю тайла. */
  maxzoom?: number;
}

/** Верхний уровень, на котором пиксель изображения ≈ пикселю тайла. */
export function nativeZoom(g: Georef, width: number, height: number, tileSize = 256): number {
  const a = pixelToLngLat(g, 0, height / 2), b = pixelToLngLat(g, width, height / 2);
  const ma = mercator(a), mb = mercator(b);
  const mercPerPx = Math.hypot(mb[0] - ma[0], mb[1] - ma[1]) / width;
  return Math.max(0, Math.min(22, Math.round(Math.log2(1 / (mercPerPx * tileSize)))));
}
