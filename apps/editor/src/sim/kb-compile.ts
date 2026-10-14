/**
 * Поправки операции из базы знаний — чистые функции (без хранилища): перечень изменений между двумя сборками,
 * наложение собранного на сценарий и историю (getData), поправки для ядра агентной модели (дивизии), перенос
 * прежних ручных «принять» и «отклонить» сверки в закрепления. Сама сборка с чтением базы — kb-recompile.ts.
 */
import { fingerprint, pinKey, type CompiledEdits, type Entry, type Pins } from '@def-ops/knowledge';
import type { History, Scenario, ScenarioChange, StrengthCheckpoint, TakeoverState } from '@def-ops/sim';

const day = (s: string) => s.slice(0, 10);
const ddmm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const moment = (s: string) => (s.length > 10 ? `${ddmm(s)} ${s.slice(11, 16)}` : ddmm(s));

/** Нормализованная запись значения (для сравнения): порядок ключей объекта и пустые поля не влияют. */
export const norm = (v: unknown): string => Array.isArray(v) ? `[${v.map(norm).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${norm((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v) ?? 'null';
const uniq = <T>(xs: T[]): T[] => { const seen = new Set<string>(); return xs.filter((x) => { const k = norm(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/* ───────────── перечень изменений ───────────── */

const FIELD: Record<keyof CompiledEdits['formations'][string], string> = { personnel: 'людей', tanks: 'танков', guns: 'орудий', parent: 'подчинение', enterAt: 'ввод' };
const plus = (c: { personnel?: number; tanks?: number; guns?: number }) =>
  [c.personnel != null ? `+${c.personnel}` : '', c.tanks != null ? `танков +${c.tanks}` : '', c.guns != null ? `орудий +${c.guns}` : ''].filter(Boolean).join(', ');
const nums = (c: { personnel?: number; tanks?: number; guns?: number }) =>
  [c.personnel != null ? `${c.personnel}` : '', c.tanks != null ? `танков ${c.tanks}` : '', c.guns != null ? `орудий ${c.guns}` : ''].filter(Boolean).join(', ');

const changeText = (c: CompiledEdits['changes'][number]) => c.kind === 'reinforce'
  ? `пополнение ${c.formation} ${ddmm(c.at)} ${plus(c)}` : `переподчинение ${c.formation} ${ddmm(c.at)} → ${c.parent}`;
const checkpointText = (c: CompiledEdits['checkpoints'][number]) => c.kind === 'strength'
  ? `численность ${c.formation} ${ddmm(c.at)}: ${nums(c)}` : `потери ${c.formation} ${ddmm(c.from)}–${ddmm(c.at)}: ${nums(c)}`;

/** Добавленное и снятое (как мультимножества строк). */
function listDiff(a: string[], b: string[]): string[] {
  const left = [...a];
  const added: string[] = [];
  for (const x of b) { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else added.push(x); }
  return [...added, ...left.map((x) => `снято: ${x}`)];
}

/**
 * Человекочитаемый перечень изменённых входов модели между прежней сборкой (a; нет — первая) и новой (b):
 * начальные значения формирований, изменения по датам, контрольные точки; положения, линии, переправы, события — числом.
 */
export function diffCompiled(a: CompiledEdits | undefined, b: CompiledEdits): string[] {
  const out: string[] = [];
  const af = a?.formations ?? {};
  for (const id of [...new Set([...Object.keys(af), ...Object.keys(b.formations)])].sort()) {
    for (const k of Object.keys(FIELD) as (keyof typeof FIELD)[]) {
      const u = af[id]?.[k], v = b.formations[id]?.[k];
      if (u === v) continue;
      const show = (x: number | string | undefined) => (x == null ? '—' : k === 'enterAt' ? moment(String(x)) : String(x));
      out.push(`${id}: ${FIELD[k]} ${show(u)} → ${show(v)}`);
    }
  }
  out.push(...listDiff((a?.changes ?? []).map(changeText), b.changes.map(changeText)));
  out.push(...listDiff((a?.checkpoints ?? []).map(checkpointText), b.checkpoints.map(checkpointText)));
  const coll: [keyof CompiledEdits, string][] = [['positions', 'положения'], ['boundaries', 'линии'], ['crossings', 'переправы'], ['events', 'события']];
  for (const [k, title] of coll) {
    const d = listDiff(((a?.[k] ?? []) as unknown[]).map(norm), (b[k] as unknown[]).map(norm));
    const add = d.filter((x) => !x.startsWith('снято: ')).length, del = d.length - add;
    if (add || del) out.push(`${title}: ${[add ? `+${add}` : '', del ? `−${del}` : ''].filter(Boolean).join(' ')}`);
  }
  return out;
}

/* ───────────── наложение на сценарий и историю ───────────── */

/**
 * Собранное из базы — поверх сценария (после ручных правок; база важнее): численность (формированиям с типом),
 * подчинение и ввод формирований сценария; изменения по датам — о формированиях сценария (к своим изменениям сценария, без повторов).
 * Формирования, которых в сценарии нет (дивизии агентной модели), пропускаются.
 */
export function applyCompiled(sc: Scenario, c: CompiledEdits | undefined): Scenario {
  if (!c) return sc;
  const ids = new Set(sc.formations.map((f) => f.id));
  const formations = sc.formations.map((f) => {
    const p = c.formations[f.id];
    if (!p) return f;
    const n = { ...f };
    // численность — только действующим формированиям (с типом), не штабам и фронтам
    if (f.type) for (const k of ['personnel', 'tanks', 'guns'] as const) if (typeof p[k] === 'number') n[k] = p[k];
    if (p.parent && ids.has(p.parent)) n.parent = p.parent;
    if (p.enterAt) n.enterAt = p.enterAt;
    return n;
  });
  const own = c.changes.filter((x) => ids.has(x.formation) && (x.kind !== 'resubordinate' || ids.has(x.parent))) as ScenarioChange[];
  return { ...sc, formations, ...(own.length ? { changes: uniq([...(sc.changes ?? []), ...own]) } : {}) };
}

/**
 * Собранное из базы — поверх истории: контрольные точки численности и потерь; положения с координатами (кроме
 * дня, на который у формирования положение уже есть; при formations — только формирований сценария); даты событий истории с тем же id (событие базы без
 * условия проверки — места, окружения — в историю не добавляется).
 */
export function applyCompiledHistory(h: History, c: CompiledEdits | undefined, formations?: Set<string>): History {
  if (!c) return h;
  const have = new Set(h.positions.map((p) => `${p.formation}|${day(p.time)}`));
  const add: History['positions'] = [];
  for (const p of c.positions) {
    const k = `${p.formation}|${day(p.time)}`;
    if (!p.at || have.has(k) || (formations && !formations.has(p.formation))) continue;
    have.add(k);
    add.push({ formation: p.formation, time: p.time, at: p.at, approxKm: p.approxKm, place: p.place ?? '', reliability: p.reliability, source: p.source });
  }
  const kbEvents = new Map((c.events as { id?: string; at?: string }[]).filter((e) => e.id && e.at).map((e) => [e.id!, e.at!]));
  const events = h.events?.map((e) => (kbEvents.has(e.id) ? { ...e, date: day(kbEvents.get(e.id)!) } : e));
  const checkpoints = uniq([...(h.checkpoints ?? []), ...(c.checkpoints as StrengthCheckpoint[])]);
  return { ...h, positions: [...h.positions, ...add], ...(events ? { events } : {}), ...(checkpoints.length ? { checkpoints } : {}) };
}

/* ───────────── поправки для ядра агентной модели ───────────── */

/** Поправки сценария ядра (scenario::EditsIn): исходные значения дивизий, изменения по датам. */
export type CoreEdits = {
  divisions: Record<string, { personnel?: number; tanks?: number; guns?: number; hq?: string; enterAt?: string }>;
  changes: CompiledEdits['changes'];
};

/**
 * Собранное — в поправки ядра: формирования-дивизии (parent → hq); изменения о дивизиях, а у штабов —
 * переподчинение (пополнение штаба в ядре смысла не имеет). Прочее (армии нынешней модели) не передаётся.
 * divisions — дивизия → её штаб в агентном сценарии, hqs — штаб → вышестоящий: подчинение из базы старшему
 * над нынешним штабом (фронту вместо армии) менее точно — не поправка.
 */
export function toCoreEdits(c: CompiledEdits, divisions: Map<string, string>, hqs: Map<string, string | null> = new Map()): CoreEdits {
  const out: CoreEdits['divisions'] = {};
  /** Штаб a — выше штаба b (по цепочке вышестоящих). */
  const above = (a: string, b: string) => { for (let x = hqs.get(b), n = 0; x && n < 20; x = hqs.get(x), n++) if (x === a) return true; return false; };
  for (const [id, p] of Object.entries(c.formations)) {
    const hq = divisions.get(id);
    if (hq === undefined) continue;
    const d: CoreEdits['divisions'][string] = {};
    for (const k of ['personnel', 'tanks', 'guns'] as const) if (typeof p[k] === 'number') d[k] = p[k];
    if (p.parent && !above(p.parent, hq)) d.hq = p.parent;
    if (p.enterAt) d.enterAt = p.enterAt;
    if (Object.keys(d).length) out[id] = d;
  }
  const changes = c.changes.filter((x) => divisions.has(x.formation) || (hqs.has(x.formation) && x.kind === 'resubordinate'));
  return { divisions: out, changes };
}

/* ───────────── данные игры ───────────── */

/**
 * Данные из базы, на которых идёт игра: собранное для нынешней модели и поправки ядра; takeoverState — состояние
 * соединений при передаче командования по фактам (takeover-state.ts). Пишутся в запись игры при начале — восстановление идёт на тех же данных.
 */
export interface GameKb { compiled: CompiledEdits | null; core: CoreEdits | null; takeoverState?: TakeoverState }
/** Записанные в игре данные важнее нынешних; в записи нет (новая игра, старая запись) — нынешние. */
export const gameKbData = (record: { kb?: GameKb } | undefined, current: GameKb): GameKb => record?.kb ?? current;

/* ───────────── перенос прежней сверки в закрепления ───────────── */

type ManualFormations = Record<string, Partial<Record<'personnel' | 'tanks' | 'guns', { value: number; was: number; source: string; at: string }>>>;

/**
 * Первая сборка операции: прежние ручные «принять в сценарий» (сверка, modeling/sync.ts) и «отклонить» — в закрепления.
 * Принятая цифра — закрепление факта начальной численности (strength у формирования, в значении которого — текст,
 * записанный в source правки); правка снимается. Факт не узнан, у факта нет этого числа или ключ уже закреплён
 * другим фактом — правка остаётся (kept). Отклонённое предложение «в сценарий» по численности, танкам, орудиям —
 * закрепление «ничего» (численность формирования — из сценария), если ключ ещё не закреплён.
 */
export function migratePins(entries: Entry[], start: string, formations: ManualFormations, dismissed: string[], pins: Pins): { pins: Pins; formations: ManualFormations; kept: string[] } {
  const out: Pins = {};
  const rest: ManualFormations = {};
  const kept: string[] = [];
  for (const [fid, p] of Object.entries(formations)) {
    for (const [k, v] of Object.entries(p) as ['personnel' | 'tanks' | 'guns', { value: number; was: number; source: string; at: string }][]) {
      if (!v) continue;
      const i = v.source.indexOf('; ');
      const tail = i >= 0 ? v.source.slice(i + 2).trim() : '';
      let hit: { entry: string; index: number; fp: string } | null = null;
      if (tail) for (const e of entries) {
        (e.facts ?? []).forEach((f, index) => {
          const c = f.claim;
          if (!hit && c?.kind === 'strength' && c.subject === fid && typeof c[k] === 'number' && f.value.startsWith(tail)) hit = { entry: e.id, index, fp: fingerprint(f) };
        });
        if (hit) break;
      }
      const key = pinKey('strength', fid, start);
      const was = out[key] ?? pins[key];
      const h = hit as { entry: string; index: number; fp: string } | null;
      const same = !!h && !!was && was !== 'none' && was.entry === h.entry && was.index === h.index;
      if (h && (!was || same)) { out[key] = h; continue; }
      (rest[fid] ??= {})[k] = v;
      kept.push(`${fid}.${k}`);
    }
  }
  for (const id of dismissed) {
    const m = /^toScenario\|(.+)\|(personnel|tanks|guns)$/.exec(id);
    if (!m) continue;
    const key = pinKey('strength', m[1], start);
    if (!out[key] && !pins[key]) out[key] = 'none';
  }
  return { pins: out, formations: rest, kept };
}
