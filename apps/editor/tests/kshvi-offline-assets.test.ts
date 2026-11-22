import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { assertAutonomousExport, createExportEnvelope, verifyOfflineManifest, type OfflineDataSet } from '../../../services/kshvi/src/admin/offline-assets';

const root = resolve('packages/kshvi/assets');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(value => rm(value, { recursive: true, force: true }))); });

it('проверяет каждый фактический payload, лицензии и SHA-256 без descriptors и внешних URL', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')) as { schemaVersion: number; assets: OfflineDataSet[] };
  expect(manifest.schemaVersion).toBe(1);
  expect(new Set(manifest.assets.map(asset => asset.kind))).toEqual(new Set(['FONT', 'LIBRARY', 'ATLAS', 'WEATHER', 'PDF_GENERATOR', 'DOCX_GENERATOR', 'SYMBOLS', 'REFERENCE']));
  expect(manifest.assets.some(asset => asset.path === 'fonts/OFL.txt')).toBe(true);
  expect(manifest.assets.some(asset => asset.path === 'vendor/react/cjs/react.production.js')).toBe(true);
  expect(manifest.assets.some(asset => asset.path === 'vendor/pdfmake/build/pdfmake.js')).toBe(true);
  expect(manifest.assets.some(asset => asset.path === 'vendor/tactical-symbols/data/sets/ru-modern-v1.json')).toBe(true);
  expect(manifest.assets.some(asset => asset.path === 'vendor/knowledge/seed.json')).toBe(true);
  expect(manifest.assets.every(asset => typeof asset.path === 'string' && !asset.path.startsWith('descriptors/'))).toBe(true);
  expect(manifest.assets.every(asset => asset.source.length > 0 && asset.license.length > 0 && asset.attribution.length > 0 && asset.offlineReady)).toBe(true);
  expect(JSON.stringify(manifest)).not.toMatch(/https?:\/\//i);
  await expect(verifyOfflineManifest(root)).resolves.toMatchObject({ valid: true, missing: [], unlisted: [], invalidHashes: [] });

  const runtime = JSON.parse(await readFile(resolve('deploy/kshvi/runtime.json'), 'utf8'));
  expect(runtime.network).toMatchObject({ mode: 'closed-lan', minWorkstations: 2, maxWorkstations: 50, externalAccess: false });
  expect(runtime.tls.required).toBe(true);
  expect(runtime.heavyJobs.maxConcurrent).toBeGreaterThan(0);
  expect(runtime.updates.activeSessionForbidden).toBe(true);
  expect(JSON.stringify(runtime)).not.toMatch(/https?:\/\//i);
});

it('публикует JSON Schema версионных административных контрактов', async () => {
  const schema = JSON.parse(await readFile(resolve('services/kshvi/src/admin/admin-contracts.schema.json'), 'utf8')) as { $schema: string; schemaVersion: number; definitions: Record<string, unknown> };
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(schema.schemaVersion).toBe(1);
  for (const name of ['ConfigVersion', 'RetentionPolicy', 'DeletionRequest', 'BackupManifest', 'SecurityAuditEvent', 'OperationsSnapshot']) expect(schema.definitions[name], name).toBeTruthy();
});

it('сохраняет версию схемы, легенду, единицы, атрибуцию, страницы и редакцию в локальном экспорте', () => {
  const envelope = createExportEnvelope({ schemaVersion: '1.0.0', content: { status: 'OK' }, legend: ['Синяя рамка — свои силы'], units: { distance: 'км' }, attribution: 'Локальный учебный атлас', revision: 4, pageCount: 3 });
  expect(envelope).toMatchObject({ schemaVersion: '1.0.0', revision: 4, generatedLocally: true, pageNumbers: [1, 2, 3], units: { distance: 'км' } });
});

it('доказывает автономность фактическим содержимым и отклоняет descriptors, повреждение и ложную ссылку', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-offline-proof-'));
  roots.push(directory);
  await writeFile(join(directory, 'atlas.txt'), 'actual payload');
  const sha256 = createHash('sha256').update('actual payload').digest('hex');
  const base: OfflineDataSet = {
    id: 'atlas', kind: 'ATLAS', name: 'Атлас', source: 'Источник', version: '1', license: 'Лицензия', sha256,
    attribution: 'Атрибуция', offlineReady: true, autonomousArchive: 'ALLOWED', path: 'atlas.txt',
  };
  await expect(assertAutonomousExport([base], { rootDirectory: directory })).resolves.toEqual({ autonomous: true, warnings: [] });
  await expect(assertAutonomousExport([{ ...base, autonomousArchive: 'LINK_ONLY' }], { rootDirectory: directory })).rejects.toThrow('ссылки/стиля');
  await expect(assertAutonomousExport([{ ...base, autonomousArchive: 'LINK_ONLY' }], { rootDirectory: directory, allowLinkOnly: true })).resolves.toMatchObject({ autonomous: false });
  const { path: _path, ...descriptor } = base;
  await expect(assertAutonomousExport([descriptor], { rootDirectory: directory })).rejects.toThrow('payload');
  await writeFile(join(directory, 'atlas.txt'), 'tampered');
  await expect(assertAutonomousExport([base], { rootDirectory: directory })).rejects.toThrow('хеш');
  await expect(assertAutonomousExport([{ ...base, autonomousArchive: 'FORBIDDEN' }], { rootDirectory: directory })).rejects.toThrow('запрещ');
});
