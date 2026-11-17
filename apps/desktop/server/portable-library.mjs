// Проверяемая библиотека: сначала полная проверка источника, затем добавление отсутствующих файлов.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs, constants } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export function safePath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.includes('\0') || name.split('/').some(p => !p || p === '.' || p === '..' || /[<>"|?*\u0000-\u001f]/.test(p) || /[ .]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error(`Недопустимый путь: ${name}`);
  const path = resolve(root, name), rel = relative(resolve(root), path);
  if (isAbsolute(rel) || rel.startsWith('..')) throw Error(`Путь вне библиотеки: ${name}`);
  return path;
}
async function regularPath(root, name, allowMissing = false) {
  let current = resolve(root);
  const rootStat = await fs.lstat(current);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw Error(`Папка библиотеки не является обычной папкой: ${root}`);
  const parts = name.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let st;
    try { st = await fs.lstat(current); } catch (e) { if (allowMissing && e.code === 'ENOENT') return; throw e; }
    if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile())) throw Error(`Непереносимый файл: ${name}`);
  }
}
export async function inventory(root, sub = '') {
  const result = [];
  for (const entry of (await fs.readdir(join(root, sub), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw Error(`Ссылка в библиотеке: ${name}`);
    if (entry.isDirectory()) result.push(...await inventory(root, name));
    else if (entry.isFile()) result.push({ path: name, size: (await fs.stat(join(root, name))).size, sha256: await sha256(join(root, name)) });
    else throw Error(`Необычный файл: ${name}`);
  }
  return result;
}
export async function verifyLibrary(bundle) {
  const manifest = JSON.parse(await fs.readFile(join(bundle, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'def-ops-file-library' || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.id) || !Array.isArray(manifest.files)) throw Error('Неподдерживаемый манифест библиотеки');
  const actualId = createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex');
  if (actualId !== manifest.id) throw Error('Повреждён манифест библиотеки');
  const seen = new Set();
  for (const file of manifest.files) {
    const target = safePath(join(bundle, 'files'), file.path);
    const key = file.path.toLowerCase();
    if (key === 'portable-library.json') throw Error('Файл комплекта занимает служебное имя отметки импорта');
    if (seen.has(key) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Некорректная запись манифеста');
    seen.add(key);
    await regularPath(join(bundle, 'files'), file.path);
    if ((await fs.stat(target)).size !== file.size || await sha256(target) !== file.sha256) throw Error(`Повреждён файл комплекта: ${file.path}`);
  }
  return manifest;
}
/** Runtime проверяется до первого запуска Python; отметка привязана к содержимому его манифеста. */
export async function verifyRuntime(runtime, data) {
  await regularPath(runtime, 'manifest.json');
  const raw = await fs.readFile(join(runtime, 'manifest.json'), 'utf8');
  const id = createHash('sha256').update(raw).digest('hex');
  let manifest;
  try { manifest = JSON.parse(raw); } catch { throw Error('Неверный манифест runtime'); }
  if (!manifest || manifest.schema !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) || Object.keys(manifest.files).length === 0) throw Error('Неверный манифест runtime');
  const files = Object.entries(manifest.files), seen = new Set();
  // Состав и пути проверяются даже при совпавшей отметке; кэшируется только дорогая проверка хешей.
  for (const [name, file] of files) {
    safePath(runtime, name);
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key) || !file || typeof file !== 'object' || Array.isArray(file) || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error(`Неверная запись манифеста runtime: ${name}`);
    seen.add(key);
    await regularPath(runtime, name);
    if ((await fs.stat(safePath(runtime, name))).size !== file.size) throw Error(`Повреждён runtime: ${name}`);
  }
  await fs.mkdir(data, { recursive: true });
  await regularPath(data, 'portable-runtime.json', true);
  const marker = join(data, 'portable-runtime.json');
  try { if (JSON.parse(await fs.readFile(marker, 'utf8')).id === id) return; } catch { /* первый запуск */ }
  for (const [name, file] of files) {
    if (await sha256(safePath(runtime, name)) !== file.sha256) throw Error(`Повреждён runtime: ${name}`);
  }
  const tmp = `${marker}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, JSON.stringify({ id }), { flag: 'wx' }); await fs.rename(tmp, marker); }
  finally { await fs.rm(tmp, { force: true }); }
}

export async function installLibrary(bundle, data) {
  const manifest = await verifyLibrary(bundle);
  await fs.mkdir(data, { recursive: true });
  await regularPath(data, 'portable-library.json', true);
  const marker = join(data, 'portable-library.json');
  let installed = null;
  try { installed = JSON.parse(await fs.readFile(marker, 'utf8')); } catch { /* первый запуск или незавершённый импорт */ }
  // Файлы пользователя никогда не заменяются. Удалённые пользователем файлы не восстанавливаются при каждом старте.
  if (installed?.id === manifest.id) return { id: manifest.id, installed: false, added: 0 };
  let added = 0;
  for (const file of manifest.files) {
    const target = safePath(data, file.path);
    await regularPath(data, file.path, true);
    try { await fs.access(target); continue; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.import-${randomUUID()}`;
    try {
      await fs.copyFile(join(bundle, 'files', file.path), tmp, constants.COPYFILE_EXCL);
      if (await sha256(tmp) !== file.sha256) throw Error(`Ошибка копирования: ${file.path}`);
      // hard link даёт атомарное добавление без перезаписи уже появившегося файла.
      try { await fs.link(tmp, target); added++; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    } finally { await fs.rm(tmp, { force: true }); }
  }
  const tmp = `${marker}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ id: manifest.id, added }), { flag: 'wx' });
    await fs.rename(tmp, marker);
  } finally { await fs.rm(tmp, { force: true }); }
  return { id: manifest.id, installed: true, added };
}

/** Проверка полного состава архива перед упаковкой/сохранением. Бинарный кодек проверяется при импорте в IndexedDB. */
export function validateUserLibraryEnvelope(user) {
  const stores = {
    knowledge: ['entries', 'documents', 'proposals', 'vectors', 'infra', 'positions', 'boundaries', 'pins', 'candidates', 'pages', 'transcripts'],
    sim: ['rules', 'operations', 'theatres', 'infrastructure', 'edits', 'replays', 'replay_data', 'game_branches'],
  };
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!object(user) || user.format !== 'def-ops-portable-library' || user.version !== 1 || typeof user.id !== 'string' || !/^[A-Za-z0-9._-]{1,150}$/.test(user.id) || typeof user.createdAt !== 'string' || !Number.isFinite(Date.parse(user.createdAt))) throw Error('Неверный формат пользовательской библиотеки');
  if (!object(user.databases) || Object.keys(user.databases).length !== 2) throw Error('Нужен полный состав хранилищ пользовательской библиотеки');
  for (const [database, expected] of Object.entries(stores)) {
    const values = user.databases[database];
    if (!object(values) || Object.keys(values).length !== expected.length || Object.keys(values).some(s => !expected.includes(s))) throw Error('Нужен полный состав хранилищ пользовательской библиотеки');
    for (const name of expected) {
      if (!Array.isArray(values[name])) throw Error(`Повреждено хранилище ${name}`);
      const ids = new Set();
      for (const row of values[name]) {
        if (!object(row) || row.type !== 'object' || !Array.isArray(row.value)) throw Error(`Повреждена запись в ${name}`);
        const id = row.value.find(pair => Array.isArray(pair) && pair.length === 2 && pair[0] === 'id')?.[1];
        if (typeof id !== 'string' || !id || ids.has(id)) throw Error(`Повреждён или повторяется id в ${name}`);
        ids.add(id);
      }
    }
  }
  return user;
}
