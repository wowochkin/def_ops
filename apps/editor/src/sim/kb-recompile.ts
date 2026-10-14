/**
 * Сборка поправок операций из базы знаний: при каждом изменении базы (событие def_ops.kb-changed, с задержкой 1 с)
 * и при запуске — все операции (встроенные и свои): записи базы и закрепления → compileOperation → правки
 * операции (edits.kb); изменилось — запись в журнал операции. Агентной модели (ядру) — поправки дивизий.
 *
 * Агентный сценарий операции: ключ AGENT_SCENARIOS совпадает с id операции каталога (berlin-1945-tasks,
 * vistula-oder-1945) — его дивизии и штабы входят в сборку (divisions).
 */
import { compileOperation, type CompileInput } from '@def-ops/knowledge';
import type { Scenario } from '@def-ops/sim';
import * as kbStore from '../kb/store';
import { AGENT_SCENARIOS } from './agent-scenarios';
import { diffCompiled, migratePins, toCoreEdits, type CoreEdits } from './kb-compile';
import { fullCatalog, getEdits, rawData, updateEdits } from './userdata';

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

/** Нормализованная запись для сравнения сборок (порядок ключей не влияет). */
const norm = (v: unknown): string => Array.isArray(v) ? `[${v.map(norm).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${norm((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v) ?? 'null';

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
 * Поправки ядра агентной модели для операции (id операции = ключ AGENT_SCENARIOS): дивизионные поправки из сборки.
 * Нет сборки или нечего передать — undefined (ядро считает сценарий как есть).
 */
export async function coreEditsFor(opId: string): Promise<CoreEdits | undefined> {
  const [e, a] = await Promise.all([getEdits(opId), agentScenario(opId)]);
  if (!e.kb || !a) return undefined;
  const r = toCoreEdits(e.kb.compiled, new Set(a.divisions.map((d) => d.id)), new Set(a.hqs.map((h) => h.id)));
  return Object.keys(r.divisions).length || r.changes.length ? r : undefined;
}
