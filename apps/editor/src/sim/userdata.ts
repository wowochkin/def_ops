/**
 * Данные моделирования пользователя (IndexedDB, доступно и из фоновых потоков): свои наборы правил (настройка,
 * калибровка) и загруженные операции (пакет: сценарий, театр, история, участки, настройки штаба модели, запись
 * каталога). Поверх данных сборки (packages/sim/data): getter отдаёт сначала встроенный файл, затем свой.
 */
import type { CatalogEntry, DataKind, OperationPackage, Rules } from '@def-ops/sim';
import { defaultCatalog, defaultLive } from '@def-ops/sim';
import catalogFile from '../../../../packages/sim/data/scenarios/catalog.json';

const DB = 'def_ops_sim', VER = 1;
type StoreName = 'rules' | 'operations';

/** Свой набор правил: правила целиком (без extends), откуда взят, для какой операции подбирался. */
export interface UserRules { id: string; title: string; note?: string; base: string; scenario?: string; created: string; rules: Rules }
/** Загруженная операция: пакет и итоги подготовки (проверка, контрольный прогон). */
export interface UserOperation {
  id: string;
  created: string;
  pkg: OperationPackage;
  /** Подготовлена к переигровке (опубликована в «Переигровку»). */
  ready: boolean;
  check?: { at: string; within: number; medianExcessKm: number; eventsHit: number; eventsTotal: number; ms: number };
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { for (const s of ['rules', 'operations']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function all<T>(s: StoreName): Promise<T[]> { try { return await req((await db()).transaction(s).objectStore(s).getAll()) as T[]; } catch { return []; } }
async function one<T>(s: StoreName, id: string): Promise<T | undefined> { try { return await req((await db()).transaction(s).objectStore(s).get(id)) as T | undefined; } catch { return undefined; } }
async function write(s: StoreName, f: (o: IDBObjectStore) => void) {
  const tx = (await db()).transaction(s, 'readwrite');
  f(tx.objectStore(s));
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  changed();
}

export const listRules = () => all<UserRules>('rules');
export const saveRules = (r: UserRules) => write('rules', (o) => o.put(r));
export const deleteRules = (id: string) => write('rules', (o) => o.delete(id));
export const listOperations = () => all<UserOperation>('operations');
export const getOperation = (id: string) => one<UserOperation>('operations', id);
export const saveOperation = (op: UserOperation) => write('operations', (o) => o.put(op));
export const deleteOperation = (id: string) => write('operations', (o) => o.delete(id));

/** Изменения видны во всех вкладках раздела: событие в окне (в потоке — нет окна, не нужно). */
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('def_ops.sim-data')); }
export function onDataChange(f: () => void) { window.addEventListener('def_ops.sim-data', f); return () => window.removeEventListener('def_ops.sim-data', f); }

/* ----------------------------- встроенные данные ----------------------------- */

const files = import.meta.glob('../../../../packages/sim/data/{scenarios,theatres,profiles,rules}/*.json', { import: 'default' });
const builtin = (kind: string, file: string) => files[`../../../../packages/sim/data/${kind}/${file}`];
/** id встроенных правил и профилей. */
export const BUILTIN = {
  rules: Object.keys(files).filter((k) => k.includes('/rules/') && !k.endsWith('norms.json')).map((k) => k.split('/').pop()!.replace('.json', '')),
  profiles: Object.keys(files).filter((k) => k.includes('/profiles/')).map((k) => k.split('/').pop()!.replace('.json', '')),
};
export const BUILTIN_CATALOG = (catalogFile as unknown as { scenarios: CatalogEntry[] }).scenarios;

/** Получение данных для движка: встроенные файлы, затем свои правила и операции. */
export async function getData(kind: DataKind, file: string): Promise<unknown> {
  const b = builtin(kind, file);
  if (b) return b();
  const id = file.replace(/\.json$/, '');
  if (kind === 'rules') { const r = await one<UserRules>('rules', id); if (r) return r.rules; }
  if (kind === 'scenarios') {
    const hist = id.endsWith('.history');
    const op = await getOperation(hist ? id.slice(0, -'.history'.length) : id);
    if (op) return hist ? op.pkg.history : op.pkg.scenario;
  }
  if (kind === 'theatres') { const op = (await listOperations()).find((o) => o.pkg.theatre.id === id); if (op) return op.pkg.theatre; }
  if (kind === 'profiles') { for (const o of await listOperations()) { const p = o.pkg.profiles?.find((x) => x.id === id); if (p) return p; } }
  throw new Error(`нет данных ${kind}/${file}`);
}

/**
 * Каталог переигровки: встроенные операции и подготовленные свои; у каждой — свои наборы правил,
 * подобранные для неё (и общие — без операции).
 */
export async function fullCatalog(includeDrafts = false): Promise<(CatalogEntry & { custom?: boolean })[]> {
  const [ops, rules] = await Promise.all([listOperations(), listRules()]);
  const mine = (id: string) => rules.filter((r) => !r.scenario || r.scenario === id).map((r) => ({ id: r.id, title: `свои: ${r.title}` }));
  const base = BUILTIN_CATALOG.map((c) => ({ ...c, rules: [...c.rules, ...mine(c.id)] }));
  const custom = ops.filter((o) => o.ready || includeDrafts).map((o) => {
    const c = o.pkg.catalog ?? defaultCatalog(o.pkg);
    return { ...c, id: o.id, custom: true, rules: [...c.rules, ...mine(o.id)] };
  });
  return [...base, ...custom];
}

/** Условия окончания игры для операции. */
export async function gameEndOf(id: string) {
  const b = BUILTIN_CATALOG.find((c) => c.id === id);
  if (b) return b.game;
  const op = await getOperation(id);
  return op ? (op.pkg.catalog ?? defaultCatalog(op.pkg)).game : undefined;
}

/** Настройки штаба модели для своей операции. */
export async function liveOf(id: string) {
  const op = await getOperation(id);
  return op ? op.pkg.live ?? defaultLive(op.pkg) : undefined;
}

/** Участки для фокуса своей операции. */
export async function sectorsOf(id: string) {
  return (await getOperation(id))?.pkg.sectors?.sectors ?? [];
}
