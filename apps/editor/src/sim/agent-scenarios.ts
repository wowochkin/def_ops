/**
 * Агентная модель (дивизии) для операций каталога: сценарий и история ядра (packages/sim/data/scenarios/agents),
 * варианты параметров (поправки agents-v0.json — из калибровки в «Моделировании» или заданные вручную) и прогон
 * через ядро настольного приложения (run_scenario).
 */
import { invoke } from '@tauri-apps/api/core';
import type { AgentHistory, AgentTrace } from '@def-ops/sim';

/** В настольном приложении (Tauri): там есть ядро агентной модели на Rust. */
export const DESKTOP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const AGENT_SCENARIOS: Record<string, { path: string; history: string; title: string }> = {
  'berlin-1945-tasks': { path: 'packages/sim/data/scenarios/agents/berlin-1945.json', history: 'packages/sim/data/scenarios/agents/berlin-1945.history.json', title: 'Берлинская операция' },
  // советская сторона — из армий с допущениями (npm run agents:vistula-data)
  'vistula-oder-1945': { path: 'packages/sim/data/scenarios/agents/vistula-oder-1945.json', history: 'packages/sim/data/scenarios/agents/vistula-oder-1945.history.json', title: 'Висло-Одерская операция (с допущениями)' },
};

/** Вариант параметров: поправки «путь → значение» (как в agents-v0.json). */
export interface AgentVariant { id: string; title: string; params: Record<string, unknown>; scenario?: string; note?: string; created: string }
const KEY = 'def_ops.agents.variants';
export function agentVariants(): AgentVariant[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as AgentVariant[]; } catch { return []; }
}
export function saveAgentVariant(v: AgentVariant) {
  const l = agentVariants().filter((x) => x.id !== v.id);
  try { localStorage.setItem(KEY, JSON.stringify([...l, v])); } catch { /* */ }
  window.dispatchEvent(new Event('def_ops.agents.variants'));
}
export function deleteAgentVariant(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify(agentVariants().filter((x) => x.id !== id))); } catch { /* */ }
  window.dispatchEvent(new Event('def_ops.agents.variants'));
}

export interface AgentRunOptions { seed: number; params?: Record<string, unknown>; edits?: Record<string, unknown>; de?: 'script' | 'doctrine'; su?: 'script' | 'doctrine'; withoutFires?: boolean; withoutWithdrawals?: boolean }
/** Прогон сценария ядром: ход по часам. */
export const runAgents = (scenario: string, o: AgentRunOptions) => invoke<AgentTrace>('run_scenario', {
  scenario: AGENT_SCENARIOS[scenario].path, seed: o.seed, ...(o.params && Object.keys(o.params).length ? { params: o.params } : {}),
  ...(o.edits && Object.keys(o.edits).length ? { edits: o.edits } : {}),
  ...(o.de && o.de !== 'script' ? { de: o.de } : {}), ...(o.su && o.su !== 'script' ? { su: o.su } : {}),
  ...(o.withoutFires ? { withoutFires: true } : {}), ...(o.withoutWithdrawals ? { withoutWithdrawals: true } : {}),
});
const histCache = new Map<string, Promise<AgentHistory>>();
export const agentHistory = (scenario: string) => {
  let p = histCache.get(scenario);
  if (!p) { p = invoke<string>('read_text', { path: AGENT_SCENARIOS[scenario].history }).then((t) => JSON.parse(t) as AgentHistory); histCache.set(scenario, p); }
  return p;
};
