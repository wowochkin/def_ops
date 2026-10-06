/**
 * Задания (загрузка тайлов, нарезка растра, импорт пакета) выполняются внутри
 * процесса сервиса: у каждой организации своя очередь, задания организации идут
 * по одному (разные организации — параллельно). Ход задания сохраняется в
 * хранилище и публикуется событием job.progress не чаще раза в progressMs.
 * После перезапуска сервиса незавершённые задания помечаются неудавшимися
 * (MapRepo.failInterrupted) — загрузку XYZ можно запустить снова: уже
 * загруженные тайлы будут пропущены.
 */
import type { MapJob } from '@def-ops/core';
import type { MapRepo } from './repo';
import type { EventBus } from './events';

export class CancelledError extends Error {
  constructor() { super('Задание отменено'); }
}

type Counters = Partial<Pick<MapJob, 'done' | 'total' | 'skipped' | 'errors' | 'message'>>;

export interface JobContext {
  readonly job: MapJob;
  readonly tenant: string;
  readonly signal: AbortSignal;
  /** Обновить счётчики задания (сохраняется и публикуется с ограничением частоты). */
  progress(patch?: Counters): void;
  /** Прервать работу, если задание отменено. */
  check(): void;
}

/** Итог задания: failed — завершить со статусом failed (без исключения). */
export type JobOutcome = { message?: string; result?: MapJob['result']; failed?: boolean } | void;
export type JobFn = (ctx: JobContext) => Promise<JobOutcome>;

interface Live { tenant: string; job: MapJob; fn: JobFn; ctl: AbortController; save: Promise<void>; last: number; cleanup?: () => Promise<void> }

export class JobRunner {
  private live = new Map<string, Live>();
  private queues = new Map<string, Live[]>();
  private busy = new Set<string>();
  private waiters: (() => void)[] = [];

  constructor(private repo: MapRepo, private bus: EventBus, private o: { progressMs?: number; log?: (e: unknown) => void } = {}) {}

  /** Новое задание в статусе «в очереди» (сохранено). */
  async create(tenant: string, mapId: string, type: MapJob['type'], total = 0): Promise<MapJob> {
    const now = new Date().toISOString();
    const job: MapJob = { id: crypto.randomUUID(), mapId, type, status: 'queued', done: 0, total, skipped: 0, errors: 0, createdAt: now, updatedAt: now };
    await this.repo.saveJob(tenant, job);
    return structuredClone(job);
  }

  /**
   * Поставить задание в очередь организации. cleanup вызывается в любом исходе —
   * и если задание отменили, не дав начаться (например, удалить загруженный скан).
   */
  enqueue(tenant: string, job: MapJob, fn: JobFn, cleanup?: () => Promise<void>): void {
    const l = this.track(tenant, job, fn);
    l.cleanup = cleanup;
    const q = this.queues.get(tenant) ?? [];
    q.push(l);
    this.queues.set(tenant, q);
    void this.pump(tenant);
  }

  /** Выполнить задание сразу, вне очереди (импорт пакета идёт вместе с его загрузкой). */
  async runNow(tenant: string, job: MapJob, fn: JobFn): Promise<MapJob> {
    return this.execute(this.track(tenant, job, fn));
  }

  /** Текущее состояние выполняющегося или ожидающего задания (свежее, чем в хранилище). */
  get(tenant: string, id: string): MapJob | null {
    const l = this.live.get(id);
    return l && l.tenant === tenant ? structuredClone(l.job) : null;
  }

  /** Отменить задание. null — такого активного задания нет. */
  async cancel(tenant: string, id: string): Promise<MapJob | null> {
    const l = this.live.get(id);
    if (!l || l.tenant !== tenant) return null;
    l.ctl.abort();
    const q = this.queues.get(tenant);
    const i = q?.indexOf(l) ?? -1;
    if (q && i >= 0) { // ещё не начиналось — снимаем с очереди
      q.splice(i, 1);
      await this.finish(l, 'cancelled', 'Задание отменено');
    }
    return structuredClone(l.job);
  }

  /** Отменить все задания карты (перед удалением карты). */
  async cancelMap(tenant: string, mapId: string): Promise<void> {
    const ids = [...this.live.values()].filter((l) => l.tenant === tenant && l.job.mapId === mapId).map((l) => l.job.id);
    for (const id of ids) await this.cancel(tenant, id);
    // дождаться, пока выполняющиеся задания карты остановятся
    while ([...this.live.values()].some((l) => l.tenant === tenant && l.job.mapId === mapId)) await new Promise((r) => setTimeout(r, 20));
  }

  /** Дождаться, пока все очереди опустеют (тесты, остановка сервиса). */
  idle(): Promise<void> {
    if (!this.live.size) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  /** Отменить всё (остановка сервиса). */
  async stop(): Promise<void> {
    for (const l of [...this.live.values()]) await this.cancel(l.tenant, l.job.id);
    await this.idle();
  }

  private track(tenant: string, job: MapJob, fn: JobFn): Live {
    const l: Live = { tenant, job: structuredClone(job), fn, ctl: new AbortController(), save: Promise.resolve(), last: 0 };
    this.live.set(job.id, l);
    return l;
  }

  private async pump(tenant: string) {
    if (this.busy.has(tenant)) return;
    this.busy.add(tenant);
    try {
      for (let l = this.queues.get(tenant)?.shift(); l; l = this.queues.get(tenant)?.shift()) await this.execute(l);
    } finally {
      this.busy.delete(tenant);
      this.queues.delete(tenant);
    }
  }

  private persist(l: Live, event: 'job.progress' | 'job.done' | 'job.failed') {
    l.job.updatedAt = new Date().toISOString();
    const snap = structuredClone(l.job);
    l.save = l.save.then(() => this.repo.saveJob(l.tenant, snap)).catch((e) => this.o.log?.(e));
    this.bus.publish({ type: event, tenant: l.tenant, mapId: snap.mapId, jobId: snap.id, job: snap });
    l.last = Date.now();
  }

  private async execute(l: Live): Promise<MapJob> {
    const { job, ctl } = l;
    if (ctl.signal.aborted) { await this.finish(l, 'cancelled', 'Задание отменено'); return structuredClone(job); }
    job.status = 'running';
    this.persist(l, 'job.progress');
    const ctx: JobContext = {
      job, tenant: l.tenant, signal: ctl.signal,
      progress: (patch) => {
        Object.assign(job, patch);
        if (Date.now() - l.last >= (this.o.progressMs ?? 500)) this.persist(l, 'job.progress');
      },
      check: () => { if (ctl.signal.aborted) throw new CancelledError(); },
    };
    try {
      const out = await l.fn(ctx);
      if (ctl.signal.aborted) await this.finish(l, 'cancelled', 'Задание отменено');
      else {
        if (out?.result) job.result = out.result;
        await this.finish(l, out?.failed ? 'failed' : 'done', out?.message);
      }
    } catch (e) {
      if (ctl.signal.aborted || e instanceof CancelledError) await this.finish(l, 'cancelled', 'Задание отменено');
      else {
        this.o.log?.(e);
        await this.finish(l, 'failed', (e as Error)?.message || String(e));
      }
    }
    return structuredClone(job);
  }

  private async finish(l: Live, status: MapJob['status'], message?: string) {
    l.job.status = status;
    if (message !== undefined) l.job.message = message;
    this.persist(l, status === 'done' ? 'job.done' : status === 'running' || status === 'queued' ? 'job.progress' : 'job.failed');
    await l.save;
    await l.cleanup?.().catch((e) => this.o.log?.(e));
    this.live.delete(l.job.id);
    if (!this.live.size) this.waiters.splice(0).forEach((r) => r());
  }
}
