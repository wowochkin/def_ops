import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { assertAutonomousExport, createExportEnvelope, type OfflineDataSet } from '../../../services/kshvi/src/admin/offline-assets';

const root = resolve('packages/kshvi/assets');

it('проверяет локальные ресурсы, атрибуцию и SHA-256 без внешних URL', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')) as {
    schemaVersion: number;
    assets: (OfflineDataSet & { path: string })[];
  };
  expect(manifest.schemaVersion).toBe(1);
  expect(new Set(manifest.assets.map(asset => asset.kind))).toEqual(new Set(['FONT', 'LIBRARY', 'ATLAS', 'WEATHER', 'PDF_GENERATOR', 'DOCX_GENERATOR', 'SYMBOLS', 'REFERENCE']));
  for (const asset of manifest.assets) {
    const content = await readFile(resolve(root, asset.path));
    expect(createHash('sha256').update(content).digest('hex'), asset.id).toBe(asset.sha256);
    expect(asset.source.length).toBeGreaterThan(0);
    expect(asset.license.length).toBeGreaterThan(0);
    expect(asset.attribution.length).toBeGreaterThan(0);
    expect(asset.offlineReady).toBe(true);
  }
  expect(JSON.stringify(manifest)).not.toMatch(/https?:\/\//i);

  const runtime = JSON.parse(await readFile(resolve('deploy/kshvi/runtime.json'), 'utf8'));
  expect(runtime.network).toMatchObject({ mode: 'closed-lan', minWorkstations: 2, maxWorkstations: 50, externalAccess: false });
  expect(runtime.tls.required).toBe(true);
  expect(runtime.heavyJobs.maxConcurrent).toBeGreaterThan(0);
  expect(runtime.updates.activeSessionForbidden).toBe(true);
  expect(JSON.stringify(runtime)).not.toMatch(/https?:\/\//i);
});

it('публикует JSON Schema версионных административных контрактов', async () => {
  const schema = JSON.parse(await readFile(resolve('services/kshvi/src/admin/admin-contracts.schema.json'), 'utf8')) as {
    $schema: string;
    schemaVersion: number;
    definitions: Record<string, unknown>;
  };
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(schema.schemaVersion).toBe(1);
  for (const name of ['ConfigVersion', 'RetentionPolicy', 'DeletionRequest', 'BackupManifest', 'SecurityAuditEvent', 'OperationsSnapshot']) {
    expect(schema.definitions[name], name).toBeTruthy();
  }
});

it('сохраняет версию схемы, легенду, единицы, атрибуцию, страницы и редакцию в локальном экспорте', () => {
  const envelope = createExportEnvelope({
    schemaVersion: '1.0.0', content: { status: 'OK' }, legend: ['Синяя рамка — свои силы'], units: { distance: 'км' },
    attribution: 'Локальный учебный атлас', revision: 4, pageCount: 3,
  });
  expect(envelope).toMatchObject({ schemaVersion: '1.0.0', revision: 4, generatedLocally: true, pageNumbers: [1, 2, 3], units: { distance: 'км' } });
  expect(envelope.attribution).toContain('атлас');
});

it('отклоняет ложную автономность и явно разрешает только экспорт ссылки или стиля', () => {
  const base: OfflineDataSet = {
    id: 'atlas', kind: 'ATLAS', name: 'Атлас', source: 'Источник', version: '1', license: 'Лицензия', sha256: 'a'.repeat(64),
    attribution: 'Атрибуция', offlineReady: true, autonomousArchive: 'ALLOWED',
  };
  expect(assertAutonomousExport([base])).toEqual({ autonomous: true, warnings: [] });
  expect(() => assertAutonomousExport([{ ...base, autonomousArchive: 'LINK_ONLY' }])).toThrow('ссылки/стиля');
  expect(assertAutonomousExport([{ ...base, autonomousArchive: 'LINK_ONLY' }], { allowLinkOnly: true })).toMatchObject({ autonomous: false });
  expect(() => assertAutonomousExport([{ ...base, autonomousArchive: 'FORBIDDEN' }])).toThrow('запрещ');
});
