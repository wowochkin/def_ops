/**
 * Состояние соединений при передаче командования по фактам базы знаний — чистые функции (без хранилища).
 * Численность — факт не старше суток до момента передачи; положение — не старше суток, с координатами и
 * неопределённостью не больше допуска ступени (армия 15 км, корпус 8, дивизия 5); подчинённость — последняя
 * действующая на момент. Из нескольких — resolve: закрепление → надёжность → близость даты → свежий документ.
 * Положение только с названием места (без координат) не берётся: справочника мест здесь нет.
 */
import { claimFacts, ECHELON_KM, resolve, type Claim, type Entry, type FactRef, type Pins } from '@def-ops/knowledge';
import type { TakeoverState } from '@def-ops/sim';

export interface TakeoverSummary {
  /** Соединений, у которых по фактам взяты численность, положение, подчинённость. */
  strength: number; position: number; parent: number;
  /** Соединений, поправленных хоть в чём-то, и оставшихся целиком на допущениях модели. */
  corrected: number; assumed: number;
}

const DAY = 86400000;
/** Дата без времени — начало дня (как момент без часового пояса, чтобы сравнивать одинаково). */
const iso = (s: string) => (s.length === 10 ? `${s}T00:00` : s);
const ms = (s: string) => Date.parse(iso(s));

/** Копия факта с датой, приведённой к моменту (для resolve). */
function normalized(f: FactRef): FactRef {
  const c = f.fact.claim!;
  const claim = ('at' in c ? { ...c, at: iso(c.at) } : 'from' in c ? { ...c, from: iso(c.from) } : c) as Claim;
  return { ...f, fact: { ...f.fact, claim } };
}

export function takeoverState(entries: Entry[], pins: Pins, ids: { id: string; echelon: string }[], moment: string): { state: TakeoverState; summary: TakeoverSummary } {
  const t = ms(moment);
  const all = claimFacts(entries).map(normalized);
  const by = new Map<string, FactRef[]>();
  for (const f of all) { const c = f.fact.claim!; if ('subject' in c) { const k = `${c.kind}|${c.subject}`; (by.get(k) ?? by.set(k, []).get(k)!).push(f); } }
  /** Свежие: не позже момента и не старше суток. */
  const fresh = (f: FactRef) => { const d = ms((f.fact.claim as { at: string }).at); return d <= t && t - d <= DAY; };
  const state: TakeoverState = {};
  const summary: TakeoverSummary = { strength: 0, position: 0, parent: 0, corrected: 0, assumed: 0 };
  for (const { id, echelon } of ids) {
    const s: TakeoverState[string] = {};
    const pick = (kind: Claim['kind'], ok: (f: FactRef) => boolean) => resolve((by.get(`${kind}|${id}`) ?? []).filter(ok), kind, id, moment, pins).chosen?.fact.claim;
    const st = pick('strength', fresh) as Extract<Claim, { kind: 'strength' }> | undefined;
    if (st) for (const k of ['personnel', 'tanks', 'guns'] as const) if (typeof st[k] === 'number') s[k] = st[k];
    const tol = ECHELON_KM[echelon] ?? ECHELON_KM.division;
    const pos = pick('position', (f) => {
      const c = f.fact.claim as Extract<Claim, { kind: 'position' }>;
      return fresh(f) && !!c.lngLat && (c.uncertaintyKm ?? 0) <= tol;
    }) as Extract<Claim, { kind: 'position' }> | undefined;
    if (pos?.lngLat) s.position = [pos.lngLat[0], pos.lngLat[1]];
    const par = pick('parent', (f) => ms((f.fact.claim as { from: string }).from) <= t) as Extract<Claim, { kind: 'parent' }> | undefined;
    if (par && par.parent !== id) s.parent = par.parent;
    if (s.personnel != null || s.tanks != null || s.guns != null) summary.strength++;
    if (s.position) summary.position++;
    if (s.parent) summary.parent++;
    if (Object.keys(s).length) { state[id] = s; summary.corrected++; } else summary.assumed++;
  }
  return { state, summary };
}

/** Состояние при передаче для ядра агентной модели (game::TakeoverIn): только дивизии, parent → hq (известный штаб). */
export type CoreTakeover = { divisions: Record<string, { personnel?: number; tanks?: number; guns?: number; pos?: [number, number]; hq?: string }> };
export function toCoreTakeover(s: TakeoverState, divisions: Set<string>, hqs: Set<string>): CoreTakeover {
  const out: CoreTakeover['divisions'] = {};
  for (const [id, v] of Object.entries(s)) {
    if (!divisions.has(id)) continue;
    const d: CoreTakeover['divisions'][string] = {};
    for (const k of ['personnel', 'tanks', 'guns'] as const) if (typeof v[k] === 'number') d[k] = v[k];
    if (v.position) d.pos = v.position;
    if (v.parent && hqs.has(v.parent)) d.hq = v.parent;
    if (Object.keys(d).length) out[id] = d;
  }
  return { divisions: out };
}

/** Сводка для окна «Принять командование». */
export const takeoverText = (s: TakeoverSummary) =>
  `по фактам поправлено ${s.corrected} соединений (численность ${s.strength}, положение ${s.position}, подчинённость ${s.parent}); на допущениях — ${s.assumed}`;
