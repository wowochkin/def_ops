import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { downloadPortableLibrary, importPortableLibraryFromUrl, decodeLibraryValue, encodeLibraryValue, exportPortableLibrary, importPortableLibrary, LIBRARY_DATABASES } from '../src/portable/library';

let factory: IDBFactory;
let storage: Storage;
beforeEach(() => {
  factory = new IDBFactory();
  const values = new Map<string, string>();
  storage = { get length() { return values.size; }, clear: () => values.clear(), getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, key: i => [...values.keys()][i] ?? null };
});
afterEach(() => vi.unstubAllGlobals());
async function open(name: keyof typeof LIBRARY_DATABASES) {
  const spec = LIBRARY_DATABASES[name];
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open(spec.name, spec.version);
    r.onupgradeneeded = () => { for (const s of spec.stores) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function write(name: keyof typeof LIBRARY_DATABASES, store: string, value: unknown) {
  const db = await open(name); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
}
async function read(name: keyof typeof LIBRARY_DATABASES, store: string, key: string) {
  const db = await open(name); const r = db.transaction(store).objectStore(store).get(key);
  const value = await new Promise<any>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close(); return value;
}

describe('перенос пользовательской библиотеки', () => {
  it('сохраняет точные байты векторов, страницы, специальные числа и похожие на служебные объекты', async () => {
    const vector = new Float32Array([0.25, -3, NaN]);
    const original = { id: 'vector', vector, page: new Blob(['страница'], { type: 'image/png' }), raw: new Uint8Array([7, 8, 9]).subarray(1), absent: undefined, special: -Infinity, nested: { type: 'blob', data: 'обычный объект' } };
    const decoded = decodeLibraryValue(JSON.parse(JSON.stringify(await encodeLibraryValue(original)))) as typeof original;
    expect(decoded.vector).toBeInstanceOf(Float32Array);
    expect(new Uint8Array(decoded.vector.buffer)).toEqual(new Uint8Array(vector.buffer));
    expect(await decoded.page.text()).toBe('страница'); expect(decoded.page.type).toBe('image/png');
    expect([...decoded.raw]).toEqual([8, 9]); expect(decoded).toHaveProperty('absent', undefined);
    expect(decoded.special).toBe(-Infinity); expect(decoded.nested).toEqual(original.nested);
  });
  it('переносит все 19 хранилищ и не подменяет локальные записи при обновлении', async () => {
    for (const [name, spec] of Object.entries(LIBRARY_DATABASES)) for (const store of spec.stores) await write(name as keyof typeof LIBRARY_DATABASES, store, { id: store, title: 'из архива' });
    await write('knowledge', 'vectors', { id: 'embedding', model: 'test', v: new Float32Array([1, 2]) });
    const archive = await exportPortableLibrary({ indexedDB: factory });
    factory = new IDBFactory();
    await write('knowledge', 'entries', { id: 'entries', title: 'локальная правка' });
    const result = await importPortableLibrary(JSON.parse(JSON.stringify(archive)), { indexedDB: factory, storage });
    expect(result).toMatchObject({ imported: 19, skipped: 1, alreadyImported: false });
    for (const [name, spec] of Object.entries(LIBRARY_DATABASES)) for (const store of spec.stores) expect(await read(name as keyof typeof LIBRARY_DATABASES, store, store)).toHaveProperty('id', store);
    expect(await read('knowledge', 'entries', 'entries')).toHaveProperty('title', 'локальная правка');
    expect((await read('knowledge', 'vectors', 'embedding')).v).toBeInstanceOf(Float32Array);
    expect(await importPortableLibrary(archive, { indexedDB: factory, storage })).toMatchObject({ alreadyImported: true, imported: 0 });
  });
  it('проверяет весь архив до первой записи, не ставит отметку при ошибке', async () => {
    const archive = await exportPortableLibrary({ indexedDB: factory });
    archive.databases.knowledge.entries.push(await encodeLibraryValue({ id: 'valid' }));
    archive.databases.sim.edits.push(await encodeLibraryValue({ missing: 'id' }));
    await expect(importPortableLibrary(archive, { indexedDB: factory, storage })).rejects.toThrow(/id/);
    expect(await read('knowledge', 'entries', 'valid')).toBeUndefined(); expect(storage.length).toBe(0);
    await expect(importPortableLibrary({ ...archive, version: 2 }, { indexedDB: factory, storage })).rejects.toThrow(/верси/);
  });
  it('отвергает повреждённые бинарные данные и неизвестные хранилища', async () => {
    expect(() => decodeLibraryValue({ type: 'typed-array', kind: 'Float32Array', data: 'AA==' })).toThrow();
    const archive = await exportPortableLibrary({ indexedDB: factory });
    (archive.databases.knowledge as Record<string, unknown>).future = [];
    await expect(importPortableLibrary(archive, { indexedDB: factory, storage })).rejects.toThrow(/хранилищ/);
  });
  it('после сбоя отметки повторяет импорт без потери локальных изменений', async () => {
    await write('knowledge', 'entries', { id: 'fact', title: 'исходный' });
    const archive = await exportPortableLibrary({ indexedDB: factory }); factory = new IDBFactory();
    await expect(importPortableLibrary(archive, { indexedDB: factory, storage: { getItem: () => null, setItem: () => { throw new Error('Нет места'); } } })).rejects.toThrow('Нет места');
    await write('knowledge', 'entries', { id: 'fact', title: 'новая правка' });
    expect(await importPortableLibrary(archive, { indexedDB: factory, storage })).toMatchObject({ imported: 0, skipped: 1 });
    expect(await read('knowledge', 'entries', 'fact')).toHaveProperty('title', 'новая правка');
  });
  it('повторный запуск не восстанавливает удалённые после импорта записи', async () => {
    await write('knowledge', 'entries', { id: 'fact' });
    const archive = await exportPortableLibrary({ indexedDB: factory });
    await importPortableLibrary(archive, { indexedDB: factory, storage });
    const db = await open('knowledge'); const tx = db.transaction('entries', 'readwrite'); tx.objectStore('entries').delete('fact');
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
    expect(await importPortableLibrary(archive, { indexedDB: factory, storage })).toHaveProperty('alreadyImported', true);
    expect(await read('knowledge', 'entries', 'fact')).toBeUndefined();
  });
  it('установленное приложение сохраняет через файловый сервис и возвращает путь', async () => {
    vi.stubGlobal('indexedDB', factory); vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ path: '/данные/exports/user-library.json' })));
    vi.stubGlobal('fetch', fetcher);
    const result = await downloadPortableLibrary();
    expect(result.path).toBe('/данные/exports/user-library.json');
    expect(fetcher.mock.calls[0][0]).toBe('/api/portable/library/export');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toHaveProperty('format', 'def-ops-portable-library');
  });
  it('отличает отсутствие переносимого комплекта от ошибки чтения', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await importPortableLibraryFromUrl()).toBeNull();
    await expect(importPortableLibraryFromUrl()).rejects.toThrow('500');
  });

});
