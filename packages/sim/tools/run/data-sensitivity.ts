/**
 * Чувствительность к данным: что станет с сходством с историей, если данные сценария или театра хуже,
 * чем есть, — то есть какие данные ценнее собирать. Правила не меняются. Приёмы:
 *  — ошибка данных заданной величины (сроки приказов ±24 ч, положения — на допуск сравнения, 10 или 2 км,
 *    численность ±20 %) — по сторонам отдельно, две независимые выборки ошибки;
 *  — отсутствие данных (подвоз, фазы подвоза, разграничительные линии, дороги, рельеф и перепады высот, реки,
 *    укреплённые полосы театра).
 * Показатели — как в sim:sensitivity: доля положений в допуске, доля событий в пределах двух суток, ошибка дат.
 * Все варианты считаются на одних и тех же seed (общие случайные числа). Падение в пределах двух σ шума
 * (см. sim:sensitivity) — не значимо.
 *
 *   npm run sim:data-sensitivity -- --scenario berlin-1945-tasks [--seeds 5] [--out evals-out/data-sensitivity]
 *   npm run sim:data-sensitivity -- --report
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadContext, loadHistory, loadTheatre } from '../../src/data';
import { evaluateRules } from '../../src/calibrate';
import { createRng } from '../../src/rng';
import { Theatre } from '../../src/theatre';
import type { SimContext } from '../../src/step';
import type { Scenario, TheatreData } from '../../src/types';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const outDir = resolve(opt('out', 'evals-out/data-sensitivity')!);
const TOLERANCE: Record<string, number> = { 'berlin-1945-tasks': 10, 'berlin-city-1945': 2, 'vistula-oder-1945': 10 };

interface Row { id: string; title: string; kind: 'error' | 'absent'; draws: number; within: number; evHit: number; evErr: number; median: number }
interface Result { scenario: string; seeds: number; tolerance: number; baseline: Row; rows: Row[]; seconds: number }

if (args.includes('--report')) { report(); process.exit(0); }

const scenarioId = opt('scenario', 'berlin-1945-tasks')!;
const seeds = Number(opt('seeds', '5'));
const tol = TOLERANCE[scenarioId] ?? 10;
const base = loadContext(scenarioId);
const history = loadHistory(scenarioId);
const t0 = Date.now();
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function evaluate(ctx: SimContext): Omit<Row, 'id' | 'title' | 'kind' | 'draws'> {
  const ev = evaluateRules(ctx, ctx.rules, history, { seeds, seed0: 1, toleranceKm: tol });
  const days = ev.events.flatMap((e) => e.days);
  return {
    within: ev.within, median: ev.medianExcessKm,
    evHit: days.filter((d) => d != null && Math.abs(d) <= 2).length / Math.max(1, days.length),
    evErr: mean(days.map((d) => (d == null ? 6 : Math.min(6, Math.abs(d))))),
  };
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const hoursShift = (iso: string, h: number) => new Date(Date.parse(iso + ':00Z') + h * 3600_000).toISOString().slice(0, 16);

type Mut = (sc: Scenario, th: TheatreData, rng: ReturnType<typeof createRng>, ctx: SimContext) => void;
const ERR_ORDER_H = 24, ERR_POS_KM = tol, ERR_STRENGTH = 0.2; // положение — с ошибкой, равной допуску сравнения
const posErr = (side: string): Mut => (sc, _th, rng, ctx) => {
  const P = ctx.theatre.proj;
  for (const f of sc.formations) if (f.side === side && f.position) {
    const [x, y] = P.toXY(f.position);
    f.position = P.toLL([x + rng.normal() * ERR_POS_KM, y + rng.normal() * ERR_POS_KM]);
  }
};
const strengthErr = (side: string): Mut => (sc, _th, rng) => {
  for (const f of sc.formations) if (f.side === side) {
    const k = 1 + (rng.next() * 2 - 1) * ERR_STRENGTH;
    if (f.personnel) f.personnel = Math.round(f.personnel * k);
    if (f.tanks) f.tanks = Math.round(f.tanks * k);
    if (f.guns) f.guns = Math.round(f.guns * k);
  }
};
const VARIANTS: { id: string; title: string; kind: 'error' | 'absent'; draws: number; mut: Mut }[] = [
  { id: 'orders', title: `сроки приказов с ошибкой до ±${ERR_ORDER_H} ч`, kind: 'error', draws: 2, mut: (sc, _t, rng) => { for (const o of sc.orders) o.issuedAt = hoursShift(o.issuedAt, Math.round((rng.next() * 2 - 1) * ERR_ORDER_H)); } },
  { id: 'pos-su', title: `исходные положения советских войск ±${ERR_POS_KM} км`, kind: 'error', draws: 2, mut: posErr('su') },
  { id: 'pos-de', title: `исходные положения немецких войск ±${ERR_POS_KM} км`, kind: 'error', draws: 2, mut: posErr('de') },
  { id: 'str-su', title: `численность, танки, орудия советских войск ±${ERR_STRENGTH * 100} %`, kind: 'error', draws: 2, mut: strengthErr('su') },
  { id: 'str-de', title: `численность, танки, орудия немецких войск ±${ERR_STRENGTH * 100} %`, kind: 'error', draws: 2, mut: strengthErr('de') },
  { id: 'supply-phases', title: 'нет фаз подвоза (база не переносится вперёд)', kind: 'absent', draws: 1, mut: (sc) => { for (const s of Object.values(sc.supply ?? {})) delete s.phases; } },
  { id: 'supply', title: 'нет баз снабжения (подвоз без источников)', kind: 'absent', draws: 1, mut: (sc) => { delete sc.supply; } },
  { id: 'boundaries', title: 'нет разграничительных линий по директивам', kind: 'absent', draws: 1, mut: (sc) => { delete sc.boundaries; } },
  { id: 'roads', title: 'нет дорог', kind: 'absent', draws: 1, mut: (_s, th) => { th.roads = []; delete th.roadGrid; } },
  { id: 'terrain', title: 'нет рельефа местности (всё открытое)', kind: 'absent', draws: 1, mut: (_s, th) => { th.terrain = []; delete th.terrainGrid; } },
  { id: 'heights', title: 'нет перепадов высот', kind: 'absent', draws: 1, mut: (_s, th) => { delete th.heightGrid; } },
  { id: 'rivers', title: 'нет рек и мостов', kind: 'absent', draws: 1, mut: (_s, th) => { th.rivers = []; th.bridges = []; } },
  { id: 'lines', title: 'нет укреплённых полос театра', kind: 'absent', draws: 1, mut: (_s, th) => { th.lines = []; } },
];

const baselineRow: Row = { id: 'base', title: 'исходные данные', kind: 'absent', draws: 1, ...evaluate(base) };
console.log(`${scenarioId}: исходные данные — в допуске ${(baselineRow.within * 100).toFixed(0)} %, события ±2 сут ${(baselineRow.evHit * 100).toFixed(0)} %`);
const rows: Row[] = [];
for (const v of VARIANTS) {
  const draws: ReturnType<typeof evaluate>[] = [];
  for (let d = 0; d < v.draws; d++) {
    const sc = clone(base.scenario), th = clone(loadTheatre(base.scenario.theatre));
    v.mut(sc, th, createRng(1000 + d * 17 + v.id.length), base);
    draws.push(evaluate({ ...base, scenario: sc, theatre: new Theatre(th) }));
  }
  const row: Row = { id: v.id, title: v.title, kind: v.kind, draws: v.draws, within: mean(draws.map((x) => x.within)), evHit: mean(draws.map((x) => x.evHit)), evErr: mean(draws.map((x) => x.evErr)), median: mean(draws.map((x) => x.median)) };
  rows.push(row);
  console.log(`  ${v.id}: в допуске ${(row.within * 100).toFixed(0)} % (${((row.within - baselineRow.within) * 100).toFixed(0)} п. п.), события ±2 сут ${(row.evHit * 100).toFixed(0)} %, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
mkdirSync(outDir, { recursive: true });
const result: Result = { scenario: scenarioId, seeds, tolerance: tol, baseline: baselineRow, rows, seconds: Math.round((Date.now() - t0) / 1000) };
writeFileSync(join(outDir, `${scenarioId}.json`), JSON.stringify(result, null, 1));
console.log(`готово, ${(result.seconds / 60).toFixed(1)} мин`);

function report() {
  const files = readdirSync(outDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')) as Result);
  const L = ['# Чувствительность к данным', '',
    'Что станет с сходством с историей, если данные хуже, чем есть (`npm run sim:data-sensitivity`); правила не меняются, прогонов на вариант — по числу seed.',
    'Падение — относительно исходных данных, п. п.; ошибка данных — средняя по двум выборкам ошибки.', ''];
  for (const r of files) {
    L.push(`## ${r.scenario}`, '', `Исходные данные: положения в допуске ±${r.tolerance} км — ${(r.baseline.within * 100).toFixed(0)} %, события ±2 сут — ${(r.baseline.evHit * 100).toFixed(0)} %, ошибка дат ${r.baseline.evErr.toFixed(2)} сут.`, '',
      '| Данные | Вид | Положения в допуске | Падение, п. п. | События ±2 сут | Падение, п. п. | Ошибка дат, сут |', '|---|---|---|---|---|---|---|');
    for (const x of [...r.rows].sort((a, b) => a.within - b.within)) {
      L.push(`| ${x.title} | ${x.kind === 'error' ? 'ошибка' : 'нет данных'} | ${(x.within * 100).toFixed(0)} % | ${((x.within - r.baseline.within) * 100).toFixed(1)} | ${(x.evHit * 100).toFixed(0)} % | ${((x.evHit - r.baseline.evHit) * 100).toFixed(0)} | ${x.evErr.toFixed(2)} |`);
    }
    L.push('');
  }
  writeFileSync(join(outDir, 'report.md'), L.join('\n'));
  console.log(`отчёт: ${join(outDir, 'report.md')}`);
}
