/**
 * Режимы боевых действий (rules.regimes): сравнение одинаковых режимов между операциями и калибровка по режимам.
 *
 * Мерило режима — темп: для каждой пары соседних исторических положений формирования (промежуток, где история
 * сдвинулась не меньше чем на 5 км) сравнивается пройденное в истории и в модели за те же сутки; режим промежутка —
 * тот, в котором формирование было чаще всего за эти ходы. Отношение темпов (история / модель) по режиму и операции —
 * 1, если темп режима верный. Темп, в отличие от отклонения положения, не копит ошибку прошлых суток (отставание после
 * медленного прорыва не приписывается следующему за ним преследованию). Раскладка промежутков по режимам — по прогону
 * с исходными правилами и дальше не меняется. Для справки — те же сведения по положениям (src/regimes.ts): превышение
 * отклонения над неопределённостью, доля в допуске, знаковое отставание вдоль оси движения.
 *
 * Калибровка — как сравнение: множитель режима подбирается по промежуткам своего режима на первой половине каждой
 * операции (вторая — проверка) и только если операции согласны: у каждой не меньше --min-legs промежутков обучения в
 * режиме на прогон, и есть значение, при котором у каждой отношение темпов в пределах ×/÷ AGREE от 1 (или не хуже её
 * лучшего значения более чем на 5 %). Из таких берётся значение с наименьшей суммой |ln отношения| (каждая операция —
 * равный вес). Нет согласия — множитель не меняется, режим отмечается как расхождение операций: искать причину в
 * данных. Согласованные множители затем принимаются прямым отбором — по одному, на каждом шаге лучший из оставшихся — по
 * полной проверке (5 прогонов, все положения и события обеих операций): ни одна операция не теряет против исходных правил
 * больше 3 п. п. положений в допуске и больше двух событий в пределах двух суток, а средняя по операциям доля положений
 * растёт не меньше чем на 2 п. п. (меньше — в пределах разброса прогонов); в сочетании множители могут мешать друг другу.
 * Принятые записываются в правила (--write).
 * Подбор покоординатный по сетке, два прохода; прогоны — в отдельных процессах.
 *
 *   npm run sim:regimes                     — только сравнение (evals-out/regimes/report.md)
 *   npm run sim:calibrate-regimes -- [--scenarios berlin-1945-tasks,vistula-oder-1945] [--seeds 3] [--jobs 4]
 *                                    [--min-legs 5] [--check-seeds 5] [--out evals-out/regimes-cal] [--write]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus } from 'node:os';
import { DATA_DIR, loadContext, loadHistory } from '../../src/data';
import { runScenario } from '../../src/history';
import { defaultTrainUntil, evaluateRules } from '../../src/calibrate';
import { dist } from '../../src/geo';
import { regimeDeviations, type RecordRegime } from '../../src/regimes';
import { COMBAT_REGIMES, REGIMES, REGIME_RU, type Regime, type RegimeParams, type Rules } from '../../src/types';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

/** Подбираемые множители: темп боя — в боевых режимах, темп движения — в режимах вне боя. */
const KEYS: [Regime, keyof RegimeParams][] = REGIMES.map((r) => [r, COMBAT_REGIMES.includes(r) ? 'advance' : 'speed']);
type Params = Partial<Record<Regime, RegimeParams>>;
/** Историческое положение, сравнённое с расчётом. */
interface Rec { scenario: string; seed: number; i: number; side: string; excess: number; lag: number | null; regime: RecordRegime; train: boolean }
/** Промежуток между соседними историческими положениями формирования: пройдено в истории и в модели. */
interface Leg { scenario: string; seed: number; id: string; side: string; regime: RecordRegime; h: number; m: number; days: number; train: boolean }
interface Out { recs: Rec[]; legs: Leg[] }

// процесс-исполнитель проверки: один сценарий, seed 1–5, заданные режимы → доля всех положений в допуске и события
if (args[0] === '--check') {
  const { scenario, regimes, seeds: n } = JSON.parse(args[1]) as { scenario: string; regimes: Params; seeds: number };
  const ctx = loadContext(scenario);
  const ev = evaluateRules(ctx, { ...ctx.rules, regimes }, loadHistory(scenario), { seeds: n, seed0: 1, toleranceKm: 10 });
  process.stdout.write(JSON.stringify({ within: ev.within, events: ev.events.flatMap((e) => e.days).filter((d) => d != null && Math.abs(d) <= 2).length }));
  process.exit(0);
}

// процесс-исполнитель: один сценарий, один seed, заданные режимы → положения и промежутки
if (args[0] === '--job') {
  const { scenario, seed, regimes } = JSON.parse(args[1]) as { scenario: string; seed: number; regimes: Params };
  const ctx = loadContext(scenario);
  ctx.rules = { ...ctx.rules, regimes };
  const tu = defaultTrainUntil(ctx), T = ctx.theatre, hist = loadHistory(scenario);
  const run = runScenario(ctx, seed), J = run.final.journal;
  const fs = new Map(ctx.scenario.formations.map((f) => [f.id, f]));
  const xy = (p: [number, number]) => T.proj.toXY(p);
  const byF = new Map<string, typeof hist.positions>();
  for (const p of [...hist.positions].sort((a, b) => a.time.localeCompare(b.time))) (byF.get(p.formation) ?? byF.set(p.formation, []).get(p.formation)!).push(p);
  // ось движения — от предыдущего исторического положения формирования (или исходного) к этому
  const prevOf = (id: string, time: string) => byF.get(id)?.filter((h) => h.time < time).pop()?.at ?? fs.get(id)?.position ?? null;
  const recs: Rec[] = regimeDeviations(ctx, run, hist).map((d, i) => {
    const u = run.snapshots.find((x) => x.time >= d.time)!.units.find((x) => x.id === d.formation)!;
    const h = byF.get(d.formation)!.find((x) => x.time === d.time)!, p0 = prevOf(d.formation, d.time);
    let lag: number | null = null;
    if (p0) {
      const a = xy(p0), b = xy(h.at), m = xy(u.at), ax = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(ax[0], ax[1]);
      if (L >= 3) lag = +(((b[0] - m[0]) * ax[0] + (b[1] - m[1]) * ax[1]) / L).toFixed(1);
    }
    return { scenario, seed, i, side: fs.get(d.formation)?.side ?? '', excess: Math.min(50, d.excessKm), lag, regime: d.regime, train: d.time <= tu };
  });
  const legs: Leg[] = [];
  for (const [fid, ps] of byF) for (let k = 1; k < ps.length; k++) {
    const a = ps[k - 1], b = ps[k];
    if (a.time < ctx.scenario.start) continue;
    const sa = run.snapshots.find((x) => x.time >= a.time), sb = run.snapshots.find((x) => x.time >= b.time);
    if (!sa || !sb || sa === sb) continue;
    const ua = sa.units.find((x) => x.id === fid), ub = sb.units.find((x) => x.id === fid);
    if (!ua || !ub || ua.destroyed || ub.destroyed) continue;
    const h = dist(xy(a.at), xy(b.at));
    if (h < 5) continue; // в истории стояли — темп не измерить
    const n: Record<string, number> = {};
    for (const j of J) {
      if (j.time < sa.time || j.time >= sb.time) continue;
      const r = j.kind === 'combat' && (j.attackers.includes(fid) || j.defenders.includes(fid)) ? j.regime ?? 'open' : j.kind === 'move' && j.formation === fid ? j.regime : undefined;
      if (r) n[r] = (n[r] ?? 0) + (j.kind === 'combat' ? 1.01 : 1); // бой и движение в один ход — по бою
    }
    const regime = (Object.entries(n).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'stand') as RecordRegime;
    legs.push({ scenario, seed, id: `${fid}|${a.time}`, side: fs.get(fid)?.side ?? '', regime, h, m: dist(xy(ua.at), xy(ub.at)), days: (Date.parse(sb.time + 'Z') - Date.parse(sa.time + 'Z')) / 864e5, train: b.time <= tu });
  }
  process.stdout.write(JSON.stringify({ recs, legs } satisfies Out));
  process.exit(0);
}

const compareOnly = args.includes('--compare');
const scenarios = opt('scenarios', 'berlin-1945-tasks,vistula-oder-1945').split(',');
const seeds = Array.from({ length: Number(opt('seeds', '3')) }, (_, k) => k + 1);
const jobs = Number(opt('jobs', String(Math.max(1, cpus().length))));
const outDir = resolve(opt('out', compareOnly ? 'evals-out/regimes' : 'evals-out/regimes-cal'));
const MIN_LEGS = Number(opt('min-legs', '5'));
/** Согласие: отношение темпов в пределах ×/÷ AGREE от 1 (или не хуже лучшего у операции более чем на 5 %). */
const AGREE = 1.15;
/** Падение доли положений в допуске на проверке, при котором найденное не записывается, п. п. */
const MAX_DROP = 3;
/** Потеря событий в пределах двух суток (по CHECK_SEEDS прогонам), при которой множитель не принимается. */
const MAX_EVENTS = 2;
/** Прогонов на полную проверку при отборе. */
const CHECK_SEEDS = Number(opt('check-seeds', '5'));
/** Прирост средней по операциям доли положений в допуске на проверке, меньше которого множитель не принимается (разброс трёх прогонов), п. п. */
const MIN_ACCEPT = 2;
const self = resolve(process.argv[1]);
const ctxs = new Map(scenarios.map((s) => [s, loadContext(s)]));
const rulesId = ctxs.get(scenarios[0])!.rules.id;
if (!compareOnly && scenarios.some((s) => ctxs.get(s)!.rules.id !== rulesId)) throw new Error('у сценариев должны быть одни правила');
const t0 = Date.now();
const min = () => ((Date.now() - t0) / 60000).toFixed(1);

function job(scenario: string, seed: number, regimes: Params): Promise<Out> { return child('--job', { scenario, seed, regimes }); }
function child<T>(mode: string, arg: unknown): Promise<T> {
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [...process.execArgv, self, mode, JSON.stringify(arg)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (b) => (out += b));
    p.on('close', (code) => (code === 0 ? ok(JSON.parse(out)) : fail(new Error(`${mode} ${JSON.stringify(arg).slice(0, 80)}: код ${code}`))));
  });
}
const len = (s: string) => Date.parse(ctxs.get(s)!.scenario.end) - Date.parse(ctxs.get(s)!.scenario.start);
/** Прогнать несколько вариантов режимов (каждый — все сценарии и seed), не больше jobs процессов разом. */
async function evaluate(variants: Params[]): Promise<Out[]> {
  const tasks = variants.flatMap((v, k) => scenarios.flatMap((s) => seeds.map((seed) => ({ k, s, seed, v })))).sort((a, b) => len(b.s) - len(a.s));
  const res: Out[] = variants.map(() => ({ recs: [], legs: [] }));
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < tasks.length) { const t = tasks[next++]; const o = await job(t.s, t.seed, t.v); res[t.k].recs.push(...o.recs); res[t.k].legs.push(...o.legs); }
  }));
  return res;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—');
const f2 = (x: number) => (!Number.isFinite(x) ? '—' : x > 20 ? '—' : x.toFixed(2).replace('.', ','));
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : '—');
const ruR = (r: RecordRegime) => (r === 'stand' ? 'стоит на месте' : REGIME_RU[r]);
const ruS = (s: string) => ctxs.get(s)!.scenario.name.split(/[,:]/)[0].replace(' операция', '');
const ruSide = (s: string) => (s === 'su' ? 'СССР' : 'Германия');

// исходная раскладка по режимам — по прогону с правилами сценария (их блок regimes, если есть)
const start: Params = JSON.parse(JSON.stringify(ctxs.get(scenarios[0])!.rules.regimes ?? {}));
const [base] = await evaluate([start]);
const recKey = (r: Rec) => `${r.scenario}|${r.seed}|${r.i}`, legKey = (l: Leg) => `${l.scenario}|${l.seed}|${l.id}`;
const recRegime = new Map(base.recs.map((r) => [recKey(r), r.regime])), legRegime = new Map(base.legs.map((l) => [legKey(l), l.regime]));
type Filter = { regime?: RecordRegime; train?: boolean; scenario?: string; side?: string };
const pass = (x: { train: boolean; scenario: string; side: string }, o: Filter) => (o.train == null || x.train === o.train) && (!o.scenario || x.scenario === o.scenario) && (!o.side || x.side === o.side);
const recs = (out: Out, o: Filter) => out.recs.filter((r) => pass(r, o) && (o.regime == null || recRegime.get(recKey(r)) === o.regime));
const legs = (out: Out, o: Filter) => out.legs.filter((l) => pass(l, o) && (o.regime == null || legRegime.get(legKey(l)) === o.regime));
/** Отношение темпов история / модель. */
const ratio = (out: Out, o: Filter) => { const l = legs(out, o); const m = l.reduce((a, x) => a + x.m, 0); return l.length ? l.reduce((a, x) => a + x.h, 0) / Math.max(0.1, m) : NaN; };
const pace = (l: Leg[], k: 'h' | 'm') => l.reduce((a, x) => a + x[k], 0) / Math.max(1e-9, l.reduce((a, x) => a + x.days, 0));
const excess = (out: Out, o: Filter) => mean(recs(out, o).map((r) => r.excess));
const within = (out: Out, s: string) => { const l = recs(out, { scenario: s, train: false }); return l.filter((x) => x.excess <= 10).length / Math.max(1, l.length); };
const nLegs = (o: Filter) => legs(base, o).length / seeds.length;

/** Сравнение одинаковых режимов между операциями (по сторонам): темп и положения. */
function compareTable(out: Out, title: string): string[] {
  const L = [`## ${title}`, '',
    'Темп: промежутков на прогон; исторический и модельный темп, км/сут; их отношение (больше 1 — модель медленнее истории). Положения: записей на прогон; среднее превышение отклонения над неопределённостью, км; доля в допуске; знаковое отставание вдоль оси движения, км (плюс — модель позади).', '',
    '| Режим | Сторона | ' + scenarios.map((s) => `${ruS(s)}: темп | ${ruS(s)}: положения`).join(' | ') + ' |', '|---|---|' + scenarios.map(() => '---|---|').join('')];
  for (const r of [...REGIMES, 'stand' as const]) for (const side of ['su', 'de']) {
    const cells = scenarios.flatMap((s) => {
      const l = legs(out, { regime: r, scenario: s, side }), p = recs(out, { regime: r, scenario: s, side });
      const lags = p.map((x) => x.lag).filter((x): x is number => x != null), lg = mean(lags);
      return [
        l.length ? `${f1(l.length / seeds.length)}; ${f1(pace(l, 'h'))} / ${f1(pace(l, 'm'))}; **${f2(ratio(out, { regime: r, scenario: s, side }))}**` : '—',
        p.length ? `${f1(p.length / seeds.length)}; ${f1(mean(p.map((x) => x.excess)))}; ${pct(p.filter((x) => x.excess <= 10).length / p.length)}; ${lags.length ? (lg > 0 ? '+' : '') + f1(lg) : '—'}` : '—',
      ];
    });
    if (cells.every((c) => c === '—')) continue;
    L.push(`| ${ruR(r)} | ${ruSide(side)} | ${cells.join(' | ')} |`);
  }
  return [...L, ''];
}

const L: string[] = [compareOnly ? '# Сравнение режимов боевых действий' : '# Калибровка по режимам', '',
  `Правила: ${[...new Set(scenarios.map((s) => ctxs.get(s)!.rules.id))].join(', ')}; операции: ${scenarios.map(ruS).join(', ')}; прогонов на вариант: ${seeds.length}. Режим промежутка (положения) — в каком режиме было формирование в эти ходы (в ход, когда снято положение), по прогону с исходными правилами. Допуск — 10 км сверх неопределённости положения.`, ''];

if (compareOnly) {
  L.push(...compareTable(base, 'Одинаковые режимы в разных операциях'));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.md'), L.join('\n'));
  console.log(L.join('\n'));
  console.log(`отчёт: ${join(outDir, 'report.md')}; ${min()} мин`);
  process.exit(0);
}

console.log(`промежутков обучения по режимам (на прогон): ${REGIMES.map((r) => `${REGIME_RU[r]} ${scenarios.map((s) => f1(nLegs({ regime: r, train: true, scenario: s }))).join('/')}`).join('; ')}`);

// покоординатный подбор: два прохода, второй — сетка вокруг найденного
let best: Params = JSON.parse(JSON.stringify(start));
const set = (p: Params, r: Regime, k: keyof RegimeParams, v: number): Params => ({ ...p, [r]: { ...p[r], [k]: v } });
const log: string[] = [];
const verdict = new Map<Regime, string>();
for (const [passNo, grid] of [[0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5], [0.85, 0.93, 1, 1.08, 1.17]].entries()) {
  for (const [r, k] of KEYS) {
    const voters = scenarios.filter((s) => nLegs({ regime: r, train: true, scenario: s }) >= MIN_LEGS);
    if (voters.length < 2) {
      if (!passNo) { const v = `мало промежутков для сравнения (${scenarios.map((s) => `${ruS(s)} — ${f1(nLegs({ regime: r, train: true, scenario: s }))}`).join(', ')}; нужно не меньше ${MIN_LEGS} в каждой) — не подбирается`; verdict.set(r, v); log.push(`${REGIME_RU[r]}: ${v}`); }
      continue;
    }
    if (passNo && verdict.get(r)?.startsWith('операции не согласны')) continue;
    const cur = best[r]?.[k] ?? 1;
    const vals = [...new Set(grid.map((g) => +(cur * g).toFixed(3)))];
    const res = await evaluate(vals.map((v) => set(best, r, k, v)));
    const curve = new Map(voters.map((s) => [s, res.map((o) => Math.abs(Math.log(ratio(o, { regime: r, train: true, scenario: s }))))]));
    const ok = vals.map((_, i) => voters.every((s) => { const c = curve.get(s)!; return c[i] <= Math.log(AGREE) || c[i] - Math.min(...c) <= Math.log(1.05); }));
    const line = `${REGIME_RU[r]}.${k}: ` + vals.map((v, i) => `${v}→${voters.map((s) => f2(Math.exp(curve.get(s)![i]))).join('/')}${ok[i] ? '✓' : ''}`).join('  ');
    if (!ok.some(Boolean)) {
      const o = voters.map((s) => { const c = curve.get(s)!; return `${ruS(s)} ×${vals[c.indexOf(Math.min(...c))]}`; }).join(', ');
      verdict.set(r, `операции не согласны (лучшее: ${o}) — множитель не меняется, искать причину в данных`);
      log.push(`${line}  ⇒ нет согласия (${o})  (${min()} мин)`); console.log(log[log.length - 1]);
      continue;
    }
    const cand = vals.map((v, i) => ({ i, v, c: voters.reduce((a, s) => a + curve.get(s)![i], 0) })).filter((x) => ok[x.i]);
    const cmin = Math.min(...cand.map((x) => x.c));
    // почти равные — ближайшее к текущему (разброс прогонов не тянет к краю сетки)
    const j = cand.filter((x) => x.c - cmin <= 0.03 * voters.length).sort((a, b) => Math.abs(Math.log(a.v / cur)) - Math.abs(Math.log(b.v / cur)))[0].i;
    best = set(best, r, k, vals[j]);
    verdict.set(r, `операции согласны: ×${vals[j]}`);
    log.push(`${line}  ⇒ ${vals[j]}  (${min()} мин)`); console.log(log[log.length - 1]);
  }
}

// отбор по полной проверке: согласованные по темпу множители в сочетании могут мешать друг другу (раньше пришли — иначе
// пошёл бой), поэтому они принимаются прямым отбором — на каждом шаге пробуются все оставшиеся, принимается лучший по
// средней доле положений в допуске, — если по полной проверке (CHECK_SEEDS прогонов, все положения и события обеих
// операций) ни одна операция не теряет против исходных правил больше MAX_DROP п. п. положений и больше MAX_EVENTS
// событий в пределах двух суток, а средняя доля растёт не меньше чем на MIN_ACCEPT п. п. Порядок не решает исход.
const fitted = KEYS.filter(([r, k]) => (best[r]?.[k] ?? 1) !== (start[r]?.[k] ?? 1));
type Check = Record<string, { within: number; events: number }>;
const check = async (variants: Params[]): Promise<Check[]> => {
  const tasks = variants.flatMap((v, k) => scenarios.map((s) => ({ k, s, v })));
  const res: Check[] = variants.map(() => ({}));
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < tasks.length) { const t = tasks[next++]; res[t.k][t.s] = await child('--check', { scenario: t.s, regimes: t.v, seeds: CHECK_SEEDS }); }
  }));
  return res;
};
const meanW = (c: Check) => mean(scenarios.map((s) => c[s].within));
const showC = (c: Check) => scenarios.map((s) => `${ruS(s)} ${pct(c[s].within)}, событий ${c[s].events}`).join('; ');
const [check0] = await check([start]);
const passes = (c: Check, prev: Check) => scenarios.every((s) => (check0[s].within - c[s].within) * 100 <= MAX_DROP && check0[s].events - c[s].events <= MAX_EVENTS) && (meanW(c) - meanW(prev)) * 100 >= MIN_ACCEPT;
log.push(`полная проверка исходных правил: ${showC(check0)}`); console.log(log[log.length - 1]);
let chosen: Params = JSON.parse(JSON.stringify(start)), chosenC = check0;
let left = [...fitted];
for (let step = 1; left.length; step++) {
  const cs = await check(left.map(([r, k]) => set(chosen, r, k, best[r]![k]!)));
  const tried = left.map(([r, k], i) => ({ r, k, c: cs[i], ok: passes(cs[i], chosenC) }));
  for (const t of tried) { const line = `отбор, шаг ${step}: ${REGIME_RU[t.r]} ×${best[t.r]![t.k]} — ${showC(t.c)}${t.ok ? '' : ' — не проходит'}  (${min()} мин)`; log.push(line); console.log(line); }
  const win = tried.filter((t) => t.ok).sort((a, b) => meanW(b.c) - meanW(a.c))[0];
  if (!win) break;
  chosen = set(chosen, win.r, win.k, best[win.r]![win.k]!); chosenC = win.c;
  log.push(`отбор, шаг ${step}: принят ${REGIME_RU[win.r]} ×${best[win.r]![win.k]}`); console.log(log[log.length - 1]);
  left = left.filter(([r]) => r !== win.r);
}
for (const [r] of left) verdict.set(r, `${verdict.get(r)}; по полной проверке не принят (не улучшает положения больше разброса прогонов или ухудшает положения либо события)`);
best = chosen;
const [after] = await evaluate([best]);
const accepted = fitted.some(([r, k]) => (best[r]?.[k] ?? 1) !== (start[r]?.[k] ?? 1));
L.push('## Итог по режимам', '', `Множитель подбирается, если в каждой операции не меньше ${MIN_LEGS} промежутков обучения в режиме на прогон и операции согласны (есть значение, при котором у каждой отношение темпов в пределах ×/÷${AGREE} от 1 или не хуже её лучшего более чем на 5 %). Отношение темпов — история / модель на промежутках режима.`, '',
  '| Режим | Множитель | Итог | ' + scenarios.map((s) => `${ruS(s)}: отношение темпов, обучение до → после; проверка до → после`).join(' | ') + ' |', '|---|---|---|' + scenarios.map(() => '---|').join(''));
for (const [r, k] of KEYS) {
  L.push(`| ${REGIME_RU[r]} | ${k === 'speed' ? 'темп движения' : 'темп боя'} ×${best[r]?.[k] ?? 1} | ${verdict.get(r) ?? '—'} | ` + scenarios.map((s) =>
    `${f2(ratio(base, { regime: r, train: true, scenario: s }))} → ${f2(ratio(after, { regime: r, train: true, scenario: s }))}; ${f2(ratio(base, { regime: r, train: false, scenario: s }))} → ${f2(ratio(after, { regime: r, train: false, scenario: s }))}`).join(' | ') + ' |');
}
L.push('', '## Положения, все записи', '', '| Операция | Превышение, обучение, км | Превышение, проверка, км | В допуске, проверка |', '|---|---|---|---|');
for (const s of scenarios) L.push(`| ${ruS(s)} | ${f1(excess(base, { train: true, scenario: s }))} → ${f1(excess(after, { train: true, scenario: s }))} | ${f1(excess(base, { train: false, scenario: s }))} → ${f1(excess(after, { train: false, scenario: s }))} | ${pct(within(base, s))} → ${pct(within(after, s))} |`);
L.push('', `Полная проверка (${CHECK_SEEDS} прогонов, все положения и события): исходные правила — ${showC(check0)}; итог — ${showC(chosenC)}.`, '', accepted ? `Принятые множители: ${KEYS.filter(([r, k]) => (best[r]?.[k] ?? 1) !== 1).map(([r, k]) => `${REGIME_RU[r]} ×${best[r]![k]}`).join(', ')} — записываются в правила (--write).` : 'Ни один множитель не принят — правила не меняются.', '');
L.push(...compareTable(base, 'Одинаковые режимы в разных операциях — до подбора'), ...compareTable(after, 'После подбора'));
L.push('## Ход подбора', '', 'Через «/» — отношение темпов (история / модель) на обучении у операций; ✓ — значение, приемлемое для каждой операции.', '', '```', ...log, '```', '');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.md'), L.join('\n'));
writeFileSync(join(outDir, 'regimes.json'), JSON.stringify({ regimes: best, verdict: Object.fromEntries(verdict), accepted, check: { before: check0, after: chosenC } }, null, 1));
console.log(L.join('\n'));
if (args.includes('--write')) {
  if (!accepted) console.log('в правила не записано: положения на проверке хуже');
  else {
    const file = join(DATA_DIR, 'rules', `${rulesId}.json`);
    const R = JSON.parse(readFileSync(file, 'utf8')) as Rules & Record<string, unknown>;
    R.regimes = Object.fromEntries(Object.entries(best).filter(([, v]) => v && Object.values(v).some((x) => x !== 1))) as Params;
    R._regimes_note = `режимы боевых действий: множители подобраны sim:calibrate-regimes по темпу на промежутках своего режима там, где операции согласны (${scenarios.join(', ')}, seed ${seeds.join(', ')}, обучение — первая половина операций); остальные режимы — 1`;
    writeFileSync(file, JSON.stringify(R, null, 2) + '\n');
    console.log('записано в', file);
  }
}
console.log(`готово, ${min()} мин`);
