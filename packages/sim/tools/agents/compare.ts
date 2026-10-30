/**
 * Проверка этапа «Итоги»: события сводки операции (operationSummary — сравнение «без вмешательства» с историей) и
 * мерила сходства (agentsScore) по одному ходу ядра — те же события и те же сроки:
 *
 *   npx tsx packages/sim/tools/agents/compare.ts --scenario berlin --trace evals-out/agents/berlin-intent/trace.json
 *
 * Печатает JSON { ok, events: [{ id, summary, score }] } (summary и score — расхождение с историей, сутки); при
 * расхождении — код выхода 1.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../../src/data';
import { contextFrom } from '../../src/source';
import { agentsScore } from '../../src/agents-score';
import { operationSummary } from '../../src/results';
import type { AgentHistory, AgentTrace } from '../../src/agents';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const scen = opt('scenario') ?? 'berlin';
const tracePath = opt('trace') ?? `evals-out/agents/${scen}/trace.json`;
const BASE: Record<string, string> = { berlin: 'berlin-1945-tasks', 'vistula-oder': 'vistula-oder-1945' };
if (!BASE[scen]) throw new Error(`неизвестный сценарий ${scen}: berlin | vistula-oder`);

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  if (kind === 'infrastructure') return null;
  return loadRules(id);
};
const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;
const { ctx, history } = await contextFrom(get, BASE[scen]);
const trace = rd<AgentTrace>(tracePath);
const hist = rd<AgentHistory>(`packages/sim/data/scenarios/agents/${scen}-1945.history.json`);
const sum = operationSummary(ctx, trace, hist, history);
const score = agentsScore(ctx, trace, hist, history);
const ids = [...new Set([...sum.events.map((e) => e.id), ...score.events.map((e) => e.id)])];
const events = ids.map((id) => ({ id, summary: sum.events.find((e) => e.id === id)?.days ?? null, score: score.events.find((e) => e.id === id)?.days ?? null }));
const ok = sum.events.length === score.events.length && events.every((e) => e.summary === e.score);
const sides = (['su', 'de'] as const).map((s) => { const r = sum.losses.rows.find((x) => x.id === s)!; return { side: s, days: +(sum.upTo / 24).toFixed(1), personnel: r.total.personnel, tanks: r.total.tanks, guns: r.total.guns, captured: r.captured, reinforced: r.reinforced }; });
console.log(JSON.stringify({ ok, events, ...(args.includes('--losses') ? { losses: sides, history: sum.history.losses.filter((h) => h.scope === 'su' || h.scope === 'de') } : {}) }));
if (!ok) process.exit(1);
