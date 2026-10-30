/**
 * «Переигровка без вмешательства» для сравнения итогов: прогон «Истории как замысла» того же сценария и seed на тех
 * же правках базы знаний. Сводка (OperationSummary) кэшируется в localStorage по сценарию, seed, отпечатку правок и
 * отпечатку модели (MODEL_STAMP: другая модель — другой ключ);
 * переигровка в режиме «История как замысел» без варианта параметров сама и есть такой прогон — её сводка
 * запоминается (rememberBaseline), отдельный прогон не нужен. Хранилища нет — просто считать.
 */
import type { AgentHistory, AgentTrace, OperationSummary } from '@def-ops/sim';
import type { SimRequest, SimResponse } from './protocol';
import type { ReplayDebriefs } from './replay-debrief';
import { MODEL_STAMP } from './model-stamp';

export const BASELINE_KEY = 'def_ops.baseline.v1';

/** FNV-1a, 32 бита — отпечаток правок. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function baselineKey(scenario: string, seed: number, edits: unknown, model: string = MODEL_STAMP): string {
  return `${BASELINE_KEY}:${scenario}:${seed}:${fnv1a(JSON.stringify(edits ?? null))}:${model}`;
}

const memory = new Map<string, OperationSummary>();
const inflight = new Map<string, Promise<OperationSummary>>();

function read(key: string): OperationSummary | null {
  const m = memory.get(key);
  if (m) return m;
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as OperationSummary) : null;
  } catch { return null; }
}
function write(key: string, s: OperationSummary): void {
  memory.set(key, s);
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* хранилища нет — только в памяти */ }
}

/** Запомнить сводку переигровки «История как замысел» (без варианта параметров) как базовую. */
export function rememberBaseline(scenario: string, seed: number, edits: unknown, s: OperationSummary): void {
  write(baselineKey(scenario, seed, edits), s);
}

type RunAgents = (scenario: string, o: { seed: number; edits?: Record<string, unknown>; command?: 'intent' }) => Promise<AgentTrace>;
export interface BaselineDeps {
  run?: RunAgents;
  summarize?(trace: AgentTrace, history: AgentHistory): Promise<OperationSummary>;
  edits?(scenario: string): Promise<unknown>;
  history?(scenario: string): Promise<AgentHistory>;
  /** Отпечаток модели (по умолчанию — MODEL_STAMP сборки). */
  model?: string;
}

/** Сводка хода фоновым потоком переигровки (summaryOnly): контекст и история сценария — там же, где у расчёта. */
export async function summarizeInWorker(scenario: string, seed: number, trace: AgentTrace, history: AgentHistory): Promise<OperationSummary> {
  return (await recomputeInWorker(scenario, seed, trace, history, false)).summary;
}

/** Сводка и (debriefs) разбор хода по суткам — для сохранённой переигровки, где их нет. */
export async function recomputeInWorker(scenario: string, seed: number, trace: AgentTrace, history: AgentHistory, debriefs = true): Promise<{ summary: OperationSummary; debriefs?: ReplayDebriefs }> {
  const { BUILTIN_CATALOG } = await import('./userdata');
  const e = BUILTIN_CATALOG.find((c) => c.id === scenario);
  if (!e) throw new Error(`операции ${scenario} нет в каталоге`);
  const q: SimRequest = { scenario, rules: e.rules[0].id, seed, runs: 1, toleranceKm: e.toleranceKm, agents: { trace, history, title: '', stepHours: 6 }, summaryOnly: true, ...(debriefs ? { debriefs } : {}) };
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<{ summary: OperationSummary; debriefs?: ReplayDebriefs }>((res, rej) => {
      w.onmessage = (m: MessageEvent<SimResponse>) => {
        if (m.data.kind === 'summary') res({ summary: m.data.summary, ...(m.data.debriefs ? { debriefs: m.data.debriefs } : {}) });
        else if (m.data.kind === 'error') rej(new Error(m.data.message));
      };
      w.onerror = (x) => rej(new Error(x.message || 'ошибка расчёта'));
      w.postMessage(q);
    });
  } finally { w.terminate(); }
}

/**
 * Сводка переигровки без вмешательства: из кэша, иначе прогон ядра (command: 'intent') и сводка фоновым потоком.
 * Одновременные вызовы с одним ключом — один прогон. o.edits — поправки ядра, с которыми считана сравниваемая игра
 * (из её записи; null — без поправок базы): прогон на них же; не заданы — на нынешней сборке базы (coreEditsFor).
 */
export async function baselineSummary(scenario: string, seed: number, deps: BaselineDeps = {}, o: { edits?: unknown } = {}): Promise<OperationSummary> {
  const editsOf = deps.edits ?? (async (sc: string) => (await import('./kb-recompile')).coreEditsFor(sc));
  const edits = 'edits' in o ? o.edits ?? undefined : await editsOf(scenario);
  const key = baselineKey(scenario, seed, edits, deps.model);
  const hit = read(key);
  if (hit) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const run = deps.run ?? ((await import('./agent-scenarios')).runAgents as unknown as RunAgents);
    const historyOf = deps.history ?? (async (sc: string) => (await import('./agent-scenarios')).agentHistory(sc));
    const [trace, history] = await Promise.all([run(scenario, { seed, ...(edits ? { edits: edits as Record<string, unknown> } : {}), command: 'intent' }), historyOf(scenario)]);
    const s = await (deps.summarize ? deps.summarize(trace, history) : summarizeInWorker(scenario, seed, trace, history));
    write(key, s);
    return s;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}
