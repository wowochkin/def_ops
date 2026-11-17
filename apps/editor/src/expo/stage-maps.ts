/**
 * Документы карты стенда у главного окна: ход ядра → воркер карты → документ; рассылка окнам — отдельным сообщением
 * шины только при смене (документ — мегабайты, состояние сеанса рассылается каждые 250 мс).
 * history — «как было» (заставка, выбор фронта, ввод), session — текущий сеанс, best — лучший завершённый сеанс дня.
 */
import type { MapDocument } from '@def-ops/core';
import type { AgentHistory, AgentTrace } from '@def-ops/sim';
import type { FrontId } from './settings';
import type { ZoneFrame } from './stage-doc';
import type { ExpoBus } from './bus';

export type StageKey = 'history' | 'session' | 'best';
/** Документ и чей он: фронт сеанса и момент конца хода (по нему вид сеанса узнаёт свой документ); зоны влияния по суткам. */
export interface StageDoc { doc: MapDocument; front: FrontId | null; time: string; zones: ZoneFrame[] }
export type StageDocs = Partial<Record<StageKey, StageDoc>>;
/** Один документ может одновременно стать текущим и лучшим — передаём тело только один раз. */
export interface StageMapUpdate { key: StageKey; d: StageDoc; aliases?: StageKey[] }
export function applyStageMap(docs: StageDocs, update: StageMapUpdate): StageDocs {
  const next = { ...docs, [update.key]: update.d };
  for (const key of update.aliases ?? []) next[key] = update.d;
  return next;
}
/** На одном физическом окне отправка через Tauri лишь сериализовала карту и возвращала своё эхо. */
export function broadcastStageMap(bus: ExpoBus, update: StageMapUpdate, count: number) {
  if (count > 1) bus.send({ k: 'map', ...update });
}
/** Дослать карты новому окну, сохраняя общую ссылку session/best в одном сообщении. */
export function missingStageMaps(docs: StageDocs, has = ''): StageMapUpdate[] {
  const known = new Set(has.split('|'));
  const grouped = new Map<StageDoc, StageMapUpdate>();
  for (const [key, d] of Object.entries(docs) as [StageKey, StageDoc | undefined][]) {
    if (!d || known.has(`${key}:${d.front}:${d.time}`)) continue;
    const update = grouped.get(d);
    if (update) (update.aliases ??= []).push(key);
    else grouped.set(d, { key, d });
  }
  return [...grouped.values()];
}


/** Подпись набора документов: какие есть и на какой момент. */
export const docsSig = (d: StageDocs) => (Object.entries(d) as [StageKey, StageDoc | undefined][]).filter(([, x]) => x).map(([k, x]) => `${k}:${x!.front}:${x!.time}`).sort().join('|');

export function stageMaps(onDoc: (key: StageKey, d: StageDoc, aliases?: StageKey[]) => void) {
  let worker: Worker | null = null;
  let seq = 0;
  let best = -Infinity;
  type Built = { doc: MapDocument; zones: ZoneFrame[] };
  const pending = new Map<number, (b: Built | null) => void>();
  const docs: StageDocs = {};
  const build = (trace: AgentTrace, history: AgentHistory) =>
    new Promise<Built | null>((resolve) => {
      if (!worker) {
        worker = new Worker(new URL('./stage-worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<{ id: number; doc?: MapDocument; zones?: ZoneFrame[]; error?: string }>) => {
          if (e.data.error) console.warn('карта стенда:', e.data.error);
          pending.get(e.data.id)?.(e.data.doc ? { doc: e.data.doc, zones: e.data.zones ?? [] } : null);
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
      const b = await build(trace, history);
      if (!b) return;
      const d = { ...b, front, time };
      docs.session = d;
      const aliases: StageKey[] = [];
      if (score !== undefined && score > best) {
        best = score;
        docs.best = d;
        aliases.push('best');
      }
      onDoc('session', d, aliases);
    },
    async history(trace: AgentTrace, history: AgentHistory) {
      const b = await build(trace, history);
      if (b) put('history', { ...b, front: null, time: end(trace) });
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
