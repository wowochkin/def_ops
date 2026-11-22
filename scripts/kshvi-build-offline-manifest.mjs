import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('packages/kshvi/assets');
async function files(relative = '') {
  const result = [];
  for (const entry of await readdir(resolve(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.name === '__pycache__' || entry.name === '.DS_Store') continue;
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile() && path !== 'manifest.json' && !path.endsWith('.pyc')) result.push(path);
  }
  return result.sort();
}
function metadata(path) {
  if (path.startsWith('fonts/')) return { kind: 'FONT', source: 'Fontsource PT Sans Narrow', version: '5.3.0', license: 'OFL-1.1', attribution: 'Copyright 2009 ParaType Ltd.; Fontsource', autonomousArchive: 'ALLOWED' };
  if (path.startsWith('vendor/react/')) return { kind: 'LIBRARY', source: 'Фактический пакет react', version: '19.3.0', license: 'MIT', attribution: 'React and contributors', autonomousArchive: 'ALLOWED' };
  if (path.startsWith('vendor/pdfmake/')) return { kind: 'PDF_GENERATOR', source: 'Фактический пакет pdfmake', version: '0.2.23', license: 'MIT', attribution: 'Bartek Pampuch and contributors', autonomousArchive: 'ALLOWED' };
  if (path.startsWith('vendor/python-docx/')) return { kind: 'DOCX_GENERATOR', source: 'Фактический пакет python-docx', version: '1.2.0', license: 'MIT', attribution: 'python-docx contributors', autonomousArchive: 'ALLOWED' };
  if (path.startsWith('vendor/tactical-symbols/')) return { kind: 'SYMBOLS', source: 'packages/tactical-symbols', version: '0.1.0', license: 'По реестру источников', attribution: 'data/source-registry.json и NOTICE.txt', autonomousArchive: path.includes('/source/') ? 'LINK_ONLY' : 'ALLOWED' };
  if (path.startsWith('vendor/knowledge/')) return { kind: 'REFERENCE', source: 'packages/knowledge/data', version: '0.1.0', license: 'По записям источников', attribution: 'seed.json, model-index.json и NOTICE.txt', autonomousArchive: 'LINK_ONLY' };
  if (path === 'data/training-atlas.json') return { kind: 'ATLAS', source: 'Проектный учебный набор', version: '1.0.0', license: 'CC0-1.0', attribution: 'Учебный набор КШВИ; не картографический эталон', autonomousArchive: 'ALLOWED' };
  if (path === 'data/training-weather.json') return { kind: 'WEATHER', source: 'Проектный учебный набор', version: '1.0.0', license: 'CC0-1.0', attribution: 'Учебный набор КШВИ; отсутствие данных сохраняется явно', autonomousArchive: 'ALLOWED' };
  throw new Error(`Неизвестная группа payload: ${path}`);
}
const assets = [];
for (const path of await files()) {
  const content = await readFile(resolve(root, path));
  assets.push({
    id: path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: path,
    ...metadata(path),
    path,
    sha256: createHash('sha256').update(content).digest('hex'),
    offlineReady: true,
  });
}
const manifest = { schemaVersion: 1, assets };
await writeFile(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Записано фактических payload-файлов: ${assets.length}\n`);
