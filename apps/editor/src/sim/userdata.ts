/**
 * Данные моделирования пользователя (IndexedDB, доступно и из фоновых потоков): свои наборы правил (настройка,
 * калибровка) и загруженные операции (пакет: сценарий, театр, история, участки, настройки штаба модели, запись
 * каталога). Поверх данных сборки (packages/sim/data): getter отдаёт сначала встроенный файл, затем свой.
 */
import type { Boundary, CatalogEntry, DataKind, History, InfraRecord, OperationPackage, Rules, Scenario, TheatreData } from '@def-ops/sim';
import type { CompileConflict, CompiledEdits, FactRef, KbOperation, OperationHint, Provenance } from '@def-ops/knowledge';
import { applyCompiled, applyCompiledBoundaries, applyCompiledCrossings, applyCompiledHistory } from './kb-compile';
import type { AgentHistory, AgentTrace } from '@def-ops/sim';
import type { SimResult } from './protocol';
import type { KbStamp } from './kb-stamp';
import { defaultCatalog, defaultLive, Theatre } from '@def-ops/sim';
import catalogFile from '../../../../packages/sim/data/scenarios/catalog.json';

const DB = 'def_ops_sim', VER = 5;
type StoreName = 'rules' | 'operations' | 'theatres' | 'infrastructure' | 'edits' | 'replays' | 'replay_data';
const STORES: StoreName[] = ['rules', 'operations', 'theatres', 'infrastructure', 'edits', 'replays', 'replay_data'];

/** Свой набор правил: правила целиком (без extends), откуда взят, для какой операции подбирался. */
export interface UserRules { id: string; title: string; note?: string; base: string; scenario?: string; created: string; rules: Rules }
/** Загруженная операция: пакет и итоги подготовки (проверка, контрольный прогон). */
export interface UserOperation {
  id: string;
  created: string;
  pkg: OperationPackage;
  /** Подготовлена к переигровке (опубликована в «Переигровку»). */
  ready: boolean;
  check?: { at: string; within: number; medianExcessKm: number; eventsHit: number; eventsTotal: number; ms: number; kb?: KbStamp | null };
}

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

/**
 * Сохранённая переигровка: в списке — только сведения для карточки (replays), сам расчёт — отдельно (replay_data):
 * результат с картой, сводной картой, событиями и отчётом, у агентной модели — ход дивизий по часам и история
 * (для карточек агентов, разговора и передачи командования). Открывается без пересчёта.
 */
export interface SavedReplay {
  id: string;
  title: string;
  created: string;
  scenario: string;
  scenarioName: string;
  engine: 'army' | 'agents';
  rules: string;
  seed: number;
  runs: number;
  within: number;
  eventsHit: number;
  eventsTotal: number;
  start: string;
  end: string;
  /** Сборка данных из базы знаний, на которой посчитан итог (в старых сохранениях нет). */
  kb?: KbStamp | null;
}
export interface SavedReplayData { id: string; result: SimResult; agents?: { trace: AgentTrace; history: AgentHistory } }
export const listReplays = async () => (await all<SavedReplay>('replays')).sort((a, b) => b.created.localeCompare(a.created));
export const getReplay = (id: string) => one<SavedReplayData>('replay_data', id);
export async function saveReplay(meta: SavedReplay, data: SavedReplayData) {
  await write('replay_data', (o) => o.put(data));
  await write('replays', (o) => o.put(meta));
}
export const renameReplay = async (id: string, title: string) => { const m = await one<SavedReplay>('replays', id); if (m) await write('replays', (o) => o.put({ ...m, title })); };
export async function deleteReplay(id: string) {
  await write('replays', (o) => o.delete(id));
  await write('replay_data', (o) => o.delete(id));
}
export const saveRules = (r: UserRules) => write('rules', (o) => o.put(r));
export const deleteRules = (id: string) => write('rules', (o) => o.delete(id));
export const listOperations = () => all<UserOperation>('operations');
/** Загруженный театр (раздел «Карты» → «Театры»): на него могут ссылаться свои операции. */
export interface UserTheatre { id: string; created: string; theatre: TheatreData }
export const listTheatres = () => all<UserTheatre>('theatres');
export const saveTheatre = (t: UserTheatre) => write('theatres', (o) => o.put(t));
export const deleteTheatre = (id: string) => write('theatres', (o) => o.delete(id));
/** Сведения об инфраструктуре операции (встроенной или своей): ложатся поверх театра при расчёте. */
export interface OperationInfra { id: string; records: InfraRecord[] }
export const getInfra = async (id: string) => (await one<OperationInfra>('infrastructure', id))?.records ?? [];
export async function saveInfra(id: string, records: InfraRecord[]) {
  const before = await getInfra(id);
  await write('infrastructure', (o) => o.put({ id, records }));
  const added = records.filter((r) => !before.some((b) => b.id === r.id)), removed = before.filter((b) => !records.some((r) => r.id === b.id));
  if (added.length || removed.length) await logChange(id, 'infra', [...added.map((r) => `+ ${r.title}`), ...removed.map((r) => `− ${r.title}`)].join('; '));
}

/* ----------------------- правки операции (слой поверх данных) ----------------------- */

/** Положение по дню, добавленное в историю операции (из документа — с цитатой). */
export type HistPosition = History['positions'][number] & { id: string; quote?: string; doc?: string };
/** Изменение данных операции: что и когда (для «изменилось после калибровки»). */
export interface ChangeLog { at: string; kind: 'scenario' | 'history' | 'infra' | 'kb'; text: string }
/** Калибровка по кнопке «Пересчитать»: когда, какие правила получились, итог. */
export interface Recalibration {
  at: string; rules: string; base: string; title: string;
  before: { within: number; eventsHit: number; eventsTotal: number; score: number };
  after: { within: number; eventsHit: number; eventsTotal: number; score: number };
  control?: { scenario: string; title: string; before: number; after: number; eventsBefore: number; eventsAfter: number; eventsTotal: number }[];
  changes: number; report: string;
  /** Сборка данных из базы знаний, на которой шёл пересчёт (в прежних записях нет). */
  kb?: KbStamp | null;
  /** Нашлись ли правила лучше текущих (по мерилу на 5 прогонах); нет — новый набор не сохранён. */
  better?: boolean;
}
/**
 * Правки операции поверх сценария и истории (встроенной или своей): цифры формирований из базы знаний (ручные —
 * прежняя сверка; собранные — kb), положения по дням из документов. Сценарий и история в сборке не меняются — правки накладываются при чтении (getData).
 */
export interface OperationEdits {
  id: string;
  /** Цифры формирований: новое значение, прежнее и на чём основано. */
  formations: Record<string, Partial<Record<'personnel' | 'tanks' | 'guns', { value: number; was: number; source: string; at: string }>>>;
  positions: HistPosition[];
  /** Отклонённые предложения сверки (id). */
  dismissed: string[];
  log: ChangeLog[];
  recalibrations: Recalibration[];
  /** Набор правил по умолчанию для операции (после пересчёта). */
  defaultRules?: string;
  /** Разграничительные линии из документов: добавляются к линиям сценария (та же пара и срок — заменяют). */
  boundaries?: Boundary[];
  /**
   * Сборка из базы знаний (sim/kb-recompile.ts, при каждом изменении базы): поправки (накладываются после ручных —
   * база важнее), на каком факте держится каждый вход, расхождения и факты о формированиях вне операции.
   */
  kb?: OperationKb;
}
export interface OperationKb {
  compiled: CompiledEdits; provenance: Provenance[]; conflicts: CompileConflict[]; unmatched: FactRef[]; at: string;
  /** Основа правил операции (sim/kb-rules.ts): коридоры множителей калибровки и нормативы-итоги операции. */
  rules?: { corridors: Record<string, [number, number]>; outcomes: string[] };
}
const emptyEdits = (id: string): OperationEdits => ({ id, formations: {}, positions: [], dismissed: [], log: [], recalibrations: [] });
export const getEdits = async (id: string): Promise<OperationEdits> => ({ ...emptyEdits(id), ...(await one<OperationEdits>('edits', id)) });
export const saveEdits = (e: OperationEdits) => write('edits', (o) => o.put(e));
/** Изменить правки операции (читать — менять — записать). */
export async function updateEdits(id: string, f: (e: OperationEdits) => void) {
  const e = await getEdits(id);
  f(e);
  await saveEdits(e);
}
export const logChange = (id: string, kind: ChangeLog['kind'], text: string) => updateEdits(id, (e) => { e.log.push({ at: new Date().toISOString(), kind, text }); });
/** Изменения после последнего пересчёта (калибровки). */
export function changesSince(e: OperationEdits): ChangeLog[] {
  const last = e.recalibrations[e.recalibrations.length - 1]?.at ?? '';
  return e.log.filter((l) => l.at > last);
}

function applyScenarioEdits(sc: Scenario, e: OperationEdits | undefined): Scenario {
  if (e?.boundaries?.length) {
    const same = (a: Boundary, b: Boundary) => a.from === b.from && ((a.right === b.right && a.left === b.left) || (a.right === b.left && a.left === b.right));
    sc = { ...sc, boundaries: [...(sc.boundaries ?? []).filter((b) => !e.boundaries!.some((x) => same(x, b))), ...e.boundaries].sort((a, b) => a.from.localeCompare(b.from)) };
  }
  if (!e || !Object.keys(e.formations).length) return sc;
  return { ...sc, formations: sc.formations.map((f) => {
    const p = e.formations[f.id];
    if (!p) return f;
    const n = { ...f };
    for (const [k, v] of Object.entries(p)) if (v) (n as Record<string, unknown>)[k] = v.value;
    return n;
  }) };
}
function applyHistoryEdits(h: History, e: OperationEdits | undefined): History {
  if (!e?.positions.length) return h;
  return { ...h, positions: [...h.positions, ...e.positions.map(({ id: _id, quote: _q, doc: _d, ...p }) => p)] };
}
export const getOperation = (id: string) => one<UserOperation>('operations', id);
export const saveOperation = (op: UserOperation) => write('operations', (o) => o.put(op));
export const deleteOperation = (id: string) => write('operations', (o) => o.delete(id));

/** Изменения видны во всех вкладках раздела: событие в окне (в потоке — нет окна, не нужно). */
function changed() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('def_ops.sim-data')); }
export function onDataChange(f: () => void) { window.addEventListener('def_ops.sim-data', f); return () => window.removeEventListener('def_ops.sim-data', f); }

/* ----------------------------- встроенные данные ----------------------------- */

const files = import.meta.glob('../../../../packages/sim/data/{scenarios,theatres,profiles,rules}/*.json', { import: 'default' });
const builtin = (kind: string, file: string) => files[`../../../../packages/sim/data/${kind}/${file}`];
/** id встроенных правил, профилей и театров. */
export const BUILTIN = {
  theatres: Object.keys(files).filter((k) => k.includes('/theatres/')).map((k) => k.split('/').pop()!.replace('.json', '')),
  // правила нынешней модели: без проверки нормативами и без параметров агентной модели (agents-*.json — их читает ядро)
  rules: Object.keys(files).filter((k) => k.includes('/rules/') && !k.endsWith('norms.json') && !/\/agents-[^/]*\.json$/.test(k)).map((k) => k.split('/').pop()!.replace('.json', '')),
  profiles: Object.keys(files).filter((k) => k.includes('/profiles/')).map((k) => k.split('/').pop()!.replace('.json', '')),
};
export const BUILTIN_CATALOG = (catalogFile as unknown as { scenarios: CatalogEntry[] }).scenarios;

/**
 * Получение данных для движка: встроенные файлы, затем свои правила и операции. compiled — собранное из базы
 * вместо нынешнего (восстановление игры на данных её начала; null — без собранного).
 */
export async function getData(kind: DataKind, file: string, compiled?: CompiledEdits | null): Promise<unknown> {
  if (kind === 'scenarios' && !file.endsWith('.sectors.json')) {
    const d = await rawData(kind, file);
    const hist = file.endsWith('.history.json');
    const e = await one<OperationEdits>('edits', file.replace(hist ? /\.history\.json$/ : /\.json$/, ''));
    const kb = compiled === undefined ? e?.kb?.compiled : compiled ?? undefined;
    // сначала ручные правки, затем собранное из базы (база важнее)
    if (!hist) {
      const sc = applyCompiled(applyScenarioEdits(d as Scenario, e), kb);
      // линии из базы — на театре операции (пункты, стороны); театр читается, только если линии есть
      return kb?.boundaries.length ? applyCompiledBoundaries(sc, kb, await theatreOf(sc.theatre)) : sc;
    }
    // положения из базы — только формирований сценария (дивизии агентной модели — в её истории)
    const ids = kb ? new Set(((await rawData(kind, file.replace(/\.history\.json$/, '.json'))) as Scenario).formations.map((f) => f.id)) : undefined;
    return applyCompiledHistory(applyHistoryEdits(d as History, e), kb, ids);
  }
  if (kind === 'infrastructure') {
    const base = (await rawData(kind, file)) as OperationInfra | null;
    const id = file.replace(/\.json$/, '');
    const e = await one<OperationEdits>('edits', id);
    const kb = compiled === undefined ? e?.kb?.compiled : compiled ?? undefined;
    if (!kb?.crossings.length) return base;
    // переправы из базы — сведениями поверх театра (мост театра — по названию или у пункта)
    const sc = (await rawData('scenarios', `${id}.json`).catch(() => null)) as Scenario | null;
    return { id, records: applyCompiledCrossings(base?.records ?? [], kb, sc ? await theatreOf(sc.theatre) : null) };
  }
  return rawData(kind, file);
}
/** Театр для привязки линий и переправ из базы (нет — null). */
async function theatreOf(id: string): Promise<Theatre | null> {
  try { return new Theatre((await rawData('theatres', `${id}.json`)) as TheatreData); } catch { return null; }
}
/** Данные без правок операции. */
export async function rawData(kind: DataKind, file: string): Promise<unknown> {
  const b = builtin(kind, file);
  if (b) return b();
  const id = file.replace(/\.json$/, '');
  if (kind === 'rules') { const r = await one<UserRules>('rules', id); if (r) return r.rules; }
  if (kind === 'scenarios') {
    const hist = id.endsWith('.history');
    const op = await getOperation(hist ? id.slice(0, -'.history'.length) : id);
    if (op) return hist ? op.pkg.history : op.pkg.scenario;
  }
  if (kind === 'theatres') {
    const op = (await listOperations()).find((o) => o.pkg.theatre.id === id); if (op) return op.pkg.theatre;
    const t = await one<UserTheatre>('theatres', id); if (t) return t.theatre;
  }
  if (kind === 'infrastructure') {
    const r = await one<OperationInfra>('infrastructure', id);
    if (r?.records.length) return r;
    const op = await getOperation(id);
    if (op?.pkg.infrastructure?.length) return { id, records: op.pkg.infrastructure };
    return null;
  }
  if (kind === 'profiles') { for (const o of await listOperations()) { const p = o.pkg.profiles?.find((x) => x.id === id); if (p) return p; } }
  throw new Error(`нет данных ${kind}/${file}`);
}

/**
 * Каталог переигровки: встроенные операции и подготовленные свои; у каждой — свои наборы правил,
 * подобранные для неё (и общие — без операции).
 */
export async function fullCatalog(includeDrafts = false): Promise<(CatalogEntry & { custom?: boolean })[]> {
  const [ops, rules] = await Promise.all([listOperations(), listRules()]);
  const edits = new Map((await all<OperationEdits>('edits')).map((e) => [e.id, e]));
  const mine = (id: string) => rules.filter((r) => !r.scenario || r.scenario === id).map((r) => ({ id: r.id, title: `свои: ${r.title}` }));
  // набор, сделанный основным после пересчёта, — первым (по умолчанию в переигровке)
  const order = (id: string, l: { id: string; title: string }[]) => { const d = edits.get(id)?.defaultRules; const i = d ? l.findIndex((r) => r.id === d) : -1; return i > 0 ? [l[i], ...l.slice(0, i), ...l.slice(i + 1)] : l; };
  const base = BUILTIN_CATALOG.map((c) => ({ ...c, rules: order(c.id, [...c.rules, ...mine(c.id)]) }));
  const custom = ops.filter((o) => o.ready || includeDrafts).map((o) => {
    const c = o.pkg.catalog ?? defaultCatalog(o.pkg);
    return { ...c, id: o.id, custom: true, rules: order(o.id, [...c.rules, ...mine(o.id)]) };
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

/** Операции для группировки базы знаний: встроенные и свои (с черновиками), со сроками. */
export async function kbOperations(): Promise<KbOperation[]> {
  const cat = await fullCatalog(true);
  const out: KbOperation[] = [];
  for (const c of cat) {
    try { const sc = (await getData('scenarios', `${c.id}.json`)) as Scenario; out.push({ id: c.id, title: c.title, start: sc.start, end: sc.end }); } catch { /* нет сценария */ }
  }
  return out;
}

/** Подсказка модели при разборе документа операции: название, сроки, стороны. */
export async function operationHint(id: string): Promise<OperationHint | undefined> {
  try {
    const sc = (await getData('scenarios', `${id}.json`)) as Scenario;
    const title = (await fullCatalog(true)).find((c) => c.id === id)?.title ?? sc.name;
    return { id, title, start: sc.start, end: sc.end, sides: sc.sides.map((x) => ({ id: x.id, name: x.name })) };
  } catch { return undefined; }
}
