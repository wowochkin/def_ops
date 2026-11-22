import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export type OfflineDataSet = Readonly<{
  id: string;
  kind: 'FONT' | 'LIBRARY' | 'ATLAS' | 'WEATHER' | 'PDF_GENERATOR' | 'DOCX_GENERATOR' | 'SYMBOLS' | 'REFERENCE';
  name: string;
  source: string;
  version: string;
  license: string;
  sha256: string;
  attribution: string;
  offlineReady: boolean;
  autonomousArchive: 'ALLOWED' | 'LINK_ONLY' | 'FORBIDDEN';
  path?: string;
}>;
export type OfflineManifest = Readonly<{ schemaVersion: 1; assets: readonly OfflineDataSet[] }>;

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
function safeRelativePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Недопустимый путь фактического offline payload');
  }
}
async function payload(rootDirectory: string, dataset: OfflineDataSet): Promise<Buffer> {
  if (!dataset.path) throw new Error('Для автономности требуется фактический payload, а не descriptor');
  safeRelativePath(dataset.path);
  const path = resolve(rootDirectory, dataset.path);
  const root = resolve(rootDirectory);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('Offline payload выходит за корень набора');
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Offline payload должен быть обычным файлом: ${dataset.path}`);
  return readFile(path);
}
async function listedFiles(rootDirectory: string, relative = ''): Promise<string[]> {
  const entries = await readdir(resolve(rootDirectory, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listedFiles(rootDirectory, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function verifyOfflineManifest(rootDirectory: string): Promise<{
  valid: boolean;
  checkedFiles: number;
  missing: string[];
  unlisted: string[];
  invalidHashes: string[];
}> {
  const manifest = JSON.parse(await readFile(resolve(rootDirectory, 'manifest.json'), 'utf8')) as OfflineManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) throw new Error('Неверная схема offline manifest');
  const missing: string[] = [];
  const invalidHashes: string[] = [];
  const listed = new Set<string>();
  for (const asset of manifest.assets) {
    if (!asset.path || listed.has(asset.path)) {
      invalidHashes.push(asset.path ?? asset.id);
      continue;
    }
    listed.add(asset.path);
    try {
      const content = await payload(rootDirectory, asset);
      if (hash(content) !== asset.sha256) invalidHashes.push(asset.path);
    } catch {
      missing.push(asset.path);
    }
  }
  const actual = (await listedFiles(rootDirectory)).filter(path => path !== 'manifest.json');
  const unlisted = actual.filter(path => !listed.has(path));
  const requiredKinds = new Set(['FONT', 'LIBRARY', 'ATLAS', 'WEATHER', 'PDF_GENERATOR', 'DOCX_GENERATOR', 'SYMBOLS', 'REFERENCE']);
  const kindsComplete = [...requiredKinds].every(kind => manifest.assets.some(asset => asset.kind === kind));
  return {
    valid: missing.length === 0 && unlisted.length === 0 && invalidHashes.length === 0 && kindsComplete,
    checkedFiles: listed.size, missing, unlisted, invalidHashes,
  };
}

export function createExportEnvelope(input: {
  schemaVersion: string;
  content: unknown;
  legend: readonly string[];
  units: Readonly<Record<string, string>>;
  attribution: string;
  revision: number;
  pageCount: number;
}) {
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) throw new Error('Экспорт должен содержать хотя бы одну страницу');
  return {
    schemaVersion: input.schemaVersion,
    content: structuredClone(input.content),
    legend: [...input.legend],
    units: { ...input.units },
    attribution: input.attribution,
    revision: input.revision,
    pageNumbers: Array.from({ length: input.pageCount }, (_, index) => index + 1),
    generatedLocally: true,
  } as const;
}

export async function assertAutonomousExport(datasets: readonly OfflineDataSet[], options: {
  rootDirectory: string;
  allowLinkOnly?: boolean;
}): Promise<{ autonomous: boolean; warnings: string[] }> {
  if (datasets.some(dataset => !dataset.offlineReady || dataset.autonomousArchive === 'FORBIDDEN')) {
    throw new Error('Включение набора данных в автономный архив запрещено лицензией или отсутствием локальных данных');
  }
  for (const dataset of datasets) {
    const content = await payload(options.rootDirectory, dataset);
    if (hash(content) !== dataset.sha256) throw new Error(`Не совпадает хеш offline payload: ${dataset.path ?? dataset.id}`);
  }
  const linkOnly = datasets.filter(dataset => dataset.autonomousArchive === 'LINK_ONLY');
  if (linkOnly.length && !options.allowLinkOnly) {
    throw new Error('Полная автономность невозможна; разрешён только экспорт ссылки/стиля');
  }
  return {
    autonomous: linkOnly.length === 0,
    warnings: linkOnly.map(dataset => `${dataset.name}: полностью автономное воспроизведение невозможно, экспортирована ссылка/стиль`),
  };
}
