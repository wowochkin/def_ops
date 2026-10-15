/**
 * Карта OHM: замена файла карты не удалась так, как в Windows, когда `ohm.mbtiles` открыт
 * (выгрузка пакета): renameSync бросает EPERM. Задание — failed с понятным сообщением,
 * временный файл удалён, прежняя карта и кэш участков целы.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { BBox, MapJob, MapSource, OverpassJson } from '@def-ops/core';
import { MemoryRepo } from '../src/repo';
import { A, B, fakeOverpass, startService, waitJob, type FakeOverpass, type Running } from './helpers';

const rename = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs', async (orig) => {
  const fsm = await orig<typeof import('node:fs')>();
  const renameSync: typeof fsm.renameSync = (from, to) => {
    if (rename.fail && String(to).endsWith('ohm.mbtiles'))
      throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM' });
    return fsm.renameSync(from, to);
  };
  return { ...fsm, default: { ...fsm, renameSync }, renameSync };
});

const BBOX: BBox = [13.25, 52.4, 13.75, 52.65];
let fake: FakeOverpass;
let run: Running;

beforeEach(async () => {
  rename.fail = false;
  fake = await fakeOverpass();
  fake.cells = (b): OverpassJson => (b[0] === 13.25 ? A : B);
  run = await startService(new MemoryRepo(), {
    ohm: { overpassUrl: fake.url + '/api/interpreter', assetsUrl: fake.url + '/map-styles', pauseMs: 10, retries: 1, backoffMs: 10, timeoutMs: 2000 },
  });
});
afterEach(async () => {
  await run.close();
  await fake.close();
});

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(run.base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'orgA' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const job = (id: string) => waitJob(async (j) => (await call('GET', `/cartography/jobs/${j}`)).body as MapJob, id, 30_000);

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p))); else out.push(p);
  }
  return out;
}

describe('карта OHM: файл карты занят (EPERM)', { timeout: 60_000 }, () => {
  it('задание failed с понятным сообщением, .tmp удалён, прежняя карта и кэш участков целы', async () => {
    const r = await call('POST', '/cartography/maps/ohm', { name: 'Берлин OHM', bbox: BBOX });
    expect((await job(r.body.job.id)).status).toBe('done');
    const id = r.body.map.id as string;
    const dir = path.join(run.tilesDir, 'orgA', id);
    const before = await fs.readFile(path.join(dir, 'ohm.mbtiles'));

    rename.fail = true;
    const c = await call('POST', `/cartography/maps/${id}/ohm`, {});
    expect(c.status).toBe(202);
    const j = await job(c.body.id);
    expect(j.status).toBe('failed');
    expect(j.message).toBe('Не удалось заменить файл карты (EPERM): он занят — например, идёт выгрузка пакета. '
      + 'Нажмите «продолжить», когда выгрузка закончится: участки возьмутся из кэша');

    const left = (await files(dir)).map((f) => path.relative(dir, f));
    expect(left.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(left.filter((f) => f.startsWith(path.join('_ohm', 'cells'))).sort()).toEqual([path.join('_ohm', 'cells', '0.json.gz'), path.join('_ohm', 'cells', '1.json.gz')]);
    expect((await fs.readFile(path.join(dir, 'ohm.mbtiles'))).equals(before)).toBe(true);
    const m = (await call('GET', `/cartography/maps/${id}`)).body as MapSource;
    expect(m.kind).toBe('vector');

    // файл освободился — «продолжить» берёт участки из кэша, без запросов к Overpass
    rename.fail = false;
    fake.hits.length = 0;
    const again = await call('POST', `/cartography/maps/${id}/ohm`, {});
    expect((await job(again.body.id)).status).toBe('done');
    expect(fake.hits.filter((h) => h.path === '/api/interpreter')).toHaveLength(0);
  });
});
