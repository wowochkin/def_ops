/**
 * Нарезка привязанного растра (скана карты) на тайлы XYZ.
 *
 *  1. Привязка: по опорным точкам (fitGeoref) или по четырём углам
 *     (georefFromCorners) — математика только из @def-ops/core.
 *  2. Верхний уровень (по умолчанию nativeZoom — пиксель скана ≈ пикселю тайла):
 *     для каждого пикселя тайла координата Меркатора переводится обратным
 *     преобразованием в пиксель скана, цвет — билинейной интерполяцией; вне скана —
 *     прозрачность. Если верхний уровень задан ниже родного, скан сначала
 *     уменьшается (иначе на тайл пришлось бы читать огромную область).
 *  3. Нижние уровни — уменьшением четырёх дочерних тайлов (2×2 → 1, с учётом
 *     прозрачности).
 *
 * Память: декодированный скан держится в памяти, только если он меньше
 * memoryLimitBytes; иначе он раскладывается во временный файл RGBA, и на каждый
 * тайл читается лишь нужная полоса строк. Тайлы сразу пишутся на диск.
 * Полностью прозрачные тайлы не сохраняются.
 */
import { promises as fs, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import type { BBox, ControlPoint, Georef, GeorefSummary, MapSource, RasterTileRequest } from '@def-ops/core';
import { fitGeoref, georefBBox, georefFromCorners, nativeZoom, tileRange } from '@def-ops/core';
import type { JobContext } from './jobs';
import type { TileStore } from './tiles';

sharp.cache(false);

export interface RasterPlan {
  file: string;
  width: number;
  height: number;
  georef: Georef;
  controlPoints: ControlPoint[];
  summary: GeorefSummary;
  bounds: BBox;
  minzoom: number;
  maxzoom: number;
  tileSize: 256 | 512;
  format: 'png' | 'webp';
  total: number;
}

/** Размер изображения с учётом поворота по EXIF (опорные точки — в повёрнутом виде). */
export async function imageSize(file: string): Promise<{ width: number; height: number; format: string }> {
  let m: sharp.Metadata;
  try { m = await sharp(file, { limitInputPixels: false }).metadata(); } catch {
    throw new Error('Не удалось прочитать изображение (ожидается PNG, JPEG, WebP или TIFF)');
  }
  if (!m.width || !m.height) throw new Error('Не удалось определить размер изображения');
  const swap = (m.orientation ?? 1) >= 5;
  return { width: swap ? m.height : m.width, height: swap ? m.width : m.height, format: m.format ?? '' };
}

/** Число тайлов охвата на уровнях minzoom..maxzoom. */
export function pyramidCount(b: BBox, minzoom: number, maxzoom: number): number {
  let n = 0;
  for (let z = minzoom; z <= maxzoom; z++) n += tileRange(b, z).count;
  return n;
}

/** Привязка, уровни и объём работы — до постановки задания (ошибки — сразу пользователю). */
export async function planRaster(file: string, req: RasterTileRequest, map: Pick<MapSource, 'tileSize' | 'format'>): Promise<RasterPlan> {
  const { width, height } = await imageSize(file);
  let controlPoints: ControlPoint[];
  let georef: Georef;
  if (req.corners) {
    georef = georefFromCorners(width, height, req.corners);
    const c = req.corners;
    controlPoints = [
      { px: 0, py: 0, lngLat: c[0] }, { px: width, py: 0, lngLat: c[1] },
      { px: width, py: height, lngLat: c[2] }, { px: 0, py: height, lngLat: c[3] },
    ];
  } else {
    controlPoints = req.controlPoints!;
    georef = fitGeoref(controlPoints, req.kind);
  }
  const T = map.tileSize;
  const native = nativeZoom(georef, width, height, T);
  const maxzoom = req.maxzoom ?? native;
  const fit = Math.max(0, maxzoom - Math.ceil(Math.log2(Math.max(width, height) / T)));
  const minzoom = Math.min(req.minzoom ?? fit, maxzoom);
  const bounds = clampBBox(georefBBox(georef, width, height));
  return {
    file, width, height, georef, controlPoints, bounds, minzoom, maxzoom, tileSize: T,
    format: map.format === 'webp' ? 'webp' : 'png',
    summary: { kind: georef.kind, width, height, rmsMeters: georef.rmsMeters, residuals: georef.residuals, nativeZoom: native },
    total: pyramidCount(bounds, minzoom, maxzoom),
  };
}

const clampBBox = (b: BBox): BBox => [Math.max(-180, b[0]), Math.max(-85.0511, b[1]), Math.min(180, b[2]), Math.min(85.0511, b[3])];

/* ------------------------------- источник пикселей ------------------------------- */

export interface RasterSource {
  width: number;
  height: number;
  /** Прямоугольник изображения как RGBA (w·h·4 байт). */
  read(x0: number, y0: number, w: number, h: number): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Декодировать скан (с поворотом по EXIF) в RGBA, при необходимости уменьшив до
 * width×height. Маленький — в память, большой — во временный файл рядом со сканом.
 */
export async function openRaster(file: string, width: number, height: number, memoryLimitBytes: number): Promise<RasterSource> {
  const pipe = () => {
    const p = sharp(file, { limitInputPixels: false }).rotate();
    return p.resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw();
  };
  if (width * height * 4 <= memoryLimitBytes) {
    const data = await pipe().toBuffer();
    return {
      width, height,
      async read(x0, y0, w, h) {
        if (x0 === 0 && w === width) return data.subarray(y0 * width * 4, (y0 + h) * width * 4);
        const out = Buffer.allocUnsafe(w * h * 4);
        for (let r = 0; r < h; r++) data.copy(out, r * w * 4, ((y0 + r) * width + x0) * 4, ((y0 + r) * width + x0 + w) * 4);
        return out;
      },
      async close() { /* память освободит сборщик */ },
    };
  }
  const rawFile = `${file}.rgba`;
  // toFile не пишет «сырые» пиксели — выводим потоком
  await pipeline(pipe(), createWriteStream(rawFile));
  const fh = await fs.open(rawFile, 'r');
  return {
    width, height,
    async read(x0, y0, w, h) {
      const out = Buffer.allocUnsafe(w * h * 4);
      for (let r = 0; r < h; r++) await fh.read(out, r * w * 4, w * 4, ((y0 + r) * width + x0) * 4);
      return out;
    },
    async close() { await fh.close(); await fs.rm(rawFile, { force: true }); },
  };
}

/* ------------------------------------ пересчёт ------------------------------------ */

/** Обратное преобразование (Меркатор → пиксель) для изображения, уменьшенного в (sx, sy) раз. */
export function scaledInverse(g: Georef, sx: number, sy: number): number[] {
  const m = g.inverse;
  return [m[0] * sx, m[1] * sx, m[2] * sx, m[3] * sy, m[4] * sy, m[5] * sy, m[6], m[7], m[8]];
}

/** Прямоугольник изображения, нужный для тайла (с запасом на интерполяцию); null — тайл вне изображения. */
export function sourceWindow(inv: number[], W: number, H: number, z: number, x: number, y: number): [number, number, number, number] | null {
  const n = 2 ** z;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) {
    const mx = cx / n, my = cy / n;
    const w = inv[6] * mx + inv[7] * my + inv[8];
    if (!(w > 0) && !(w < 0)) return null;
    const px = (inv[0] * mx + inv[1] * my + inv[2]) / w, py = (inv[3] * mx + inv[4] * my + inv[5]) / w;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  const a = Math.max(0, Math.floor(x0) - 2), b = Math.max(0, Math.floor(y0) - 2);
  const c = Math.min(W, Math.ceil(x1) + 2), d = Math.min(H, Math.ceil(y1) + 2);
  return c > a && d > b ? [a, b, c - a, d - b] : null;
}

/**
 * Тайл z/x/y размером T из окна изображения (RGBA, левый верхний угол окна — ox, oy;
 * всё изображение — W×H). Билинейная интерполяция, вне изображения — прозрачно.
 * Возвращает null, если тайл получился полностью прозрачным.
 */
export function warpTile(win: Buffer, ox: number, oy: number, ww: number, wh: number, W: number, H: number,
  inv: number[], z: number, x: number, y: number, T: number): Buffer | null {
  const out = Buffer.alloc(T * T * 4);
  const n = 2 ** z;
  const [a, b, c, d, e, f, g, h, k] = inv;
  let any = false;
  for (let j = 0; j < T; j++) {
    const my = (y + (j + 0.5) / T) / n;
    for (let i = 0; i < T; i++) {
      const mx = (x + (i + 0.5) / T) / n;
      const w = g * mx + h * my + k;
      const px = (a * mx + b * my + c) / w, py = (d * mx + e * my + f) / w;
      if (!(px >= 0 && px < W && py >= 0 && py < H)) continue;
      // центры пикселей — в (i + 0,5); у края изображения — повтор крайнего пикселя
      const u = Math.min(Math.max(px - 0.5, 0), W - 1) - ox, v = Math.min(Math.max(py - 0.5, 0), H - 1) - oy;
      const u0 = Math.max(0, Math.min(ww - 1, Math.floor(u))), v0 = Math.max(0, Math.min(wh - 1, Math.floor(v)));
      const u1 = Math.min(ww - 1, u0 + 1), v1 = Math.min(wh - 1, v0 + 1);
      const fu = Math.min(1, Math.max(0, u - u0)), fv = Math.min(1, Math.max(0, v - v0));
      const p00 = (v0 * ww + u0) * 4, p10 = (v0 * ww + u1) * 4, p01 = (v1 * ww + u0) * 4, p11 = (v1 * ww + u1) * 4;
      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
      // интерполяция с предумноженной прозрачностью (без тёмной каймы у прозрачных мест скана)
      const al = win[p00 + 3] * w00 + win[p10 + 3] * w10 + win[p01 + 3] * w01 + win[p11 + 3] * w11;
      const o = (j * T + i) * 4;
      if (al <= 0) continue;
      for (let ch = 0; ch < 3; ch++)
        out[o + ch] = Math.round((win[p00 + ch] * win[p00 + 3] * w00 + win[p10 + ch] * win[p10 + 3] * w10
          + win[p01 + ch] * win[p01 + 3] * w01 + win[p11 + ch] * win[p11 + 3] * w11) / al);
      out[o + 3] = Math.round(al);
      any = true;
    }
  }
  return any ? out : null;
}

/** Уменьшение 2×2 → 1 четырёх дочерних тайлов (RGBA T×T или null — пусто). */
export function downsample(children: (Buffer | null)[], T: number): Buffer | null {
  if (children.every((c) => !c)) return null;
  const out = Buffer.alloc(T * T * 4);
  const half = T / 2;
  let any = false;
  children.forEach((src, q) => {
    if (!src) return;
    const qx = (q % 2) * half, qy = Math.floor(q / 2) * half;
    for (let j = 0; j < half; j++)
      for (let i = 0; i < half; i++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const p = ((2 * j + dj) * T + 2 * i + di) * 4;
          const al = src[p + 3];
          r += src[p] * al; g += src[p + 1] * al; b += src[p + 2] * al; a += al;
        }
        if (!a) continue;
        const o = ((qy + j) * T + qx + i) * 4;
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round(a / 4);
        any = true;
      }
  });
  return any ? out : null;
}

export async function encodeTile(raw: Buffer, T: number, format: 'png' | 'webp'): Promise<Buffer> {
  const s = sharp(raw, { raw: { width: T, height: T, channels: 4 } });
  return format === 'webp' ? s.webp({ quality: 85, alphaQuality: 100 }).toBuffer() : s.png({ compressionLevel: 6 }).toBuffer();
}

export async function decodeTile(file: string, T: number): Promise<Buffer> {
  return sharp(file).resize(T, T, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
}

/** Задание: нарезать скан по плану. Тайлы карты перед нарезкой удаляются (перепривязка). */
export async function tileRaster(ctx: JobContext, store: TileStore, mapId: string, plan: RasterPlan, o: { memoryLimitBytes?: number } = {}) {
  const { tenant } = ctx;
  const T = plan.tileSize, top = plan.maxzoom;
  await store.removeMap(tenant, mapId);
  // если верхний уровень ниже родного — уменьшить скан, чтобы пиксель ≈ пикселю тайла
  const k = Math.min(1, 2 ** (top - plan.summary.nativeZoom));
  const W = Math.max(1, Math.round(plan.width * k)), H = Math.max(1, Math.round(plan.height * k));
  const inv = scaledInverse(plan.georef, W / plan.width, H / plan.height);
  const src = await openRaster(plan.file, W, H, o.memoryLimitBytes ?? 256 * 1024 * 1024);
  let written = 0;
  const step = (stored: boolean) => {
    if (stored) written++;
    ctx.progress({ done: ctx.job.done + 1, skipped: ctx.job.skipped + (stored ? 0 : 1) });
  };
  try {
    const r = tileRange(plan.bounds, top);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        ctx.check();
        const win = sourceWindow(inv, W, H, top, x, y);
        const raw = win ? warpTile(await src.read(...win), win[0], win[1], win[2], win[3], W, H, inv, top, x, y, T) : null;
        if (raw) await store.write(tenant, mapId, top, x, y, plan.format, await encodeTile(raw, T, plan.format));
        step(!!raw);
      }
  } finally {
    await src.close();
  }
  for (let z = top - 1; z >= plan.minzoom; z--) {
    const r = tileRange(plan.bounds, z);
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        ctx.check();
        const kids = await Promise.all([[0, 0], [1, 0], [0, 1], [1, 1]].map(async ([dx, dy]) => {
          const f = await store.find(tenant, mapId, z + 1, 2 * x + dx, 2 * y + dy, plan.format);
          return f ? decodeTile(f.file, T) : null;
        }));
        const raw = downsample(kids, T);
        if (raw) await store.write(tenant, mapId, z, x, y, plan.format, await encodeTile(raw, T, plan.format));
        step(!!raw);
      }
  }
  return { written };
}
