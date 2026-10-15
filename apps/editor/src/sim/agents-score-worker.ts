/** Сверка прогона агентной модели с историей в фоновом потоке (карта не строится): «Моделирование» — сравнение и калибровка. */
import { agentsScore, contextFrom, type AgentHistory, type AgentTrace, type AgentsScore, type History, type Norm, type SimContext } from '@def-ops/sim';
import { getData } from './userdata';

/** outcomes — нормативы-итоги операции из базы знаний (от трёх измеримых — в итоге с весом 1/8). */
export type ScoreRequest = { id: number; scenario: string; trace: AgentTrace; history: AgentHistory; toleranceKm?: number; outcomes?: Norm[] };
export type ScoreResponse = { id: number; ok: true; score: AgentsScore } | { id: number; ok: false; error: string };

const ctxs = new Map<string, Promise<{ ctx: SimContext; history: History }>>();
self.onmessage = async (e: MessageEvent<ScoreRequest>) => {
  const q = e.data;
  try {
    let c = ctxs.get(q.scenario);
    if (!c) { c = contextFrom((k, f) => getData(k, f), q.scenario); ctxs.set(q.scenario, c); }
    const { ctx, history } = await c;
    (self as unknown as Worker).postMessage({ id: q.id, ok: true, score: agentsScore(ctx, q.trace, q.history, history, q.toleranceKm ?? 10, 6, q.outcomes ?? []) } satisfies ScoreResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: q.id, ok: false, error: (err as Error).message ?? String(err) } satisfies ScoreResponse);
  }
};
