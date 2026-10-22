// Сверка легенды с картой на всех уровнях: Берлинская операция на нынешней модели и на агентной (ядро —
// target/release/agents-game), каждые сутки. Для каждого уровня и часа:
//   — знаки на карте, которых нет ни в одной строке легенды уровня («без строки»);
//   — строки легенды, чьих знаков на карте нет («пустая строка»);
//   — строки, чьи знаки на карте есть, а строки в легенде нет («строки нет»).
//
//   npx tsx scripts/legend-check.ts [--scenario berlin-1945-tasks] [--only legacy|agents] [--out файл.md]
// Код выхода 1 — есть расхождения.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MapDocument } from '../packages/core/src/index';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../packages/sim/src/data';
import { contextFrom } from '../packages/sim/src/source';
import { analyze } from '../packages/sim/src/report';
import { agentsHistory, agentsToRun, type AgentTrace } from '../packages/sim/src/agents';
import { runToDocument } from '../packages/sim/src/publish';
import { legendFor, legendGaps, legendText, presentItems } from '../apps/editor/src/map-legend';
import { withLevel } from '../apps/editor/src/map-levels';
import type { LevelId } from '../apps/editor/src/map-level-scale';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SCENARIO = arg('--scenario', 'berlin-1945-tasks')!;
const ONLY = arg('--only');
const LEVELS: LevelId[] = ['stavka', 'front', 'army', 'corps', 'division'];
const RU: Record<LevelId, string> = { stavka: 'Ставка', front: 'Фронт', army: 'Армия', corps: 'Корпус', division: 'Дивизия' };

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};

/** Прогон ядра агентной модели (как run_scenario приложения). */
function agentTrace(path: string, seed: number): Promise<AgentTrace> {
  const p = spawn(join(ROOT, 'target/release/agents-game'), [], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, DEFOPS_ROOT: ROOT } });
  return new Promise((res, rej) => {
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      const r = JSON.parse(buf.slice(0, i));
      p.stdin.end();
      if ('error' in r) rej(new Error(r.error)); else res(r.ok);
    });
    p.on('error', rej);
    p.stdin.write(`${JSON.stringify({ cmd: 'run_scenario', args: { scenario: path, seed } })}\n`);
  });
}

async function docs(): Promise<{ model: string; doc: MapDocument }[]> {
  const { ctx, history } = await contextFrom(get as never, SCENARIO);
  const out: { model: string; doc: MapDocument }[] = [];
  if (ONLY !== 'agents') {
    const a = analyze(ctx, history, { seed: 1, runs: 1 });
    out.push({ model: 'нынешняя', doc: runToDocument(ctx, a.run, history, { name: 'проверка' }) });
  }
  if (ONLY !== 'legacy') {
    const path = `packages/sim/data/scenarios/agents/${SCENARIO.replace(/-tasks$/, '')}.json`;
    const trace = await agentTrace(path, 1);
    const hist = JSON.parse(readFileSync(join(ROOT, path.replace(/\.json$/, '.history.json')), 'utf8'));
    const { ctx: c2, run } = agentsToRun(ctx, trace, 6);
    out.push({ model: 'агентная', doc: runToDocument(c2, run, agentsHistory(hist, history), { name: 'проверка', frontCombine: 'max' }) });
  }
  return out;
}

const ms = (t: string) => Date.parse(t.length <= 16 ? `${t}:00Z` : t);

const lines: string[] = [];
let problems = 0;
for (const { model, doc } of await docs()) {
  // все слои включены — как «Показать все»
  const all: MapDocument = { ...doc, layers: doc.layers.map((l) => ({ ...l, visible: true })) };
  const start = ms(doc.timeline!.start!), end = ms(doc.timeline!.end!);
  const times: string[] = [];
  for (let t = start; t <= end; t += 24 * 3600_000) times.push(new Date(t).toISOString().slice(0, 16));
  lines.push(`## ${model} модель`, '', `Знаков: ${doc.features.length}; сутки ${times[0].slice(0, 10)} — ${times[times.length - 1].slice(0, 10)}.`, '');
  for (const level of LEVELS) {
    const items = legendFor(level);
    const shown = withLevel(all, level);
    const uncovered = new Map<string, number>(), empty = new Map<string, string[]>(), missing = new Map<string, string[]>();
    const rows = new Map<string, number>();
    for (const t of times) {
      const g = legendGaps(shown, all, level, t);
      rows.set(t, presentItems(items, level, all, t).length);
      for (const k of g.uncovered) uncovered.set(k, (uncovered.get(k) ?? 0) + 1);
      for (const k of g.empty) empty.set(k, [...(empty.get(k) ?? []), t.slice(5, 10)]);
      for (const k of g.missing) missing.set(k, [...(missing.get(k) ?? []), t.slice(5, 10)]);
    }
    const n = uncovered.size + empty.size + missing.size;
    problems += n;
    const rc = [...rows.values()];
    lines.push(`### ${RU[level]} — ${n ? `расхождений: ${n}` : 'без расхождений'}; строк легенды ${Math.min(...rc)}–${Math.max(...rc)}`, '');
    for (const [k, c] of uncovered) lines.push(`- без строки: ${k} (в ${c} сутках)`);
    for (const [k, d] of empty) lines.push(`- пустая строка: «${legendText(items.find((x) => x.id === k)!, level)}» — ${d.join(', ')}`);
    for (const [k, d] of missing) lines.push(`- строки нет: «${legendText(items.find((x) => x.id === k)!, level)}» — ${d.join(', ')}`);
    if (n) lines.push('');
  }
}
const text = lines.join('\n');
const out = arg('--out');
if (out) writeFileSync(out, text + '\n');
console.log(text);
console.log(problems ? `\nрасхождений: ${problems}` : '\nрасхождений нет');
process.exit(problems ? 1 : 0);
