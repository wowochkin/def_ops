import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tileRange } from '@def-ops/core';

const state = vi.hoisted(() => ({
  root: '', work: '', workerData: undefined as unknown,
  messages: [] as { state?: string; stage?: string; done?: number; total?: number; error?: string }[],
  fetch: vi.fn(),
}));
vi.mock('node:worker_threads', () => ({
  parentPort: {
    postMessage: vi.fn((message: (typeof state.messages)[number]) => { state.messages.push(message); }),
    close: vi.fn(), on: vi.fn(),
  },
  get workerData() { return state.workerData; },
}));
vi.mock('../src/net', () => ({ http: { fetch: state.fetch }, netMessage: (error: unknown) => String(error) }));
vi.mock('../src/ohm', () => ({ ensureAssets: vi.fn(async () => {}), OHM_DEFAULTS: {} }));

let root = '';
beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(join(tmpdir(), 'atlas-openfreemap-large-'));
  state.root = join(root, 'catalog');
  state.work = join(root, 'work');
  state.messages = [];
  state.fetch.mockReset();
  state.fetch.mockImplementation(async () => new Response(Buffer.alloc(1024, 1), { status: 200 }));
  state.workerData = {
    root: state.root, work: state.work, tenant: 'tenant',
    input: { kind: 'openfreemap', options: {
      bounds: [-180, -85.05112878, 180, 85.05112878], minzoom: 6, maxzoom: 6,
      name: 'Большая область', attribution: 'test',
    } },
  };
  await mkdir(state.work, { recursive: true });
  const db = new DatabaseSync(join(state.work, 'source-tiles.mbtiles'));
  db.exec('create table metadata(name text primary key,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob);create unique index tile_index on tiles(zoom_level,tile_column,tile_row)');
  const tileJson = JSON.stringify({ tiles: ['https://tiles.openfreemap.org/{z}/{x}/{y}.pbf'], vector_layers: [{ id: 'roads', fields: {} }], maxzoom: 14 });
  db.prepare("insert into metadata values('source_tilejson',?)").run(tileJson);
  const insert = db.prepare('insert into tiles values(?,?,?,?)');
  const payload = Buffer.alloc(16 * 1024, 1);
  const range = tileRange([-180, -85.05112878, 180, 85.05112878], 6);
  db.exec('begin');
  for (let x = range.x0; x <= range.x1; x += 1) {
    for (let y = range.y0; y <= range.y1; y += 1) {
      if (x === range.x1 && y === range.y1) continue;
      insert.run(6, x, 2 ** 6 - 1 - y, payload);
    }
  }
  db.exec('commit');
  db.close();
  await import('../src/atlas-worker');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('продолжает большую область по кэшем без ограничения 3000 тайлов и 50 МБ', async () => {
  for (let attempt = 0; attempt < 250 && !state.messages.some(message => message.state); attempt += 1) await new Promise(resolve => setTimeout(resolve, 20));
  const range = tileRange([-180, -85.05112878, 180, 85.05112878], 6);
  const count = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
  expect(count).toBe(4096);
  expect(count * 16 * 1024).toBeGreaterThan(50 * 1024 * 1024);
  expect(state.messages.at(-1)).toMatchObject({ state: 'done' });
  expect(state.messages.at(-1)?.error).toBeUndefined();
  expect(state.messages.some(message => message.stage === 'Тайлы OpenFreeMap' && message.done === 4096 && message.total === 4096)).toBe(true);
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
