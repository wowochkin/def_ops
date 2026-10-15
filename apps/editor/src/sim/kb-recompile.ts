/**
 * Сборка поправок операций из базы знаний: при каждом изменении базы (событие def_ops.kb-changed, с задержкой 1 с)
 * и при запуске — все операции (встроенные и свои): записи базы и закрепления → compileOperation → правки
 * операции (edits.kb); изменилось — запись в журнал операции. Агентной модели (ядру) — поправки дивизий.
 *
 * Агентный сценарий операции: ключ AGENT_SCENARIOS совпадает с id операции каталога (berlin-1945-tasks,
 * vistula-oder-1945) — его дивизии и штабы входят в сборку (divisions).
 *
 * Там же — основа правил операции (sim/kb-rules.ts): коридоры множителей калибровки по нормативам базы и нормативы-итоги
 * операции для набора правил операции; изменились — запись в журнал операции («данные изменились» в панели пересчёта).
 * Наборы правил не меняются.
 */
import { compileOperation, type CompileInput, type CompiledEdits } from '@def-ops/knowledge';
import type { Scenario, TakeoverState } from '@def-ops/sim';
import * as kbStore from '../kb/store';
import { AGENT_SCENARIOS } from './agent-scenarios';
import { diffDigest, rulesBasis, rulesDigest, type RulesDigest } from './kb-rules';
import { applyCompiled, diffCompiled, migratePins, norm, toCoreEdits, type CoreEdits, type GameKb } from './kb-compile';
import { fullCatalog, getEdits, rawData, updateEdits } from './userdata';
import { kbStamp, type KbStamp } from './kb-stamp';
import { parentsAt, takeoverState, toCoreTakeover, type CoreTakeover, type TakeoverSummary, type TakeoverUnit } from './takeover-state';

export interface AgentScenarioFile {
  hqs: { id: string; name: string; side: string; echelon: string; parent?: string | null }[];
  divisions: { id: string; name: string; side: string; hq: string; personnel?: number; tanks?: number; guns?: number; enterAt?: string | null }[];
}
const agentFiles = import.meta.glob('../../../../packages/sim/data/scenarios/agents/*.json', { import: 'default' });

/** Агентный сценарий операции (дивизии и штабы); нет — undefined. */
export async function agentScenario(opId: string): Promise<AgentScenarioFile | undefined> {
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
  // основа правил операции: набор правил по умолчанию (после пересчёта) или сценария; не собралась — прежняя
  let rules: RulesDigest | undefined = edits.kb?.rules;
  try { rules = rulesDigest(await rulesBasis(edits.defaultRules ?? sc.rules, { entries, pins }), opId); } catch (e) { console.warn(`основа правил: ${opId}:`, e); }
  const next = { compiled: r.edits, provenance: r.provenance, conflicts: r.conflicts, unmatched: r.unmatched, ...(rules ? { rules } : {}) };
  if (edits.kb && !migrated && norm(next) === norm({ ...edits.kb, at: undefined })) return { changed: [] };
  const rulesChanged = rules ? diffDigest(edits.kb?.rules, rules) : [];
  const changed = [...diffCompiled(edits.kb?.compiled, r.edits), ...rulesChanged];
  const at = new Date().toISOString();
  await updateEdits(opId, (e) => {
    if (migrated) {
      const n = Object.keys(migrated.pins).length;
      e.formations = migrated.formations;
      if (n) e.log.push({ at, kind: 'kb', text: `прежняя сверка — в закрепления: ${n}${migrated.kept.length ? `; ручные правки остались: ${migrated.kept.join(', ')}` : ''}` });
    }
    e.kb = { ...next, at };
    const inputs = changed.slice(0, changed.length - rulesChanged.length);
    if (inputs.length) {
      const text = edits.kb ? `изменено из базы: ${inputs.slice(0, 8).join('; ')}${inputs.length > 8 ? `; и ещё ${inputs.length - 8}` : ''}` : `собрано из базы: ${inputs.length} изменений входов модели`;
      e.log.push({ at, kind: 'kb', text });
    }
    if (rulesChanged.length) e.log.push({ at, kind: 'kb', text: `основа правил из базы: ${rulesChanged.slice(0, 8).join('; ')}${rulesChanged.length > 8 ? `; и ещё ${rulesChanged.length - 8}` : ''}` });
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
/** Сборка запланирована или идёт; ждущие её окончания (kbSettled). */
let pending = false;
let waiters: (() => void)[] = [];
const settle = () => { pending = false; const w = waiters; waiters = []; for (const f of w) f(); };
/**
 * Сборка из базы закончена (не запланирована и не идёт): расчёт, начатый раньше, прочёл бы данные операции без
 * поправок базы (при первом запуске) или с прежними — и тот же seed дал бы другой итог.
 */
export const kbSettled = (): Promise<void> => (pending ? new Promise((res) => waiters.push(res)) : Promise.resolve());
/** Сборка запланирована или идёт: расчёт подождёт её (подпись «сборка данных из базы знаний…»). */
export const kbBuilding = (): boolean => pending;
/** Подпись ожидания сборки — у кнопки или хода расчёта. */
export const KB_WAIT = 'сборка данных из базы знаний…';
/**
 * Перед расчётом по данным операции: дождаться сборки из базы и взять её отметку (на каких поправках посчитан итог).
 * Отмена — у вызывающего (проверить свой номер расчёта после await).
 */
export async function kbReady(opId: string): Promise<KbStamp | null> {
  await kbSettled();
  return kbStamp(opId);
}

/** Подписка (один раз, из окна редактора): изменения базы — пересборка всех операций через 1 с; и при запуске. */
export function watchKb() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, again = false;
  const run = async () => {
    timer = undefined;
    if (running) { again = true; return; }
    running = true;
    try {
      // база версии 6 — сначала перенос прежних очередей (один раз): принятые положения и линии — фактами базы
      try { await (await import('../kb/migrate')).migrateV7(); } catch (e) { console.warn('перенос базы знаний (версия 7):', e); }
      // расчёты в фоновых потоках держат данные операции — сбросить
      if (await recompileAll()) (await import('../modeling/data')).resetPool();
    } finally {
      running = false;
      // новое изменение базы во время сборки — ещё одна сборка; до неё расчёт ждёт
      if (again) { again = false; schedule(); } else if (timer === undefined) settle();
    }
  };
  const schedule = () => { pending = true; clearTimeout(timer); timer = setTimeout(() => void run(), 1000); };
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
 * Подчинённость агентного сценария на момент: дивизия → штаб (исходный с поправкой ядра и переподчинения по датам),
 * штаб → вышестоящий (с переподчинениями штабов).
 */
function agentParentsAt(a: AgentScenarioFile, core: CoreEdits | null | undefined, moment: string) {
  const changes = core?.changes ?? [];
  const divisions = parentsAt(new Map(a.divisions.map((d) => [d.id, core?.divisions[d.id]?.hq ?? d.hq])), changes, moment) as Map<string, string>;
  const hqs = parentsAt(new Map(a.hqs.map((h) => [h.id, h.parent ?? null])), changes, moment);
  return { divisions, hqs };
}

/**
 * Состояние соединений при передаче командования по нынешней базе (записи; закрепления не действуют) на момент moment:
 * нынешняя модель — действующие формирования сценария (с типом), агентная — дивизии агентного сценария. Нынешняя
 * подчинённость — по сценарию с данными базы игры (kb; нет — нынешние) и переподчинениям не позже момента: факт,
 * совпадающий с ней или указывающий старшего над нынешним штабом, — не поправка.
 */
export async function takeoverNow(opId: string, moment: string, agents: boolean, kb?: GameKb): Promise<{ state: TakeoverState; summary: TakeoverSummary }> {
  // при передаче факт выбирается по правилу: закрепления «Основы модели» действуют на собранные входы операции
  const entries = await kbStore.entries();
  const data = kb ?? await gameKbNow(opId, agents);
  let ids: TakeoverUnit[];
  let hqs: Map<string, string | null>;
  const a = agents ? await agentScenario(opId) : undefined;
  if (a) {
    const p = agentParentsAt(a, data.core, moment);
    hqs = p.hqs;
    ids = a.divisions.map((d) => ({ id: d.id, echelon: 'division', parent: p.divisions.get(d.id) }));
  } else {
    const sc = applyCompiled((await rawData('scenarios', `${opId}.json`)) as Scenario, data.compiled ?? undefined);
    hqs = parentsAt(new Map(sc.formations.map((f) => [f.id, f.parent ?? null])), (sc.changes ?? []) as CompiledEdits['changes'], moment);
    ids = sc.formations.filter((f) => f.type).map((f) => ({ id: f.id, echelon: f.echelon, parent: hqs.get(f.id) }));
  }
  return takeoverState(entries, {}, ids, moment, hqs);
}

/**
 * Состояние при передаче — для ядра агентной модели (дивизии, штабы агентного сценария; подчинённость на момент —
 * с поправками ядра core); нечего передать — undefined.
 */
export async function coreTakeoverFor(opId: string, s: TakeoverState, core: CoreEdits | null | undefined, moment: string): Promise<CoreTakeover | undefined> {
  const a = await agentScenario(opId);
  if (!a) return undefined;
  const p = agentParentsAt(a, core, moment);
  const r = toCoreTakeover(s, p.divisions, p.hqs);
  return Object.keys(r.divisions).length ? r : undefined;
}
