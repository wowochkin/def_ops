/**
 * Пул потоков моделирования: прогоны раскладываются по свободным потокам (по числу ядер, не больше 8) —
 * калибровка и сравнение моделей идут параллельно. Поток держит загруженный сценарий между заданиями.
 */
import type { RulesEvaluation } from '@def-ops/sim';
import type { ModelRequest, ModelResponse } from './model-protocol';

type Job = { q: Omit<ModelRequest, 'id'>; res: (r: RulesEvaluation) => void; rej: (e: Error) => void };

export class ModelPool {
  private workers: { w: Worker; busy: boolean }[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, Job & { slot: number }>();
  private seq = 0;
  readonly size: number;
  constructor(size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))) { this.size = size; }

  private spawn(i: number) {
    const w = new Worker(new URL('./model-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ModelResponse>) => {
      const m = e.data, j = this.pending.get(m.id);
      if (!j) return;
      this.pending.delete(m.id);
      this.workers[j.slot].busy = false;
      if (m.ok) j.res(m.result); else j.rej(new Error(m.error));
      this.pump();
    };
    w.onerror = (e) => { for (const [id, j] of this.pending) if (j.slot === i) { this.pending.delete(id); j.rej(new Error(e.message || 'ошибка потока')); } this.workers[i].busy = false; this.pump(); };
    return { w, busy: false };
  }
  private pump() {
    while (this.queue.length) {
      let i = this.workers.findIndex((x) => !x.busy);
      if (i < 0 && this.workers.length < this.size) { this.workers.push(this.spawn(this.workers.length)); i = this.workers.length - 1; }
      if (i < 0) return;
      const j = this.queue.shift()!;
      const id = ++this.seq;
      this.workers[i].busy = true;
      this.pending.set(id, { ...j, slot: i });
      this.workers[i].w.postMessage({ ...j.q, id } satisfies ModelRequest);
    }
  }
  run(q: Omit<ModelRequest, 'id'>): Promise<RulesEvaluation> {
    return new Promise((res, rej) => { this.queue.push({ q, res, rej }); this.pump(); });
  }
  /** Остановить всё: очередь отбрасывается, потоки завершаются (кэш сценариев — тоже). */
  stop() {
    for (const j of this.queue) j.rej(new Error('остановлено'));
    for (const j of this.pending.values()) j.rej(new Error('остановлено'));
    this.queue = []; this.pending.clear();
    for (const x of this.workers) x.w.terminate();
    this.workers = [];
  }
}
