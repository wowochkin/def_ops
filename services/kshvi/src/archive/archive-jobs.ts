import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { sha256Canonical } from '../../../../packages/kshvi/src/archive/file-digest';

export type ArchiveJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ArchiveJobOwner = { organizationId: string; userId: string };
export type ArchiveJobActor = { organizationId: string; authorities: readonly string[] };
export type ArchiveJobRun = (context: { signal: AbortSignal; reportProgress: (progress: number) => void }) => Promise<unknown> | unknown;
export type ArchiveJob = {
  id: string;
  kind: 'EXPORT' | 'IMPORT' | 'VERIFY' | 'BULK_REPLAY';
  status: ArchiveJobStatus;
  progress: number;
  attempts: number;
  result?: unknown;
  error?: string;
  owner: ArchiveJobOwner;
};
export type ArchiveJobSubmit = {
  idempotencyKey: string;
  kind: ArchiveJob['kind'];
  payload: unknown;
  owner: ArchiveJobOwner;
  run: ArchiveJobRun;
};
export type ArchiveJobLimits = {
  maxConcurrent?: number;
  maxQueue?: number;
  maxPayloadBytes?: number;
  maxDurationMs?: number;
};
type InternalJob = ArchiveJob & {
  idempotencyKey: string;
  requestHash: string;
  run: ArchiveJobRun;
};

const terminal = (status: ArchiveJobStatus): boolean => status === 'succeeded' || status === 'failed' || status === 'cancelled';

export class ArchiveJobManager {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly keys = new Map<string, string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancellations = new Set<string>();
  private readonly waiters = new Map<string, (() => void)[]>();
  private readonly limits: Required<ArchiveJobLimits>;
  private active = 0;
  private started = false;
  private nextId = 1;

  constructor(limits: ArchiveJobLimits = {}) {
    this.limits = {
      maxConcurrent: limits.maxConcurrent ?? 1,
      maxQueue: limits.maxQueue ?? 20,
      maxPayloadBytes: limits.maxPayloadBytes ?? 10 * 1024 * 1024,
      maxDurationMs: limits.maxDurationMs ?? 5 * 60 * 1000,
    };
    if (this.limits.maxConcurrent < 1 || this.limits.maxQueue < 1 || this.limits.maxPayloadBytes < 1 || this.limits.maxDurationMs < 1) {
      throw new Error('Лимиты заданий должны быть положительными');
    }
  }

  private publicJob(job: InternalJob): ArchiveJob {
    const { idempotencyKey: ignoredKey, requestHash: ignoredHash, run: ignoredRun, ...publicFields } = job;
    void ignoredKey; void ignoredHash; void ignoredRun;
    return structuredClone(publicFields);
  }

  private settleWaiters(id: string): void {
    for (const resolve of this.waiters.get(id) ?? []) resolve();
    this.waiters.delete(id);
  }

  submit(input: ArchiveJobSubmit): ArchiveJob {
    const requestHash = sha256Canonical({ kind: input.kind, payload: input.payload });
    const key = `${input.owner.organizationId}/${input.idempotencyKey}`;
    const existingId = this.keys.get(key);
    if (existingId) {
      const existing = this.jobs.get(existingId)!;
      if (existing.requestHash !== requestHash) throw new Error('Ключ задания уже использован с другим содержимым');
      return this.publicJob(existing);
    }
    if (Buffer.byteLength(canonicalJson(input.payload)) > this.limits.maxPayloadBytes) throw new Error('Превышен лимит размера задания');
    const queued = [...this.jobs.values()].filter(job => job.status === 'queued').length;
    if (queued >= this.limits.maxQueue) throw new Error('Превышен лимит очереди тяжёлых заданий');
    const job: InternalJob = {
      id: `archive-job-${this.nextId++}`, kind: input.kind, status: 'queued', progress: 0, attempts: 0,
      owner: structuredClone(input.owner), idempotencyKey: input.idempotencyKey, requestHash, run: input.run,
    };
    this.jobs.set(job.id, job);
    this.keys.set(key, job.id);
    if (this.started) queueMicrotask(() => this.pump());
    return this.publicJob(job);
  }

  start(): void {
    this.started = true;
    this.pump();
  }

  private pump(): void {
    if (!this.started) return;
    while (this.active < this.limits.maxConcurrent) {
      const job = [...this.jobs.values()].find(candidate => candidate.status === 'queued');
      if (!job) return;
      void this.execute(job);
    }
  }

  private async execute(job: InternalJob): Promise<void> {
    job.status = 'running';
    job.attempts += 1;
    this.active += 1;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const abort = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('Задание отменено')), { once: true });
    });
    const timeout = setTimeout(() => controller.abort(new Error('Превышен лимит времени задания')), this.limits.maxDurationMs);
    timeout.unref();
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => job.run({
          signal: controller.signal,
          reportProgress: progress => {
            if (job.status === 'running') job.progress = Math.max(0, Math.min(99, progress));
          },
        })),
        abort,
      ]);
      if (this.cancellations.has(job.id)) job.status = 'cancelled';
      else {
        job.status = 'succeeded';
        job.progress = 100;
        job.result = result;
      }
    } catch (error) {
      if (this.cancellations.has(job.id)) job.status = 'cancelled';
      else {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(job.id);
      this.active -= 1;
      this.settleWaiters(job.id);
      this.pump();
    }
  }

  cancel(id: string): ArchiveJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Задание не найдено');
    if (terminal(job.status)) return this.publicJob(job);
    this.cancellations.add(id);
    if (job.status === 'queued') {
      job.status = 'cancelled';
      this.settleWaiters(id);
    } else this.controllers.get(id)?.abort(new Error('Задание отменено пользователем'));
    return this.publicJob(job);
  }

  retry(id: string): ArchiveJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Задание не найдено');
    if (job.status !== 'failed' && job.status !== 'cancelled') throw new Error('Повторять можно только failed или cancelled задание');
    this.cancellations.delete(id);
    job.status = 'queued';
    job.progress = 0;
    delete job.result;
    delete job.error;
    if (this.started) queueMicrotask(() => this.pump());
    return this.publicJob(job);
  }

  get(id: string, actor: ArchiveJobActor): ArchiveJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Задание не найдено');
    if (job.owner.organizationId !== actor.organizationId || !actor.authorities.includes('archive.jobs.read')) {
      throw new Error('403: Результат задания недоступен');
    }
    return this.publicJob(job);
  }

  activeCount(): number {
    return this.active;
  }

  async wait(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Задание не найдено');
    if (terminal(job.status)) return;
    await new Promise<void>(resolve => {
      const waiters = this.waiters.get(id) ?? [];
      waiters.push(resolve);
      this.waiters.set(id, waiters);
    });
  }
}
