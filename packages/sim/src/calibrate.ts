/**
 * Калибровка правил арбитра по истории — общая часть для консоли (npm run sim:calibrate) и раздела
 * «Моделирование» редактора: подбираемые множители и их границы, применение к правилам, мерило
 * (положения по дням сверх их неопределённости и даты ключевых событий; «обучение» — до trainUntil,
 * «проверка» — после) и подбор: сначала широкий случайный поиск, потом уточнение вокруг лучшего.
 * Подбор пошаговый (next → report): кандидатов можно считать параллельно в нескольких потоках.
 */
import { checkEvents, compareStrength, compareWithHistory, runScenario, STRENGTH_MIN_POINTS, STRENGTH_WEIGHT, type History } from './history';
import { CORRIDOR_TOL, edgeOf, evaluateNorms, outcomesScore, OUTCOME_WEIGHT, type Norm } from './norms';
import { createRng } from './rng';
import type { SimContext } from './step';
import type { Rules } from './types';

/** Подбираемые множители и их границы. */
export const CALIB_SPACE = {
  advance: [0.3, 1.6], attackerLoss: [0.5, 2], defenderLoss: [0.5, 2],
  prepared: [1.0, 2.2], fortPerLevel: [0, 0.8], terrainExp: [0.5, 2.5], movement: [0.4, 1.2], urbanAdvance: [0.05, 0.6], fortAdvance: [0.4, 2.0],
  // темп по территории противника, км/сут (если правила ведут территорию): пешие и подвижные
  terrFoot: [10, 80], terrMobile: [15, 150],
} as const satisfies Record<string, readonly [number, number]>;
export type CalibKey = keyof typeof CALIB_SPACE;
export type CalibParams = Record<CalibKey, number>;
export const CALIB_KEYS = Object.keys(CALIB_SPACE) as CalibKey[];

/** Что значит каждый множитель — для интерфейса и отчёта. */
export const CALIB_INFO: Record<CalibKey, { title: string; hint: string; unit?: string }> = {
  advance: { title: 'Темп продвижения', hint: 'множитель к таблице темпа наступающего (км/сут от соотношения сил)', unit: '×' },
  attackerLoss: { title: 'Потери наступающего', hint: 'множитель к таблице потерь наступающего', unit: '×' },
  defenderLoss: { title: 'Потери обороняющегося', hint: 'множитель к таблице потерь обороняющегося', unit: '×' },
  prepared: { title: 'Подготовленная оборона', hint: 'сила обороняющегося, простоявшего на месте сутки и больше', unit: '×' },
  fortPerLevel: { title: 'Укрепления', hint: 'прибавка к силе обороны за каждый уровень укреплённости района', unit: '+' },
  terrainExp: { title: 'Влияние местности', hint: 'степень к поправкам за местность (>1 — сильнее лес, болото, город)', unit: '^' },
  movement: { title: 'Темп марша', hint: 'множитель к темпам марша из профилей (заторы, разрушенные дороги, беженцы)', unit: '×' },
  urbanAdvance: { title: 'Темп в городе', hint: 'доля обычного темпа в бою в городской застройке', unit: '×' },
  fortAdvance: { title: 'Прогрызание полос', hint: 'множитель к предельному темпу прорыва укреплённых полос', unit: '×' },
  terrFoot: { title: 'Пешие по чужой территории', hint: 'темп продвижения пеших по территории противника вне боя', unit: 'км/сут' },
  terrMobile: { title: 'Подвижные по чужой территории', hint: 'темп продвижения танков и мотопехоты по территории противника', unit: 'км/сут' },
};

/** Множители, при которых правила не меняются (исходная точка подбора). */
export function baseParams(r: Rules): CalibParams {
  return {
    advance: 1, attackerLoss: 1, defenderLoss: 1, prepared: r.defense.prepared, fortPerLevel: r.defense.fortificationPerLevel, terrainExp: 1,
    movement: r.movementScale ?? 1, urbanAdvance: r.advanceTerrain?.urban ?? 1, fortAdvance: 1,
    terrFoot: r.territory?.enemyKmPerDay.foot ?? 30, terrMobile: r.territory?.enemyKmPerDay.tracked ?? 50,
  };
}

/** Правила с применёнными множителями. */
export function rulesWith(r0: Rules, p: CalibParams, status?: string): Rules {
  const scale = (t: [number, number][], k: number) => t.map(([x, y]) => [x, +(y * k).toFixed(4)] as [number, number]);
  return {
    ...r0,
    ...(status ? { _status: status } : {}),
    advance: scale(r0.advance, p.advance),
    attackerLoss: scale(r0.attackerLoss, p.attackerLoss),
    defenderLoss: scale(r0.defenderLoss, p.defenderLoss),
    defense: {
      ...r0.defense,
      prepared: +p.prepared.toFixed(3),
      fortificationPerLevel: +p.fortPerLevel.toFixed(3),
      terrain: Object.fromEntries(Object.entries(r0.defense.terrain).map(([k, v]) => [k, +Math.pow(v!, p.terrainExp).toFixed(3)])),
    },
    movementScale: +p.movement.toFixed(3),
    advanceTerrain: { ...(r0.advanceTerrain ?? {}), urban: +p.urbanAdvance.toFixed(3) },
    ...(r0.fortAdvanceKm ? { fortAdvanceKm: r0.fortAdvanceKm.map((v, i) => (i ? +(v * p.fortAdvance).toFixed(2) : v)) } : {}),
    ...(r0.territory ? { territory: { ...r0.territory, enemyKmPerDay: { foot: +p.terrFoot.toFixed(1), motor: +p.terrMobile.toFixed(1), tracked: +p.terrMobile.toFixed(1) } } } : {}),
  };
}

/** Середина операции — граница «обучения» и «проверки» по умолчанию. */
export const defaultTrainUntil = (ctx: SimContext) =>
  new Date((Date.parse(ctx.scenario.start + 'Z') + Date.parse(ctx.scenario.end + 'Z')) / 2).toISOString().slice(0, 10) + 'T23:59';

export interface CalibScore {
  /** Мерило подбора: обучение (км) + 3 × ошибка дат событий (сут); с контрольными точками — см. strength. Меньше — лучше. */
  total: number;
  /** Среднее превышение отклонения над неопределённостью, км (до 50): обучение и проверка. */
  train: number;
  test: number;
  /** Доля положений в пределах 10 км сверх неопределённости. */
  within: number;
  /** Средняя ошибка дат событий обучения, сут (несостоявшееся — 6). */
  events: number;
  detail: { id: string; days: number | null }[];
  /**
   * Сверка численности и потерь с документами на обучении (History.checkpoints до trainUntil): точек за прогон и доля
   * в пределах ±25 %. От 10 точек входит в total: total × 0,75 + (1 − within) × 50 × 0,25. Нет точек — поля нет.
   */
  strength?: { n: number; within: number };
  /**
   * Нормативы-итоги операции (пункт «итоги» сборщика «база → правила»): измеримых итогов, доля в допуске и каждый итог.
   * От OUTCOME_MIN (3) измеримых входит в total: total × 7/8 + (1 − within) × 50 × 1/8 (withOutcomes). Нет итогов — поля нет.
   */
  outcomes?: { n: number; within: number; items: OutcomeItem[] };
}
/** Норматив-итог в мериле: значение модели (среднее по прогонам), ожидаемое, в допуске ли. */
export interface OutcomeItem { id: string; title: string; mean: number | null; expect?: [number, number]; unit?: string; ok: boolean }

/** Мерило с нормативами-итогами: 7/8 × нынешнее + 1/8 × (1 − доля в допуске) × 50; доли нет (итогов < 3) — прежнее. */
export const withOutcomes = (total: number, share: number | null) => (share == null ? total : total * (1 - OUTCOME_WEIGHT) + (1 - share) * 50 * OUTCOME_WEIGHT);

/** Итог прогонов набора правил: мерило калибровки и всё для сравнения с историей и другими моделями. */
export interface RulesEvaluation {
  score: CalibScore;
  /** Доля положений в допуске и медиана превышения (по всем прогонам). */
  within: number;
  medianExcessKm: number;
  n: number;
  /** По дням: среднее превышение, км, и доля в допуске. */
  byDay: { day: string; meanExcessKm: number; within: number; n: number }[];
  /** События: историческая дата и расхождение в сутках по прогонам (null — не случилось). */
  events: { id: string; title: string; historical: string; days: (number | null)[] }[];
  ms: number;
}

/** Прогнать правила seeds раз и сравнить с историей. */
export function evaluateRules(ctx: SimContext, rules: Rules, history: History, o: { seeds?: number; trainUntil?: string; seed0?: number; toleranceKm?: number; outcomes?: Norm[] } = {}): RulesEvaluation {
  const c: SimContext = { ...ctx, rules };
  const seeds = o.seeds ?? 2, trainUntil = o.trainUntil ?? defaultTrainUntil(ctx), tol = o.toleranceKm ?? 10;
  let tr = 0, te = 0, ntr = 0, nte = 0, ev = 0, nev = 0, within10 = 0, n = 0;
  const all: number[] = [];
  const days = new Map<string, number[]>();
  const events = new Map<string, RulesEvaluation['events'][number]>();
  let detail: CalibScore['detail'] = [];
  // контрольные точки численности и потерь обучения
  const cpTrain = (history.checkpoints ?? []).filter((c) => c.at <= trainUntil);
  let cpN = 0, cpWithin = 0;
  // нормативы-итоги этой операции (итоги других операций прогоном этой не измерить)
  const outs = (o.outcomes ?? []).filter((n) => 'scenario' in n.measure && n.measure.scenario === ctx.scenario.id);
  const runs: ReturnType<typeof runScenario>[] = [];
  const t0 = Date.now();
  for (let s = 0; s < seeds; s++) {
    const run = runScenario(c, (o.seed0 ?? 101) + s);
    if (outs.length) runs.push(run);
    for (const d of compareWithHistory(c, run, history)) {
      const v = Math.min(d.excessKm, 50);
      if (d.time <= trainUntil) { tr += v; ntr++; } else { te += v; nte++; }
      if (d.excessKm <= 10) within10++;
      n++;
      all.push(d.excessKm);
      const day = d.time.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), d.excessKm]);
    }
    const evs = checkEvents(c, run, history);
    for (const e of evs) {
      const x = events.get(e.id) ?? { id: e.id, title: e.title, historical: e.historical, days: [] };
      x.days.push(e.days);
      events.set(e.id, x);
      if (e.historical > trainUntil.slice(0, 10)) continue;
      ev += e.days == null ? 6 : Math.min(6, Math.abs(e.days));
      nev++;
    }
    detail = evs.map((e) => ({ id: e.id, days: e.days }));
    if (cpTrain.length) {
      const st = compareStrength(c, run, { ...history, checkpoints: cpTrain });
      cpN += st.n; cpWithin += st.within * st.n;
    }
  }
  const train = tr / Math.max(1, ntr), test = te / Math.max(1, nte), evd = ev / Math.max(1, nev);
  const sorted = [...all].sort((a, b) => a - b);
  const strength = cpN ? { n: Math.round(cpN / seeds), within: +(cpWithin / cpN).toFixed(3) } : undefined;
  const base = train + 3 * evd;
  const withStrength = strength && strength.n >= STRENGTH_MIN_POINTS ? base * (1 - STRENGTH_WEIGHT) + (1 - strength.within) * 50 * STRENGTH_WEIGHT : base;
  let outcomes: CalibScore['outcomes'];
  let share: number | null = null;
  if (outs.length) {
    const res = evaluateNorms({ norms: outs }, () => c, () => runs);
    share = outcomesScore(res);
    const items: OutcomeItem[] = res.filter((r) => r.verdict === 'ok' || r.verdict === 'low' || r.verdict === 'high')
      .map((r) => ({ id: r.norm.id, title: r.norm.title, mean: r.mean == null ? null : +r.mean.toFixed(2), ...(r.norm.expect ? { expect: r.norm.expect } : {}), ...(r.norm.unit ? { unit: r.norm.unit } : {}), ok: r.verdict === 'ok' }));
    outcomes = { n: items.length, within: +(items.length ? items.filter((x) => x.ok).length / items.length : 0).toFixed(3), items };
  }
  const total = withOutcomes(withStrength, share);
  return {
    score: { total: +total.toFixed(3), train: +train.toFixed(2), test: +test.toFixed(2), within: +(within10 / Math.max(1, n)).toFixed(3), events: +evd.toFixed(2), detail, ...(strength ? { strength } : {}), ...(outcomes ? { outcomes } : {}) },
    within: +(all.filter((x) => x <= tol).length / Math.max(1, all.length)).toFixed(3),
    medianExcessKm: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    n: all.length,
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, l]) => ({ day, meanExcessKm: +(l.reduce((a, b) => a + b, 0) / l.length).toFixed(1), within: +(l.filter((x) => x <= tol).length / l.length).toFixed(2), n: l.length })),
    events: [...events.values()],
    ms: Date.now() - t0,
  };
}

/** Оценить правила по истории (мерило калибровки): seeds прогонов. */
export function scoreRules(ctx: SimContext, rules: Rules, history: History, o: { seeds?: number; trainUntil?: string; seed0?: number; outcomes?: Norm[] } = {}): CalibScore {
  return evaluateRules(ctx, rules, history, o).score;
}

/**
 * Подбор множителей: next(k) — следующие кандидаты (их можно считать параллельно), report — результат.
 * Первые 40 % — широкий случайный поиск, дальше — уточнение вокруг лучшего с сужающимся шагом.
 */
export class Calibrator {
  private rng;
  private issued = 0;
  best: { p: CalibParams; s: CalibScore } | null = null;
  /** Границы поиска: коридоры нормативов (сборщик «база → правила»), где их нет — CALIB_SPACE. */
  readonly space: Record<CalibKey, readonly [number, number]>;
  /**
   * Исходная точка подбора: подбираемые множители, лежащие вне коридора (набор старше норматива), перенесены к его
   * ближнему краю; прочие — как были. Если она отличается от переданной, её нужно оценить и сообщить (report) —
   * точка вне коридора лучшей не становится.
   */
  readonly start: CalibParams;
  constructor(start: CalibParams, readonly evals: number, seed = 2026, readonly keys: CalibKey[] = CALIB_KEYS, space?: Partial<Record<CalibKey, readonly [number, number]>>) {
    this.rng = createRng(seed);
    this.space = { ...CALIB_SPACE, ...(space ?? {}) };
    this.start = { ...start };
    for (const k of keys) this.start[k] = this.clamp(k, start[k]);
  }
  get done() { return this.issued >= this.evals; }
  get progress() { return this.issued; }
  private clamp(k: CalibKey, v: number) { return Math.min(this.space[k][1], Math.max(this.space[k][0], v)); }
  /** Подбираемые множители точки — в коридорах (с запасом на округление). */
  inside(p: CalibParams) { return this.keys.every((k) => p[k] >= this.space[k][0] - 1e-9 && p[k] <= this.space[k][1] + 1e-9); }
  next(k: number): CalibParams[] {
    const out: CalibParams[] = [];
    const explore = Math.floor(this.evals * 0.4);
    for (let j = 0; j < k && this.issued < this.evals; j++, this.issued++) {
      const i = this.issued;
      const p = { ...(this.best?.p ?? this.start) };
      for (const key of this.keys) {
        p[key] = i < explore || !this.best
          ? this.space[key][0] + this.rng.next() * (this.space[key][1] - this.space[key][0])
          : this.clamp(key, this.best.p[key] * Math.exp(this.rng.normal() * 0.15 * (1 - i / this.evals)));
      }
      out.push(p);
    }
    return out;
  }
  /** Учесть результат; true — новый лучший. */
  report(p: CalibParams, s: CalibScore): boolean {
    if (!this.inside(p)) return false;
    if (this.best && s.total >= this.best.s.total) return false;
    this.best = { p, s };
    return true;
  }
}

/** Правила-итог калибровки с блоком calibration (откуда, множители, мерило до и после). */
export function calibratedRules(base: Rules, p: CalibParams, o: { id: string; scenario: string; evals: number; seeds: number; trainUntil: string; before: CalibScore; after: CalibScore; note?: string; corridors?: Partial<Record<CalibKey, CalibCorridor>> }): Rules {
  const outc = (s: CalibScore) => (s.outcomes ? { n: s.outcomes.n, within: s.outcomes.within } : undefined);
  return {
    ...rulesWith(base, p, `откалибровано по ${o.scenario} (блок calibration: исходные правила, множители, мерило до и после)`),
    id: o.id,
    calibration: {
      scenario: o.scenario, date: new Date().toISOString().slice(0, 10), evals: o.evals, seeds: o.seeds, trainUntil: o.trainUntil,
      from: base.id, multipliers: Object.fromEntries(CALIB_KEYS.map((k) => [k, +p[k].toFixed(3)])),
      before: { trainKm: o.before.train, testKm: o.before.test, eventsDays: o.before.events, within: o.before.within },
      after: { trainKm: o.after.train, testKm: o.after.test, eventsDays: o.after.events, within: o.after.within },
      events: o.after.detail,
      ...(o.corridors ? { corridors: o.corridors } : {}),
      ...(o.before.outcomes || o.after.outcomes ? { outcomes: { before: outc(o.before), after: outc(o.after) } } : {}),
      note: o.note ?? 'Подобрано по одной операции: обязательна проверка на контрольной операции. Мерило — среднее превышение отклонения над неопределённостью исторического положения (до 50 км) + 3 × средняя ошибка дат событий (сут).',
    },
  };
}

/** Слить оценки отдельных прогонов (по одному seed — из разных потоков) в одну. */
export function mergeEvaluations(list: RulesEvaluation[]): RulesEvaluation {
  if (list.length === 1) return list[0];
  const w = (f: (e: RulesEvaluation) => number) => list.reduce((a, e) => a + f(e) * e.n, 0) / Math.max(1, list.reduce((a, e) => a + e.n, 0));
  const avg = (f: (e: RulesEvaluation) => number) => list.reduce((a, e) => a + f(e), 0) / list.length;
  const meds = list.map((e) => e.medianExcessKm).sort((a, b) => a - b);
  const days = new Map<string, { s: number; w: number; n: number }>();
  for (const e of list) for (const d of e.byDay) { const x = days.get(d.day) ?? { s: 0, w: 0, n: 0 }; x.s += d.meanExcessKm * d.n; x.w += d.within * d.n; x.n += d.n; days.set(d.day, x); }
  const events = list[0].events.map((ev) => ({ ...ev, days: list.flatMap((e) => e.events.find((x) => x.id === ev.id)?.days ?? []) }));
  const st = list.filter((e) => e.score.strength?.n);
  const stN = st.reduce((a, e) => a + e.score.strength!.n, 0);
  const strength = st.length ? { n: Math.round(stN / st.length), within: +(st.reduce((a, e) => a + e.score.strength!.within * e.score.strength!.n, 0) / stN).toFixed(3) } : undefined;
  const outcomes = mergeOutcomes(list.map((e) => e.score.outcomes));
  return {
    score: { total: +avg((e) => e.score.total).toFixed(3), train: +avg((e) => e.score.train).toFixed(2), test: +avg((e) => e.score.test).toFixed(2), within: +avg((e) => e.score.within).toFixed(3), events: +avg((e) => e.score.events).toFixed(2), detail: list[0].score.detail, ...(strength ? { strength } : {}), ...(outcomes ? { outcomes } : {}) },
    within: +w((e) => e.within).toFixed(3),
    medianExcessKm: meds[Math.floor(meds.length / 2)],
    n: list.reduce((a, e) => a + e.n, 0),
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, x]) => ({ day, meanExcessKm: +(x.s / x.n).toFixed(1), within: +(x.w / x.n).toFixed(2), n: x.n })),
    events,
    ms: list.reduce((a, e) => a + e.ms, 0),
  };
}

/** Итоги по прогонам из разных потоков: значение — среднее, в допуске — по среднему. */
function mergeOutcomes(list: (CalibScore['outcomes'] | undefined)[]): CalibScore['outcomes'] {
  const have = list.filter((x): x is NonNullable<CalibScore['outcomes']> => !!x);
  if (!have.length) return undefined;
  const byId = new Map<string, OutcomeItem[]>();
  for (const o of have) for (const it of o.items) byId.set(it.id, [...(byId.get(it.id) ?? []), it]);
  const items = [...byId.values()].map((l) => {
    const ms = l.map((x) => x.mean).filter((x): x is number => x != null);
    const mean = ms.length ? +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2) : null;
    const e = l[0].expect;
    return { ...l[0], mean, ok: mean != null && (e ? mean >= e[0] && mean <= e[1] : l.every((x) => x.ok)) };
  });
  return { n: items.length, within: +(items.length ? items.filter((x) => x.ok).length / items.length : 0).toFixed(3), items };
}

/** Коридор, по которому подбирался множитель (блок calibration.corridors откалиброванного набора). */
export interface CalibCorridor {
  range: [number, number];
  /** Факт-норматив базы: запись#номер; norm — строка norms.json (у фактов сида). Нет — прежние границы (допущение). */
  fact?: string; norm?: string;
  /** Источник норматива (запись-источник базы) и надёжность; допуск коридора по надёжности. */
  source?: string; reliability?: string; tolerance?: number;
  /** Коридор источника шире прежних границ; норматив есть, но пересчитать в множитель нельзя. */
  wider?: true; tableMissing?: true;
}

/** Коридоры множителей сборщика «база → правила» (форма CompiledRules.corridors из packages/knowledge) → границы калибратора. */
export function spaceOf(corridors: Record<string, { range: [number, number] }>): Partial<Record<CalibKey, [number, number]>> {
  const out: Partial<Record<CalibKey, [number, number]>> = {};
  for (const k of CALIB_KEYS) { const c = corridors[k]; if (c && c.range.every(Number.isFinite)) out[k] = [Math.min(...c.range), Math.max(...c.range)]; }
  return out;
}

/** Коридоры сборщика → запись в откалиброванный набор: коридор, факт-норматив, источник, надёжность и её допуск. */
export function calibCorridors(corridors: Record<string, { range: [number, number]; fact: { entry: string; index: number; fact: { source?: string; reliability?: string; norm?: { id: string } } } | null; wider?: true; tableMissing?: true }>): Partial<Record<CalibKey, CalibCorridor>> {
  const out: Partial<Record<CalibKey, CalibCorridor>> = {};
  for (const k of CALIB_KEYS) {
    const c = corridors[k];
    if (!c) continue;
    const f = c.fact, rel = f?.fact.reliability;
    out[k] = {
      range: [c.range[0], c.range[1]],
      ...(f ? { fact: `${f.entry}#${f.index}` } : {}), ...(f?.fact.norm ? { norm: f.fact.norm.id } : {}), ...(f?.fact.source ? { source: f.fact.source } : {}),
      ...(rel ? { reliability: rel } : {}), ...(rel && rel in CORRIDOR_TOL ? { tolerance: CORRIDOR_TOL[rel as keyof typeof CORRIDOR_TOL] } : {}),
      ...(c.wider ? { wider: true as const } : {}), ...(c.tableMissing ? { tableMissing: true as const } : {}),
    };
  }
  return out;
}

/** Строка отчёта калибровки по множителю: значение, коридор (нет записи — прежние границы), источник, упирается ли в край. */
export interface CorridorRow { key: CalibKey; title: string; value: number; range: [number, number]; source?: string; reliability?: string; fact?: string; wider?: true; edge: 'low' | 'high' | null }
export function corridorReport(p: CalibParams, corridors: Partial<Record<CalibKey, CalibCorridor>> | undefined, keys: CalibKey[] = CALIB_KEYS): CorridorRow[] {
  return keys.map((k) => {
    const c = corridors?.[k];
    const range: [number, number] = c ? c.range : [CALIB_SPACE[k][0], CALIB_SPACE[k][1]];
    return {
      key: k, title: CALIB_INFO[k].title, value: p[k], range,
      ...(c?.source ? { source: c.source } : {}), ...(c?.reliability ? { reliability: c.reliability } : {}), ...(c?.fact ? { fact: c.fact } : {}), ...(c?.wider ? { wider: true as const } : {}),
      edge: edgeOf(p[k], range),
    };
  });
}
