import { afterEach, expect, it, vi } from 'vitest';
import { stageMaps, applyStageMap, missingStageMaps, broadcastStageMap, docsSig, type StageDoc } from '../src/expo/stage-maps';
import { memoryBus } from '../src/expo/bus';
import type { AgentTrace, AgentHistory } from '@def-ops/sim';
class MockWorker {
  onmessage?: (event: MessageEvent) => void;
  postMessage({ id }: { id: number }) { queueMicrotask(() => this.onmessage?.({ data: { id, doc: { id: 'doc-' + id, features: [] }, zones: [] } } as MessageEvent)); }
  terminate() {}
}
afterEach(() => vi.unstubAllGlobals());
const trace = { start: '1945-04-16T05:00', frames: [{}, {}] } as AgentTrace;
it('лучший завершённый сеанс публикуется с текущим одной транзакцией и одним документом', async () => {
  vi.stubGlobal('Worker', MockWorker);
  const published: { key: string; d: StageDoc; aliases?: string[] }[] = [];
  const maps = stageMaps((key, d, aliases) => published.push({ key, d, aliases }));
  await maps.session(trace, {} as AgentHistory, 'su_1uf', 3);
  expect(published).toHaveLength(1);
  expect(published[0]).toMatchObject({ key: 'session', aliases: ['best'] });
  expect(maps.docs.best).toBe(maps.docs.session);
  const peer = applyStageMap({}, published[0] as never);
  expect(peer.best).toBe(peer.session);
  expect(docsSig(peer)).toBe(docsSig(maps.docs));
  // Следующий более слабый сеанс не затирает лучший.
  await maps.session(trace, {} as AgentHistory, 'su_1bf', 1);
  expect(maps.docs.best?.front).toBe('su_1uf');
  expect(maps.docs.session?.front).toBe('su_1bf');
  expect(published).toHaveLength(2);
  maps.dispose();
});
it('на одном физическом экране документ не сериализуется в межоконную шину; на трёх приходит с алиасом', () => {
  const [host, peer] = memoryBus(); const received: unknown[] = [];
  peer.on(m => received.push(m));
  const update = { key: 'session' as const, aliases: ['best' as const], d: { doc: {}, front: 'su_1uf', time: '1945-05-02T05:00', zones: [] } as unknown as StageDoc };
  broadcastStageMap(host, update, 1);
  expect(received).toEqual([]);
  broadcastStageMap(host, update, 3);
  expect(received).toEqual([{ k: 'map', ...update }]);
});
it('поздно подключившееся окно получает недостающие карты, одинаковые session и best только одним payload', () => {
  const d = { doc: {}, front: 'su_1uf', time: '1945-05-02T05:00', zones: [] } as unknown as StageDoc;
  const h = { ...d, front: null };
  const docs = { history: h, session: d, best: d };
  const first = missingStageMaps(docs, '');
  expect(first).toHaveLength(2);
  let peer = {}; for (const update of first) peer = applyStageMap(peer, update);
  expect(docsSig(peer)).toEqual(docsSig(docs));
  expect(missingStageMaps(docs, docsSig(peer))).toEqual([]);
  const missing = missingStageMaps(docs, docsSig({ history: h, session: d }));
  expect(missing).toHaveLength(1);
  expect(missing[0].key).toBe('best');
});
