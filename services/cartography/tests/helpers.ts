/** Вспомогательное для тестов картографии: поддельный сервер тайлов, синтетический скан, запуск сервиса. */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createService } from '@def-ops/service-kit';
import type { BBox, MapJob, OverpassElement, OverpassJson } from '@def-ops/core';
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

export type OverpassFault = '429' | '500' | 'remark' | 'html' | '400';

export interface FakeOverpass {
  url: string;
  /** Запросы: путь, время, User-Agent, текст запроса Overpass (из поля data). */
  hits: { path: string; t: number; ua?: string; query?: string }[];
  /** Ответ на участок (рамка — из node(s,w,n,e) запроса). */
  cells: (b: BBox) => OverpassJson;
  /** Сбои по номеру участка (порядок первого запроса его рамки): по одному на запрос, затем — нормальный ответ. */
  script: Map<number, OverpassFault[]>;
  /** Задержка ответа, мс. */
  delay: number;
  /** Ответ участка — кусками по 1 КБ без Content-Length (как потоковый ответ Overpass). */
  chunked: boolean;
  close(): Promise<void>;
}

/** Небольшой файл, зависящий от имени (шрифты и значки OHM; имя — до 120 знаков). */
export const fakeAsset = (name: string): Buffer => {
  const text = Buffer.from(`asset:${name}`);
  // по форме — как настоящие: шрифт — сообщение PBF из одного поля 1, значки — PNG и JSON
  if (name.endsWith('.pbf')) return Buffer.concat([Buffer.from([0x0a, text.length]), text]);
  if (name.endsWith('.png')) return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), text]);
  return Buffer.from(JSON.stringify({ asset: name }));
};

/** Два объекта на участок: пункт в центре и путь вдоль южного края. */
export function defaultCell(b: BBox): OverpassJson {
  const id = Math.round(b[0] * 1000) * 100_000 + Math.round(b[1] * 1000);
  return { elements: [
    { type: 'node', id, lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2, tags: { place: 'village', name: `П${id}` } },
    { type: 'way', id, tags: { highway: 'track' }, geometry: [{ lat: b[1], lon: b[0] }, { lat: b[1], lon: b[2] }] },
  ] };
}

/* ---------- участки A и B (центр Берлина): ---------- */
const pt = (lon: number, lat: number) => ({ lon, lat });
const square = (w: number, s: number, e: number, n: number) => [pt(w, s), pt(e, s), pt(e, n), pt(w, n), pt(w, s)];
const BOUNDARY = { type: 'boundary', boundary: 'administrative', admin_level: '2', start_date: '1938-03-13', end_date: '1945-05-08' };

/** Участки A и B: отношения из путей обоих участков, недостающий член, дубликаты на стыке (10 признаков). */
export const A: OverpassJson = { elements: [
  { type: 'node', id: 1, lat: 52.52, lon: 13.40, tags: { place: 'city', name: 'Berlin', start_date: '1237' } },
  { type: 'node', id: 3, lat: 52.5195, lon: 13.4085, tags: { amenity: 'place_of_worship', name: 'Marienkirche', start_date: '1294' } },
  { type: 'way', id: 10, tags: { highway: 'primary', name: 'Unter den Linden', bridge: 'yes', start_date: '1647' }, geometry: [pt(13.45, 52.52), pt(13.55, 52.52)] },
  { type: 'way', id: 11, tags: { building: 'yes', start_date: '1706', end_date: '1945' }, geometry: square(13.3925, 52.5165, 13.3935, 52.517) },
  { type: 'way', id: 12, geometry: [pt(13.40, 52.50), pt(13.42, 52.50), pt(13.42, 52.51)] },
  { type: 'way', id: 13, geometry: [pt(13.40, 52.50), pt(13.40, 52.51), pt(13.42, 52.51)] }, // обратный ход
  { type: 'way', id: 14, geometry: square(13.405, 52.503, 13.415, 52.507) },
  { type: 'way', id: 16, geometry: [pt(13.30, 52.45), pt(13.35, 52.47)] },
  { type: 'relation', id: 100, tags: { type: 'multipolygon', landuse: 'forest', start_date: '1900-05' }, members: [{ type: 'way', ref: 12, role: 'outer' }, { type: 'way', ref: 13, role: 'outer' }, { type: 'way', ref: 14, role: 'inner' }] },
  { type: 'relation', id: 101, tags: { type: 'multipolygon', natural: 'water', name: 'Rummelsburger See' }, members: [{ type: 'way', ref: 15, role: 'outer' }] }, // путь 15 — только в B
  { type: 'relation', id: 102, tags: BOUNDARY, members: [{ type: 'way', ref: 16, role: 'outer' }, { type: 'way', ref: 17, role: 'outer' }] }, // 17 нет нигде
  { type: 'relation', id: 103, tags: BOUNDARY, members: [{ type: 'way', ref: 16, role: 'outer' }] },
] };
export const B: OverpassJson = { elements: [
  A.elements![2], A.elements![9],
  { type: 'way', id: 15, geometry: square(13.60, 52.45, 13.62, 52.46) },
  { type: 'way', id: 18, tags: { highway: 'footway' }, geometry: [pt(13.60, 52.50), pt(13.61, 52.505)] },
  { type: 'way', id: 19, tags: { highway: 'residential' }, geometry: [pt(13.62, 52.50), pt(13.64, 52.51)] },
  { type: 'way', id: 20, tags: { railway: 'rail', start_date: '1842' }, geometry: [pt(13.55, 52.40), pt(13.70, 52.60)] },
] satisfies OverpassElement[] };

/** Поддельные Overpass OHM (POST /api/interpreter) и файлы стиля (/map-styles/...). */
export async function fakeOverpass(): Promise<FakeOverpass> {
  const s: Omit<FakeOverpass, 'url' | 'close'> = { hits: [], cells: defaultCell, script: new Map(), delay: 0, chunked: false };
  const seen: string[] = [];
  const server = http.createServer(async (req, res) => {
    const hit: FakeOverpass['hits'][number] = { path: req.url ?? '', t: Date.now(), ua: req.headers['user-agent'] };
    s.hits.push(hit);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (s.delay) await new Promise((r) => setTimeout(r, s.delay));
    const u = req.url ?? '';
    if (req.method === 'POST' && u === '/api/interpreter') {
      const query = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('data') ?? '';
      hit.query = query;
      const m = /node\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(query);
      if (!m) { res.writeHead(400).end('Error: line 1: parse error'); return; }
      const b: BBox = [Number(m[2]), Number(m[1]), Number(m[4]), Number(m[3])];
      const key = b.join(',');
      if (!seen.includes(key)) seen.push(key);
      const fault = s.script.get(seen.indexOf(key))?.shift();
      const json = s.cells(b);
      switch (fault) {
        case '429': res.writeHead(429, { 'Retry-After': '0' }).end(); return;
        case '500': res.writeHead(500).end('сбой'); return;
        case '400': res.writeHead(400, { 'Content-Type': 'text/html' }).end('Error: line 1: parse error'); return;
        case 'html': res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><body>The server is probably too busy</body></html>'); return;
        case 'remark':
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            remark: 'runtime error: Query timed out in "query" at line 1 after 181 seconds.', elements: (json.elements ?? []).slice(0, 1),
          }));
          return;
      }
      const text = JSON.stringify(json);
      if (!s.chunked) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(text); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
      for (let i = 0; i < text.length && !res.destroyed; i += 1024) {
        res.write(text.slice(i, i + 1024));
        await new Promise((r) => setImmediate(r));
      }
      res.end();
      return;
    }
    const f = /^\/map-styles\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/.exec(u);
    if (req.method === 'GET' && f) { res.writeHead(200).end(fakeAsset(`${decodeURIComponent(f[1])}/${f[2]}.pbf`)); return; }
    const sp = /^\/map-styles\/historical\/historical_spritesheet(@2x)?\.(json|png)$/.exec(u);
    if (req.method === 'GET' && sp) { res.writeHead(200).end(fakeAsset(`ohm${sp[1] ?? ''}.${sp[2]}`)); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(s, {
    url,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  }) as FakeOverpass;
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

/** Запустить сервис картографии на случайном порту с временным TILES_DIR (или своим — dir; удаляется при close). */
export async function startService(repo: MapRepo, options: Partial<CartographyOptions> = {}, dir?: string): Promise<Running> {
  const tilesDir = dir ?? await tempDir();
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
