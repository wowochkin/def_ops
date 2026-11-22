import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { INITIAL_MAP_COMMAND_SCHEMAS, INITIAL_MAP_JSON_SCHEMA } from '../../src/scenario/initial-map';
import { SUPPORTED_ARCHIVE_SCHEMA_VERSIONS } from '../../src/archive/archive-schema';

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) result.push(path);
  }
  return result;
}

it('не допускает React, браузерное хранилище и транспорт в чистом ядре', async () => {
  const files = await sourceFiles(resolve('packages/kshvi/src'));
  expect(files.length).toBeGreaterThan(50);
  const forbidden: string[] = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    if (/from\s+['"](?:react|react-dom)(?:\/|['"])/.test(source) || /\b(?:localStorage|sessionStorage|indexedDB|XMLHttpRequest)\b/.test(source) || /\bfetch\s*\(/.test(source)) forbidden.push(path);
  }
  expect(forbidden).toEqual([]);
});

it('публикует версионные JSON Schema команд, карты, архива и администрирования', async () => {
  expect(INITIAL_MAP_JSON_SCHEMA).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'kshvi/initial-map-v1.schema.json', type: 'object' });
  expect(INITIAL_MAP_JSON_SCHEMA.properties.schemaVersion).toEqual({ const: 1 });
  expect(Object.keys(INITIAL_MAP_COMMAND_SCHEMAS)).toEqual(['manualAdd', 'geoJsonImport', 'groupShift', 'approve']);
  for (const schema of Object.values(INITIAL_MAP_COMMAND_SCHEMAS)) expect(schema.required.length).toBeGreaterThan(0);
  expect(SUPPORTED_ARCHIVE_SCHEMA_VERSIONS).toEqual([1]);
  const admin = JSON.parse(await readFile('services/kshvi/src/admin/admin-contracts.schema.json', 'utf8')) as { $schema: string; schemaVersion: number; definitions: Record<string, unknown> };
  expect(admin.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(admin.schemaVersion).toBe(1);
  expect(Object.keys(admin.definitions)).toEqual(expect.arrayContaining(['ConfigVersion', 'BackupManifest', 'SecurityAuditEvent', 'OperationsSnapshot']));
});
