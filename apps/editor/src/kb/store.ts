/**
 * Хранилище базы знаний в браузере (IndexedDB): слой пользователя — записи (новые и изменённые),
 * загруженные документы (текст по частям), предложения из документов. Начальное наполнение — в
 * сборке (packages/knowledge/data/seed.json); слой пользователя — поверх него. Доступно и из фоновых
 * потоков (игра: справка советнику).
 */
import type { Entry, KbDocument, Proposal } from '@def-ops/knowledge';

const DB = 'def_ops_kb', VER = 1;
type StoreName = 'entries' | 'documents' | 'proposals';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { for (const s of ['entries', 'documents', 'proposals']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function all<T = Entry | KbDocument | Proposal>(store: StoreName): Promise<T[]> {
  try { return await req((await db()).transaction(store).objectStore(store).getAll()) as T[]; } catch { return []; }
}
export async function put(store: StoreName, ...items: unknown[]) {
  const tx = (await db()).transaction(store, 'readwrite');
  for (const it of items) tx.objectStore(store).put(it);
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function del(store: StoreName, ...ids: string[]) {
  const tx = (await db()).transaction(store, 'readwrite');
  for (const id of ids) tx.objectStore(store).delete(id);
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

/** Начальное наполнение (лениво, отдельным куском сборки). */
let seedP: Promise<Entry[]> | null = null;
export function seed(): Promise<Entry[]> {
  seedP ??= import('../../../../packages/knowledge/data/seed.json').then((m) => (m.default as unknown as { entries: Entry[] }).entries);
  return seedP;
}

/** Все записи: начальные, поверх — слой пользователя (тот же id заменяет). */
export async function entries(): Promise<Entry[]> {
  const [s, u] = await Promise.all([seed(), all<Entry>('entries')]);
  const m = new Map(s.map((e) => [e.id, e]));
  for (const e of u) m.set(e.id, e);
  return [...m.values()];
}
