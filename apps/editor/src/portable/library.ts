/** Перенос только пользовательских слоёв. Встроенные данные остаются частью сборки. */
export const LIBRARY_DATABASES = {
  knowledge: { name: 'def_ops_kb', version: 7, stores: ['entries', 'documents', 'proposals', 'vectors', 'infra', 'positions', 'boundaries', 'pins', 'candidates', 'pages', 'transcripts'] },
  sim: { name: 'def_ops_sim', version: 6, stores: ['rules', 'operations', 'theatres', 'infrastructure', 'edits', 'replays', 'replay_data', 'game_branches'] },
} as const;
type DatabaseName = keyof typeof LIBRARY_DATABASES;
type EncodedValue = null | boolean | number | string | { type: string; [key: string]: unknown };
export interface PortableLibraryArchive {
  format: 'def-ops-portable-library';
  version: 1;
  id: string;
  createdAt: string;
  databases: Record<DatabaseName, Record<string, EncodedValue[]>>;
}
export interface LibraryImportResult { id: string; imported: number; skipped: number; alreadyImported: boolean }
interface LibraryEnvironment { indexedDB?: IDBFactory; storage?: Pick<Storage, 'getItem' | 'setItem'> }
const MARKER = 'def_ops.portable-library.v1.';
const typedArrays = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array };
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(chunks.join(''));
}
function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))) throw new Error('Повреждены бинарные данные библиотеки');
  const raw = atob(value); return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** Объекты кодируются явно: пользовательские поля type/data не принимаются за служебную метку. */
export async function encodeLibraryValue(value: unknown, ancestors = new Set<object>()): Promise<EncodedValue> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : { type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
  if (typeof value !== 'object') throw new Error('Неподдерживаемое значение в библиотеке');
  if (ancestors.has(value)) throw new Error('Циклическая ссылка в библиотеке');
  const next = new Set(ancestors).add(value);
  if (value instanceof Blob) return { type: 'blob', mime: value.type, data: base64(new Uint8Array(await value.arrayBuffer())) };
  if (value instanceof ArrayBuffer) return { type: 'array-buffer', data: base64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { type: 'typed-array', kind: value instanceof DataView ? 'DataView' : value.constructor.name, data: base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (Array.isArray(value)) return { type: 'array', value: await Promise.all(value.map(v => encodeLibraryValue(v, next))) };
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Неподдерживаемый объект в библиотеке');
  return { type: 'object', value: await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encodeLibraryValue(v, next)])) };
}
export function decodeLibraryValue(value: unknown): unknown { return decodeValue(value, 0); }
function decodeValue(value: unknown, depth: number): unknown {
  if (depth > 200) throw new Error('Слишком глубокая вложенность библиотеки');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (!record(value)) throw new Error('Повреждён формат значения библиотеки');
  const decode = (v: unknown) => decodeValue(v, depth + 1);
  switch (value.type) {
    case 'undefined': return undefined;
    case 'number': {
      const numbers: Record<string, number> = { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 };
      if (typeof value.value === 'string' && Object.hasOwn(numbers, value.value)) return numbers[value.value]; break;
    }
    case 'bigint': if (typeof value.value === 'string' && /^-?\d+$/.test(value.value)) return BigInt(value.value); break;
    case 'date': if (typeof value.value === 'string' && Number.isFinite(Date.parse(value.value))) return new Date(value.value); break;
    case 'array-buffer': return bytes(value.data).buffer;
    case 'blob': if (typeof value.mime === 'string') return new Blob([bytes(value.data)], { type: value.mime }); break;
    case 'typed-array': {
      const data = bytes(value.data);
      if (value.kind === 'DataView') return new DataView(data.buffer);
      if (typeof value.kind === 'string' && Object.hasOwn(typedArrays, value.kind)) {
        const Ctor = typedArrays[value.kind as keyof typeof typedArrays];
        if (data.byteLength % Ctor.BYTES_PER_ELEMENT !== 0) throw new Error('Повреждён размер вектора библиотеки');
        return new Ctor(data.buffer);
      }
      break;
    }
    case 'array': if (Array.isArray(value.value)) return value.value.map(decode); break;
    case 'object': {
      if (!Array.isArray(value.value)) break;
      const result: Record<string, unknown> = {};
      for (const pair of value.value) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || Object.hasOwn(result, pair[0])) throw new Error('Повреждены поля объекта библиотеки');
        Object.defineProperty(result, pair[0], { value: decode(pair[1]), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
  }
  throw new Error('Неизвестный или повреждённый тип данных библиотеки');
}
function openDatabase(name: DatabaseName, factory: IDBFactory): Promise<IDBDatabase> {
  const spec = LIBRARY_DATABASES[name];
  return new Promise((resolve, reject) => {
    let rejected = false;
    const r = factory.open(spec.name, spec.version);
    r.onupgradeneeded = () => { for (const store of spec.stores) if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store, { keyPath: 'id' }); };
    r.onblocked = () => { rejected = true; reject(new Error('Библиотека занята другой версией приложения. Закройте остальные окна.')); };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      if (rejected) { r.result.close(); return; }
      if (Array.from(r.result.objectStoreNames).some(s => !(spec.stores as readonly string[]).includes(s))) {
        r.result.close(); reject(new Error('Обновите приложение: найдено неизвестное хранилище библиотеки')); return;
      }
      r.result.onversionchange = () => r.result.close(); resolve(r.result);
    };
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Импорт библиотеки отменён')); tx.onerror = () => reject(tx.error); });
}
/** Ошибка чтения не подменяется пустой базой: нельзя незаметно выпустить неполный архив. */
export async function exportPortableLibrary(env: LibraryEnvironment = {}): Promise<PortableLibraryArchive> {
  const databases = {} as PortableLibraryArchive['databases'];
  for (const name of Object.keys(LIBRARY_DATABASES) as DatabaseName[]) {
    const db = await openDatabase(name, env.indexedDB ?? indexedDB);
    let snapshot: Record<string, unknown[]>;
    try {
      const stores = [...LIBRARY_DATABASES[name].stores];
      const tx = db.transaction(stores); const done = completed(tx);
      snapshot = {};
      for (const store of stores) { const r = tx.objectStore(store).getAll(); r.onsuccess = () => { snapshot[store] = r.result; }; }
      await done;
    } finally { db.close(); }
    databases[name] = {};
    for (const [store, rows] of Object.entries(snapshot)) databases[name][store] = await Promise.all(rows.map(row => encodeLibraryValue(row)));
  }
  return { format: 'def-ops-portable-library', version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), databases };
}
function validateArchive(input: unknown): { archive: PortableLibraryArchive; decoded: Record<DatabaseName, Record<string, Record<string, unknown>[]>> } {
  if (!record(input) || input.format !== 'def-ops-portable-library' || input.version !== 1) throw new Error('Неподдерживаемый формат или версия библиотеки');
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9._-]{1,150}$/.test(input.id) || typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt))) throw new Error('Повреждены сведения о версии библиотеки');
  if (!record(input.databases) || Object.keys(input.databases).length !== 2) throw new Error('Неполный состав баз библиотеки');
  const decoded = {} as Record<DatabaseName, Record<string, Record<string, unknown>[]>>;
  for (const name of Object.keys(LIBRARY_DATABASES) as DatabaseName[]) {
    const stores = input.databases[name], expected = LIBRARY_DATABASES[name].stores;
    if (!record(stores) || Object.keys(stores).length !== expected.length || Object.keys(stores).some(s => !(expected as readonly string[]).includes(s))) throw new Error('Неизвестный или неполный состав хранилищ библиотеки');
    decoded[name] = {};
    for (const store of expected) {
      const rows = stores[store]; if (!Array.isArray(rows)) throw new Error(`Повреждено хранилище ${store}`);
      const ids = new Set<string>();
      decoded[name][store] = rows.map(row => {
        const value = decodeLibraryValue(row);
        if (!record(value) || typeof value.id !== 'string' || !value.id || ids.has(value.id)) throw new Error(`Отсутствует или повторяется id в ${store}`);
        ids.add(value.id); return value;
      });
    }
  }
  return { archive: input as unknown as PortableLibraryArchive, decoded };
}
/** Каждый DB атомарен. Если второй DB/отметка недоступны, повтор безопасно продолжит импорт. */
export async function importPortableLibrary(input: unknown, env: LibraryEnvironment = {}): Promise<LibraryImportResult> {
  const { archive, decoded } = validateArchive(input);
  const storage = env.storage ?? localStorage;
  const result: LibraryImportResult = { id: archive.id, imported: 0, skipped: 0, alreadyImported: false };
  if (storage.getItem(MARKER + archive.id)) return { ...result, alreadyImported: true };
  for (const name of Object.keys(LIBRARY_DATABASES) as DatabaseName[]) {
    const db = await openDatabase(name, env.indexedDB ?? indexedDB);
    try {
      const tx = db.transaction([...LIBRARY_DATABASES[name].stores], 'readwrite'); const done = completed(tx);
      for (const [storeName, rows] of Object.entries(decoded[name])) {
        const store = tx.objectStore(storeName);
        for (const row of rows) {
          const r = store.getKey(row.id as string);
          r.onsuccess = () => { if (r.result !== undefined) result.skipped++; else { store.add(row); result.imported++; } };
        }
      }
      await done;
    } finally { db.close(); }
  }
  storage.setItem(MARKER + archive.id, archive.createdAt);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('def_ops.sim-data'));
    window.dispatchEvent(new Event('def_ops.kb-data'));
  }
  return result;
}
/** Отсутствующий комплект — обычная установка без переносимой библиотеки. Остальные ошибки видны оператору. */
export async function importPortableLibraryFromUrl(url = '/api/portable/library'): Promise<LibraryImportResult | null> {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Не удалось прочитать комплект библиотеки (${response.status})`);
  return importPortableLibrary(await response.json());
}
export async function downloadPortableLibrary(): Promise<{ archive: PortableLibraryArchive; path?: string }> {
  const archive = await exportPortableLibrary();
  if ('__TAURI_INTERNALS__' in window) {
    const response = await fetch('/api/portable/library/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(archive) });
    if (!response.ok) throw new Error(`Не удалось сохранить библиотеку (${response.status})`);
    const result = await response.json() as { path?: unknown };
    if (typeof result.path !== 'string' || !result.path) throw new Error('Приложение не сообщило путь сохранённой библиотеки');
    return { archive, path: result.path };
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'user-library.json';
  document.body.append(link); link.click(); link.remove();
  // WebView должен успеть начать сохранение перед освобождением Blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { archive };
}
