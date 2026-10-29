/**
 * Калибровка агентной модели перебором: случайные сочетания параметров agents-v0 в заданных пределах (допущения — в
 * разумных пределах вокруг нынешнего значения, параметры с источником — в коридоре норматива), каждое — прогоны ядра
 * на нескольких seed и тот же итог сверки, что у score.ts (agentsScore). Подбор — на Берлинской; лучшие сочетания
 * проверяются на десяти seed и на Зееловских высотах, контроль — Висло-Одерская (в подбор не входит).
 *
 *   npx tsx packages/sim/tools/agents/calibrate.ts --samples 200 --seeds 1,2,3 --jobs 4 --out evals-out/calib/r1
 *   npx tsx packages/sim/tools/agents/calibrate.ts --around evals-out/calib/r1 --scale 0.15 --samples 100 --out evals-out/calib/r2
 *   npx tsx packages/sim/tools/agents/calibrate.ts --mode commanders --samples 200 --out evals-out/calib/cmd1   (пространство — числа commanders.json с range)
 *   npx tsx packages/sim/tools/agents/calibrate.ts --refine evals-out/calib/r2 --top 8
 *   npx tsx packages/sim/tools/agents/calibrate.ts --mode commanders --keys '^commanders\.(mood|gains)\.' …   (только ключи по выражению; прочие — как в файлах)
 *   npx tsx packages/sim/tools/agents/calibrate.ts --measure --mode agents --seeds 1-20 [--scenario berlin] [--params '{…}'] [--keep evals-out/calib/m-agents] --out evals-out/calib/m
 *   npx tsx packages/sim/tools/agents/calibrate.ts --measure --mode fronts --scenario-file evals-out/exp/x.json …   (свой файл сценария, сверка с историей Берлинской)
 *   npx tsx packages/sim/tools/agents/calibrate.ts --measure --mode agents --side both …   (штабы-агенты обеих сторон, без командующих)
 *
 * Пишет построчно <out>/samples.jsonl ({ params, total, positions, events, meanKm, eventDays, runs }), <out>/refine.jsonl
 * и <out>/measure.jsonl (замер: итог, положения, события и непрерывные меры — средняя ошибка положений, км; средняя
 * ошибка сроков наступивших событий, сутки; по каждому прогону).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../../src/data';
import { contextFrom } from '../../src/source';
import { agentsScore } from '../../src/agents-score';
import type { AgentHistory, AgentTrace } from '../../src/agents';
import { commandersSpace, commandersValues } from './commanders-space';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

/** Пространство поиска: путь параметра → [нижний, верхний]; целые — шаг 1. */
export const SPACE: Record<string, [number, number, 'int'?]> = {
  // окружение (допущения)
  'pocket.zocKm': [3, 8], 'pocket.holdKm': [6, 18], 'pocket.ownKm': [2, 5], 'pocket.linkKm': [3, 10],
  'pocket.encircleHours': [12, 48, 'int'], 'pocket.releaseHours': [6, 24, 'int'],
  // слаженность, потери, остановка атаки (допущения; показатель перевеса — в пределах Дюпюи 0–0,8)
  'cohesion.recoverPerHour': [0.005, 0.03], 'cohesion.combatLossFactor': [1.5, 5], 'routThreshold.cohesion': [0.1, 0.3],
  'attackStop.ammo': [0.1, 0.3], 'combat.attackerRatioExp': [0, 0.8], 'combat.defenderRatio.capDay': [0.3, 0.7],
  // развёртывание, полосы, соприкосновение, ночной марш (допущения)
  'deployHours.rifle': [2, 6], 'deployHours.tank': [1, 4], 'frontageKm.rifle': [4, 9], 'contactKm': [3, 6], 'march.nightFactor': [0.5, 1],
  // советские штабы: допущения и параметры в коридоре источника
  'command.su.mainBlowShare': [0.5, 0.8], 'command.su.secondEchelonBehindKm': [3, 10],
  'doctrine.su.firstEchelonShare': [0.55, 0.75], 'doctrine.su.commitDepthKm': [6, 8], 'doctrine.su.secondEchelonFallbackHours': [24, 72],
  'doctrine.su.tankCommitDepthKm': [13, 17], 'doctrine.su.tankCommitFallbackHours': [24, 72],
};

const SCEN: Record<string, { path: string; base: string }> = {
  berlin: { path: 'packages/sim/data/scenarios/agents/berlin-1945.json', base: 'berlin-1945-tasks' },
  seelow: { path: 'packages/sim/data/scenarios/agents/seelow-1945.json', base: 'berlin-1945-tasks' },
  'vistula-oder': { path: 'packages/sim/data/scenarios/agents/vistula-oder-1945.json', base: 'vistula-oder-1945' },
};
// --scenario-file <путь>: свой файл сценария вместо стандартного (опыты с изменёнными распоряжениями); сверка — по истории --scenario
if (opt('scenario-file')) SCEN[opt('scenario', 'berlin')!].path = opt('scenario-file')!;
const mode = opt('mode', 'fronts')!;
const keysRe = opt('keys') ? new RegExp(opt('keys')!) : null;
const space = Object.fromEntries(Object.entries(mode === 'commanders' ? commandersSpace() : SPACE).filter(([k]) => !keysRe || keysRe.test(k)));
const current: Record<string, number> = mode === 'commanders' ? commandersValues() : {};
const jobs = +opt('jobs', '4')!;
const BIN = resolve(ROOT, 'target/release/agents-run');

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  if (kind === 'infrastructure') return null;
  return loadRules(id);
};
const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;
const ctxs = new Map<string, Awaited<ReturnType<typeof contextFrom>>>();
const hists = new Map<string, AgentHistory>();
async function score(sc: string, trace: AgentTrace) {
  if (!ctxs.has(SCEN[sc].base)) ctxs.set(SCEN[sc].base, await contextFrom(get, SCEN[sc].base));
  if (!hists.has(sc)) hists.set(sc, rd<AgentHistory>(`packages/sim/data/scenarios/agents/${sc}-1945.history.json`));
  const { ctx, history } = ctxs.get(SCEN[sc].base)!;
  const s = agentsScore(ctx, trace, hists.get(sc)!, history);
  return { total: s.score, positions: s.within, events: s.eventsTotal ? s.eventsHit / s.eventsTotal : 0, meanKm: s.meanKm, eventDays: s.meanEventDays, occurred: s.eventsOccurred, eventDetail: s.events };
}

let tmpN = 0;
/** Прогон ядра: сценарий, seed, поправки; ход — во временную папку, после сверки удаляется. */
function run(sc: string, seed: number, params: Record<string, number>, keepDir?: string): Promise<string> {
  const out = keepDir ? `${keepDir}/${sc}-${seed}` : `evals-out/calib/tmp/${process.pid}-${tmpN++}`;
  // commanders — обе стороны (с --side su|de — только она), прочие режимы — советская сторона (--side both — обе)
  const extra = mode === 'script' ? [] : mode === 'commanders' ? ['--command', mode, ...(opt('side') ? ['--side', opt('side')!] : [])] : ['--command', mode, '--side', opt('side', 'su')!];
  return new Promise((ok, fail) => {
    const p = spawn(BIN, ['--scenario', SCEN[sc].path, '--seed', String(seed), '--runs', '1', '--out', out, ...extra, ...(Object.keys(params).length ? ['--params', JSON.stringify(params)] : [])], { cwd: ROOT, stdio: 'ignore' });
    p.on('exit', (c) => (c === 0 ? ok(out) : fail(new Error(`agents-run: код ${c}`))));
  });
}

/** Средние итоги сочетания по сценарию и seed; прогоны — параллельно по `jobs`. */
async function evaluate(sc: string, seeds: number[], params: Record<string, number>, keepDir?: string) {
  const res: Awaited<ReturnType<typeof score>>[] = [];
  for (let k = 0; k < seeds.length; k += jobs) {
    const outs = await Promise.all(seeds.slice(k, k + jobs).map((s) => run(sc, s, params, keepDir)));
    for (const o of outs) {
      res.push(await score(sc, rd<AgentTrace>(`${o}/trace.json`)));
      if (!keepDir) rmSync(resolve(ROOT, o), { recursive: true, force: true });
    }
  }
  const m = (f: (x: (typeof res)[number]) => number) => +(res.reduce((s, x) => s + f(x), 0) / res.length).toFixed(4);
  const withDays = res.filter((x) => x.eventDays != null);
  return {
    total: m((x) => x.total), positions: m((x) => x.positions), events: m((x) => x.events), meanKm: +m((x) => x.meanKm).toFixed(1),
    eventDays: withDays.length ? +(withDays.reduce((s, x) => s + x.eventDays!, 0) / withDays.length).toFixed(2) : null, occurred: +m((x) => x.occurred).toFixed(1),
    runs: res.map((x) => +x.total.toFixed(3)), eventDetail: res.map((x) => Object.fromEntries(x.eventDetail.map((e) => [e.id, e.days]))),
  };
}

/** Детерминированный генератор (mulberry32): тот же --rng — те же сочетания. */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sample = (r: () => number) => Object.fromEntries(Object.entries(space).map(([k, [lo, hi, int]]) => {
  const v = lo + (hi - lo) * r();
  return [k, int ? Math.round(v) : +v.toFixed(3)];
}));

/** Список seed: «1,2,3» или «1-20». */
const seedsOf = (s: string) => s.split(',').flatMap((x) => { const [a, b] = x.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
if (args.includes('--measure')) {
  const dir = resolve(ROOT, opt('out', 'evals-out/calib/measure')!);
  mkdirSync(dir, { recursive: true });
  const sc = opt('scenario', 'berlin')!;
  const params = opt('params') ? JSON.parse(opt('params')!) as Record<string, number> : {};
  const keep = opt('keep');
  if (keep) mkdirSync(resolve(ROOT, keep), { recursive: true });
  const seeds = seedsOf(opt('seeds', '1-20')!);
  const t0 = Date.now();
  const e = await evaluate(sc, seeds, params, keep);
  const { eventDetail, ...brief } = e;
  appendFileSync(`${dir}/measure.jsonl`, JSON.stringify({ mode, side: opt('side') ?? null, scenario: sc, seeds, params, ...e }) + '\n');
  console.log(JSON.stringify({ mode, side: opt('side') ?? null, scenario: sc, n: seeds.length, ...brief, sec: Math.round((Date.now() - t0) / 1000) }));
  void eventDetail;
} else if (opt('refine')) {
  const dir = resolve(ROOT, opt('refine')!);
  const rows = readFileSync(`${dir}/samples.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { params: Record<string, number>; total: number });
  const top = [{ params: {}, total: NaN }, ...rows.filter((r) => Object.keys(r.params).length).sort((a, b) => b.total - a.total).slice(0, +opt('top', '8')!)];
  for (const [k, r] of top.entries()) {
    const berlin = await evaluate('berlin', seedsOf(opt('seeds', '1,2,3,4,5,6,7,8,9,10')!), r.params);
    const seelow = await evaluate('seelow', [1, 2, 3, 4, 5], r.params);
    const vistula = await evaluate('vistula-oder', [1, 2, 3, 4, 5], r.params);
    const strip = <T extends { eventDetail: unknown }>(x: T) => { const { eventDetail, ...rest } = x; void eventDetail; return rest; };
    const line = { k, params: r.params, berlin: strip(berlin), seelow: strip(seelow), vistula: strip(vistula) };
    appendFileSync(`${dir}/refine.jsonl`, JSON.stringify(line) + '\n');
    console.log(`${k === 0 ? 'база' : `#${k}`}: Берлинская ${berlin.total} (положения ${berlin.positions}, события ${berlin.events}); Зееловские ${seelow.total}; Висло-Одерская ${vistula.total}`);
  }
} else {
  const dir = resolve(ROOT, opt('out', 'evals-out/calib/r1')!);
  mkdirSync(dir, { recursive: true });
  const n = +opt('samples', '100')!;
  const seeds = seedsOf(opt('seeds', '1,2,3')!);
  const r = rng(+opt('rng', '7')!);
  // --around <папка>: второй этап — вокруг лучшего сочетания той папки, сдвиг на ±scale диапазона параметра
  const around = opt('around') ? readFileSync(resolve(ROOT, opt('around')!, 'samples.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { params: Record<string, number>; total: number }).sort((a, b) => b.total - a.total)[0]?.params : undefined;
  const scale = +opt('scale', '0.15')!;
  const near = (c: Record<string, number>) => Object.fromEntries(Object.entries(space).map(([k, [lo, hi, int]]) => {
    const base = c[k] ?? current[k] ?? lo + (hi - lo) / 2;
    const v = Math.min(hi, Math.max(lo, base + (r() * 2 - 1) * scale * (hi - lo)));
    return [k, int ? Math.round(v) : +v.toFixed(3)];
  }));
  const done = existsSync(`${dir}/samples.jsonl`) ? readFileSync(`${dir}/samples.jsonl`, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  // продолжение прерванного перебора: те же сочетания по порядку, готовые пропускаются
  for (let k = 0; k < n; k++) {
    const params = k === 0 ? (around ?? {}) : around ? near(around) : sample(r);
    if (k < done) continue;
    const t0 = Date.now();
    const e = await evaluate('berlin', seeds, params);
    const { eventDetail, ...row } = e; void eventDetail;
    appendFileSync(`${dir}/samples.jsonl`, JSON.stringify({ k, params, ...row }) + '\n');
    console.log(`${k}/${n} итог ${e.total} (положения ${e.positions}, события ${e.events}) за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
}
