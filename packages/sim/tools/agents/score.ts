/**
 * Итог сверки прогона агентной модели с историей — тот же счёт, что вкладка «Агентная модель» (agentsScore):
 *
 *   npx tsx packages/sim/tools/agents/score.ts --scenario berlin|seelow|vistula-oder --trace evals-out/agents/berlin/trace.json
 *
 * Печатает JSON { positions, events, total }.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../../src/data';
import { contextFrom } from '../../src/source';
import { agentsScore } from '../../src/agents-score';
import type { AgentHistory, AgentTrace } from '../../src/agents';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const scen = opt('scenario') ?? 'berlin';
const tracePath = opt('trace') ?? `evals-out/agents/${scen}/trace.json`;
// сценарий нынешней модели, по которому строится сверка (контекст и базовая история)
const BASE: Record<string, string> = { berlin: 'berlin-1945-tasks', seelow: 'berlin-1945-tasks', 'vistula-oder': 'vistula-oder-1945' };
if (!BASE[scen]) throw new Error(`неизвестный сценарий ${scen}: berlin | seelow | vistula-oder`);

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
const s = agentsScore(ctx, trace, hist, history);
console.log(JSON.stringify({ positions: s.within, events: s.eventsTotal ? s.eventsHit / s.eventsTotal : 0, total: s.score, detail: { within: s.within, n: s.n, medianExcessKm: s.medianExcessKm, eventsHit: s.eventsHit, eventsTotal: s.eventsTotal, ...(args.includes("--events") ? { events: s.events, byGroup: s.byGroup } : {}) } }));
