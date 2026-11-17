import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareLibrary } from '../../../scripts/portable-release.mjs';
import { installLibrary, safePath, verifyLibrary, verifyRuntime } from '../server/portable-library.mjs';
import { LIBRARY_DATABASES } from '../../editor/src/portable/library';
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'перенос библиотеки ')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file: string, content: string) { await fs.mkdir(join(file, '..'), { recursive: true }); await fs.writeFile(file, content); }
const archive = () => ({ format: 'def-ops-portable-library', version: 1, id: 'test', createdAt: new Date().toISOString(), databases: Object.fromEntries(Object.entries(LIBRARY_DATABASES).map(([name, spec]) => [name, Object.fromEntries(spec.stores.map(s => [s, []]))])) });
async function bundle(files: Record<string, string>) {
  const dir = join(root, 'комплект'); const rows = [];
  for (const [path, value] of Object.entries(files)) { await write(join(dir, 'files', path), value); rows.push({ path, size: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') }); }
  await write(join(dir, 'manifest.json'), JSON.stringify({ format: 'def-ops-file-library', version: 1, id: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), files: rows }));
  return dir;
}
describe('файловый комплект переноса', () => {
  it('собирает разрешённые ресурсы и исключает секреты и настройки мониторов', async () => {
    const data = join(root, 'данные'), out = join(root, 'готовый комплект');
    await write(join(data, 'documents/a.json'), '{}'); await write(join(data, 'voice/voices/a.wav'), 'voice');
    await write(join(data, 'secrets.json'), 'secret'); await write(join(data, 'expo/screens.json'), 'screens');
    await write(join(root, 'user.json'), JSON.stringify(archive()));
    await prepareLibrary({ data, archive: join(root, 'user.json'), out });
    const m = await verifyLibrary(out); expect(m.files.map((f: { path: string }) => f.path)).toEqual(['documents/a.json', 'portable/user-library.json', 'voice/tts.json', 'voice/voices/a.wav']);
    await expect(prepareLibrary({ data, archive: join(root, 'user.json'), out })).rejects.toThrow();
  });
  it('проверяет весь источник до изменений и отказывает при повреждении файла', async () => {
    const source = await bundle({ 'documents/a.json': 'a', 'documents/b.json': 'b' });
    await fs.writeFile(join(source, 'files/documents/b.json'), 'x');
    const data = join(root, 'профиль'); await expect(installLibrary(source, data)).rejects.toThrow(/Повреждён/);
    await expect(fs.access(data)).rejects.toThrow();
  });
  it('не заменяет локальные правки и не восстанавливает удалённое при повторном запуске', async () => {
    const source = await bundle({ 'documents/a.json': 'a', 'documents/b.json': 'b' }); const data = join(root, 'профиль');
    await write(join(data, 'documents/a.json'), 'правка');
    expect(await installLibrary(source, data)).toMatchObject({ added: 1, installed: true });
    expect(await fs.readFile(join(data, 'documents/a.json'), 'utf8')).toBe('правка');
    await fs.unlink(join(data, 'documents/b.json'));
    expect(await installLibrary(source, data)).toMatchObject({ added: 0, installed: false });
    await expect(fs.access(join(data, 'documents/b.json'))).rejects.toThrow();
  });
  it('после сбоя продолжает добавление, не отмечает незавершённый импорт', async () => {
    const source = await bundle({ 'documents/a.json': 'a', 'documents/b.json': 'b' }); const data = join(root, 'профиль');
    await fs.mkdir(join(data, 'documents/b.json'), { recursive: true });
    await expect(installLibrary(source, data)).rejects.toThrow(/Непереносимый/);
    await expect(fs.access(join(data, 'portable-library.json'))).rejects.toThrow();
    await fs.writeFile(join(data, 'documents/a.json'), 'правка после сбоя'); await fs.rmdir(join(data, 'documents/b.json'));
    expect(await installLibrary(source, data)).toMatchObject({ added: 1 });
    expect(await fs.readFile(join(data, 'documents/a.json'), 'utf8')).toBe('правка после сбоя');
  });
  it.each(['../escape', '/absolute', 'a/../b', 'a\\b', 'C:/data', 'a//b', 'a\0b', 'CON', 'a/NUL.json', 'a/end.', 'a/end ', 'a/x?y'])('отклоняет непереносимый путь %s', value => { expect(() => safePath(root, value)).toThrow(); });
  it('не идёт по ссылкам в источнике и в профиле', async () => {
    const source = await bundle({ 'documents/a.json': 'a' }); const data = join(root, 'профиль');
    const outside = join(root, 'внешние'); await fs.mkdir(outside);
    await fs.mkdir(data); await fs.symlink(outside, join(data, 'documents'));
    await expect(installLibrary(source, data)).rejects.toThrow(/Непереносимый/);
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.unlink(join(source, 'files/documents/a.json')); await write(join(outside, 'a.json'), 'a'); await fs.symlink(join(outside, 'a.json'), join(source, 'files/documents/a.json'));
    await expect(verifyLibrary(source)).rejects.toThrow(/Непереносимый/);
  });
  it('не позволяет файлу комплекта заменить отметку импорта', async () => {
    const source = await bundle({ 'portable-library.json': 'подмена' });
    await expect(installLibrary(source, join(root, 'профиль'))).rejects.toThrow(/служебн/i);
  });
  it('не пишет через оставленную ссылку на временную отметку', async () => {
    const source = await bundle({ 'documents/a.json': 'a' }); const data = join(root, 'профиль');
    const untouched = join(root, 'посторонний'); await fs.writeFile(untouched, 'не менять'); await fs.mkdir(data);
    await fs.symlink(untouched, join(data, 'portable-library.json.tmp'));
    await installLibrary(source, data);
    expect(await fs.readFile(untouched, 'utf8')).toBe('не менять');
  });
  it('не выпускает комплект с неполным пользовательским архивом', async () => {
    await write(join(root, 'bad.json'), JSON.stringify({ ...archive(), databases: {} }));
    await expect(prepareLibrary({ data: root, archive: join(root, 'bad.json'), out: join(root, 'неготовый') })).rejects.toThrow(/полн|хранилищ/i);
  });
});


async function runtimeBundle(files: Record<string, string> = { 'python/bin/python3': 'python' }) {
  const dir = join(root, 'runtime'); const rows: Record<string, { size: number; sha256: string }> = {};
  for (const [path, value] of Object.entries(files)) {
    await write(join(dir, path), value); rows[path] = { size: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') };
  }
  await write(join(dir, 'manifest.json'), JSON.stringify({ schema: 1, files: rows })); return dir;
}
describe('проверка автономного runtime', () => {
  it('ставит отметку после проверки и не переписывает её при повторном запуске', async () => {
    const runtime = await runtimeBundle(); const data = join(root, 'новый профиль');
    await verifyRuntime(runtime, data);
    const marker = join(data, 'portable-runtime.json'); const saved = JSON.parse(await fs.readFile(marker, 'utf8'));
    const raw = await fs.readFile(join(runtime, 'manifest.json'));
    expect(saved.id).toBe(createHash('sha256').update(raw).digest('hex'));
    await fs.writeFile(marker, JSON.stringify({ ...saved, unchanged: true }));
    await verifyRuntime(runtime, data); expect(JSON.parse(await fs.readFile(marker, 'utf8')).unchanged).toBe(true);
  });
  it('не ставит отметку при несовпадении хеша', async () => {
    const runtime = await runtimeBundle(); const data = join(root, 'профиль'); await fs.mkdir(data);
    await fs.writeFile(join(runtime, 'python/bin/python3'), 'broken');
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/Повреждён runtime/);
    expect(await fs.readdir(data)).toEqual([]);
  });
  it.each([null, {}, { schema: 2, files: {} }, { schema: 1, files: [] }, { schema: 1, files: {} }, { schema: 1, files: { 'python/bin/python3': null } }])('отклоняет повреждённый манифест %j', async manifest => {
    const runtime = await runtimeBundle(); const data = join(root, 'профиль'); await fs.mkdir(data);
    const raw = JSON.stringify(manifest); await fs.writeFile(join(runtime, 'manifest.json'), raw);
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/манифест/i);
    expect(await fs.readdir(data)).toEqual([]);
  });
  it('не пропускает неверный формат манифеста даже при совпавшей отметке', async () => {
    const runtime = await runtimeBundle(); const data = join(root, 'профиль');
    const raw = JSON.stringify({ schema: 100, files: [] }); await fs.writeFile(join(runtime, 'manifest.json'), raw);
    await write(join(data, 'portable-runtime.json'), JSON.stringify({ id: createHash('sha256').update(raw).digest('hex') }));
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/манифест/i);
  });
  it.each(['../outside', 'python/../../outside', 'C:/python', 'python\\evil', 'CON.json'])('отклоняет путь runtime %s', async path => {
    const runtime = await runtimeBundle(); const data = join(root, 'профиль'); await fs.mkdir(data);
    await fs.writeFile(join(runtime, 'manifest.json'), JSON.stringify({ schema: 1, files: { [path]: { size: 0, sha256: '0'.repeat(64) } } }));
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/путь/i);
    expect(await fs.readdir(data)).toEqual([]);
  });
  it('не доверяет ссылке вместо отметки даже с верным id', async () => {
    const runtime = await runtimeBundle(); const data = join(root, 'профиль'); await fs.mkdir(data);
    const raw = await fs.readFile(join(runtime, 'manifest.json'));
    const other = join(root, 'чужая отметка'); await fs.writeFile(other, JSON.stringify({ id: createHash('sha256').update(raw).digest('hex') }));
    await fs.symlink(other, join(data, 'portable-runtime.json'));
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/Непереносимый/);
  });
  it('не следует ссылкам манифеста и исполняемых файлов', async () => {
    const runtime = await runtimeBundle(); const data = join(root, 'профиль'); await fs.mkdir(data);
    const manifest = join(runtime, 'manifest.json'), other = join(root, 'manifest.json'); await fs.rename(manifest, other); await fs.symlink(other, manifest);
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/Непереносимый/);
    await fs.unlink(manifest); await fs.rename(other, manifest);
    await fs.unlink(join(runtime, 'python/bin/python3')); await write(join(root, 'other-python'), 'python'); await fs.symlink(join(root, 'other-python'), join(runtime, 'python/bin/python3'));
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/Непереносимый/);
    expect(await fs.readdir(data)).toEqual([]);
  });
  it('новый манифест проверяется заново; отказ не выдаёт новую отметку', async () => {
    const runtime = await runtimeBundle(); const data = join(root, 'профиль'); await fs.mkdir(data); await verifyRuntime(runtime, data);
    const marker = await fs.readFile(join(data, 'portable-runtime.json'), 'utf8');
    const manifest = JSON.parse(await fs.readFile(join(runtime, 'manifest.json'), 'utf8')); manifest.files['python/bin/python3'].sha256 = '0'.repeat(64);
    await fs.writeFile(join(runtime, 'manifest.json'), JSON.stringify(manifest));
    await expect(verifyRuntime(runtime, data)).rejects.toThrow(/Повреждён runtime/);
    expect(await fs.readFile(join(data, 'portable-runtime.json'), 'utf8')).toBe(marker);
  });
});
