import { Worker } from 'node:worker_threads';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { sha256Canonical } from '../../../../packages/kshvi/src/archive/file-digest';

export type ArchiveJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ArchiveJobOwner = { organizationId: string; userId: string; authorities: readonly string[] };
export type ArchiveJobActor = ArchiveJobOwner;
export type ArchiveJobRun = (context: { signal: AbortSignal; reportProgress: (progress: number) => void; payload?: unknown }) => Promise<unknown> | unknown;
export type ArchiveJobTask = { module: string; exportName?: string };
export type ArchiveJob = {
  id: string;
  kind: 'EXPORT' | 'ARCHIVE' | 'MASS_CALCULATION' | 'IMPORT' | 'VERIFY' | 'BULK_REPLAY';
  status: ArchiveJobStatus;
  progress: number;
  attempts: number;
  result?: unknown;
  error?: string;
  owner: Omit<ArchiveJobOwner, 'authorities'>;
};
export type ArchiveJobSubmit = {
  idempotencyKey: string;
  kind: ArchiveJob['kind'];
  payload: unknown;
  owner: ArchiveJobOwner;
  run?: ArchiveJobRun;
  task?: ArchiveJobTask;
};
export type ArchiveJobLimits = {
  maxConcurrent?: number;
  maxQueue?: number;
  maxPayloadBytes?: number;
  maxDurationMs?: number;
  maxMemoryMb?: number;
};
type InternalJob = ArchiveJob & {
  owner: ArchiveJobOwner;
  idempotencyKey: string;
  requestHash: string;
  payload: unknown;
  task: { moduleUrl?: string; exportName?: string; runSource?: string };
};

const terminal = (status: ArchiveJobStatus): boolean => status === 'succeeded' || status === 'failed' || status === 'cancelled';

export class ArchiveJobManager {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly keys = new Map<string, string>();
  private readonly workers = new Map<string, Worker>();
  private readonly cancellations = new Set<string>();
  private readonly timeouts = new Set<string>();
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
      maxMemoryMb: limits.maxMemoryMb ?? 256,
    };
    if (Object.values(this.limits).some(value => !Number.isFinite(value) || value < 1)) throw new Error('Лимиты заданий должны быть положительными');
  }

  private publicJob(job: InternalJob): ArchiveJob {
    const { idempotencyKey: ignoredKey, requestHash: ignoredHash, task: ignoredTask, payload: ignoredPayload, ...publicFields } = job;
    void ignoredKey; void ignoredHash; void ignoredTask; void ignoredPayload;
    return structuredClone({
      ...publicFields,
      owner: { organizationId: job.owner.organizationId, userId: job.owner.userId },
    });
  }

  private settleWaiters(id: string): void {
    for (const resolve of this.waiters.get(id) ?? []) resolve();
    this.waiters.delete(id);
  }

  submit(input: ArchiveJobSubmit): ArchiveJob {
    if (!input.owner.authorities.includes('archive.jobs.create')) throw new Error('403: Создание задания недоступно');
    if (!input.owner.userId || !input.owner.organizationId) throw new Error('403: Нужен владелец задания');
    if (!input.run && !input.task || input.run && input.task) throw new Error('Нужен один исполняемый worker task');
    const task = input.run
      ? { runSource: input.run.toString() }
      : { moduleUrl: new URL(input.task!.module, import.meta.url).href, exportName: input.task!.exportName ?? 'default' };
    if (task.moduleUrl && !task.moduleUrl.startsWith('file:')) throw new Error('Worker допускает только локальные модули');
    const requestHash = sha256Canonical({ kind: input.kind, payload: input.payload, task });
    const key = `${input.owner.organizationId}/${input.owner.userId}/${input.idempotencyKey}`;
    const existingId = this.keys.get(key);
    if (existingId) {
      const existing = this.jobs.get(existingId)!;
      if (existing.requestHash !== requestHash) throw new Error('Ключ задания уже использован с другим содержимым');
      if (!input.owner.authorities.includes('archive.jobs.read') && !input.owner.authorities.includes('archive.jobs.read.any')) {
        throw new Error('403: Чтение результата идемпотентного задания недоступно');
      }
      return this.publicJob(existing);
    }
    if (Buffer.byteLength(canonicalJson(input.payload)) > this.limits.maxPayloadBytes) throw new Error('Превышен лимит размера задания');
    const queued = [...this.jobs.values()].filter(job => job.status === 'queued').length;
    if (queued >= this.limits.maxQueue) throw new Error('Превышен лимит очереди тяжёлых заданий');
    const job: InternalJob = {
      id: `archive-job-${this.nextId++}`, kind: input.kind, status: 'queued', progress: 0, attempts: 0,
      owner: structuredClone(input.owner), idempotencyKey: input.idempotencyKey, requestHash, payload: structuredClone(input.payload), task,
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
    let worker: Worker;
    try {
      worker = new Worker(new URL('./job-worker.mjs', import.meta.url), {
        workerData: { ...job.task, payload: structuredClone(job.payload), attempt: job.attempts },
        resourceLimits: { maxOldGenerationSizeMb: this.limits.maxMemoryMb },
      });
    } catch (error) {
      this.active -= 1;
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      this.settleWaiters(job.id);
      this.pump();
      return;
    }
    this.workers.set(job.id, worker);
    let result: unknown;
    let resultReceived = false;
    let failure: string | null = null;
    worker.on('message', (message: { type?: string; progress?: number; result?: unknown; error?: string }) => {
      if (message.type === 'progress' && job.status === 'running') job.progress = Math.max(0, Math.min(99, message.progress ?? 0));
      if (message.type === 'result') { result = message.result; resultReceived = true; }
      if (message.type === 'error') failure = message.error ?? 'Ошибка worker';
    });
    worker.on('error', error => { failure = error.message; });
    const timer = setTimeout(() => {
      this.timeouts.add(job.id);
      void worker.terminate();
    }, this.limits.maxDurationMs);
    timer.unref();
    await new Promise<void>(resolve => {
      worker.once('exit', code => {
        clearTimeout(timer);
        this.workers.delete(job.id);
        this.active -= 1;
        if (this.cancellations.has(job.id)) job.status = 'cancelled';
        else if (this.timeouts.has(job.id)) {
          job.status = 'failed';
          job.error = 'Превышен лимит времени задания';
        } else if (failure || code !== 0 || !resultReceived) {
          job.status = 'failed';
          job.error = failure ?? 'Worker завершился без результата';
        } else {
          job.status = 'succeeded';
          job.progress = 100;
          job.result = result;
        }
        this.settleWaiters(job.id);
        resolve();
        this.pump();
      });
    });
  }

  private assertManage(job: InternalJob, actor: ArchiveJobActor): void {
    const any = actor.authorities.includes('archive.jobs.cancel.any');
    if (job.owner.organizationId !== actor.organizationId || (job.owner.userId !== actor.userId && !any)
      || (!actor.authorities.includes('archive.jobs.cancel') && !any)) {
      throw new Error('403: Управление чужим заданием запрещено');
    }
  }

  cancel(id: string, actor: ArchiveJobActor): ArchiveJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Задание не найдено');
    this.assertManage(job, actor);
    if (terminal(job.status)) return this.publicJob(job);
    this.cancellations.add(id);
    if (job.status === 'queued') {
      job.status = 'cancelled';
      this.settleWaiters(id);
    } else {
      const worker = this.workers.get(id);
      if (worker) void worker.terminate();
    }
    return this.publicJob(job);
  }

  retry(id: string, actor: ArchiveJobActor): ArchiveJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Задание не найдено');
    this.assertManage(job, actor);
    if (this.workers.has(id)) throw new Error('Старое выполнение ещё не завершено');
    if (job.status !== 'failed' && job.status !== 'cancelled') throw new Error('Повторять можно только завершённые failed или cancelled задания');
    this.cancellations.delete(id);
    this.timeouts.delete(id);
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
    const any = actor.authorities.includes('archive.jobs.read.any');
    if (job.owner.organizationId !== actor.organizationId || (job.owner.userId !== actor.userId && !any)
      || (!actor.authorities.includes('archive.jobs.read') && !any)) {
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
