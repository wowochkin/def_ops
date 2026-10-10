/**
 * Калибровка по режимам (rules.regimes): у каждого режима — свой множитель, и подбирается он только по записям
 * своего режима. Записи (положения из истории) раскладываются по режимам по прогону с исходными правилами — в каком
 * режиме было формирование в ход, когда снято положение (src/regimes.ts); раскладка дальше не меняется, чтобы подбор
 * не «улучшал» режим, вытесняя из него трудные записи. Обучение — первая половина каждой операции, проверка — вторая.
 * Подбор — покоординатный по сетке множителей, два прохода; прогоны идут параллельно в отдельных процессах.
 * Записанный результат — блок regimes в правилах (--write) и отчёт по режимам и операциям.
 *
 *   npm run sim:calibrate-regimes -- [--scenarios berlin-1945-tasks,vistula-oder-1945] [--seeds 3] [--jobs 4] [--min-records 30]
 *                                    [--out evals-out/regimes-cal] [--write]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus } from 'node:os';
import { DATA_DIR, loadContext, loadHistory } from '../../src/data';
import { runScenario } from '../../src/history';
import { defaultTrainUntil } from '../../src/calibrate';
import { regimeDeviations, type RecordRegime } from '../../src/regimes';
import { REGIME_RU, type Regime, type RegimeParams, type Rules } from '../../src/types';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

/** Подбираемые множители: темп боя в застройке, в полосе, на открытой местности; темп марша и преследования. */
const KEYS: [Regime, keyof RegimeParams][] = [['urban', 'advance'], ['belt', 'advance'], ['open', 'advance'], ['march', 'speed'], ['pursuit', 'speed']];
type Params = Partial<Record<Regime, RegimeParams>>;
interface Rec { scenario: string; seed: number; i: number; time: string; excess: number; regime: RecordRegime; train: boolean }

// процесс-исполнитель: один сценарий, один seed, заданные режимы → записи с отклонениями
if (args[0] === '--job') {
  const { scenario, seed, regimes } = JSON.parse(args[1]) as { scenario: string; seed: number; regimes: Params };
  const ctx = loadContext(scenario);
  ctx.rules = { ...ctx.rules, regimes };
  const tu = defaultTrainUntil(ctx);
  const recs: Rec[] = regimeDeviations(ctx, runScenario(ctx, seed), loadHistory(scenario))
    .map((d, i) => ({ scenario, seed, i, time: d.time, excess: Math.min(50, d.excessKm), regime: d.regime, train: d.time <= tu }));
  process.stdout.write(JSON.stringify(recs));
  process.exit(0);
}

const scenarios = opt('scenarios', 'berlin-1945-tasks,vistula-oder-1945').split(',');
const seeds = Array.from({ length: Number(opt('seeds', '3')) }, (_, k) => k + 1);
const jobs = Number(opt('jobs', String(Math.max(1, cpus().length))));
const outDir = resolve(opt('out', 'evals-out/regimes-cal'));
const self = resolve(process.argv[1]);
const rulesId = loadContext(scenarios[0]).rules.id;
if (scenarios.some((s) => loadContext(s).rules.id !== rulesId)) throw new Error('у сценариев должны быть одни правила');
const t0 = Date.now();

function job(scenario: string, seed: number, regimes: Params): Promise<Rec[]> {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [...process.execArgv, self, '--job', JSON.stringify({ scenario, seed, regimes })], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (b) => (out += b));
    p.on('close', (code) => (code === 0 ? ok(JSON.parse(out)) : fail(new Error(`${scenario}/${seed}: код ${code}`))));
  });
}
/** Прогнать несколько вариантов режимов (каждый — все сценарии и seed), не больше jobs процессов разом. */
async function evaluate(variants: Params[]): Promise<Rec[][]> {
  const tasks = variants.flatMap((v, k) => scenarios.flatMap((s) => seeds.map((seed) => ({ k, s, seed, v }))));
  // долгие сценарии — первыми
  const len = (s: string) => Date.parse(loadContextCache(s).scenario.end) - Date.parse(loadContextCache(s).scenario.start);
  tasks.sort((a, b) => len(b.s) - len(a.s));
  const res: Rec[][] = variants.map(() => []);
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < tasks.length) { const t = tasks[next++]; res[t.k].push(...(await job(t.s, t.seed, t.v))); }
  }));
  return res;
}
const ctxCache = new Map<string, ReturnType<typeof loadContext>>();
function loadContextCache(s: string) { if (!ctxCache.has(s)) ctxCache.set(s, loadContext(s)); return ctxCache.get(s)!; }

const key = (r: Rec) => `${r.scenario}|${r.seed}|${r.i}`;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

// исходная раскладка по режимам — по прогону без поправок режимов
const start: Params = Object.fromEntries(KEYS.map(([r]) => [r, {}]));
const [base] = await evaluate([start]);
const member = new Map(base.map((r) => [key(r), r.regime]));
const errOf = (recs: Rec[], regime: RecordRegime | null, train: boolean, scenario?: string) =>
  mean(recs.filter((r) => r.train === train && (!scenario || r.scenario === scenario) && (regime == null || member.get(key(r)) === regime)).map((r) => r.excess));
console.log(`исходная раскладка: ${KEYS.map(([r]) => `${REGIME_RU[r]} ${base.filter((x) => x.regime === r && x.train).length}`).join(', ')}, стоит ${base.filter((x) => x.regime === 'stand' && x.train).length} записей обучения`);

// покоординатный подбор: два прохода, второй — сетка уже вокруг найденного
let best: Params = JSON.parse(JSON.stringify(start));
// режим с малым числом записей обучения не подбирается (подгонка под несколько точек); разница меньше MIN_GAIN км
// считается неразличимой
const MIN_RECORDS = Number(opt('min-records', '30')), MIN_GAIN = 0.1;
const nTrain = (r: Regime) => base.filter((x) => x.train && x.regime === r).length;
const set = (p: Params, r: Regime, k: keyof RegimeParams, v: number): Params => ({ ...p, [r]: { ...p[r], [k]: v } });
const log: string[] = [];
for (const grid of [[0.5, 0.65, 0.8, 1, 1.25, 1.5, 2], [0.85, 0.93, 1, 1.08, 1.17]]) {
  for (const [r, k] of KEYS) {
    if (nTrain(r) < MIN_RECORDS) { if (grid[0] === 0.5) log.push(`${REGIME_RU[r]}: записей обучения ${nTrain(r)} < ${MIN_RECORDS} — не подбирается`); continue; }
    const cur = best[r]?.[k] ?? 1;
    const vals = [...new Set(grid.map((g) => +(cur * g).toFixed(3)))];
    const res = await evaluate(vals.map((v) => set(best, r, k, v)));
    const scores = res.map((recs) => errOf(recs, r, true));
    if (scores.every((x) => Number.isNaN(x))) continue; // записей режима нет
    // из значений не хуже лучшего более чем на MIN_GAIN — ближайшее к текущему (разброс прогонов не тянет к краю сетки)
    const m = Math.min(...scores.filter((x) => !Number.isNaN(x)));
    const j = vals.map((v, i) => ({ i, d: Math.abs(Math.log(v / cur)) })).filter(({ i }) => scores[i] - m <= MIN_GAIN).sort((a, b) => a.d - b.d)[0].i;
    best = set(best, r, k, vals[j]);
    const line = `${REGIME_RU[r]}.${k}: ${vals.map((v, i) => `${v}→${scores[i].toFixed(2)}`).join('  ')}  ⇒ ${vals[j]}  (${((Date.now() - t0) / 60000).toFixed(1)} мин)`;
    console.log(line); log.push(line);
  }
}

// итог: до и после — по режимам и операциям, обучение и проверка
const [after] = await evaluate([best]);
const L = ['# Калибровка по режимам', '',
  `Правила ${rulesId}; операции: ${scenarios.join(', ')}; seed ${seeds.join(', ')}. Ошибка — среднее превышение отклонения положения над его неопределённостью, км (не больше 50); обучение — первая половина операции, проверка — вторая. Раскладка записей по режимам — по прогону с исходными правилами.`, '',
  '## Найденные множители', '', '| Режим | Множитель | Значение |', '|---|---|---|',
  ...KEYS.map(([r, k]) => `| ${REGIME_RU[r]} | ${k === 'speed' ? 'темп движения' : 'темп в бою'} | ${best[r]?.[k] ?? 1} |`), '',
  '## Ошибка по режимам, км', '', '| Режим | Операция | Записей (обуч./пров.) | Обучение до → после | Проверка до → после |', '|---|---|---|---|---|'];
for (const r of [...KEYS.map(([x]) => x), 'stand' as const]) for (const s of scenarios) {
  const n = (t: boolean) => base.filter((x) => x.scenario === s && x.train === t && x.regime === r).length;
  if (!n(true) && !n(false)) continue;
  const f = (x: number) => (Number.isNaN(x) ? '—' : x.toFixed(1));
  L.push(`| ${r === 'stand' ? 'стоит' : REGIME_RU[r]} | ${s} | ${n(true)} / ${n(false)} | ${f(errOf(base, r, true, s))} → ${f(errOf(after, r, true, s))} | ${f(errOf(base, r, false, s))} → ${f(errOf(after, r, false, s))} |`);
}
L.push('', '## Все записи', '', '| Операция | Обучение до → после | Проверка до → после | В допуске 10 км, проверка до → после |', '|---|---|---|---|');
const within = (recs: Rec[], s: string) => { const l = recs.filter((x) => x.scenario === s && !x.train); return (100 * l.filter((x) => x.excess <= 10).length / Math.max(1, l.length)).toFixed(0) + ' %'; };
for (const s of scenarios) L.push(`| ${s} | ${errOf(base, null, true, s).toFixed(1)} → ${errOf(after, null, true, s).toFixed(1)} | ${errOf(base, null, false, s).toFixed(1)} → ${errOf(after, null, false, s).toFixed(1)} | ${within(base, s)} → ${within(after, s)} |`);
L.push('', '## Ход подбора', '', `Режим с записями обучения меньше ${MIN_RECORDS} не подбирается; из значений не хуже лучшего более чем на ${MIN_GAIN} км берётся ближайшее к текущему.`, '', '```', ...log, '```', '');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.md'), L.join('\n'));
writeFileSync(join(outDir, 'regimes.json'), JSON.stringify(best, null, 1));
console.log(L.join('\n'));
if (args.includes('--write')) {
  const file = join(DATA_DIR, 'rules', `${rulesId}.json`);
  const R = JSON.parse(readFileSync(file, 'utf8')) as Rules & Record<string, unknown>;
  R.regimes = best;
  R._regimes_note = `режимы боевых действий: множители подобраны sim:calibrate-regimes по записям своего режима (${scenarios.join(', ')}, seed ${seeds.join(', ')}, обучение — первая половина операций)`;
  writeFileSync(file, JSON.stringify(R, null, 2) + '\n');
  console.log('записано в', file);
}
console.log(`готово, ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
