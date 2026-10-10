/**
 * Анализ чувствительности арбитра: какие из 11 множителей калибровки вообще влияют на сходство с
 * историей и насколько сильнее шума от seed. Два приёма:
 *  — глобальный скрининг Морриса (траектории по сетке в границах подбора калибровки): среднее
 *    абсолютное элементарное влияние μ* и разброс σ (σ велико — влияние нелинейно или зависит от
 *    остальных множителей);
 *  — локальные отклонения ±20 % от текущих (откалиброванных) значений — что даст тонкая подстройка.
 * Шум: тот же набор правил на разных seed. Все точки считаются на одних и тех же seed (общие случайные
 * числа), поэтому разности точек точнее, чем разброс между seed.
 *
 *   npm run sim:sensitivity -- --scenario berlin-1945-tasks --part morris [--r 8] [--seeds 2] [--out evals-out/sensitivity]
 *   npm run sim:sensitivity -- --scenario berlin-1945-tasks --part local            # локальные ±20 % и шум
 *   npm run sim:sensitivity -- --report                                              # свести файлы в report.md
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadContext, loadHistory } from '../../src/data';
import { baseParams, CALIB_INFO, CALIB_KEYS, CALIB_SPACE, evaluateRules, rulesWith, type CalibKey, type CalibParams } from '../../src/calibrate';
import { createRng } from '../../src/rng';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const outDir = resolve(opt('out', 'evals-out/sensitivity')!);

const METRICS = ['within', 'median', 'evHit', 'evErr', 'obj'] as const;
type Metric = typeof METRICS[number];
type Vals = Record<Metric, number>;
const METRIC_RU: Record<Metric, string> = {
  within: 'доля положений в допуске', median: 'медиана превышения, км', evHit: 'доля событий в пределах ±2 сут', evErr: 'ошибка дат событий, сут', obj: 'мерило калибровки',
};
const TOLERANCE: Record<string, number> = { 'berlin-1945-tasks': 10, 'berlin-city-1945': 2, 'vistula-oder-1945': 10 };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

interface PartResult {
  scenario: string; part: 'morris' | 'local'; seeds: number; tolerance: number; points: number; seconds: number;
  baseline: Vals;
  morris?: { r: number; levels: number; keys: Record<string, Record<Metric, { mu: number; muStar: number; sigma: number; seMuStar: number }>> };
  local?: { rel: number; keys: Record<string, { from: number; lo: number; hi: number; swing: Vals }>; noise: Record<Metric, { mean: number; sd: number }>; noiseRuns: number };
}

if (args.includes('--report')) { report(); process.exit(0); }

const scenarioId = opt('scenario', 'berlin-1945-tasks')!;
const part = (opt('part', 'morris') as 'morris' | 'local');
const seeds = Number(opt('seeds', '2'));
const tol = TOLERANCE[scenarioId] ?? 10;
const ctx = loadContext(scenarioId);
const history = loadHistory(scenarioId);
let points = 0;
const t0 = Date.now();

function measure(p: CalibParams, seed0 = 1, n = seeds): Vals {
  const ev = evaluateRules(ctx, rulesWith(ctx.rules, p), history, { seeds: n, seed0, toleranceKm: tol });
  const days = ev.events.flatMap((e) => e.days);
  points++;
  return {
    within: ev.within, median: ev.medianExcessKm,
    evHit: days.filter((d) => d != null && Math.abs(d) <= 2).length / Math.max(1, days.length),
    evErr: mean(days.map((d) => (d == null ? 6 : Math.min(6, Math.abs(d))))),
    obj: ev.score.total,
  };
}

const base = baseParams(ctx.rules);
const baseline = measure(base);
console.log(`${scenarioId} [${part}]: исходные правила — в допуске ${(baseline.within * 100).toFixed(0)} %, события ±2 сут ${(baseline.evHit * 100).toFixed(0)} %, ${((Date.now() - t0) / 1000).toFixed(0)} с на точку`);

const result: PartResult = { scenario: scenarioId, part, seeds, tolerance: tol, points: 0, seconds: 0, baseline };

if (part === 'morris') {
  const r = Number(opt('r', '8')), p = 4, delta = p / (2 * (p - 1));
  const rng = createRng(Number(opt('design-seed', '7')));
  const toParams = (x: number[]) => Object.fromEntries(CALIB_KEYS.map((k, i) => [k, CALIB_SPACE[k][0] + x[i] * (CALIB_SPACE[k][1] - CALIB_SPACE[k][0])])) as CalibParams;
  const ee = Object.fromEntries(CALIB_KEYS.map((k) => [k, Object.fromEntries(METRICS.map((m) => [m, [] as number[]]))])) as Record<CalibKey, Record<Metric, number[]>>;
  for (let t = 0; t < r; t++) {
    const x = CALIB_KEYS.map(() => Math.floor(rng.next() * p) / (p - 1));
    let y = measure(toParams(x));
    const order = CALIB_KEYS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const i of order) {
      const up = x[i] + delta <= 1 + 1e-9, down = x[i] - delta >= -1e-9;
      const d = up && (!down || rng.next() < 0.5) ? delta : -delta;
      x[i] += d;
      const y2 = measure(toParams(x));
      for (const m of METRICS) ee[CALIB_KEYS[i]][m].push((y2[m] - y[m]) / d);
      y = y2;
    }
    console.log(`  траектория ${t + 1}/${r}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  result.morris = {
    r, levels: p,
    keys: Object.fromEntries(CALIB_KEYS.map((k) => [k, Object.fromEntries(METRICS.map((m) => {
      const e = ee[k][m], a = e.map(Math.abs);
      return [m, { mu: mean(e), muStar: mean(a), sigma: sd(e), seMuStar: sd(a) / Math.sqrt(Math.max(1, a.length)) }];
    }))])),
  };
} else {
  const rel = Number(opt('rel', '0.2'));
  const clamp = (k: CalibKey, v: number) => Math.min(CALIB_SPACE[k][1], Math.max(CALIB_SPACE[k][0], v));
  const keys: NonNullable<PartResult['local']>['keys'] = {};
  for (const k of CALIB_KEYS) {
    const lo = clamp(k, base[k] * (1 - rel)), hi = clamp(k, base[k] * (1 + rel));
    const yl = measure({ ...base, [k]: lo }), yh = measure({ ...base, [k]: hi });
    keys[k] = { from: base[k], lo, hi, swing: Object.fromEntries(METRICS.map((m) => [m, yh[m] - yl[m]])) as Vals };
    console.log(`  ${k}: в допуске ${(yl.within * 100).toFixed(0)} → ${(yh.within * 100).toFixed(0)} %, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  const nRuns = Number(opt('noise-runs', '5'));
  const per = Array.from({ length: nRuns }, (_, i) => measure(base, 1 + i, 1));
  result.local = { rel, keys, noiseRuns: nRuns, noise: Object.fromEntries(METRICS.map((m) => [m, { mean: mean(per.map((v) => v[m])), sd: sd(per.map((v) => v[m])) }])) as Record<Metric, { mean: number; sd: number }> };
}

result.points = points; result.seconds = Math.round((Date.now() - t0) / 1000);
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${scenarioId}.${part}.json`);
writeFileSync(file, JSON.stringify(result, null, 1));
console.log(`готово: ${points} точек, ${(result.seconds / 60).toFixed(1)} мин → ${file}`);

function report() {
  const files = readdirSync(outDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')) as PartResult);
  const scen = [...new Set(files.map((f) => f.scenario))];
  const L: string[] = ['# Анализ чувствительности арбитра', '',
    'Какие из 11 множителей калибровки влияют на сходство с историей (`npm run sim:sensitivity`). Скрининг Морриса — по границам подбора калибровки;',
    'локальные отклонения — ±20 % от откалиброванных значений. Все точки считаются на одних и тех же seed.', ''];
  for (const s of scen) {
    const m = files.find((f) => f.scenario === s && f.part === 'morris'), l = files.find((f) => f.scenario === s && f.part === 'local');
    L.push(`## ${s}`, '');
    const ref = m ?? l!;
    L.push(`Допуск ${ref.tolerance} км, прогонов на точку: ${ref.seeds}. Исходные правила: ${(ref.baseline.within * 100).toFixed(0)} % положений в допуске, события ±2 сут — ${(ref.baseline.evHit * 100).toFixed(0)} %, ошибка дат ${ref.baseline.evErr.toFixed(2)} сут.`);
    if (l) L.push(`Шум одного прогона (${l.local!.noiseRuns} seed): положения в допуске ±${(l.local!.noise.within.sd * 100).toFixed(1)} п. п. (σ), события ±2 сут ±${(l.local!.noise.evHit.sd * 100).toFixed(0)} п. п., ошибка дат ±${l.local!.noise.evErr.sd.toFixed(2)} сут.`);
    L.push('');
    const rows = CALIB_KEYS.map((k) => ({ k, a: m?.morris!.keys[k], b: l?.local!.keys[k] }))
      .sort((x, y) => (y.a?.within.muStar ?? Math.abs(y.b?.swing.within ?? 0)) - (x.a?.within.muStar ?? Math.abs(x.b?.swing.within ?? 0)));
    L.push('| Множитель | Положения: μ* (п. п. на весь диапазон) | σ | События ±2 сут: μ* (п. п.) | Мерило: μ* | Локально ±20 %: положения (п. п.) | события (п. п.) | локально / шум |', '|---|---|---|---|---|---|---|---|');
    const noise = l?.local!.noise.within.sd ?? 0;
    for (const { k, a, b } of rows) {
      const pp = (x: number) => (x * 100).toFixed(1);
      L.push(`| ${CALIB_INFO[k].title} (\`${k}\`) | ${a ? `${pp(a.within.muStar)} ± ${pp(a.within.seMuStar)}` : '—'} | ${a ? pp(a.within.sigma) : '—'} | ${a ? pp(a.evHit.muStar) : '—'} | ${a ? a.obj.muStar.toFixed(1) : '—'} | ${b ? pp(b.swing.within) : '—'} | ${b ? pp(b.swing.evHit) : '—'} | ${b && noise ? (Math.abs(b.swing.within) / noise).toFixed(1) : '—'} |`);
    }
    L.push('');
  }
  L.push('μ* — среднее абсолютное элементарное влияние (изменение показателя при сдвиге множителя на весь диапазон подбора), σ — разброс влияния (велик — влияние нелинейно или зависит от остальных множителей); «локально / шум» — размах показателя при ±20 %, делённый на σ шума одного прогона.');
  writeFileSync(join(outDir, 'report.md'), L.join('\n'));
  console.log(`отчёт: ${join(outDir, 'report.md')}`);
}
