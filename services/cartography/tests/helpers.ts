/** Вспомогательное для тестов картографии: поддельный сервер тайлов, синтетический скан, запуск сервиса. */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createService } from '@def-ops/service-kit';
import type { MapJob } from '@def-ops/core';
import type { MapRepo } from '../src/repo';
import { EventBus } from '../src/events';
import { JobRunner } from '../src/jobs';
import { TileStore } from '../src/tiles';
import { buildRouter, type CartographyOptions } from '../src/app';

export interface FakeTileServer {
  url: string;
  /** Запросы: путь, время, заголовки. */
  hits: { path: string; t: number; ua?: string; referer?: string }[];
  /** Задержка ответа, мс. */
  delay: number;
  /** Тайлы, которых «нет» на источнике (404). */
  missing: (z: number, x: number, y: number) => boolean;
  /** Сколько раз подряд отвечать 500 на тайл, прежде чем отдать (проверка повторов). */
  flaky: Map<string, number>;
  close(): Promise<void>;
}

const pngCache = new Map<string, Buffer>();
/** Маленький PNG, цвет которого зависит от адреса тайла. */
export async function tilePng(z: number, x: number, y: number): Promise<Buffer> {
  const k = `${z}/${x}/${y}`;
  let b = pngCache.get(k);
  if (!b) {
    b = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: (x * 37) % 256, g: (y * 53) % 256, b: (z * 19) % 256 } } }).png().toBuffer();
    pngCache.set(k, b);
  }
  return b;
}

export async function fakeTileServer(): Promise<FakeTileServer> {
  const s: Omit<FakeTileServer, 'url' | 'close'> = { hits: [], delay: 0, missing: () => false, flaky: new Map() };
  const server = http.createServer(async (req, res) => {
    s.hits.push({ path: req.url ?? '', t: Date.now(), ua: req.headers['user-agent'], referer: req.headers.referer });
    const m = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(req.url ?? '');
    if (s.delay) await new Promise((r) => setTimeout(r, s.delay));
    if (!m) { res.writeHead(400).end(); return; }
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const key = `${z}/${x}/${y}`;
    const fl = s.flaky.get(key) ?? 0;
    if (fl > 0) { s.flaky.set(key, fl - 1); res.writeHead(500).end('сбой'); return; }
    if (s.missing(z, x, y)) { res.writeHead(404).end(); return; }
    // нарочно неточный Content-Type: формат определяется по сигнатуре
    res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(await tilePng(z, x, y));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(s, {
    url,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  }) as FakeTileServer;
}

/** Цвета четвертей синтетического скана: ЛВ, ПВ, ЛН, ПН. */
export const QUADRANTS = { tl: [220, 30, 30], tr: [30, 180, 30], bl: [30, 30, 220], br: [230, 220, 40] } as const;

/** Синтетический «скан» w×h: четыре цветные четверти и тёмная сетка через 100 px. */
export async function quadrantImage(w = 1200, h = 900, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = y < h / 2 ? (x < w / 2 ? QUADRANTS.tl : QUADRANTS.tr) : x < w / 2 ? QUADRANTS.bl : QUADRANTS.br;
      const grid = x % 100 === 0 || y % 100 === 0;
      const o = (y * w + x) * 3;
      raw[o] = grid ? 0 : q[0]; raw[o + 1] = grid ? 0 : q[1]; raw[o + 2] = grid ? 0 : q[2];
    }
  const s = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return format === 'png' ? s.png().toBuffer() : s.jpeg({ quality: 95 }).toBuffer();
}

/** RGBA пикселя изображения (PNG/JPEG/WebP). */
export async function pixel(img: Buffer, px: number, py: number): Promise<[number, number, number, number]> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (Math.floor(py) * info.width + Math.floor(px)) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

export async function alphaStats(img: Buffer): Promise<{ transparent: number; opaque: number; total: number }> {
  const { data } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, opaque = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) transparent++; else if (data[i] === 255) opaque++; }
  return { transparent, opaque, total: data.length / 4 };
}

export const near = (a: readonly number[], b: readonly number[], tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

export async function tempDir(prefix = 'carto-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export interface Running {
  base: string;
  tilesDir: string;
  jobs: JobRunner;
  store: TileStore;
  bus: EventBus;
  close(): Promise<void>;
}

/** Запустить сервис картографии на случайном порту с временным TILES_DIR. */
export async function startService(repo: MapRepo, options: Partial<CartographyOptions> = {}): Promise<Running> {
  const tilesDir = await tempDir();
  const bus = new EventBus();
  const jobs = new JobRunner(repo, bus, { progressMs: 50 });
  const store = new TileStore(tilesDir);
  const svc = createService({ name: 'cartography', port: 0, router: buildRouter({ repo, store, bus, jobs, options }) });
  const port = await svc.listen();
  return {
    base: `http://127.0.0.1:${port}`, tilesDir, jobs, store, bus,
    async close() {
      await jobs.stop();
      await svc.close();
      await fs.rm(tilesDir, { recursive: true, force: true });
    },
  };
}

/** Дождаться завершения задания (опрос). */
export async function waitJob(get: (id: string) => Promise<MapJob>, id: string, timeoutMs = 20_000): Promise<MapJob> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const j = await get(id);
    if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') return j;
    if (Date.now() > until) throw new Error(`Задание ${id} не завершилось: ${JSON.stringify(j)}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}
