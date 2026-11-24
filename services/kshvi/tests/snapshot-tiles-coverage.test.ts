import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import sharp from 'sharp';
import { tileOf } from '@def-ops/core';
import { EnvironmentSnapshotStore, prepareContent, type SnapshotDraft } from '../src/environment/snapshot-store';
import { readSnapshotTile } from '../src/environment/snapshot-tiles';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(process.cwd(), '.snapshot-tiles-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('обрезает растр снимка по рамке и не меняет исходный MBTiles', async () => {
  const bounds: [number, number, number, number] = [34.727193, 48.299639, 35.42196, 48.633668];
  const z = 10, outside = bounds[0] - 0.01, inside = bounds[0] + 0.01, lat = (bounds[1] + bounds[3]) / 2;
  const [x, y] = tileOf([outside, lat], z);
  const png = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
  const database = new DatabaseSync(path.join(root, 'source.mbtiles'));
  database.exec('create table tiles(zoom_level integer, tile_column integer, tile_row integer, tile_data blob)');
  database.prepare('insert into tiles values(?,?,?,?)').run(z, x, 2 ** z - 1 - y, png);
  database.close();
  const sourceBytes = await readFile(path.join(root, 'source.mbtiles'));
  const exported = prepareContent(sourceBytes, '.mbtiles');
  const style = prepareContent('{"version":8,"sources":{},"layers":[]}', '.json');
  const elevations = prepareContent('{"values":[]}', '.json');
  const weather = prepareContent('{"scenario":{}}', '.json');
  const draft: SnapshotDraft = {
    schemaVersion: 1,
    region: { name: 'Тестовая область', bounds },
    atlases: [{
      meta: { id: 'a1', name: 'Рельеф', format: 'png', kind: 'terrain', minzoom: 8, maxzoom: 13, bounds, attribution: 'Тест', layers: [], bytes: sourceBytes.length },
      id: 'a1', sha256: exported.content.ref.sha256, attribution: 'Тест', license: 'Тест', exportRights: 'ALLOWED',
      style: style.artifact, export: exported.artifact, elevations: elevations.artifact,
    }],
    resources: [],
    weather: { mode: 'scenario', contentRef: weather.content.ref, sourceId: 'test', attribution: 'Тест', license: 'Тест' },
    elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
    autonomy: 'COMPLETE', limitations: [],
  };
  const store = new EnvironmentSnapshotStore(root);
  const snapshot = await store.create(draft, [exported.content, style.content, elevations.content, weather.content]);
  const storedFile = path.join(root, snapshot.id, exported.content.ref.path);
  const before = createHash('sha256').update(await readFile(storedFile)).digest('hex');
  const tile = await readSnapshotTile(store, snapshot, 'a1', z, x, y);
  expect(tile).not.toBeNull();
  expect(tile!.format).toBe('png');
  const { data, info } = await sharp(tile!.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (lon: number) => {
    const px = Math.floor(((lon + 180) / 360 * 2 ** z - x) * info.width);
    const py = Math.floor(((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z - y) * info.height);
    return data[(py * info.width + px) * 4 + 3];
  };
  expect(alpha(outside)).toBe(0);
  expect(alpha(inside)).toBe(255);
  expect(createHash('sha256').update(await readFile(storedFile)).digest('hex')).toBe(before);
});
