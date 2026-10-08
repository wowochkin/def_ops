/**
 * Калибровка правил арбитра по истории: подбор множителей к правилам так, чтобы
 * прогоны сценария с историческими задачами ближе всего повторяли историю —
 * положения по дням (сверх их неопределённости) и даты ключевых событий.
 * Чтобы не подогнать под всё сразу, мерило считается раздельно: «обучение» —
 * дни до trainUntil, «проверка» — после; подбор идёт только по обучению.
 *
 *   npm run sim:calibrate -- [--scenario berlin-1945-tasks] [--base ww2-draft] [--evals 120] [--seeds 2] [--train-until 1945-04-25]
 *                            [--out packages/sim/data/rules/ww2-berlin-cal.json]
 */
import { writeFileSync } from 'node:fs';
import { loadContext, loadHistory, DATA_DIR } from '../../src/data';
import { checkEvents, compareWithHistory, runScenario } from '../../src/history';
import { createRng } from '../../src/rng';
import type { Rules } from '../../src/types';
import type { SimContext } from '../../src/step';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scenarioId = opt('scenario', 'berlin-1945-tasks');
const evals = Number(opt('evals', '120'));
const seeds = Number(opt('seeds', '2'));
const trainUntil = opt('train-until', '1945-04-25T23:59');
const out = opt('out', join(DATA_DIR, 'rules', 'ww2-berlin-cal.json'));

// подбор — от исходных (некалиброванных) правил, а не от тех, что у сценария по умолчанию (там — уже откалиброванные)
const base = loadContext(scenarioId, opt('base', 'ww2-draft'));
const history = loadHistory(scenarioId);

/** Подбираемые множители и их границы. */
const SPACE = {
  advance: [0.3, 1.6], attackerLoss: [0.5, 2], defenderLoss: [0.5, 2],
  prepared: [1.0, 2.2], fortPerLevel: [0, 0.8], terrainExp: [0.5, 2.5], movement: [0.4, 1.2], urbanAdvance: [0.05, 0.6], fortAdvance: [0.4, 2.0],
  // темп по территории противника, км/сут (если правила ведут территорию): пешие и подвижные
  terrFoot: [10, 80], terrMobile: [15, 150],
} as const;
type Params = Record<keyof typeof SPACE, number>;

function rulesWith(r0: Rules, p: Params): Rules {
  const scale = (t: [number, number][], k: number) => t.map(([x, y]) => [x, +(y * k).toFixed(4)] as [number, number]);
  return {
    ...r0,
    _status: `откалибровано по ${scenarioId} (блок calibration); устройство — docs/simulation-model.md`,
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

interface Score { total: number; train: number; test: number; within: number; events: number; detail: { id: string; days: number | null }[] }

function score(p: Params): Score {
  const ctx: SimContext = { ...base, rules: rulesWith(base.rules, p) };
  let tr = 0, te = 0, ntr = 0, nte = 0, ev = 0, nev = 0, within = 0, n = 0;
  let detail: Score['detail'] = [];
  for (let s = 0; s < seeds; s++) {
    const run = runScenario(ctx, 101 + s);
    for (const d of compareWithHistory(ctx, run, history)) {
      const v = Math.min(d.excessKm, 50);
      if (d.time <= trainUntil) { tr += v; ntr++; } else { te += v; nte++; }
      if (d.excessKm <= 10) within++;
      n++;
    }
    const evs = checkEvents(ctx, run, history);
    for (const e of evs) {
      if (e.historical > trainUntil.slice(0, 10)) continue;
      ev += e.days == null ? 6 : Math.min(6, Math.abs(e.days));
      nev++;
    }
    detail = evs.map((e) => ({ id: e.id, days: e.days }));
  }
  const train = tr / Math.max(1, ntr), test = te / Math.max(1, nte), events = ev / Math.max(1, nev);
  return { total: train + 3 * events, train: +train.toFixed(2), test: +test.toFixed(2), within: +(within / Math.max(1, n)).toFixed(3), events: +events.toFixed(2), detail };
}

const keys = Object.keys(SPACE) as (keyof typeof SPACE)[];
const rng = createRng(2026);
const ones: Params = { advance: 1, attackerLoss: 1, defenderLoss: 1, prepared: base.rules.defense.prepared, fortPerLevel: base.rules.defense.fortificationPerLevel, terrainExp: 1, movement: base.rules.movementScale ?? 1, urbanAdvance: base.rules.advanceTerrain?.urban ?? 1, fortAdvance: 1,
  terrFoot: base.rules.territory?.enemyKmPerDay.foot ?? 30, terrMobile: base.rules.territory?.enemyKmPerDay.tracked ?? 50 };
const rand = (): Params => Object.fromEntries(keys.map((k) => [k, SPACE[k][0] + rng.next() * (SPACE[k][1] - SPACE[k][0])])) as Params;
const clamp = (k: keyof typeof SPACE, v: number) => Math.min(SPACE[k][1], Math.max(SPACE[k][0], v));

const t0 = Date.now();
let best = { p: ones, s: score(ones) };
const baseline = best.s;
console.log(`исходные правила: обучение ${baseline.train} км, проверка ${baseline.test} км, события ${baseline.events} сут, в допуске ${(baseline.within * 100).toFixed(0)} %`);
const explore = Math.floor(evals * 0.4);
for (let i = 0; i < evals; i++) {
  // сначала широкий поиск, потом уточнение вокруг лучшего
  const p: Params = i < explore ? rand() : Object.fromEntries(keys.map((k) => [k, clamp(k, best.p[k] * Math.exp(rng.normal() * 0.15 * (1 - i / evals) + 0))])) as Params;
  const s = score(p);
  if (s.total < best.s.total) {
    best = { p, s };
    console.log(`#${i + 1}: обучение ${s.train} км, проверка ${s.test} км, события ${s.events} сут, в допуске ${(s.within * 100).toFixed(0)} % — ${keys.map((k) => `${k} ${p[k].toFixed(2)}`).join(', ')}`);
  }
  if ((i + 1) % 20 === 0) console.log(`  … ${i + 1}/${evals}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}

const rules: Rules = {
  ...rulesWith(base.rules, best.p),
  id: 'ww2-berlin-cal',
  calibration: {
    scenario: scenarioId, date: new Date().toISOString().slice(0, 10), evals, seeds, trainUntil,
    from: base.rules.id, multipliers: Object.fromEntries(keys.map((k) => [k, +best.p[k].toFixed(3)])),
    before: { trainKm: baseline.train, testKm: baseline.test, eventsDays: baseline.events, within: baseline.within },
    after: { trainKm: best.s.train, testKm: best.s.test, eventsDays: best.s.events, within: best.s.within },
    events: best.s.detail,
    note: 'Подобрано по одной операции: обязательна проверка на контрольной операции (этап 2). Мерило — среднее превышение отклонения над неопределённостью исторического положения (до 50 км) + 3 × средняя ошибка дат событий (сут).',
  },
};
writeFileSync(out, JSON.stringify(rules, null, 2));
console.log(`\nлучшее: обучение ${baseline.train} → ${best.s.train} км, проверка ${baseline.test} → ${best.s.test} км, события ${baseline.events} → ${best.s.events} сут; ${((Date.now() - t0) / 60000).toFixed(1)} мин\nправила: ${out}`);
