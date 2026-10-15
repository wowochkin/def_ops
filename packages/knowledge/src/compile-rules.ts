/**
 * Сборщик «база → правила»: нормативы базы (факты `param` и `outcome`) → коридоры множителей калибровки,
 * происхождение каждого входа правил и профилей, нормативы-итоги по операциям и расхождения нормативов.
 *
 * Пакет не зависит от модели (packages/sim): перечень входов с их значениями, расчёт коридора по надёжности и пересчёт
 * коридора в множитель приходят параметрами (их связывает apps/editor/src/sim/kb-rules.ts).
 *
 * Выбор норматива на вход — как в части 1: закрепление → надёжность → свежесть записи; допущение (без надёжности)
 * уступает нормативу с источником. Коридор входа — значение или диапазон источника с допуском надёжности; факт со
 * scale дан на 1/scale входа — коридор умножается на scale. Коридор множителя — пересечение пересчитанных коридоров
 * всех входов множителя (у показателя местности — по видам местности); пусто — расхождение, коридор — у норматива,
 * выбранного по правилу (закреплённый — всегда он). Без норматива, у допущения или когда пересчитать нельзя — прежние
 * границы (space). Не берутся (и отмечаются в conflicts с why): норматив с коридором ≤ 0 или с отрицательной нижней
 * границей (вырожденный [0, 0] тоже) и норматив одной стороны (side) на вход без стороны.
 */
import type { Claim, Entry } from './schema';
import { claimFacts, pinKey, resolve, subjectOf, type FactRef, type Pins } from './resolve';

/** Вход правил: путь (как param норматива), ключ множителя калибровки, модель, значение в наборе правил. */
export interface RuleInputRef {
  path: string;
  calib?: string;
  engine: string;
  value: number | null;
  /** Вход одной стороны (профиль): нормативы другой стороны на него не берутся. */
  side?: 'su' | 'de';
}

export type Corridor = [number, number];
export type RuleProvenance = { path: string; fact: FactRef | null; reliability: 'A' | 'B' | 'C' | 'assumption'; value: number | null; corridor?: Corridor };

export interface CompileRulesOptions {
  /** Коридор норматива по надёжности (null — допущение или нет числа). */
  corridorOf: (v: { value?: number; range?: [number, number] }, rel: 'A' | 'B' | 'C' | undefined) => Corridor | null;
  /** Коридор входа path → коридор множителя key (null — пересчитать нельзя). */
  toMultiplier: (key: string, c: Corridor, path?: string) => Corridor | null;
  /** Прежние границы множителей (CALIB_SPACE). */
  space: Record<string, readonly [number, number]>;
}

export interface CompiledRules {
  /** Коридор множителя калибровки; wider — шире прежних границ; tableMissing — норматив есть, пересчитать нельзя. */
  corridors: Record<string, { range: Corridor; fact: FactRef | null; wider?: true; tableMissing?: true }>;
  /** У каждого входа: выбранный норматив (или допущение), надёжность, значение набора и коридор входа (в его единицах). */
  provenance: RuleProvenance[];
  /** Нормативы-итоги (по одному на итог; scenario — операция). */
  outcomes: { fact: FactRef; claim: Extract<Claim, { kind: 'outcome' }> }[];
  /**
   * Несколько нормативов с непересекающимися коридорами: path — путь входа, у пересечения по нескольким входам
   * (виды местности) — ключ множителя, у итога — ключ итога; pinned — выбор закреплён. why — не расхождение, а
   * норматив, отброшенный сборщиком (коридор ≤ 0, норматив одной стороны на общий вход): почему он не берётся.
   */
  conflicts: { path: string; facts: FactRef[]; pinned?: true; why?: string }[];
}

type ParamClaim = Extract<Claim, { kind: 'param' }>;
type OutcomeClaim = Extract<Claim, { kind: 'outcome' }>;

const RANK = { A: 0, B: 1, C: 2 } as const;
/** Порядок выбора без закрепления: норматив с источником раньше допущения, надёжность, свежесть, проверка человеком. */
const better = (a: FactRef, b: FactRef) =>
  (a.fact.reliability ? 0 : 1) - (b.fact.reliability ? 0 : 1)
  || RANK[a.fact.reliability ?? 'C'] - RANK[b.fact.reliability ?? 'C']
  || (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0)
  || (a.fact.check?.by === 'auto' ? 1 : 0) - (b.fact.check?.by === 'auto' ? 1 : 0);

const overlap = (a: Corridor, b: Corridor) => a[0] <= b[1] && b[0] <= a[1];
const anyDisjoint = (cs: Corridor[]) => cs.some((a, i) => cs.slice(i + 1).some((b) => !overlap(a, b)));

/** Коридор норматива в единицах входа (с масштабом); допущение — null. */
function corridorOfFact(f: FactRef, o: CompileRulesOptions): Corridor | null {
  const c = f.fact.claim as ParamClaim;
  if (!f.fact.reliability) return null;
  const k = o.corridorOf(c, f.fact.reliability);
  if (!k) return null;
  const s = c.scale && c.scale > 0 ? c.scale : 1;
  return s === 1 ? k : [+(k[0] * s).toPrecision(12), +(k[1] * s).toPrecision(12)];
}

/**
 * Выбор норматива из нескольких (разные «о ком»: путь и путь@сторона): закрепление по ключу каждого «о ком»
 * (факт — берётся он, «не брать ничего» — факты этого ключа выбывают), иначе — лучший по порядку выбора.
 */
function choose(cands: FactRef[], kind: 'param' | 'outcome', moment: string, pins: Pins): { chosen: FactRef | null; pool: FactRef[]; pinned: boolean } {
  const subjects = [...new Set(cands.map((f) => subjectOf(f.fact.claim!)))];
  let pinnedFact: FactRef | null = null;
  const off = new Set<string>();
  for (const s of subjects) {
    if (!pins[pinKey(kind, s, moment)]) continue;
    const r = resolve(cands, kind, s, moment, pins);
    if (r.pin === 'none') off.add(s);
    else if (r.pin === 'fact' && !pinnedFact) pinnedFact = r.chosen;
  }
  const pool = cands.filter((f) => !off.has(subjectOf(f.fact.claim!)));
  return { chosen: pinnedFact ?? [...pool].sort(better)[0] ?? null, pool, pinned: !!pinnedFact };
}

export function compileRules(entries: Entry[], inputs: RuleInputRef[], pins: Pins, o: CompileRulesOptions): CompiledRules {
  const facts = claimFacts(entries);
  const params = facts.filter((f) => f.fact.claim!.kind === 'param');
  const conflicts: CompiledRules['conflicts'] = [];

  // входы: выбранный норматив, коридор в единицах входа
  const provenance: RuleProvenance[] = [];
  const perInput = new Map<string, { fact: FactRef; corridor: Corridor; pinned: boolean }>();
  for (const inp of inputs) {
    const cands: FactRef[] = [];
    for (const f of params) {
      const c = f.fact.claim as ParamClaim;
      if (c.param !== inp.path) continue;
      if (inp.side && c.side && c.side !== inp.side) continue;
      if (!inp.side && c.side) {
        conflicts.push({ path: inp.path, facts: [f], why: `норматив одной стороны (${c.side}) на общий для сторон вход — не берётся` });
        continue;
      }
      const k = corridorOfFact(f, o);
      if (k && (k[1] <= 0 || k[0] < 0)) {
        conflicts.push({ path: inp.path, facts: [f], why: `коридор норматива ${k[0]}–${k[1]} ≤ 0 или с отрицательной границей — не берётся` });
        continue;
      }
      cands.push(f);
    }
    const { chosen, pool, pinned } = choose(cands, 'param', '', pins);
    const withCorr = pool.map((f) => ({ f, c: corridorOfFact(f, o) })).filter((x): x is { f: FactRef; c: Corridor } => !!x.c);
    if (withCorr.length > 1 && anyDisjoint(withCorr.map((x) => x.c))) conflicts.push({ path: inp.path, facts: withCorr.map((x) => x.f), ...(pinned ? { pinned: true as const } : {}) });
    const corridor = chosen ? corridorOfFact(chosen, o) : null;
    if (chosen && corridor) perInput.set(inp.path, { fact: chosen, corridor, pinned });
    provenance.push({
      path: inp.path, fact: chosen, reliability: chosen?.fact.reliability ?? 'assumption', value: inp.value, ...(corridor ? { corridor } : {}),
    });
  }

  // множители: пересечение пересчитанных коридоров входов множителя
  const corridors: CompiledRules['corridors'] = {};
  for (const [key, sp] of Object.entries(o.space)) {
    const space: Corridor = [sp[0], sp[1]];
    const ins = inputs.filter((i) => i.calib === key && perInput.has(i.path));
    if (!ins.length) { corridors[key] = { range: space, fact: null }; continue; }
    const mapped: { fact: FactRef; range: Corridor; pinned: boolean }[] = [];
    let missing: FactRef | null = null;
    for (const i of ins) {
      const p = perInput.get(i.path)!;
      const m = o.toMultiplier(key, p.corridor, i.path);
      if (m && m.every(Number.isFinite)) mapped.push({ fact: p.fact, range: [Math.min(m[0], m[1]), Math.max(m[0], m[1])], pinned: p.pinned });
      else missing ??= p.fact;
    }
    if (!mapped.length) { corridors[key] = { range: space, fact: missing, tableMissing: true }; continue; }
    // закреплённый норматив входа берёт верх над порядком выбора, как и на самом входе
    const best = mapped.find((m) => m.pinned) ?? [...mapped].sort((a, b) => better(a.fact, b.fact))[0];
    let range: Corridor = [Math.max(...mapped.map((m) => m.range[0])), Math.min(...mapped.map((m) => m.range[1]))];
    if (range[0] > range[1]) {
      conflicts.push({ path: key, facts: mapped.map((m) => m.fact), ...(best.pinned ? { pinned: true as const } : {}) });
      range = best.range;
    }
    const wider = range[0] < space[0] || range[1] > space[1];
    corridors[key] = { range, fact: best.fact, ...(wider ? { wider: true as const } : {}) };
  }

  // нормативы-итоги: по одному на итог (операция, мера, соединение, период)
  const outcomes: CompiledRules['outcomes'] = [];
  const byKey = new Map<string, FactRef[]>();
  for (const f of facts) if (f.fact.claim!.kind === 'outcome') {
    const k = subjectOf(f.fact.claim!);
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  for (const [k, cands] of byKey) {
    const moment = (cands[0].fact.claim as OutcomeClaim).to;
    const { chosen, pool, pinned } = choose(cands, 'outcome', moment, pins);
    const rs = pool.map((f) => (f.fact.claim as OutcomeClaim).range).filter((r) => Array.isArray(r)).map((r) => [Math.min(...r), Math.max(...r)] as Corridor);
    if (rs.length > 1 && anyDisjoint(rs)) conflicts.push({ path: k, facts: pool, ...(pinned ? { pinned: true as const } : {}) });
    if (chosen) outcomes.push({ fact: chosen, claim: chosen.fact.claim as OutcomeClaim });
  }
  return { corridors, provenance, outcomes, conflicts };
}
