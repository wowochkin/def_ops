/**
 * Хранилище базы знаний в браузере (IndexedDB): слой пользователя — записи (новые и изменённые),
 * загруженные документы (текст по частям), предложения из документов. Начальное наполнение — в
 * сборке (packages/knowledge/data/seed.json); слой пользователя — поверх него. Доступно и из фоновых
 * потоков (игра: справка советнику).
 */
import type { Entry, InfraProposal, KbDocument, Pins, PositionProposal, Proposal } from '@def-ops/knowledge';

const DB = 'def_ops_kb', VER = 7;
/**
 * infra — сведения об инфраструктуре из документов операций (на проверку); positions — положения формирований из них;
 * boundaries — разграничительные линии (три прежние очереди и proposals — до версии 7, переносятся в candidates);
 * pins — закрепления выбора факта ({ id: ключ pinKey, pin: факт или 'none' }; там же метки переноса);
 * candidates — кандидаты-факты (очередь «На проверку» и отброшенные — для итогов документа); pages — картинки
 * страниц сканов; transcripts — их расшифровки.
 */
export type StoreName = 'entries' | 'documents' | 'proposals' | 'vectors' | 'infra' | 'positions' | 'boundaries' | 'pins' | 'candidates' | 'pages' | 'transcripts';
const STORES: StoreName[] = ['entries', 'documents', 'proposals', 'vectors', 'infra', 'positions', 'boundaries', 'pins', 'candidates', 'pages', 'transcripts'];

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
/** Только для тестов: закрыть базу и забыть соединение (следующее обращение откроет заново). */
export async function resetForTests() {
  if (dbp) { try { (await dbp).close(); } catch { /* не открылась */ } }
  dbp = null;
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function all<T = Entry | KbDocument | Proposal | InfraProposal | PositionProposal>(store: StoreName): Promise<T[]> {
  // vectors — кэш эмбеддингов: { id: модель|документ индекса, hash текста, v: Float32Array }
  try { return await req((await db()).transaction(store).objectStore(store).getAll()) as T[]; } catch { return []; }
}
export async function one<T>(store: StoreName, id: string): Promise<T | undefined> {
  try { return await req((await db()).transaction(store).objectStore(store).get(id)) as T | undefined; } catch { return undefined; }
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

/** Закрепления выбора факта (слой пользователя; в сиде их нет). */
export async function pins(): Promise<Pins> {
  // метки переноса (migrated:…) лежат в том же хранилище — не закрепления
  return Object.fromEntries((await all<{ id: string; pin: Pins[string] }>('pins')).filter((p) => !p.id.startsWith('migrated:')).map((p) => [p.id, p.pin]));
}
/** Записать закрепления; null — снять. */
export async function putPins(list: Record<string, Pins[string] | null>) {
  const set = Object.entries(list).filter(([, v]) => v != null).map(([id, pin]) => ({ id, pin }));
  const off = Object.entries(list).filter(([, v]) => v == null).map(([id]) => id);
  if (set.length) await put('pins', ...set);
  if (off.length) await del('pins', ...off);
}
