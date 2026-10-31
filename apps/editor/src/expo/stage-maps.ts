/**
 * Документы карты стенда у главного окна: ход ядра → воркер карты → документ; рассылка окнам — отдельным сообщением
 * шины только при смене (документ — мегабайты, состояние сеанса рассылается каждые 250 мс).
 * history — «как было» (заставка, выбор фронта, ввод), session — текущий сеанс, best — лучший завершённый сеанс дня.
 */
import type { MapDocument } from '@def-ops/core';
import type { AgentHistory, AgentTrace } from '@def-ops/sim';
import type { FrontId } from './settings';

export type StageKey = 'history' | 'session' | 'best';
/** Документ и чей он: фронт сеанса и момент конца хода (по нему вид сеанса узнаёт свой документ). */
export interface StageDoc { doc: MapDocument; front: FrontId | null; time: string }
export type StageDocs = Partial<Record<StageKey, StageDoc>>;

/** Подпись набора документов: какие есть и на какой момент. */
export const docsSig = (d: StageDocs) => (Object.entries(d) as [StageKey, StageDoc | undefined][]).filter(([, x]) => x).map(([k, x]) => `${k}:${x!.front}:${x!.time}`).sort().join('|');

export function stageMaps(onDoc: (key: StageKey, d: StageDoc) => void) {
  let worker: Worker | null = null;
  let seq = 0;
  let best = -Infinity;
  const pending = new Map<number, (doc: MapDocument | null) => void>();
  const docs: StageDocs = {};
  const build = (trace: AgentTrace, history: AgentHistory) =>
    new Promise<MapDocument | null>((resolve) => {
      if (!worker) {
        worker = new Worker(new URL('./stage-worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<{ id: number; doc?: MapDocument; error?: string }>) => {
          if (e.data.error) console.warn('карта стенда:', e.data.error);
          pending.get(e.data.id)?.(e.data.doc ?? null);
          pending.delete(e.data.id);
        };
      }
      const id = ++seq;
      pending.set(id, resolve);
      worker.postMessage({ id, trace, history });
    });
  const put = (key: StageKey, d: StageDoc) => {
    docs[key] = d;
    onDoc(key, d);
  };
  const end = (t: AgentTrace) => new Date(Date.parse(`${t.start.slice(0, 16)}:00Z`) + (t.frames.length - 1) * 3_600_000).toISOString().slice(0, 16);
  return {
    docs,
    /** Ход сеанса; `score` — сумма осей завершённого сеанса (лучший за день — на заставку). */
    async session(trace: AgentTrace, history: AgentHistory, front: FrontId, score?: number) {
      const time = end(trace);
      const doc = await build(trace, history);
      if (!doc) return;
      put('session', { doc, front, time });
      if (score !== undefined && score > best) {
        best = score;
        put('best', { doc, front, time });
      }
    },
    async history(trace: AgentTrace, history: AgentHistory) {
      const doc = await build(trace, history);
      if (doc) put('history', { doc, front: null, time: end(trace) });
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
