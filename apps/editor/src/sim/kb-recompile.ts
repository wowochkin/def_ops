/**
 * Сборка поправок операций из базы знаний: при каждом изменении базы (событие def_ops.kb-changed, с задержкой 1 с)
 * и при запуске — все операции (встроенные и свои): записи базы и закрепления → compileOperation → правки
 * операции (edits.kb); изменилось — запись в журнал операции. Агентной модели (ядру) — поправки дивизий.
 *
 * Агентный сценарий операции: ключ AGENT_SCENARIOS совпадает с id операции каталога (berlin-1945-tasks,
 * vistula-oder-1945) — его дивизии и штабы входят в сборку (divisions).
 */
import { compileOperation, type CompileInput, type CompiledEdits } from '@def-ops/knowledge';
import type { Scenario, TakeoverState } from '@def-ops/sim';
import * as kbStore from '../kb/store';
import { AGENT_SCENARIOS } from './agent-scenarios';
import { diffCompiled, migratePins, norm, toCoreEdits, type CoreEdits, type GameKb } from './kb-compile';
import { fullCatalog, getEdits, rawData, updateEdits } from './userdata';
import { takeoverState, toCoreTakeover, type CoreTakeover, type TakeoverSummary } from './takeover-state';

interface AgentScenarioFile {
  hqs: { id: string; name: string; side: string; echelon: string; parent?: string | null }[];
  divisions: { id: string; name: string; side: string; hq: string; personnel?: number; tanks?: number; guns?: number; enterAt?: string | null }[];
}
const agentFiles = import.meta.glob('../../../../packages/sim/data/scenarios/agents/*.json', { import: 'default' });

/** Агентный сценарий операции (дивизии и штабы); нет — undefined. */
async function agentScenario(opId: string): Promise<AgentScenarioFile | undefined> {
  const a = AGENT_SCENARIOS[opId];
  const load = a && agentFiles[`../../../../${a.path}`];
  return load ? (await load()) as AgentScenarioFile : undefined;
}

/** Дивизии и штабы агентного сценария — формирования для сборки (parent дивизии — её штаб). */
const divisionsIn = (a: AgentScenarioFile): NonNullable<CompileInput['divisions']> => [
  ...a.hqs.map((h) => ({ id: h.id, name: h.name, side: h.side, echelon: h.echelon, parent: h.parent ?? null })),
  ...a.divisions.map((d) => ({ id: d.id, name: d.name, side: d.side, echelon: 'division', parent: d.hq, personnel: d.personnel, tanks: d.tanks, guns: d.guns, enterAt: d.enterAt ?? null })),
];

/**
 * Пересобрать поправки операции из базы: записи и закрепления, сценарий (без правок) и агентный сценарий. При первой
 * сборке — перенос прежней сверки в закрепления (migratePins). changed — перечень изменённых входов.
 */
export async function recompile(opId: string): Promise<{ changed: string[] }> {
  const sc = (await rawData('scenarios', `${opId}.json`)) as Scenario;
  const [entries, edits, agents] = await Promise.all([kbStore.entries(), getEdits(opId), agentScenario(opId)]);
  let pins = await kbStore.pins();
  let migrated: ReturnType<typeof migratePins> | null = null;
  if (!edits.kb) {
    migrated = migratePins(entries, sc.start, edits.formations, edits.dismissed, pins);
    // закрепления пишутся без события «база изменилась»: сборка — следом, здесь же
    if (Object.keys(migrated.pins).length) await kbStore.putPins(migrated.pins);
    pins = { ...pins, ...migrated.pins };
  }
  const r = compileOperation(entries, { id: opId, start: sc.start, end: sc.end, formations: sc.formations, ...(agents ? { divisions: divisionsIn(agents) } : {}) }, pins);
  const next = { compiled: r.edits, provenance: r.provenance, conflicts: r.conflicts, unmatched: r.unmatched };
  if (edits.kb && !migrated && norm(next) === norm({ ...edits.kb, at: undefined })) return { changed: [] };
  const changed = diffCompiled(edits.kb?.compiled, r.edits);
  const at = new Date().toISOString();
  await updateEdits(opId, (e) => {
    if (migrated) {
      const n = Object.keys(migrated.pins).length;
      e.formations = migrated.formations;
      if (n) e.log.push({ at, kind: 'kb', text: `прежняя сверка — в закрепления: ${n}${migrated.kept.length ? `; ручные правки остались: ${migrated.kept.join(', ')}` : ''}` });
    }
    e.kb = { ...next, at };
    if (changed.length) {
      const text = edits.kb ? `изменено из базы: ${changed.slice(0, 8).join('; ')}${changed.length > 8 ? `; и ещё ${changed.length - 8}` : ''}` : `собрано из базы: ${changed.length} изменений входов модели`;
      e.log.push({ at, kind: 'kb', text });
    }
  });
  return { changed };
}

/** Пересобрать все операции (встроенные и свои, с черновиками); число операций, где сборка изменилась. */
export async function recompileAll(): Promise<number> {
  let n = 0;
  for (const c of await fullCatalog(true)) {
    try { if ((await recompile(c.id)).changed.length) n++; } catch (e) { console.warn(`сборка из базы: ${c.id}:`, e); }
  }
  return n;
}

let watching = false;
/** Подписка (один раз, из окна редактора): изменения базы — пересборка всех операций через 1 с; и при запуске. */
export function watchKb() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      // расчёты в фоновых потоках держат данные операции — сбросить
      if (await recompileAll()) (await import('../modeling/data')).resetPool();
    } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void run(), 1000); };
  window.addEventListener('def_ops.kb-changed', schedule);
  // база могла измениться и без события: новая сборка приложения (сид), правки в другом окне
  schedule();
}

/**
 * Поправки ядра агентной модели для операции (id операции = ключ AGENT_SCENARIOS): дивизионные поправки из сборки
 * (нынешней или переданной). Нет сборки или нечего передать — undefined (ядро считает сценарий как есть).
 */
export async function coreEditsFor(opId: string, compiled?: CompiledEdits | null): Promise<CoreEdits | undefined> {
  const [e, a] = await Promise.all([compiled === undefined ? getEdits(opId) : null, agentScenario(opId)]);
  const c = compiled === undefined ? e?.kb?.compiled : compiled;
  if (!c || !a) return undefined;
  const r = toCoreEdits(c, new Map(a.divisions.map((d) => [d.id, d.hq])), new Map(a.hqs.map((h) => [h.id, h.parent ?? null])));
  return Object.keys(r.divisions).length || r.changes.length ? r : undefined;
}

/** Данные из базы для новой игры: нынешнее собранное и поправки ядра (для агентной модели). */
export async function gameKbNow(opId: string, agents: boolean): Promise<GameKb> {
  const compiled = (await getEdits(opId)).kb?.compiled ?? null;
  return { compiled, core: agents ? (await coreEditsFor(opId, compiled)) ?? null : null };
}

/**
 * Состояние соединений при передаче командования по нынешней базе (записи и закрепления) на момент moment:
 * нынешняя модель — действующие формирования сценария (с типом), агентная — дивизии агентного сценария.
 */
export async function takeoverNow(opId: string, moment: string, agents: boolean): Promise<{ state: TakeoverState; summary: TakeoverSummary }> {
  const [entries, pins] = await Promise.all([kbStore.entries(), kbStore.pins()]);
  let ids: { id: string; echelon: string }[];
  if (agents) ids = ((await agentScenario(opId))?.divisions ?? []).map((d) => ({ id: d.id, echelon: 'division' }));
  else ids = ((await rawData('scenarios', `${opId}.json`)) as Scenario).formations.filter((f) => f.type).map((f) => ({ id: f.id, echelon: f.echelon }));
  return takeoverState(entries, pins, ids, moment);
}

/** Состояние при передаче — для ядра агентной модели (дивизии, штабы агентного сценария); нечего передать — undefined. */
export async function coreTakeoverFor(opId: string, s: TakeoverState): Promise<CoreTakeover | undefined> {
  const a = await agentScenario(opId);
  if (!a) return undefined;
  const r = toCoreTakeover(s, new Set(a.divisions.map((d) => d.id)), new Set(a.hqs.map((h) => h.id)));
  return Object.keys(r.divisions).length ? r : undefined;
}
