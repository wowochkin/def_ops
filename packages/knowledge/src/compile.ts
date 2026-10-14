/**
 * Сборщик «база → модель»: из формальных частей фактов базы — поправки к операции (начальные численность,
 * подчинённость, ввод; изменения по датам; контрольные точки численности и накопленных потерь; положения,
 * линии, переправы, события), у каждого входа — на каком факте он держится, и список расхождений.
 * Чистая функция: выбор из нескольких — resolve, закрепления — pins.
 */
import type { Claim, Entry } from './schema';
import { claimFacts, pinKey, resolve, type FactRef, type Pins } from './resolve';

type FormationIn = {
  id: string; name: string; side: string; echelon: string; parent?: string | null;
  personnel?: number; tanks?: number; guns?: number; enterAt?: string | null;
};
/** Операция: сценарий (армии, корпуса) и, если есть, агентный (дивизии; parent — штаб). */
export interface CompileInput { id: string; start: string; end: string; formations: FormationIn[]; divisions?: CompileInput['formations'] }

/** На чём держится вход модели: факт или допущение сценария (fact: null). */
export interface Provenance {
  /** 'su_61a.personnel', 'change:3', 'checkpoint:7', 'boundary:2', 'crossing:0', 'position:12', 'event:4' */
  input: string;
  fact: FactRef | null;
  reliability: 'A' | 'B' | 'C' | 'assumption';
}

export type ScenarioChangeIn =
  | { at: string; formation: string; kind: 'reinforce'; personnel?: number; tanks?: number; guns?: number }
  | { at: string; formation: string; kind: 'resubordinate'; parent: string };

export type CheckpointIn =
  | { at: string; formation: string; kind: 'strength'; personnel?: number; tanks?: number; guns?: number }
  /** Накопленные потери за [from, at]: personnel — убитые + раненые + пропавшие (или общее число). */
  | { at: string; formation: string; kind: 'losses'; from: string; personnel: number; tanks?: number };

export interface CompiledEdits {
  formations: Record<string, { personnel?: number; tanks?: number; guns?: number; parent?: string; enterAt?: string }>;
  changes: ScenarioChangeIn[];
  checkpoints: CheckpointIn[];
  positions: { formation: string; time: string; at?: [number, number]; place?: string; approxKm: number; reliability: string; source: string }[];
  boundaries: unknown[];
  crossings: unknown[];
  events: unknown[];
}

export interface CompileConflict { key: string; candidates: FactRef[]; chosen: FactRef | null }

export interface CompileResult { edits: CompiledEdits; provenance: Provenance[]; conflicts: CompileConflict[]; unmatched: FactRef[] }

const DAY = 86400000;
const ms = (s: string) => Date.parse(s);
const day = (s: string) => s.slice(0, 10);
const NUM = ['personnel', 'tanks', 'guns'] as const;
const prevDay = (d: string) => new Date(ms(`${day(d)}T00:00Z`) - DAY).toISOString().slice(0, 10);
/** Окно начального состояния, сут. */
const START_WINDOW = 2;
/** Неизвестное формирование в unmatched — если факт не раньше начала больше чем на столько суток. */
const UNMATCHED_BEFORE = 30;
/** Неопределённость положения по ступени, км (если у факта нет своей). */
const approxKmOf = (echelon: string) => echelon === 'front' ? 25 : echelon === 'army' ? 15 : echelon === 'corps' ? 8 : 5;

const subjectOf = (c: Claim): string => c.kind === 'boundary' ? c.between.join('|') : c.kind === 'event' ? c.id : c.subject;
const dateOf = (c: Claim): string => c.kind === 'losses' ? c.to : 'at' in c ? c.at : c.from;
const claimOf = <K extends Claim['kind']>(f: FactRef) => f.fact.claim as Extract<Claim, { kind: K }>;
const relOf = (f: FactRef): 'A' | 'B' | 'C' => f.fact.reliability ?? 'C';

/** Потери людьми одного факта: убитые + раненые + пропавшие, если есть хоть одно; иначе общее число. */
function people(c: Extract<Claim, { kind: 'losses' }>): number | undefined {
  const parts = [c.killed, c.wounded, c.missing].filter((x): x is number => typeof x === 'number');
  return parts.length ? parts.reduce((s, x) => s + x, 0) : c.total;
}

/** Разбить факты на группы по ключу (порядок появления сохраняется). */
function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); const g = m.get(k); if (g) g.push(x); else m.set(k, [x]); }
  return m;
}

export function compileOperation(entries: Entry[], op: CompileInput, pins: Pins): CompileResult {
  const facts = claimFacts(entries);
  const edits: CompiledEdits = { formations: {}, changes: [], checkpoints: [], positions: [], boundaries: [], crossings: [], events: [] };
  const provenance: Provenance[] = [];
  const conflicts: CompileConflict[] = [];
  const unmatched: FactRef[] = [];
  const tStart = ms(op.start), tEnd = ms(op.end), dStart = day(op.start);

  const known = new Map<string, FormationIn>();
  for (const f of [...op.formations, ...(op.divisions ?? [])]) if (!known.has(f.id)) known.set(f.id, f);

  const bySubject = groupBy(facts, (f) => `${f.fact.claim!.kind}|${subjectOf(f.fact.claim!)}`);
  const of = (kind: Claim['kind'], subject: string) => bySubject.get(`${kind}|${subject}`) ?? [];

  const prov = (input: string, fact: FactRef | null) => provenance.push({ input, fact, reliability: fact ? relOf(fact) : 'assumption' });
  /** Выбор с учётом закреплений; расхождение — в список. */
  const pick = (group: FactRef[], kind: Claim['kind'], subject: string, moment: string, window = 0): FactRef | null => {
    const r = resolve(group, kind, subject, moment, pins, { window });
    if (r.conflict) conflicts.push({ key: pinKey(kind, subject, moment), candidates: r.candidates, chosen: r.chosen });
    return r.chosen;
  };
  /** Выбор среди фактов на один момент (точечные факты: пополнение, точка, положение, период потерь). */
  const atMoments = (group: FactRef[], kind: Claim['kind'], subject: string, date: (f: FactRef) => string) => {
    const out: { moment: string; chosen: FactRef }[] = [];
    const moments = groupBy(group, (f) => String(ms(date(f))));
    for (const g of [...moments.values()].sort((a, b) => ms(date(a[0])) - ms(date(b[0])))) {
      const chosen = pick(g, kind, subject, date(g[0]));
      if (chosen) out.push({ moment: date(g[0]), chosen });
    }
    return out;
  };
  const setField = (id: string, k: keyof CompiledEdits['formations'][string], v: number | string) => {
    (edits.formations[id] ??= {} as CompiledEdits['formations'][string])[k] = v as never;
  };
  const inOp = (s: string) => day(s) >= dStart && ms(s) <= tEnd;

  for (const f of known.values()) {
    const id = f.id;

    // начальная численность: ±2 сут. от начала
    const strength = of('strength', id);
    const s0 = pick(strength, 'strength', id, op.start, START_WINDOW);
    for (const k of NUM) {
      const v = s0 ? claimOf<'strength'>(s0)[k] : undefined;
      if (typeof v === 'number') { setField(id, k, v); prov(`${id}.${k}`, s0); }
      else if (k === 'personnel' || f[k] != null) prov(`${id}.${k}`, null);
    }

    // подчинённость на начало; переподчинения по ходу операции
    const parents = of('parent', id);
    const p0 = pick(parents, 'parent', id, op.start);
    // старший вне операции (de_12a → ОКВ) — в операции формирование верхнее: поправки нет, основание — факт
    const p0to = p0 ? claimOf<'parent'>(p0).parent : null;
    if (p0to && known.has(p0to)) setField(id, 'parent', p0to);
    prov(`${id}.parent`, p0);
    let parent = p0to ?? f.parent ?? null;
    const later = parents.filter((x) => { const t = ms(claimOf<'parent'>(x).from); return t > tStart && t <= tEnd; });
    for (const { moment, chosen } of atMoments(later, 'parent', id, (x) => claimOf<'parent'>(x).from)) {
      const to = claimOf<'parent'>(chosen).parent;
      if (to === parent || !known.has(to)) continue;
      prov(`change:${edits.changes.length}`, chosen);
      edits.changes.push({ at: moment, formation: id, kind: 'resubordinate', parent: to });
      parent = to;
    }

    // ввод: момент после начала
    const enters = of('enter', id).filter((x) => { const t = ms(claimOf<'enter'>(x).at); return t > tStart && t <= tEnd; });
    const e0 = enters.length ? pick(enters, 'enter', id, op.start, Math.ceil((tEnd - tStart) / DAY)) : null;
    if (e0) { setField(id, 'enterAt', claimOf<'enter'>(e0).at); prov(`${id}.enterAt`, e0); } else if (f.enterAt) prov(`${id}.enterAt`, null);

    // пополнения
    const reinf = of('reinforce', id).filter((x) => inOp(claimOf<'reinforce'>(x).at));
    for (const { moment, chosen } of atMoments(reinf, 'reinforce', id, (x) => claimOf<'reinforce'>(x).at)) {
      const c = claimOf<'reinforce'>(chosen);
      prov(`change:${edits.changes.length}`, chosen);
      edits.changes.push({ at: moment, formation: id, kind: 'reinforce', ...Object.fromEntries(NUM.filter((k) => typeof c[k] === 'number').map((k) => [k, c[k]])) });
    }

    // численность после начала — контрольные точки
    // (факты в окне начального состояния — его кандидаты, не точки)
    const after = strength.filter((x) => { const t = ms(claimOf<'strength'>(x).at); return t > tStart + START_WINDOW * DAY && t <= tEnd; });
    for (const { moment, chosen } of atMoments(after, 'strength', id, (x) => claimOf<'strength'>(x).at)) {
      const c = claimOf<'strength'>(chosen);
      prov(`checkpoint:${edits.checkpoints.length}`, chosen);
      edits.checkpoints.push({ at: moment, formation: id, kind: 'strength', ...Object.fromEntries(NUM.filter((k) => typeof c[k] === 'number').map((k) => [k, c[k]])) });
    }

    // потери: по периоду — один выбранный факт; точка на конец периода — сумма цепочки смежных периодов,
    // только накопленных в операции: начало цепочки не раньше чем за сутки до её начала
    const minFrom = prevDay(dStart);
    const L = (x: FactRef) => claimOf<'losses'>(x);
    const losses = of('losses', id).filter((x) => inOp(L(x).to));
    const periods = [...groupBy(losses, (x) => `${day(L(x).from)}|${day(L(x).to)}`).values()]
      .map((g) => pick(g, 'losses', id, L(g[0]).to))
      .filter((x): x is FactRef => !!x && people(L(x)) != null && day(L(x).from) >= minFrom);
    /** Все цепочки от периода назад (каждый предшественник кончается накануне начала следующего), до упора. */
    const chains = (c: FactRef, seen: FactRef[] = []): FactRef[][] => {
      const want = prevDay(day(L(c).from));
      const prev = periods.filter((x) => day(L(x).to) === want && !seen.includes(x));
      return prev.length ? prev.flatMap((x) => chains(x, [...seen, c]).map((ch) => [c, ...ch])) : [[c]];
    };
    const sum = (ch: FactRef[]) => ch.reduce((s, x) => s + people(L(x))!, 0);
    const byTo = groupBy(periods, (x) => day(L(x).to));
    for (const to of [...byTo.keys()].sort()) {
      // раньше начало, затем подробнее (больше звеньев)
      const all = byTo.get(to)!.flatMap((c) => chains(c)).sort((a, b) =>
        day(L(a[a.length - 1]).from).localeCompare(day(L(b[b.length - 1]).from)) || b.length - a.length);
      const best = all[0];
      const total = sum(best);
      const cs = best.map(L);
      // другие цепочки на тот же конец с иной суммой (> 5 %) — расхождение
      const rivals = all.slice(1).filter((ch) => Math.abs(sum(ch) - total) / Math.max(1, sum(ch), total) > 0.05);
      if (rivals.length) {
        const key = pinKey('losses', id, cs[0].to);
        const candidates = [...new Set([best[0], ...rivals.map((ch) => ch[0])])];
        const was = conflicts.find((c) => c.key === key);
        if (was) was.candidates = [...new Set([...was.candidates, ...candidates])];
        else conflicts.push({ key, candidates, chosen: best[0] });
      }
      const tanks = cs.every((c) => typeof c.tanks === 'number') ? cs.reduce((s, c) => s + c.tanks!, 0) : undefined;
      const n = edits.checkpoints.length;
      for (const x of [...best].reverse()) prov(`checkpoint:${n}`, x);
      edits.checkpoints.push({ at: cs[0].to, formation: id, kind: 'losses', from: cs[cs.length - 1].from, personnel: total, ...(tanks != null ? { tanks } : {}) });
    }

    // положения
    const pos = of('position', id).filter((x) => inOp(claimOf<'position'>(x).at));
    for (const { moment, chosen } of atMoments(pos, 'position', id, (x) => claimOf<'position'>(x).at)) {
      const c = claimOf<'position'>(chosen);
      prov(`position:${edits.positions.length}`, chosen);
      edits.positions.push({
        formation: id, time: moment, ...(c.lngLat ? { at: c.lngLat } : {}), ...(c.place ? { place: c.place } : {}),
        approxKm: c.uncertaintyKm ?? approxKmOf(f.echelon), reliability: relOf(chosen), source: chosen.fact.source ?? chosen.entry,
      });
    }
  }

  // разграничительные линии между известными объединениями, действующие в операции
  const lines = facts.filter((x) => {
    const c = x.fact.claim!;
    return c.kind === 'boundary' && c.between.every((b) => known.has(b)) && ms(c.from) <= tEnd && (!c.to || ms(c.to) >= tStart);
  });
  for (const [subject, g] of groupBy(lines, (x) => subjectOf(x.fact.claim!))) {
    for (const { chosen } of atMoments(g, 'boundary', subject, (x) => claimOf<'boundary'>(x).from)) {
      prov(`boundary:${edits.boundaries.length}`, chosen);
      edits.boundaries.push({ ...chosen.fact.claim! });
    }
  }

  // переправы: состояние на начало и смены по ходу операции
  const crossings = groupBy(facts.filter((x) => x.fact.claim!.kind === 'crossing' && ms(claimOf<'crossing'>(x).from) <= tEnd), (x) => subjectOf(x.fact.claim!));
  for (const [subject, g] of crossings) {
    const c0 = pick(g, 'crossing', subject, op.start);
    if (c0) { prov(`crossing:${edits.crossings.length}`, c0); edits.crossings.push({ ...c0.fact.claim! }); }
    const later = g.filter((x) => ms(claimOf<'crossing'>(x).from) > tStart);
    for (const { chosen } of atMoments(later, 'crossing', subject, (x) => claimOf<'crossing'>(x).from)) {
      prov(`crossing:${edits.crossings.length}`, chosen);
      edits.crossings.push({ ...chosen.fact.claim! });
    }
  }

  // события операции: по id одно (при разных датах — расхождение)
  const events = groupBy(facts.filter((x) => x.fact.claim!.kind === 'event' && inOp(claimOf<'event'>(x).at)), (x) => subjectOf(x.fact.claim!));
  for (const [id, g] of events) {
    const chosen = pick(g, 'event', id, op.start, Math.ceil((tEnd - tStart) / DAY) + 1);
    if (!chosen) continue;
    prov(`event:${edits.events.length}`, chosen);
    edits.events.push({ ...chosen.fact.claim! });
  }

  // факты о формированиях, которых нет в операции (в пределах её времени)
  const from = tStart - UNMATCHED_BEFORE * DAY;
  for (const x of facts) {
    const c = x.fact.claim!;
    if (c.kind === 'crossing' || c.kind === 'event') continue;
    const ids = c.kind === 'boundary' ? c.between : [c.subject];
    if (ids.every((i) => known.has(i))) continue;
    const t = ms(dateOf(c));
    if (t >= from && t <= tEnd) unmatched.push(x);
  }

  return { edits, provenance, conflicts, unmatched };
}
